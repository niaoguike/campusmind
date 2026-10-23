export const AGENT_META = {
  coordinator: { label: '学习编排器', description: '拆解任务、校验依赖并调度专业 Agent。' },
  retrieval: { label: '资料检索 Agent', description: '仅从已解析的课程资料库寻找依据。' },
  learning_state: { label: '学习画像 Agent', description: '只读取当前用户自己的学习状态摘要。' },
  planner: { label: '学习计划 Agent', description: '把目标转化为待确认的可执行任务。' },
  tutor: { label: '学习导师 Agent', description: '根据资料和学习状态进行分步讲解。' },
  reflection: { label: '学习复盘 Agent', description: '分析学习记录并给出调整建议。' },
  peer: { label: '同伴协作 Agent', description: '只基于他人明确授权的学习摘要回应。' },
  synthesis: { label: '整合 Agent', description: '汇总已完成的专业任务、资料引用和未完成项。' },
  group: { label: '群协作 Agent', description: '只使用群内已授权的任务、摘要和讨论内容。' }
}

export function traceLabel (type) {
  return AGENT_META[type]?.label || '学习 Agent'
}
