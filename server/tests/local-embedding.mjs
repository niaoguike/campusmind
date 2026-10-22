import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createTestDatabase } from './helpers/postgres.mjs'
import { createLongTermMemoryService } from '../services/longTermMemory.js'

test('Local BGE-M3 writes and recalls persistent facts and summaries without cloud model calls', { timeout: 180000 }, async () => {
  const env = dotenv.parse(await readFile(new URL('../.env', import.meta.url), 'utf8'))
  assert.equal(env.MEMORY_EMBEDDING_MODEL, 'bge-m3')
  assert.equal(new URL(env.MEMORY_EMBEDDING_BASE_URL).hostname, '127.0.0.1')
  const fixture = await createTestDatabase(), db = fixture.db
  let service
  const makeService = () => createLongTermMemoryService({ db, env,
    userOf: id => db.prepare('SELECT * FROM users WHERE id=?').get(id),
    extract: async ({ source }) => [{ key: 'goal.dynamic_programming', kind: 'goal', content: '学习目标是掌握动态规划和背包问题', evidence: source, confidence: 0.99 }],
    summarize: async () => ({ summary: '讨论了动态规划的状态转移和背包问题，接下来继续背包练习。', topics: ['动态规划', '背包问题'], open_questions: ['如何设置背包问题的初始状态'] })
  })
  try {
    await db.exec("INSERT INTO users(id,student_id,name,phone,college,class,password) VALUES (1,'local-embedding-1','test','test','test','test','unused'),(2,'local-embedding-2','test','test','test','test','unused'); INSERT INTO agent_threads(id,user_id) VALUES (11,1),(12,1),(21,2)")
    await db.prepare("INSERT INTO agent_messages(id,thread_id,role,content) VALUES (1,11,'user',?),(2,11,'assistant',?)").run('我的学习目标是掌握动态规划和背包问题', '动态规划可以从状态定义和状态转移开始练习。')
    service = makeService()
    await service.enqueue(1, 11, 1)
    await service.enqueueSummary(1, 11, 2, true)
    await service.drain()
    const written = await service.list(1)
    assert.equal(written.items.length, 1); assert.equal(written.episodes.length, 1)
    const stored = await db.prepare('SELECT vector_dims(embedding) dims FROM campusmind_memories WHERE user_id=1').get()
    assert.equal(stored.dims, 1024)
    await service.close(); service = makeService()
    const recalled = await service.recall(1, '帮我继续练习动态规划和背包问题', { threadId: 12 })
    assert.equal(recalled.status, 'ready'); assert.equal(recalled.items.length, 1); assert.equal(recalled.episodes.length, 1)
    const other = await service.recall(2, '帮我继续练习动态规划和背包问题', { threadId: 21 })
    assert.equal(other.items.length, 0); assert.equal(other.episodes.length, 0)
    await service.erase(1, written.items[0].id)
    const forgotten = await service.list(1)
    assert.equal(forgotten.items.length, 0); assert.equal(forgotten.episodes.length, 0)
  } finally { if (service) await service.close(); await fixture.close() }
})
