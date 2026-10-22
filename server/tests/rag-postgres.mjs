import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestDatabase } from './helpers/postgres.mjs'
import { createResourceRag } from '../services/rag/service.js'
import { chunkPages } from '../services/rag/chunking.js'

const options = { env: {}, dimensions: 2, space: 'synthetic-test-space', embedding: async text => /精确匹配|烹饪|烹调/.test(text) ? [0, 1] : [1, 0] }
async function seed(db, course, title, content, service, review = 'approved') {
  const id = (await db.prepare('INSERT INTO resources(course_id,title,file_name,review_status) VALUES(?,?,?,?)').run(course, title, title + '.txt', review)).insertId
  await service.replace(id, chunkPages([{ pageNumber: 4, text: content }]))
  return id
}
async function drain(service) { for (let i = 0; i < 50; i++) if (!await service.drainOne()) return; throw new Error('Unexpected queue loop') }

test('PostgreSQL hybrid retrieval combines both lanes, filters courses/reviews and survives embedding/rerank outages', { timeout: 30000 }, async () => {
  const fixture = await createTestDatabase(), db = fixture.db
  const service = createResourceRag({ db, ...options })
  let fallback
  try {
    const course = (await db.prepare("INSERT INTO courses(name) VALUES('算法基础')").run()).insertId
    const other = (await db.prepare("INSERT INTO courses(name) VALUES('另一门课程')").run()).insertId
    const both = await seed(db, course, '讲义甲', '# 状态转移\n背包问题通过状态转移计算最优解。', service)
    const semantic = await seed(db, course, '讲义乙', '复用子任务的答案以减少重复计算。', service)
    const lexical = await seed(db, course, '讲义丙', '背包精确匹配术语表。', service)
    const excluded = await seed(db, other, '跨课程', '背包问题的状态转移。', service)
    const pending = await seed(db, course, '待审核', '背包问题的非公开审核草稿。', service, 'pending')
    await drain(service)
    // A second model/dimension in the same table must never reach cosine
    // evaluation in this service's vector space.
    await db.query(`INSERT INTO resource_chunk_vectors(chunk_id,space_identity,content_hash,resource_revision,embedding)
      SELECT id,'another-model',content_hash,resource_revision,'[1,0,0]'::vector FROM resource_chunks WHERE resource_id=$1`, [both])
    const result = await service.search('背包', 8, course)
    assert.equal(result[0].resource_id, both); assert.deepEqual(result[0].ranks, { keyword: 1, vector: 1 })
    assert.equal(result.find(row => row.resource_id === semantic).ranks.keyword, undefined)
    assert.equal(result.find(row => row.resource_id === semantic).ranks.vector > 0, true)
    assert.equal(result.find(row => row.resource_id === lexical).ranks.vector, undefined)
    assert.ok(result.every(row => ![excluded, pending].includes(row.resource_id)))
    assert.equal(result[0].page_number, 4); assert.match(result[0].source, /状态转移/)
    fallback = createResourceRag({ db, ...options, embedding: async () => { throw new Error('provider down') }, rerank: async () => { throw new Error('reranker down') } })
    const degraded = await fallback.search('背包', 1, course)
    assert.equal(degraded[0].resource_id, both); assert.deepEqual(degraded[0].ranks, { keyword: 1 })
    const rewritten = await service.search('它的状态怎么转移？', 8, course, { history: [{ role: 'user', content: '背包问题' }], originalQuery: '它的状态怎么转移？' })
    assert.equal(rewritten[0].resource_id, both)
    // Old rows remain searchable while the background backfill is pending.
    const legacy = (await db.prepare("INSERT INTO resources(course_id,title) VALUES(?,'旧导入资料')").run(course)).insertId
    await db.prepare("INSERT INTO resource_chunks(resource_id,chunk_index,content) VALUES(?,0,'拉格朗日乘子用于约束优化')").run(legacy)
    assert.ok((await service.search('拉格朗日', 8, course)).some(row => row.resource_id === legacy))
  } finally { await service.close(); if (fallback) await fallback.close(); await fixture.close() }
})

test('Index updates invalidate old vectors immediately, queued work persists and deletes cascade', { timeout: 30000 }, async () => {
  const fixture = await createTestDatabase(), db = fixture.db
  let service = createResourceRag({ db, ...options })
  try {
    const course = (await db.prepare("INSERT INTO courses(name) VALUES('测试课程')").run()).insertId
    const resource = await seed(db, course, '旧标题 photosynthesis', '状态转移方程和边界条件', service)
    await service.close(); service = createResourceRag({ db, ...options })
    await drain(service)
    assert.equal((await service.search('同义表达', 8, course)).length, 1)
    await db.prepare("UPDATE resources SET title='新标题 cryptography',file_name='cryptography.txt' WHERE id=?").run(resource)
    assert.equal((await service.search('同义表达', 8, course)).length, 0)
    assert.equal((await service.search('新标题', 8, course)).length, 1)
    const keywordOnly = createResourceRag({ db, env: { RAG_VECTOR_ENABLED: 'false' } })
    try { assert.equal((await keywordOnly.search('photosynthesis', 8, course)).length, 0) } finally { await keywordOnly.close() }
    await service.synchronize(); await drain(service)
    assert.equal((await service.search('同义表达', 8, course)).length, 1)
    await db.prepare("UPDATE courses SET name='课程更名' WHERE id=?").run(course)
    assert.equal((await service.search('同义表达', 8, course)).length, 0)
    await service.synchronize(); await drain(service)
    await service.replace(resource, chunkPages([{ text: '烹饪新的资料，旧正文已经删除。' }]))
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM resource_chunk_vectors').get()).count, 0)
    await drain(service)
    assert.equal((await service.search('同义表达', 8, course)).length, 0)
    await db.prepare('DELETE FROM resource_chunks WHERE resource_id=?').run(resource)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM resource_chunk_vectors').get()).count, 0)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM resource_embedding_jobs').get()).count, 0)
  } finally { await service.close(); await fixture.close() }
})

test('An in-flight query cannot return a resource rejected while the embedding was pending', { timeout: 30000 }, async () => {
  const fixture = await createTestDatabase(), db = fixture.db
  const writer = createResourceRag({ db, ...options })
  let release, started
  const entered = new Promise(resolve => { started = resolve })
  const reader = createResourceRag({ db, ...options, embedding: async () => { started(); return new Promise(resolve => { release = resolve }) } })
  try {
    const course = (await db.prepare("INSERT INTO courses(name) VALUES('并发审核')").run()).insertId
    const resource = await seed(db, course, '资料', '背包问题的完整解答', writer)
    await drain(writer)
    const pending = reader.search('背包', 8, course)
    await entered
    await db.prepare("UPDATE resources SET review_status='rejected' WHERE id=?").run(resource)
    release([1, 0])
    assert.deepEqual(await pending, [])
  } finally { release?.([1, 0]); await reader.close(); await writer.close(); await fixture.close() }
})

test('Leased workers cannot publish an embedding after replacement; failures retry and expire safely', { timeout: 30000 }, async () => {
  const fixture = await createTestDatabase(), db = fixture.db
  let release, started
  const entered = new Promise(resolve => { started = resolve })
  const service = createResourceRag({ db, ...options, embedding: async () => { started(); return new Promise(resolve => { release = resolve }) } })
  const second = createResourceRag({ db, ...options })
  let failing
  try {
    const course = (await db.prepare("INSERT INTO courses(name) VALUES('并发测试')").run()).insertId
    const resource = await seed(db, course, '资料', '原始正文', service)
    const inflight = service.drainOne(); await entered
    assert.equal(await second.drainOne(), false)
    await second.replace(resource, chunkPages([{ text: '已经替换的正文' }]))
    release([1, 0]); await inflight
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM resource_chunk_vectors').get()).count, 0)
    await drain(second)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM resource_chunk_vectors').get()).count, 1)
    await second.replace(resource, chunkPages([{ text: '失败重试正文' }]))
    failing = createResourceRag({ db, ...options, embedding: async () => { throw new Error('offline') } })
    for (let attempt = 0; attempt < 5; attempt++) {
      await db.prepare('UPDATE resource_embedding_jobs SET next_at=0').run()
      await failing.drainOne()
    }
    assert.equal((await failing.status())[0].state, 'failed')
    await second.synchronize({ retryFailed: true }); await drain(second)
    assert.equal((await second.status()).length, 0)
    await second.replace(resource, chunkPages([{ text: '最后一次租约失效' }]))
    await db.prepare("UPDATE resource_embedding_jobs SET state='running',attempts=5,lease_until=1").run()
    assert.equal(await second.drainOne(), false)
    assert.equal((await second.status())[0].state, 'failed')
  } finally { release?.([1, 0]); await service.close(); await second.close(); if (failing) await failing.close(); await fixture.close() }
})
