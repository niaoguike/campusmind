import { createPlannerAgent } from './plannerAgent.js'
import { createTutorAgent } from './tutorAgent.js'
import { createReflectionAgent } from './reflectionAgent.js'

const PLAN_PATTERN = /(计划|安排|日程|复习表|学习表|任务清单|时间表|每天.*学|本周.*学|下周.*学)/
const RESOURCE_PATTERN = /(资料|课件|讲义|教材|ppt|pdf|文件夹|搜(?:索|一下)?|检索|在哪(?:里)?|有没有.*(?:课件|资料))/
const REFLECTION_PATTERN = /(薄弱|画像|复盘|学习偏好|记住|掌握.*(?:情况|程度)|分析.*(?:学习|错误|错题))/

/**
 * 规则分类始终保留为安全回退：模型不可用、超时或返回无效结果时，平台仍能提供服务。
 */
export function classifyLearningIntentFallback (content = '') {
  const text = String(content).replace(/\s+/g, '')
  if (PLAN_PATTERN.test(text)) return 'planner'
  if (RESOURCE_PATTERN.test(text)) return 'retrieval'
  if (REFLECTION_PATTERN.test(text)) return 'reflection'
  return 'tutor'
}

function plainModelContent (result) {
  return typeof result?.content === 'string' ? result.content : String(result?.content || '')
}

function parseIntentResult (raw, fallback) {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return fallback
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    const intent = String(value.intent || '')
    const confidence = Number(value.confidence || 0)
    return ['planner', 'retrieval', 'reflection', 'tutor'].includes(intent) && confidence >= 0.55 ? intent : fallback
  } catch {
    return fallback
  }
}

/**
 * 模型只负责理解自然语言，并且只能在固定的四个专业 Agent 中选择。
 * 它不获得数据库、写操作或平台权限；真正可用的工具仍由下面的确定性代码分配。
 */
export async function classifyLearningIntent ({ content = '', model }) {
  const fallback = classifyLearningIntentFallback(content)
  if (!model) return fallback
  try {
    const result = await model.invoke([
      {
        role: 'system',
        content: '你是 CampusMind 学习任务路由器。只返回一个 JSON 对象，不要解释：{"intent":"planner|retrieval|reflection|tutor","confidence":0到1}。planner 用于制定或调整学习计划、日程和任务；retrieval 用于查找、定位或核对课程资料；reflection 用于分析学习状态、薄弱点、偏好、复盘或记忆；tutor 用于概念讲解、解题引导和其他学习问答。用户同时涉及多项时，选择最终回答最需要的主 Agent。'
      },
      { role: 'user', content: String(content).slice(0, 4000) }
    ])
    return parseIntentResult(plainModelContent(result), fallback)
  } catch {
    return fallback
  }
}

export async function createLearningCoordinator ({ content, model, user, tools }) {
  const intent = await classifyLearningIntent({ content, model })

  if (intent === 'planner') {
    return {
      type: 'planner',
      label: '学习计划 Agent',
      agent: createPlannerAgent({ model, user, tools: [tools.search, tools.snapshot, tools.createPlanDraft, tools.remember] })
    }
  }

  if (intent === 'retrieval') {
    return {
      type: 'retrieval',
      label: '资料检索 Agent',
      agent: createTutorAgent({ model, user, tools: [tools.search] })
    }
  }

  if (intent === 'reflection') {
    return {
      type: 'reflection',
      label: '学习画像 Agent',
      agent: createReflectionAgent({ model, user, tools: [tools.snapshot, tools.remember] })
    }
  }

  return {
    type: 'tutor',
    label: '学习导师 Agent',
    agent: createTutorAgent({ model, user, tools: [tools.search, tools.snapshot, tools.remember] })
  }
}
