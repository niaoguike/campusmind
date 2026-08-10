/**
 * 只构建当前会话最近的上下文。旧消息不直接无限传给模型，避免费用和上下文膨胀。
 */
export function buildThreadHistory ({ db, threadId, userId, attachmentContext, limit = 12 }) {
  return db.prepare('SELECT role,content,attachments_json FROM agent_messages WHERE thread_id=? ORDER BY id DESC LIMIT ?')
    .all(threadId, limit)
    .reverse()
    .map(message => {
      const ids = JSON.parse(message.attachments_json || '[]').map(item => Number(item.id)).filter(Boolean)
      const rows = ids.length
        ? db.prepare(`SELECT * FROM agent_attachments WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(userId, ...ids)
        : []
      return { role: message.role, content: message.content + rows.map(attachmentContext).join('') }
    })
}
