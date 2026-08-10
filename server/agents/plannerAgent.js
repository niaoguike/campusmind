import { createAgent, tool } from 'langchain'
import { z } from 'zod'

export function createPlanDraftTool ({ db, userId, now }) {
  return tool(({ title, content, due_date }) => {
    const result = db.prepare('INSERT INTO study_plans (user_id,title,content,status,due_date) VALUES (?,?,?,?,?)')
      .run(userId, title, content, 'draft', due_date || null)
    return `已创建待确认计划草稿 #${result.lastInsertRowid}，请提醒学生到学习计划区确认后执行。`
  }, {
    name: 'create_plan_draft',
    description: '学生明确要求时创建可编辑学习计划草稿，绝不直接执行或覆盖已有计划。',
    schema: z.object({
      title: z.string().min(2).max(80),
      content: z.string().min(10).max(4000),
      due_date: z.string().max(30).optional()
    })
  })
}

export function createPlannerAgent ({ model, user, tools }) {
  return createAgent({
    model,
    tools,
    systemPrompt: `你是 CampusMind 的学习计划 Agent，服务对象为 ${user.name}。你的目标是把学习目标拆成可完成、可调整的计划。制定安排前必须调用 get_my_learning_snapshot；若需要课程资料或复习主题，调用 search_course_resources。只能读取当前学生数据。学生明确要求创建计划时才调用 create_plan_draft，并说明这是待确认草稿，绝不替学生直接执行。计划要避开已知课程时间，包含日期/时长/任务/完成标准；资料不足时要明确说明。用中文，简洁且可执行。`
  })
}
