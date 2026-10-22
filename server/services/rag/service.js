import { ragConfig } from './config.js'
import { tokens, aliases, cleanText } from './text.js'
import { rewriteQuery } from './rewrite.js'
import { reciprocalRankFusion, assembleContext } from './ranking.js'
import { createResourceIndexer, eligible } from './indexing.js'

const select = 'rc.*,rc.id chunk_id,r.rag_revision candidate_revision,r.title,r.file_name,r.file_path,r.url,c.name course_name'
const from = 'resource_chunks rc JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id LEFT JOIN resource_documents d ON d.resource_id=r.id'
export function createResourceRag({ db, env = process.env, embedding, space, dimensions, rerank, onError = () => {} }) {
  const config = ragConfig(env)
  if (embedding !== undefined) config.embed = embedding
  if (space !== undefined) config.space = space
  if (dimensions !== undefined) config.dimensions = dimensions
  if (rerank !== undefined) config.rerank = rerank
  const indexer = createResourceIndexer({ db, ...config, onError })
  async function keyword(query, original, courseId, count) {
    const terms = [...new Set(tokens([query, original, ...aliases(query)].join(' ')))].slice(0, 32)
    if (!terms.length) return []
    const expression = terms.map(term => `'${term.replaceAll("'", "''")}'`).join(' | ')
    return (await db.query(`WITH q AS (SELECT to_tsquery('simple',$1) ts, $2::text[] terms)
      SELECT ${select},
      CASE WHEN rc.resource_revision=r.rag_revision THEN ts_rank_cd(rc.rag_search,q.ts) ELSE 0 END + (
        SELECT COUNT(*)::float/GREATEST(cardinality(q.terms),1) FROM unnest(q.terms) term
        WHERE strpos(lower(rc.content || ' ' || r.title || ' ' || COALESCE(r.tags,'') || ' ' || COALESCE(r.description,'') || ' ' || COALESCE(r.file_name,'') || ' ' || c.name),term)>0
      ) lexical_score
      FROM ${from} CROSS JOIN q
      WHERE ${eligible} AND ($3::bigint=0 OR r.course_id=$3)
      AND ((rc.resource_revision=r.rag_revision AND rc.rag_search @@ q.ts) OR ((rc.content_hash='' OR rc.resource_revision<>r.rag_revision) AND EXISTS (
        SELECT 1 FROM unnest(q.terms) term WHERE strpos(lower(rc.content || ' ' || r.title || ' ' || COALESCE(r.tags,'') || ' ' || COALESCE(r.description,'') || ' ' || COALESCE(r.file_name,'') || ' ' || c.name),term)>0)))
      ORDER BY lexical_score DESC,rc.id ASC LIMIT $4`, [expression, terms, courseId, count])).rows
  }
  async function vector(query, courseId, count) {
    if (!config.embed || !config.space) return []
    // Avoid a model call when this scope has no usable vectors yet.
    const available = await db.query(`SELECT 1 FROM ${from} JOIN resource_chunk_vectors v ON v.chunk_id=rc.id
      WHERE ${eligible} AND ($1::bigint=0 OR r.course_id=$1) AND v.space_identity=$2 AND v.content_hash=rc.content_hash
      AND v.resource_revision=r.rag_revision AND vector_dims(v.embedding)=$3 LIMIT 1`, [courseId, config.space, config.dimensions])
    if (!available.rows.length) return []
    const embedding = await config.embed(query)
    return (await db.query(`WITH candidates AS MATERIALIZED (
      SELECT ${select},v.embedding FROM ${from} JOIN resource_chunk_vectors v ON v.chunk_id=rc.id
      WHERE ${eligible} AND ($2::bigint=0 OR r.course_id=$2) AND v.space_identity=$3
      AND v.content_hash=rc.content_hash AND v.resource_revision=r.rag_revision AND vector_dims(v.embedding)=$4)
      SELECT *,1-(embedding <=> $1::vector) vector_score FROM candidates
      WHERE 1-(embedding <=> $1::vector)>=0.45 ORDER BY embedding <=> $1::vector,chunk_id LIMIT $5`, [JSON.stringify(embedding), courseId, config.space, config.dimensions, count])).rows
  }
  return { ...indexer, config,
    async search(query, limit = 8, courseId = 0, options = {}) {
      const raw = cleanText(query).slice(0, 240)
      if (!raw) return []
      if (!Number.isSafeInteger(courseId) || courseId < 0) throw new Error('RAG_INVALID_COURSE')
      limit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 8)))
      const rewritten = await rewriteQuery(raw, { ...options, mode: config.rewriteMode })
      const count = Math.max(20, limit * 3)
      const lanes = await Promise.allSettled([keyword(rewritten.query, raw, courseId, count), vector(rewritten.query, courseId, count)])
      // Database errors must remain visible. A missing/unavailable vector service
      // is an expected degradation and preserves the keyword lane.
      if (lanes[0].status === 'rejected') throw lanes[0].reason
      if (lanes[1].status === 'rejected') onError(lanes[1].reason)
      let rows = reciprocalRankFusion({ keyword: lanes[0].value, vector: lanes[1].status === 'fulfilled' ? lanes[1].value : [] })
      if (config.rerank && rows.length > limit) {
        try { rows = await config.rerank(rewritten.query, rows.slice(0, 40)) } catch (error) { onError(error) }
      }
      // An embedding/rerank request can outlive a document edit, deletion or
      // review decision. Recheck live versions before exposing the evidence.
      if (rows.length) {
        const fresh = (await db.query(`SELECT ${select} FROM ${from}
          WHERE rc.id=ANY($1::bigint[]) AND ${eligible} AND ($2::bigint=0 OR r.course_id=$2)`, [rows.map(row => row.chunk_id), courseId])).rows
        const byId = new Map(fresh.map(row => [row.chunk_id, row]))
        rows = rows.filter(row => {
          const current = byId.get(row.chunk_id)
          return current && current.content_hash === row.content_hash && current.index_revision === row.index_revision && current.candidate_revision === row.candidate_revision
        })
      }
      return assembleContext(rows, { limit, budget: 7000 })
    }
  }
}

const services = new WeakMap()
export function getResourceRag(db) {
  if (!services.has(db)) services.set(db, createResourceRag({ db, onError: () => console.warn('资料向量/重排暂不可用，保留关键词检索；写入任务稍后重试') }))
  return services.get(db)
}
