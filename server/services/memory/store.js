import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const publicColumns = 'id,memory_key,kind,content,evidence,source_thread_id,source_message_id,confidence,authority,revision,expires_at,created_at,updated_at'

export function createMemoryStore ({ pool, dimensions, identity, onMutation = async () => {}, ownsPool = true }) {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) throw new Error('MEMORY_INVALID_DIMENSIONS')
  const vectorLiteral = values => {
    if (!Array.isArray(values) || values.length!==dimensions || values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new Error('MEMORY_INVALID_VECTOR')
    return `[${values.join(',')}]`
  }
  let initializing
  async function ready () {
    if (!initializing) initializing = (async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(782431901)')
        await client.query('CREATE EXTENSION IF NOT EXISTS vector')
        const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
        await client.query(schema.replaceAll('__DIMENSIONS__', String(dimensions)))
        await client.query('INSERT INTO campusmind_memory_space (singleton,identity,dimensions) VALUES (TRUE,$1,$2) ON CONFLICT DO NOTHING', [identity, dimensions])
        const { rows } = await client.query('SELECT identity,dimensions FROM campusmind_memory_space WHERE singleton=TRUE')
        if (rows[0].identity !== identity || Number(rows[0].dimensions) !== dimensions) throw new Error('MEMORY_EMBEDDING_SPACE_CHANGED')
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    })().catch(error => { initializing = null; throw error })
    return initializing
  }
  async function transaction (userId, run) {
    await ready()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Serialize extraction, edits and erasure for this user across API processes.
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId])
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async function list (userId, offset = 0, limit = 100) {
    await ready()
    return (await pool.query(`SELECT ${publicColumns} FROM campusmind_memories WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC,id LIMIT $2 OFFSET $3`, [userId, limit, offset])).rows
  }
  async function get (userId, id) {
    await ready()
    return (await pool.query(`SELECT ${publicColumns} FROM campusmind_memories WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL`, [userId, id])).rows[0] || null
  }
  async function candidates (userId) {
    await ready()
    return (await pool.query('SELECT id,memory_key,kind,content,revision,authority,deleted_at,source_message_id FROM campusmind_memories WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100', [userId])).rows
  }
  async function search (userId, vector, limit = 6, minimum = 0.5) {
    await ready()
    // Exact search over the tenant subset avoids ANN post-filter under-recall.
    // Personal memory volumes are small; add partitioned ANN when measured scale warrants it.
    return (await pool.query(`WITH mine AS MATERIALIZED (
      SELECT * FROM campusmind_memories WHERE user_id=$1 AND deleted_at IS NULL
      AND embedding IS NOT NULL AND (expires_at IS NULL OR expires_at>NOW())
    ) SELECT ${publicColumns},1-(embedding <=> $2::vector) AS similarity FROM mine
      WHERE 1-(embedding <=> $2::vector)>=$3 ORDER BY embedding <=> $2::vector LIMIT $4`, [userId, vectorLiteral(vector), minimum, limit])).rows
  }
  async function writeAutomatic (userId, items) {
    return transaction(userId, async client => {
      if((await client.query('SELECT 1 FROM memory_erased_users WHERE user_id=$1',[userId])).rows.length)return 0
      let written = 0
      for (const item of items) {
        const existing = (await client.query('SELECT * FROM campusmind_memories WHERE user_id=$1 AND memory_key=$2', [userId, item.key])).rows[0]
        // Manual edits and deletion tombstones cannot be undone by stale extraction jobs.
        if (existing && (existing.deleted_at || existing.authority === 'user' || Number(existing.source_message_id) > item.messageId)) continue
        if (existing && existing.content === item.content) continue
        await client.query(`INSERT INTO campusmind_memories
          (id,user_id,memory_key,kind,content,evidence,source_thread_id,source_message_id,confidence,embedding,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11)
          ON CONFLICT (user_id,memory_key) DO UPDATE SET kind=excluded.kind,content=excluded.content,
          evidence=excluded.evidence,source_thread_id=excluded.source_thread_id,source_message_id=excluded.source_message_id,
          confidence=excluded.confidence,embedding=excluded.embedding,expires_at=excluded.expires_at,
          revision=campusmind_memories.revision+1,updated_at=NOW()`,
        [randomUUID(), userId, item.key, item.kind, item.content, item.evidence, item.threadId, item.messageId, item.confidence, vectorLiteral(item.vector), item.expiresAt])
        written++
      }
      return written
    })
  }
  async function edit (userId, id, content, vector, revision) {
    return transaction(userId, async client => {
      const row=(await client.query(`UPDATE campusmind_memories SET content=$3,
      embedding=$4::vector,authority='user',evidence='',confidence=1,expires_at=NULL,revision=revision+1,updated_at=NOW()
      WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL AND revision=$5 RETURNING ${publicColumns}`,
    [userId, id, content, vectorLiteral(vector), revision])).rows[0] || null
      if(row)await onMutation(client,userId)
      return row
    })
  }
  async function erase (userId, id) {
    return transaction(userId, async client => {
      const changed=(await client.query(`UPDATE campusmind_memories SET content='',evidence='',
      embedding=NULL,source_thread_id=NULL,source_message_id=NULL,deleted_at=NOW(),authority='user',revision=revision+1,
      updated_at=NOW() WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [userId, id])).rowCount > 0
      if(changed)await onMutation(client,userId)
      return changed
    })
  }
  async function eraseUser (userId) {
    return transaction(userId, async client => {
      await client.query('INSERT INTO memory_erased_users(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[userId])
      await client.query('DELETE FROM campusmind_memories WHERE user_id=$1', [userId])
      await onMutation(client,userId)
    })
  }
  return { ready, list, get, candidates, search, writeAutomatic, edit, erase, eraseUser, close: () => ownsPool ? pool.end() : Promise.resolve() }
}
