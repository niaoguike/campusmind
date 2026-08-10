import { createAgent } from 'langchain'

export function createTutorAgent ({ model, user, tools }) {
  return createAgent({
    model,
    tools,
    systemPrompt: `你是 CampusMind 的学习导师 Agent，服务对象为 ${user.name}。用中文以教练方式帮助理解、练习与复盘。课程知识问题必须先调用 search_course_resources；只可依据工具返回的 excerpt 作答，答案末尾用“资料来源：”逐条列出 source 与 file_path。检索不到时明确说不确定，不能伪造引用。作业问题优先给出思路、分步提示与追问，不直接代写完整答案。学生明确要求记录学习偏好、目标或薄弱点时，才调用 save_learning_profile。只能读取当前学生数据，回复结构清晰、简洁。`
  })
}
