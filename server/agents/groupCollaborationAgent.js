import { createAgent, tool } from 'langchain'
import { z } from 'zod'

export function createGroupFacilitatorAgent ({ model, groupName, workspace }) {
  const readWorkspace = tool(() => JSON.stringify(workspace), {
    name: 'get_group_workspace',
    description: '读取当前学习群已授权的群消息摘要、群任务和成员自愿共享的学习状态。必须在生成建议前调用。',
    schema: z.object({})
  })
  return createAgent({
    model,
    tools: [readWorkspace],
    systemPrompt: `你是 CampusMind 学习群“${groupName}”的小组协作 Agent。你只能基于 get_group_workspace 返回的群共享数据进行总结，不得猜测或泄露任何成员的私人课表、个人计划、私聊、学习画像、身份信息或 API Key。生成群复习建议前必须调用 get_group_workspace。最终严格只输出 JSON：{"summary":"不超过500字的群学习总结","agenda":["议程1"],"task_proposals":[{"title":"任务标题","description":"任务说明","assignee_id":null,"due_date":"可选日期"}]}。任务最多 5 项；assignee_id 只能使用群成员列表中的 id，无法合理分配时必须为 null。不得输出 Markdown。`
  })
}

export function normalizeGroupProposal (value, memberIds) {
  const raw = value && typeof value === 'object' ? value : {}
  const allowed = new Set(memberIds.map(Number))
  const taskProposals = Array.isArray(raw.task_proposals) ? raw.task_proposals.slice(0, 5).map(item => ({
    title: String(item?.title || '').trim().slice(0, 100),
    description: String(item?.description || '').trim().slice(0, 1000),
    assignee_id: allowed.has(Number(item?.assignee_id)) ? Number(item.assignee_id) : null,
    due_date: String(item?.due_date || '').trim().slice(0, 30)
  })).filter(item => item.title && item.description) : []
  return {
    summary: String(raw.summary || '小组协作 Agent 暂未生成有效总结。').trim().slice(0, 600),
    agenda: Array.isArray(raw.agenda) ? raw.agenda.map(item => String(item).trim().slice(0, 160)).filter(Boolean).slice(0, 6) : [],
    task_proposals: taskProposals
  }
}
