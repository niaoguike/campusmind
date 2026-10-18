import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { createTestDatabase } from './helpers/postgres.mjs'
import { createResourceRag } from '../services/rag/service.js'
import { chunkPages } from '../services/rag/chunking.js'

test('Local BGE-M3 supplies vector-only cross-language recall, RRF and multi-turn retrieval', { timeout: 180000 }, async () => {
  const env = dotenv.parse(await readFile(new URL('../.env', import.meta.url), 'utf8'))
  assert.equal(env.MEMORY_EMBEDDING_MODEL, 'bge-m3')
  assert.equal(new URL(env.MEMORY_EMBEDDING_BASE_URL).hostname, '127.0.0.1')
  const fixture = await createTestDatabase(), db = fixture.db
  const rag = createResourceRag({ db, env })
  try {
    const course = (await db.prepare("INSERT INTO courses(name) VALUES('计算机算法')").run()).insertId
    const docs = [
      ['背包问题', '# 动态规划\n例题：背包承重有限，需要选择不同重量和价值的物品，使总价值最大。\n\n解答：动态规划将大问题拆分为重叠子问题，保存计算结果，定义状态表示前若干物品在给定容量下的最优价值，再根据选择或放弃当前物品计算状态转移。'],
      ['概率论', '随机变量描述不确定事件，数学期望衡量平均水平，大数定律讨论独立重复试验中平均值的收敛性质。'],
      ['家常烹饪', '煮米饭时先淘米，加水后加热，焖熟后开盖搅拌。不同米种的吸水量和烹调时间有所区别。']
    ]
    const ids = []
    for (const [title, text] of docs) {
      const id = (await db.prepare('INSERT INTO resources(course_id,title,file_name) VALUES(?,?,?)').run(course, title, `${title}.txt`)).insertId
      ids.push(id); await rag.replace(id, chunkPages([{ pageNumber: 3, text }]))
    }
    for (let i = 0; i < docs.length; i++) assert.equal(await rag.drainOne(), true)
    assert.equal((await rag.status()).length, 0)
    const stored = await db.prepare('SELECT DISTINCT vector_dims(embedding) dims FROM resource_chunk_vectors').all()
    assert.deepEqual(stored.map(row => row.dims), [1024])
    const semantic = await rag.search('knapsack optimization', 3, course)
    assert.equal(semantic[0].resource_id, ids[0]); assert.equal(semantic[0].ranks.keyword, undefined)
    assert.ok(semantic[0].ranks.vector)
    const mixed = await rag.search('背包问题的动态规划', 3, course)
    assert.equal(mixed[0].resource_id, ids[0]); assert.ok(mixed[0].ranks.keyword && mixed[0].ranks.vector)
    const followup = await rag.search('它的状态如何定义？', 3, course, { history: [{ role: 'user', content: '讲解背包问题的动态规划' }] })
    assert.equal(followup[0].resource_id, ids[0]); assert.match(followup[0].excerpt, /例题[\s\S]*解答/)
    assert.match(followup[0].source, /第 3 页/)
    console.log(JSON.stringify({ model: env.MEMORY_EMBEDDING_MODEL, dimensions: 1024, indexed: docs.length, vectorOnlyTop: semantic[0].title, hybridRanks: mixed[0].ranks, followupTop: followup[0].title }))
  } finally { await rag.close(); await fixture.close() }
})
