import { createAgent, tool } from 'langchain';
import { z } from 'zod';

export function createRetrievalAgent({ model, tools }) {
  return createAgent({
    model,
    tools,
    systemPrompt: '你是 CampusMind 资料检索 Agent。必须调用 search_course_resources 查找原始请求涉及的课程资料，必要时使用不同短关键词检索。输出与子任务相关的证据摘要，逐项保留 source、页码和 file_path。检索不到时明确说明，不得编造来源或借助常识补写证据。你不能读取个人学习状态、制定计划或保存记忆。'
  });
}

/**
 * 资料检索 Agent 的唯一工具。
 * 它只接触已经解析到课程资料库中的片段，不接触用户的课表、计划、
 * 私人聊天或任何模型密钥。
 */
export function createCourseResourceSearchTool({ db, searchKnowledgeChunks }) {
  return tool(async ({ query }) => {
    const rows = await searchKnowledgeChunks(db, query);
    return rows.length ?
    JSON.stringify(rows) :
    '资源库没有找到可用正文片段；请明确告知学生，不要编造课程资料或引用。';
  }, {
    name: 'search_course_resources',
    description: '检索整个平台资料库中已解析的课程文件正文，并返回带课程、文件名、页码/幻灯片与文件链接的引用片段。回答课程知识问题前必须优先使用；检索词应尽量短且包含课程名、概念名或关键词。',
    schema: z.object({ query: z.string().min(1).max(120) })
  });
}
