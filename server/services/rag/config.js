import { createHash } from 'node:crypto'
import { createEmbeddingClient } from '../memory/embeddings.js'
import { createReranker } from './ranking.js'

export const hash = text => createHash('sha256').update(text).digest('hex')
export function ragConfig(env = process.env) {
  const baseUrl = env.RAG_EMBEDDING_BASE_URL || env.MEMORY_EMBEDDING_BASE_URL
  const model = env.RAG_EMBEDDING_MODEL || env.MEMORY_EMBEDDING_MODEL
  const dimensions = Number(env.RAG_EMBEDDING_DIMENSIONS || env.MEMORY_EMBEDDING_DIMENSIONS || 1024)
  const timeout = Number(env.RAG_EMBEDDING_TIMEOUT_MS || env.MEMORY_EMBEDDING_TIMEOUT_MS || 8000)
  const enabled = env.RAG_VECTOR_ENABLED !== 'false' && Boolean(baseUrl && model)
  if (enabled && (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096)) throw new Error('RAG_INVALID_DIMENSIONS')
  return {
    dimensions, timeout, space: enabled ? hash(`${baseUrl.replace(/\/+$/, '')}|${model}|${dimensions}`) : '',
    embed: enabled ? createEmbeddingClient({ baseUrl, model, dimensions, timeout, apiKey: env.RAG_EMBEDDING_API_KEY || env.MEMORY_EMBEDDING_API_KEY || 'local' }) : null,
    rewriteMode: ['off', 'rules', 'model'].includes(env.RAG_QUERY_REWRITE) ? env.RAG_QUERY_REWRITE : 'rules',
    rerank: env.RAG_RERANK_ENABLED === 'true' && env.RAG_RERANK_URL ? createReranker({ url: env.RAG_RERANK_URL, model: env.RAG_RERANK_MODEL, apiKey: env.RAG_RERANK_API_KEY, timeout: Number(env.RAG_RERANK_TIMEOUT_MS || 3000) }) : null
  }
}
