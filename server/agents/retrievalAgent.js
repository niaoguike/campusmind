import { tool } from 'langchain';
import { z } from 'zod';

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
