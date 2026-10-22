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
export function createCourseResourceSearchTool({ db, searchKnowledgeChunks, history = [], originalQuery, courseId = 0, rewriteModel }) {
  const pending = new Map();
  return tool(async ({ query }) => {
    const key = `${courseId}:${query.trim()}`;
    if (!pending.has(key)) pending.set(key, searchKnowledgeChunks(db, query, 8, courseId, { history, originalQuery: originalQuery || query, rewriteModel }));
    let rows;
    try { rows = await pending.get(key); } catch (error) { pending.delete(key); throw error; }
    return rows.length ?
    JSON.stringify(rows) :
    '资源库没有找到可用正文片段；请明确告知学生，不要编造课程资料或引用。';
  }, {
    name: 'search_course_resources',
    description: '用关键词和语义混合检索已审核的课程文件，返回完整段落、章节、页码与文件链接。多轮追问会结合本会话前文补全主题；检索词应包含课程名、概念或关键词。',
    schema: z.object({ query: z.string().min(1).max(120) })
  });
}
