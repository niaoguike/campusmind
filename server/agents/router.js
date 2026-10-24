// 复杂度路由：决定一次个人 Agent 请求需要多少编排成本。
//
//   direct  闲聊或平台说明，不需要检索与工具
//   single  单一学习意图，直接交给对应专业 Agent，跳过规划调用
//   multi   复合意图或带附件，交给 orchestrator 生成依赖图并调度
//
// 纯函数：不访问数据库、不调用模型、不写日志，便于单测与灰度。
// 注意：本模块只负责“该走哪条路”，不改变 coordinator 的意图分类结果。

import { PLAN_PATTERN, RESOURCE_PATTERN, REFLECTION_PATTERN } from './coordinator.js'

export const ROUTE_MODES = ['direct', 'single', 'multi']

// 整句只有问候、致谢或平台说明时才走 direct；带任何诉求都会落到后面的分支。
const DIRECT_PATTERN = /^(?:你好|您好|hi|hello|嗨|在吗|谢谢(?:你|您)?|多谢|好的|嗯|收到|你是谁|你能做什么|你能干什么|这个平台|怎么使用平台|使用说明|帮助)[\s!！。.？?~]*$/i

// “一次请求里办两件事”的连接词。
const COMPOSITE_PATTERN = /(?:并且|同时|顺便|然后|再帮我|另外|以及|既要|又要)/
// 显式分步描述：即使只命中一个关键词，也应拆分执行。
const STEPWISE_PATTERN = /(?:先.{0,12}再|首先.{0,20}然后|第一步)/
// 路由专用的“学习状态”表达；命中后主角色仍由 coordinator 的规则决定。
const EXTRA_REFLECTION_PATTERN = /(?:跟不上|落下|欠账|没听懂|学不会|成绩下降)/

export function classifyIntents (content = '') {
  const text = String(content || '').replace(/\s+/g, '')
  const intents = []
  if (PLAN_PATTERN.test(text)) intents.push('planner')
  if (RESOURCE_PATTERN.test(text)) intents.push('retrieval')
  if (REFLECTION_PATTERN.test(text) || EXTRA_REFLECTION_PATTERN.test(text)) intents.push('reflection')
  return intents
}

export function isDirectRequest (content = '') {
  return DIRECT_PATTERN.test(String(content || '').trim())
}

export function routeComplexity (content, { hasAttachment = false } = {}) {
  const raw = String(content || '').trim()
  const text = raw.replace(/\s+/g, '')

  if (!text.trim()) {
    if (hasAttachment) return { mode: 'multi', role: null, intents: [], reason: '只有附件，需要读取附件正文' }
    return { mode: 'direct', role: null, intents: [], reason: '空输入' }
  }
  // 带附件意味着必须读取附件正文，即使文字只是寒暄也应走多步编排。
  if (hasAttachment) return { mode: 'multi', role: null, intents: classifyIntents(text), reason: '带附件，需要多步处理' }
  if (isDirectRequest(raw)) return { mode: 'direct', role: null, intents: [], reason: '闲聊或平台说明' }

  const intents = classifyIntents(text)
  if (intents.length >= 2 && COMPOSITE_PATTERN.test(text)) {
    return { mode: 'multi', role: null, intents, reason: '连接词 + 多个学习意图' }
  }
  if (intents.length >= 2) return { mode: 'multi', role: null, intents, reason: '同时命中多个学习意图' }
  if (STEPWISE_PATTERN.test(text)) return { mode: 'multi', role: null, intents, reason: '显式分步请求' }

  const role = intents[0] || 'tutor'
  return {
    mode: 'single',
    role,
    intents,
    reason: intents.length ? `单一意图：${role}` : '未命中关键词，按通用问答处理'
  }
}
