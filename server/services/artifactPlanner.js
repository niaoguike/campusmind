function clamp (value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback
}

function cleanText (value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function jsonFromText (value) {
  const text = String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回可识别的结构化内容')
  return JSON.parse(text.slice(start, end + 1))
}

function normalizeSlides (items, count) {
  const normalized = Array.isArray(items) ? items.map((item, index) => ({
    title: cleanText(item?.title, 42) || `第 ${index + 1} 部分`,
    takeaway: cleanText(item?.takeaway, 90),
    bullets: (Array.isArray(item?.bullets) ? item.bullets : []).map(point => cleanText(point, 74)).filter(Boolean).slice(0, 4),
    example: cleanText(item?.example, 100),
    visual_hint: cleanText(item?.visual_hint, 90)
  })).filter(item => item.bullets.length || item.takeaway) : []
  const result = normalized.slice(0, count)
  while (result.length < count) result.push({ title: `学习要点 ${result.length + 1}`, takeaway: '围绕核心概念建立理解与应用联系。', bullets: ['定义关键概念', '联系课程材料', '完成一个小练习'], example: '', visual_hint: '' })
  return result
}

export async function designLearningArtifact ({ requestChat, model, mode, pages, style, focus, conversation }) {
  const totalPages = clamp(pages, 4, 16, 8)
  const bodyPages = mode === 'ppt' ? Math.max(3, totalPages - 1) : Math.max(3, totalPages - 2)
  const selectedStyle = ['课程复习', '课堂汇报', '大创答辩'].includes(style) ? style : '课程复习'
  const source = String(conversation || '').slice(-24000)
  const formatRule = mode === 'ppt'
    ? `请设计 ${bodyPages} 页内容页；封面由系统自动生成，因此 slides 必须刚好有 ${bodyPages} 项。`
    : '请设计清晰的报告章节，sections 建议有 4 至 8 项。'
  const prompt = `你是大学学习成果设计师。请基于给定对话内容，为学生制作一份“${selectedStyle}”风格的${mode === 'ppt' ? 'PPT' : mode === 'word' ? 'Word 学习报告' : 'PDF 学习报告'}。
额外侧重点：${cleanText(focus, 180) || '无'}。
${formatRule}
必须只依据给定内容；资料不足时在对应要点明确写“需要补充课程资料”，绝不编造事实、数据、引用或图片来源。语言面向大学生，标题应表达结论而不是只写主题。每页不超过 4 个短要点，避免密集长段落。只输出合法 JSON，不要 Markdown，不要解释。
JSON 格式：
{"title":"成果标题","subtitle":"一句副标题","summary":"100 字以内摘要","slides":[{"title":"结论式标题","takeaway":"本页核心结论","bullets":["要点1","要点2"],"example":"可选例子或练习","visual_hint":"建议使用的简单图示"}],"sections":[{"heading":"章节标题","paragraph":"正文概述","points":["要点1","要点2"]}],"review_questions":["复习问题"]}

对话内容：
${source}`
  const response = await requestChat({
    model,
    temperature: 0.25,
    max_tokens: 5000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是 CampusMind 成果生成 Agent。必须输出一个合法 JSON 对象，严格遵守用户给定的 JSON 格式。' },
      { role: 'user', content: prompt }
    ]
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(`模型成果设计请求失败（${response.status}）：${detail.slice(0, 180)}`)
    error.status = response.status
    throw error
  }
  const payload = await response.json()
  const raw = jsonFromText(payload?.choices?.[0]?.message?.content)
  const title = cleanText(raw.title, 55) || '学习成果汇报'
  const subtitle = cleanText(raw.subtitle, 100)
  const summary = cleanText(raw.summary, 260)
  const slides = normalizeSlides(raw.slides, bodyPages)
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map(item => ({ heading: cleanText(item?.heading, 55), paragraph: cleanText(item?.paragraph, 300), points: (Array.isArray(item?.points) ? item.points : []).map(point => cleanText(point, 120)).filter(Boolean).slice(0, 5) })).filter(item => item.heading || item.paragraph).slice(0, 8)
  const reviewQuestions = (Array.isArray(raw.review_questions) ? raw.review_questions : []).map(item => cleanText(item, 120)).filter(Boolean).slice(0, 6)
  return { title, subtitle, summary, slides, sections, reviewQuestions, style: selectedStyle, totalPages }
}

export function artifactPlanMarkdown (plan, mode) {
  const lines = []
  if (plan.subtitle) lines.push(`> ${plan.subtitle}`)
  if (plan.summary) lines.push(`> 摘要：${plan.summary}`)
  if (mode === 'ppt') {
    for (const slide of plan.slides) {
      lines.push(`## ${slide.title}`)
      if (slide.takeaway) lines.push(`- 核心结论：${slide.takeaway}`)
      for (const bullet of slide.bullets) lines.push(`- ${bullet}`)
      if (slide.example) lines.push(`- 示例/练习：${slide.example}`)
      if (slide.visual_hint) lines.push(`- 图示建议：${slide.visual_hint}`)
    }
  } else {
    const content = plan.sections.length ? plan.sections : plan.slides.map(slide => ({ heading: slide.title, paragraph: slide.takeaway, points: [...slide.bullets, slide.example].filter(Boolean) }))
    for (const section of content) {
      lines.push(`## ${section.heading}`)
      if (section.paragraph) lines.push(section.paragraph)
      for (const point of section.points) lines.push(`- ${point}`)
    }
    if (plan.reviewQuestions.length) {
      lines.push('## 复习自测')
      for (const question of plan.reviewQuestions) lines.push(`- ${question}`)
    }
  }
  return lines.join('\n\n')
}
