import { createHash } from 'node:crypto'
import { createEmbeddingClient } from './embeddings.js'

// Use synthetic text only; checking a provider does not create personal memories.
export async function checkEmbedding ({ db, env = process.env, fetchImpl = fetch }) {
  const baseUrl = env.MEMORY_EMBEDDING_BASE_URL?.trim(), apiKey = env.MEMORY_EMBEDDING_API_KEY?.trim(), model = env.MEMORY_EMBEDDING_MODEL?.trim()
  if (!baseUrl || !apiKey || !model || /YOUR-PROVIDER|YOUR-WORKSPACE|\{WorkspaceId\}|replace-with|你的向量/.test(`${baseUrl} ${apiKey} ${model}`)) throw new Error('EMBEDDING_NOT_CONFIGURED')
  const dimensions = Number(env.MEMORY_EMBEDDING_DIMENSIONS || 1024)
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) throw new Error('EMBEDDING_INVALID_DIMENSIONS')
  const identity = createHash('sha256').update(`${baseUrl.replace(/\/+$/, '')}|${model}|${dimensions}`).digest('hex')
  const existing = await db.prepare('SELECT identity,dimensions FROM campusmind_memory_space WHERE singleton=TRUE').get()
  if (existing && (existing.identity !== identity || Number(existing.dimensions) !== dimensions)) throw new Error('MEMORY_EMBEDDING_SPACE_CHANGED')
  const embed = createEmbeddingClient({ baseUrl, apiKey, model, dimensions, timeout: Number(env.MEMORY_EMBEDDING_TIMEOUT_MS || 8000), fetchImpl })
  const started = Date.now()
  const vectors = await Promise.all([
    embed('我希望加强动态规划和背包问题的练习。'),
    embed('今天准备学习番茄炒蛋的做法。'),
    embed('帮我安排动态规划背包题的训练。')
  ])
  const matches = await db.transaction(async () => {
    await db.exec(`CREATE TEMP TABLE embedding_service_check (topic TEXT,embedding vector(${dimensions})) ON COMMIT DROP`)
    await db.prepare('INSERT INTO embedding_service_check(topic,embedding) VALUES (?,?::vector),(?,?::vector)').run('study', JSON.stringify(vectors[0]), 'cooking', JSON.stringify(vectors[1]))
    return db.prepare('SELECT topic,1-(embedding <=> ?::vector) AS similarity FROM embedding_service_check ORDER BY embedding <=> ?::vector').all(JSON.stringify(vectors[2]), JSON.stringify(vectors[2]))
  })()
  return { provider: new URL(baseUrl).hostname, model, dimensions, requests: 3, elapsed_ms: Date.now() - started,
    pgvector: 'ready', sample_ranking: matches.map(row => ({ topic: row.topic, similarity: Number(Number(row.similarity).toFixed(4)) })),
    semantic_sample: matches[0]?.topic === 'study' && matches[0].similarity > matches[1].similarity ? 'passed' : 'review_required',
    memory_enabled: env.MEMORY_ENABLED !== 'false' }
}
