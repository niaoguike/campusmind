/** Only the recent window is sent to the model; PostgreSQL owns all messages. */
export async function loadRecentThreadMessages ({ db, cache, threadId, userId, limit = 12 }) {
  const load = async () => (await db.prepare(`SELECT m.id,m.role,m.content,m.attachments_json
    FROM agent_messages m JOIN agent_threads t ON t.id=m.thread_id
    WHERE m.thread_id=? AND t.user_id=? ORDER BY m.id DESC LIMIT ?`).all(threadId, userId, limit)).reverse()
  return cache && limit === 12 ? cache.recent(userId, threadId, load) : load()
}

export async function buildThreadHistory ({ db, cache, messages, threadId, userId, attachmentContext, limit = 12 }) {
  const recent = messages || await loadRecentThreadMessages({ db, cache, threadId, userId, limit })
  const ids = [...new Set(recent.flatMap(message => JSON.parse(message.attachments_json || '[]').map(item => Number(item.id)).filter(Boolean)))]
  const rows = ids.length ? await db.prepare(`SELECT * FROM agent_attachments WHERE user_id=? AND thread_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(userId, threadId, ...ids) : []
  const attachments = new Map(rows.map(row => [row.id, row]))
  return recent.map(message => ({ role: message.role, content: message.content + JSON.parse(message.attachments_json || '[]')
    .map(item => attachments.get(Number(item.id))).filter(Boolean).map(attachmentContext).join('') }))
}
