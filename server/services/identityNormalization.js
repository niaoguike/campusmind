const LIST_SEPARATOR = /\s*(?:和|以及|、|,|，|;|；|\/|\\|\+|&)\s*/u
const CLASS_NUMBER = /(?:第\s*)?(\d+)(?:\s*(?:班|级))?/gu

function clean(value = '') {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/gu, ' ').trim()
}

export function splitIdentityList(value = '') {
  return clean(value).split(LIST_SEPARATOR).map(item => clean(item)).filter(Boolean)
}

export function normalizeCollegeKey(value = '') {
  return clean(value)
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·.。_-]+/gu, '')
    .replace(/(学院|学部|系)$/u, '')
}

function collegeLabel(value = '') {
  const text = clean(value).replace(/[，,、；;]+$/gu, '')
  if (!text) return ''
  if (/(学院|学部|系)$/u.test(text) || !/[\u4e00-\u9fff]/u.test(text)) return text
  return `${text}学院`
}

function uniqueByKey(items) {
  const seen = new Set()
  return items.filter(item => {
    if (!item.key || seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

function normalizedColleges(value = '') {
  return uniqueByKey(splitIdentityList(value).map(raw => ({
    key: normalizeCollegeKey(raw),
    label: collegeLabel(raw)
  })))
}

function collegeMatchesHint(college, hint) {
  const hintKey = normalizeCollegeKey(hint)
  return Boolean(hintKey && (hintKey === college.key || hintKey.includes(college.key) || college.key.includes(hintKey)))
}

function parseClassEntries(value = '') {
  const entries = []
  let inheritedHint = ''
  for (const segment of splitIdentityList(value.replace(/与|及/gu, '和'))) {
    const matches = [...segment.matchAll(CLASS_NUMBER)]
    if (!matches.length) continue
    const firstNumberIndex = matches[0].index ?? 0
    const explicitHint = clean(segment.slice(0, firstNumberIndex)).replace(/^第/u, '').trim()
    if (explicitHint) inheritedHint = explicitHint
    for (const match of matches) {
      entries.push({ classKey: match[1], collegeHint: explicitHint || inheritedHint })
    }
  }
  return entries
}

function targetLabel(college, classKey) {
  return `${college.label}${classKey}班`
}

export function normalizeStudentIdentity(collegeInput, classInput) {
  const colleges = normalizedColleges(collegeInput)
  const entries = parseClassEntries(classInput)
  if (colleges.length !== 1) return { ok: false, error: '学生请填写一个学院；多个学院请分开注册账号' }
  if (entries.length !== 1) return { ok: false, error: '班级中需要包含一个数字班级标识，例如“13”“13班”或“软件13班”' }
  const entry = entries[0]
  if (entry.collegeHint && !collegeMatchesHint(colleges[0], entry.collegeHint)) {
    return { ok: false, error: '班级中的学院与所属学院不一致，请检查填写内容' }
  }
  return {
    ok: true,
    college: colleges[0].label,
    collegeKey: colleges[0].key,
    className: entry.classKey,
    classKey: entry.classKey,
    collegeRaw: clean(collegeInput),
    classRaw: clean(classInput)
  }
}

export function normalizeCourseTargets(collegeInput, classInput) {
  const colleges = normalizedColleges(collegeInput)
  const entries = parseClassEntries(classInput)
  if (!colleges.length) return { ok: false, error: '请至少填写一个学院' }
  if (!entries.length) return { ok: false, error: '班级中需要包含数字标识，例如“12和13班”或“软件13班、计算机2班”' }

  const targets = []
  const add = (college, entry) => {
    const key = `${college.key}:${entry.classKey}`
    if (!targets.some(item => item.key === key)) targets.push({
      key,
      collegeKey: college.key,
      college: college.label,
      classKey: entry.classKey,
      className: entry.classKey,
      label: targetLabel(college, entry.classKey)
    })
  }

  const hasHints = entries.some(entry => entry.collegeHint)
  if (!hasHints && colleges.length > 1 && entries.length === colleges.length) {
    entries.forEach((entry, index) => add(colleges[index], entry))
  } else {
    for (const entry of entries) {
      const matches = entry.collegeHint ? colleges.filter(college => collegeMatchesHint(college, entry.collegeHint)) : colleges
      if (!matches.length) return { ok: false, error: `无法识别“${entry.collegeHint}${entry.classKey}班”对应的学院，请使用学院名称或简称` }
      matches.forEach(college => add(college, entry))
    }
  }

  return {
    ok: true,
    colleges,
    targets,
    college: colleges.map(item => item.label).join('、'),
    className: [...new Set(targets.map(item => item.classKey))].join('、'),
    collegeRaw: clean(collegeInput),
    classRaw: clean(classInput)
  }
}

export function normalizedTargetRows(parsed) {
  return (parsed?.targets || []).map(item => ({
    collegeKey: item.collegeKey,
    college: item.college,
    classKey: item.classKey,
    className: item.className
  }))
}
