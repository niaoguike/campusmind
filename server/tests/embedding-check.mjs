import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from './helpers/postgres.mjs'
import { checkEmbedding } from '../services/memory/checkEmbedding.js'

const settings = { MEMORY_EMBEDDING_BASE_URL: 'https://embedding.example/v1', MEMORY_EMBEDDING_API_KEY: 'test-key', MEMORY_EMBEDDING_MODEL: 'test-embedding', MEMORY_EMBEDDING_DIMENSIONS: '3', MEMORY_ENABLED: 'true' }

test('Embedding check validates real pgvector ranking without persisting vectors or credentials', async () => {
  const fixture = await createTestDatabase()
  try {
    let calls = 0
    const result = await checkEmbedding({ db: fixture.db, env: settings, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://embedding.example/v1/embeddings')
      assert.equal(options.headers.Authorization, 'Bearer test-key')
      const body = JSON.parse(options.body); assert.equal(body.dimensions, 3); calls++
      return Response.json({ data: [{ embedding: body.input.includes('番茄') ? [0, 1, 0] : [1, 0, 0] }] })
    } })
    assert.equal(calls, 3); assert.equal(result.semantic_sample, 'passed'); assert.equal(result.pgvector, 'ready')
    assert.equal(result.sample_ranking[0].topic, 'study')
    assert(!JSON.stringify(result).includes('test-key'))
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) n FROM campusmind_memory_space').get()).n, 0)
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) n FROM campusmind_memories').get()).n, 0)
    assert.equal((await fixture.db.prepare('SELECT COUNT(*) n FROM agent_thread_summaries').get()).n, 0)
  } finally { await fixture.close() }
})

test('Embedding check rejects missing configuration and incompatible vector spaces before calling providers', async () => {
  const fixture = await createTestDatabase()
  try {
    const fetchImpl = () => assert.fail('provider must not be called')
    await assert.rejects(() => checkEmbedding({ db: fixture.db, env: {}, fetchImpl }), /EMBEDDING_NOT_CONFIGURED/)
    await assert.rejects(() => checkEmbedding({ db: fixture.db, env: { ...settings, MEMORY_EMBEDDING_DIMENSIONS: '0' }, fetchImpl }), /EMBEDDING_INVALID_DIMENSIONS/)
    await fixture.db.prepare('INSERT INTO campusmind_memory_space(singleton,identity,dimensions) VALUES (TRUE,?,3)').run('another-model')
    await assert.rejects(() => checkEmbedding({ db: fixture.db, env: settings, fetchImpl }), /MEMORY_EMBEDDING_SPACE_CHANGED/)
  } finally { await fixture.close() }
})

test('Embedding check flags meaningless vectors and sanitizes provider failures', async () => {
  const fixture = await createTestDatabase()
  try {
    const result = await checkEmbedding({ db: fixture.db, env: settings, fetchImpl: async () => Response.json({ data: [{ embedding: [1, 0, 0] }] }) })
    assert.equal(result.semantic_sample, 'review_required')
    await assert.rejects(() => checkEmbedding({ db: fixture.db, env: settings, fetchImpl: async () => Response.json({ data: [{ embedding: [1, 0] }] }) }), /EMBEDDING_INVALID_VECTOR/)
    await assert.rejects(() => checkEmbedding({ db: fixture.db, env: settings, fetchImpl: async () => new Response('private-provider-error', { status: 401 }) }), error => error.message === 'EMBEDDING_HTTP_401')
  } finally { await fixture.close() }
})
