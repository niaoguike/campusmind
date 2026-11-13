// Only self-contained, source-free turns may skip retrieval and planning.
// Ambiguous turns stay on the evidence-backed orchestration path.
const GREETING = /^(?:你好|您好|嗨|哈喽|hello|hi|hey|早上好|下午好|晚上好|谢谢|多谢|感谢|再见|拜拜)[！!。,.，？?\s]*$/i
const GENERAL_EXPLANATION = /^(?:请|麻烦|能否|可以|帮我)?\s*(?:简单|通俗|简要)?\s*(?:解释(?:一下|下)?|讲讲|介绍(?:一下|下)?|什么是|何为|如何理解)\s*[^。！？!?]{1,50}[。！？!?]?$/
const NEEDS_CONTEXT = /(这个|那个|上述|上面|刚才|之前|继续|再来|它|这道|那道|这里|其中|我(?:的|上次|之前|现在)|咱们|我们(?:的)?|根据|结合|按照|参考|课件|讲义|教材|资料|文件|附件|老师|课程|本课|课堂|题目|作业|测验|错题|记录|成绩|进度|计划|安排|复习|记住|保存|上传|下载|发送|发布|创建|删除|修改|群|论坛|好友|agent|api|今天|明天|最新|现在|最近)/i

export function directChatEligible ({ content = '', mode = 'study', attachments = [], priorMessages = [], exportMode = '' } = {}) {
  const text = String(content).trim()
  if (!text || attachments.length || exportMode) return false
  if (GREETING.test(text)) return true
  if (mode !== 'study' || priorMessages.length || NEEDS_CONTEXT.test(text)) return false
  return GENERAL_EXPLANATION.test(text)
}

export function createDirectChatRun ({ model }) {
  const plan = { intent: 'tutor', steps: [{ agent: 'tutor', task: '直接回答独立的通用问题，不读取课程资料或个人记录。', dependsOn: [] }], source: 'direct' }
  return {
    type: 'tutor', label: '直接问答', plan, finalAgent: 'tutor',
    async invoke ({ messages, onStep = async () => {} }) {
      await onStep('tutor', { status: 'running', input: plan.steps[0].task })
      const result = await model.invoke([
        { role: 'system', content: '你是 CampusMind 学习助手。简洁、自然地回答用户当前的独立通用问题。不要声称查看过课程资料、个人记录或平台状态；不能提供资料引用，也不能声称执行了任何平台操作。若问题实际依赖这些信息，请明确说明缺少依据并请用户给出资料或具体上下文。' },
        ...messages.filter(message => message.role === 'user').slice(-1)
      ], { signal: AbortSignal.timeout(45000) })
      const answer = typeof result?.content === 'string' ? result.content.trim() : ''
      if (!answer) throw new Error('直接问答返回空结果')
      await onStep('tutor', { status: 'done', output: answer })
      return { answer, results: [{ agent: 'tutor', status: 'done', output: answer }], status: 'done' }
    }
  }
}
