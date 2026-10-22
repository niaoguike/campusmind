import { tool } from 'langchain';
import { z } from 'zod';

/**
 * 个人学习状态 Agent 的受限工具集。
 * 所有 SQL 都强制使用当前 userId，因此 Agent 不能跨用户读取私有信息。
 */
export function createLearningStateTools({ db, userId, now, longTermMemoryEnabled = false }) {
  const snapshot = tool(async () => JSON.stringify({
    schedule: await db.prepare('SELECT course_name,weekday,start_time,end_time,location FROM schedules WHERE user_id=? ORDER BY weekday,start_time').all(userId),
    plans: await db.prepare("SELECT title,content,status,due_date FROM study_plans WHERE user_id=? AND status!='done' ORDER BY id DESC LIMIT 5").all(userId),
    profile: longTermMemoryEnabled ?
    '已启用跨会话长期记忆，请使用本轮已召回的记忆；不要使用旧版单条画像推断当前偏好。' :
    (await db.prepare('SELECT content FROM agent_memories WHERE user_id=? AND memory_key=?').get(userId, 'learning_profile'))?.content || '尚未建立学习画像',
    mastery: await db.prepare(`SELECT kp.name,kp.course_id,um.mastery,um.attempts FROM user_knowledge_mastery um
      JOIN knowledge_points kp ON kp.id=um.knowledge_point_id WHERE um.user_id=? ORDER BY um.mastery ASC LIMIT 8`).all(userId)
  }), {
    name: 'get_my_learning_snapshot',
    description: '读取当前学生自己的课表、未完成计划和学习画像；制定安排或进行学习复盘前调用。',
    schema: z.object({})
  });

  const remember = tool(async ({ summary }) => {
    if (longTermMemoryEnabled) return '已启用自动长期记忆，系统会从用户本条原文提取学习事实并异步保存。请勿声称尚未完成的记忆写入已成功；用户可在“跨会话长期记忆”中查看写入结果。';
    await db.prepare("INSERT INTO agent_memories (user_id,memory_key,content,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,memory_key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at").
    run(userId, 'learning_profile', summary, now());
    return '已更新学习画像，只记录学习偏好、目标和薄弱点。';
  }, {
    name: 'save_learning_profile',
    description: '学生明确要求记住目标、偏好或薄弱点时使用。不得记录与学习无关的敏感信息。',
    schema: z.object({ summary: z.string().min(5).max(600) })
  });

  return { snapshot, remember };
}
