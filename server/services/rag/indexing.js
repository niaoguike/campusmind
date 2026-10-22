import { randomUUID } from 'node:crypto'
import { indexTokens, metadata } from './text.js'
import { CHUNKING_VERSION } from './chunking.js'
import { hash } from './config.js'

export const eligible = "COALESCE(r.review_status,'approved')='approved' AND (d.status IS NULL OR d.status='ready')"

export function createResourceIndexer({ db, embed, space, dimensions, timeout = 8000, onError = () => {} }) {
  let timer, running, closed = false, lastSync = 0
  async function enqueue(chunk) {
    if (!embed) return
    await db.query(`INSERT INTO resource_embedding_jobs(chunk_id,space_identity,content_hash,resource_revision)
      VALUES($1,$2,$3,$4) ON CONFLICT(chunk_id,space_identity) DO UPDATE SET
      content_hash=excluded.content_hash,resource_revision=excluded.resource_revision,state='pending',attempts=0,next_at=0,lease_until=0,last_error=''
      WHERE resource_embedding_jobs.content_hash IS DISTINCT FROM excluded.content_hash
         OR resource_embedding_jobs.resource_revision IS DISTINCT FROM excluded.resource_revision`, [chunk.id, space, chunk.content_hash, chunk.rag_revision])
  }
  async function replace(resourceId, chunks, { sourceHash = '' } = {}) {
    if (!chunks.length) throw new Error('RAG_EMPTY_DOCUMENT')
    return db.transaction(async () => {
      const resource = await db.prepare('SELECT r.*,c.name course_name FROM resources r JOIN courses c ON c.id=r.course_id WHERE r.id=? FOR UPDATE OF r').get(resourceId)
      if (!resource) return false
      await db.prepare('DELETE FROM resource_chunks WHERE resource_id=?').run(resourceId)
      const revision = randomUUID()
      for (const [index, chunk] of chunks.entries()) {
        const contentHash = hash(chunk.content)
        const inserted = await db.prepare(`INSERT INTO resource_chunks(resource_id,chunk_index,content,page_number,page_end,parent_page_number,parent_page_end,section_title,parent_index,parent_content,content_hash,index_revision,resource_revision,lexical_tokens,metadata_tokens)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(resourceId, index, chunk.content, chunk.pageNumber ?? null, chunk.pageEnd ?? chunk.pageNumber ?? null, chunk.parentPageNumber ?? chunk.pageNumber ?? null, chunk.parentPageEnd ?? chunk.pageEnd ?? chunk.pageNumber ?? null,
          chunk.sectionTitle || '', chunk.parentIndex ?? index, chunk.parentContent || chunk.content, contentHash, revision, resource.rag_revision,
          indexTokens(chunk.content), indexTokens(metadata({ ...resource, section_title: chunk.sectionTitle })))
        await db.prepare('INSERT INTO resource_chunks_fts(chunk_id,resource_id,content) VALUES(?,?,?)').run(inserted.insertId, resourceId, chunk.content)
        if ((resource.review_status || 'approved') === 'approved') await enqueue({ id: inserted.insertId, content_hash: contentHash, rag_revision: resource.rag_revision })
      }
      await db.prepare(`INSERT INTO resource_documents(resource_id,status,error_message,chunk_count,processed_at,chunking_version,source_hash)
        VALUES(?,'ready','',?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET status='ready',error_message='',chunk_count=excluded.chunk_count,
        processed_at=excluded.processed_at,chunking_version=excluded.chunking_version,source_hash=excluded.source_hash`).run(resourceId, chunks.length, new Date().toISOString(), CHUNKING_VERSION, sourceHash)
      return true
    })()
  }

  // Backfill legacy lexical indexes and queue only missing vectors. Completed
  // vectors in a different model space are kept separate, never mixed together.
  async function synchronize({ limit = 100, retryFailed = false } = {}) {
    if (retryFailed && space) await db.prepare("UPDATE resource_embedding_jobs SET state='pending',attempts=0,next_at=0,lease_until=0 WHERE space_identity=? AND state='failed'").run(space)
    const rows = (await db.query(`SELECT rc.*,r.rag_revision,r.title,r.file_name,r.tags,r.description,c.name course_name
      FROM resource_chunks rc JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id
      LEFT JOIN resource_documents d ON d.resource_id=r.id
      WHERE ${eligible} AND (rc.resource_revision<>r.rag_revision OR rc.content_hash=''
      OR ($1<>'' AND NOT EXISTS(SELECT 1 FROM resource_chunk_vectors v WHERE v.chunk_id=rc.id AND v.space_identity=$1 AND v.content_hash=rc.content_hash AND v.resource_revision=r.rag_revision)
        AND NOT EXISTS(SELECT 1 FROM resource_embedding_jobs j WHERE j.chunk_id=rc.id AND j.space_identity=$1 AND j.content_hash=rc.content_hash AND j.resource_revision=r.rag_revision)))
      ORDER BY rc.id LIMIT $2`, [space, limit])).rows
    for (const row of rows) {
      await db.transaction(async () => {
        // Serialize against resource metadata edits and document replacement.
        const resource = await db.prepare('SELECT r.*,c.name course_name FROM resources r JOIN courses c ON c.id=r.course_id WHERE r.id=? FOR UPDATE OF r').get(row.resource_id)
        if (!resource) return
        const current = await db.prepare('SELECT * FROM resource_chunks WHERE id=?').get(row.id)
        if (!current) return
        const contentHash = hash(current.content)
        await db.prepare('UPDATE resource_chunks SET content_hash=?,resource_revision=?,lexical_tokens=?,metadata_tokens=? WHERE id=?').run(contentHash, resource.rag_revision, indexTokens(current.content), indexTokens(metadata({ ...resource, section_title: current.section_title })), current.id)
        await enqueue({ id: current.id, content_hash: contentHash, rag_revision: resource.rag_revision })
      })()
    }
    return rows.length
  }

  async function drainOne() {
    if (!embed || closed) return false
    const now = Date.now(), lease = now + timeout + 30000 + Math.floor(Math.random() * 1000)
    await db.prepare("UPDATE resource_embedding_jobs SET state='failed',lease_until=0,last_error='LEASE_EXPIRED' WHERE space_identity=? AND state='running' AND lease_until<? AND attempts>=5").run(space, now)
    const job = (await db.query(`WITH picked AS (
      SELECT j.chunk_id FROM resource_embedding_jobs j JOIN resource_chunks rc ON rc.id=j.chunk_id
      JOIN resources r ON r.id=rc.resource_id LEFT JOIN resource_documents d ON d.resource_id=r.id
      WHERE j.space_identity=$1 AND j.attempts<5 AND ${eligible}
      AND ((j.state='pending' AND j.next_at<=$2) OR (j.state='running' AND j.lease_until<$2))
      ORDER BY j.next_at,j.chunk_id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE resource_embedding_jobs j SET state='running',attempts=j.attempts+1,lease_until=$3
      FROM picked WHERE j.chunk_id=picked.chunk_id AND j.space_identity=$1 RETURNING j.*`, [space, now, lease])).rows[0]
    if (!job) return false
    try {
      const chunk = await db.prepare(`SELECT rc.*,r.rag_revision,r.title,r.file_name,r.tags,r.description,c.name course_name
        FROM resource_chunks rc JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id WHERE rc.id=?`).get(job.chunk_id)
      if (!chunk) return true
      if (chunk.content_hash !== job.content_hash || chunk.rag_revision !== job.resource_revision) {
        await enqueue({ id: chunk.id, content_hash: chunk.content_hash, rag_revision: chunk.rag_revision }); return true
      }
      const vector = await embed(`${metadata(chunk).slice(0, 700)}\n${chunk.content}`)
      if (!Array.isArray(vector) || vector.length !== dimensions || vector.some(n => !Number.isFinite(n)) || !vector.some(n => n !== 0)) throw new Error('RAG_INVALID_VECTOR')
      await db.transaction(async () => {
        // Lock the resource before the job, matching replace/synchronize's order.
        const current = await db.prepare('SELECT r.rag_revision FROM resources r WHERE r.id=? FOR UPDATE').get(chunk.resource_id)
        if (!current) return
        const claimed = await db.prepare('SELECT * FROM resource_embedding_jobs WHERE chunk_id=? AND space_identity=? FOR UPDATE').get(job.chunk_id, space)
        if (!claimed || claimed.lease_until !== lease || claimed.content_hash !== job.content_hash || claimed.resource_revision !== job.resource_revision) return
        if (current.rag_revision !== job.resource_revision) {
          await enqueue({ id: chunk.id, content_hash: chunk.content_hash, rag_revision: current.rag_revision }); return
        }
        await db.query(`INSERT INTO resource_chunk_vectors(chunk_id,space_identity,content_hash,resource_revision,embedding)
          VALUES($1,$2,$3,$4,$5::vector) ON CONFLICT(chunk_id,space_identity) DO UPDATE SET content_hash=excluded.content_hash,
          resource_revision=excluded.resource_revision,embedding=excluded.embedding,updated_at=NOW()`, [job.chunk_id, space, job.content_hash, job.resource_revision, JSON.stringify(vector)])
        await db.prepare('DELETE FROM resource_embedding_jobs WHERE chunk_id=? AND space_identity=?').run(job.chunk_id, space)
      })()
    } catch (error) {
      await db.prepare(`UPDATE resource_embedding_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        next_at=?,lease_until=0,last_error=? WHERE chunk_id=? AND space_identity=? AND lease_until=?`).run(Date.now() + Math.min(60000, 1000 * 2 ** job.attempts), 'EMBEDDING_UNAVAILABLE', job.chunk_id, space, lease)
      onError(error)
    }
    return true
  }
  async function tick() {
    if (running || closed) return running
    running = (async () => {
      if (Date.now() - lastSync > 30000) { await synchronize(); lastSync = Date.now() }
      await drainOne()
    })().catch(onError).finally(() => { running = null })
    return running
  }
  return { replace, synchronize, drainOne,
    start() { if (!timer && !closed) { timer = setInterval(tick, 1500); timer.unref(); void tick() } },
    async close() { closed = true; clearInterval(timer); await running },
    async status() { return (await db.query('SELECT state,COUNT(*) count FROM resource_embedding_jobs WHERE space_identity=$1 GROUP BY state', [space])).rows }
  }
}
