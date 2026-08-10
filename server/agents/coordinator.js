import { createPlannerAgent } from './plannerAgent.js'
import { createTutorAgent } from './tutorAgent.js'
import { createReflectionAgent } from './reflectionAgent.js'

const PLAN_PATTERN = /(计划|安排|日程|复习表|学习表|任务清单|时间表|每天.*学|本周.*学|下周.*学)/
const RESOURCE_PATTERN = /(资料|课件|讲义|教材|ppt|pdf|文件夹|搜(?:索|一下)?|检索|在哪(?:里)?|有没有.*(?:课件|资料))/
const REFLECTION_PATTERN = /(薄弱|画像|复盘|学习偏好|记住|掌握.*(?:情况|程度)|分析.*(?:学习|错误|错题))/

/**
 * 第一阶段的协调器使用可审计的规则路由，而不是先额外调用一次大模型。
 * 这样不增加费用，也能让每次回答明确归属到一个专业 Agent。
 */
export function classifyLearningIntent (content = '') {
  const text = String(content).replace(/\s+/g, '')
  if (PLAN_PATTERN.test(text)) return 'planner'
  if (RESOURCE_PATTERN.test(text)) return 'retrieval'
  if (REFLECTION_PATTERN.test(text)) return 'reflection'
  return 'tutor'
}

export function createLearningCoordinator ({ content, model, user, tools }) {
  const intent = classifyLearningIntent(content)

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
