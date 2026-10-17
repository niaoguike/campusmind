import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, connect } from 'node:net'
import { once } from 'node:events'
import { createConversationCache, conversationCacheConfig } from '../services/conversationCache.js'
import { createTestDatabase } from './helpers/postgres.mjs'
import { loadRecentThreadMessages, buildThreadHistory } from '../agents/contextBuilder.js'

const configuration = await conversationCacheConfig({ NODE_ENV: 'development', REDIS_URL: process.env.TEST_REDIS_URL })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function makeCache (options = {}) {
  return createConversationCache({ env: { ...configuration, REDIS_KEY_PREFIX: `campusmind:test:${randomUUID()}`, ...options }, onError () {} })
}
async function ready (cache) { await cache.start(); assert.equal(cache.status().ready, true, 'Start local Redis or configure TEST_REDIS_URL') }
const message = id => ({ id, role: id % 2 ? 'user' : 'assistant', content: `message ${id}`, attachments_json: '[]' })

test('Redis serves repeated PostgreSQL context reads and preserves the latest 12 committed messages', async () => {
  const fixture = await createTestDatabase(), db = fixture.db, cache = makeCache()
  try {
    await ready(cache)
    await db.exec("INSERT INTO users(id,student_id,name,phone,college,class,password) VALUES (1,'redis-test','test','test','test','test','unused'); INSERT INTO agent_threads(id,user_id) VALUES (1,1)")
    let reads = 0
    const measured = { prepare (sql) { if (sql.includes('FROM agent_messages')) reads++; return db.prepare(sql) } }
    const recent = () => loadRecentThreadMessages({ db: measured, cache, userId: 1, threadId: 1 })
    assert.deepEqual(await recent(), [])
    assert.deepEqual(await recent(), [])
    assert.equal(reads, 1)
    for (let id = 1; id <= 16; id++) {
      const row = message(id)
      await db.transaction(async () => { await db.prepare('INSERT INTO agent_messages(id,thread_id,role,content) VALUES (?,1,?,?)').run(id, row.role, row.content) })()
      await cache.recordMessage(1, 1, row)
      assert.equal((await recent()).at(-1).id, id)
    }
    assert.equal(reads, 1, '16 appended messages do not reload the PostgreSQL context')
    assert.deepEqual((await recent()).map(x => x.id), Array.from({ length: 12 }, (_, i) => i + 5))
    const history = await buildThreadHistory({ db, cache, userId: 1, threadId: 1, attachmentContext: () => '' })
    assert.equal(history.length, 12); assert.equal(history.at(-1).content, 'message 16')
    let listReads = 0
    const list = () => cache.messages(1, 1, async () => { listReads++; return db.prepare('SELECT content FROM agent_messages WHERE thread_id=1 ORDER BY id').all() })
    await list(); await list(); assert.equal(listReads, 1)
    await cache.invalidateThread(1, 1); await list(); assert.equal(listReads, 2)
    assert.deepEqual(await cache.recent(2, 1, async () => []), [])
  } finally { await cache.close(); await fixture.close() }
})

test('Redis shares ordered appends between workers and prevents stale in-flight fills', async () => {
  const prefix = `campusmind:test:${randomUUID()}`
  const first = makeCache({ REDIS_KEY_PREFIX: prefix }), second = makeCache({ REDIS_KEY_PREFIX: prefix })
  try {
    await ready(first); await ready(second)
    await first.recent(1, 1, async () => [message(1)])
    await Promise.all([second.recordMessage(1, 1, message(3)), first.recordMessage(1, 1, message(2))])
    assert.deepEqual((await second.recent(1, 1, () => assert.fail('unexpected database read'))).map(x => x.id), [1, 2, 3])
    await first.invalidateThread(1, 1)
    let release, loaded
    const loading = new Promise(resolve => { loaded = resolve })
    const pending = first.recent(1, 1, async () => { loaded(); await new Promise(resolve => { release = resolve }); return [message(1)] })
    await loading
    await second.recordMessage(1, 1, message(4))
    release(); await pending
    const fresh = await second.recent(1, 1, async () => [message(1), message(4)])
    assert.deepEqual(fresh.map(x => x.id), [1, 4], 'a late old fill cannot overwrite a newer commit')
    await first.invalidateThread(1, 1)
    let reads = 0
    const values = await Promise.all(Array.from({ length: 8 }, () => first.recent(1, 1, async () => { reads++; await wait(20); return [message(4)] })))
    assert.equal(reads, 1); assert.equal(values.length, 8)
  } finally { await first.close(); await second.close() }
})

test('Redis expires entries, bounds payloads, and blocks repopulation after account erasure', async () => {
  const cache = makeCache({ REDIS_CACHE_TTL_SECONDS: '1' })
  try {
    await ready(cache)
    let reads = 0
    const load = async () => { reads++; return [message(reads)] }
    await cache.recent(1, 1, load); await cache.recent(1, 1, load); assert.equal(reads, 1)
    await wait(1150)
    await cache.recent(1, 1, load); assert.equal(reads, 2)
    let largeReads = 0
    const large = async () => { largeReads++; return [{ content: 'x'.repeat(300000) }] }
    await cache.messages(1, 2, large); await cache.messages(1, 2, large); assert.equal(largeReads, 2)
    let release, started
    const loading = new Promise(resolve => { started = resolve })
    const pending = cache.recent(1, 3, async () => { started(); await new Promise(resolve => { release = resolve }); return [message(3)] })
    await loading; await cache.eraseUser(1); release(); await pending
    await cache.recordMessage(1, 1, message(9))
    assert.deepEqual(await cache.recent(1, 1, async () => []), [])
    assert.deepEqual(await cache.recent(1, 3, async () => []), [])
    assert.deepEqual(await cache.recent(2, 1, async () => [message(2)]), [message(2)])
  } finally { await cache.close() }
})

test('Redis command timeout falls back promptly and recovery discards data from before missed writes', async () => {
  const destination = new URL(configuration.REDIS_URL), sockets = new Set()
  const targetHost = destination.hostname, targetPort = Number(destination.port || 6379)
  let stalled = false
  const proxy = createServer(socket => {
    const upstream = connect({ host: targetHost, port: targetPort })
    sockets.add(socket); sockets.add(upstream)
    socket.on('data', bytes => { if (!stalled) upstream.write(bytes) })
    upstream.on('data', bytes => { if (!stalled) socket.write(bytes) })
    for (const s of [socket, upstream]) { s.on('error', () => {}); s.on('close', () => { sockets.delete(s); socket.destroy(); upstream.destroy() }) }
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  destination.hostname = '127.0.0.1'; destination.port = String(proxy.address().port)
  const cache = makeCache({ REDIS_URL: destination.href, REDIS_TIMEOUT_MS: '100' })
  try {
    await ready(cache)
    await cache.recent(1, 1, async () => [message(1)])
    stalled = true
    const start = Date.now()
    await cache.recordMessage(1, 1, message(2))
    assert(Date.now() - start < 600, 'a stalled Redis command must not block the request')
    assert.deepEqual(await cache.recent(1, 1, async () => [message(1), message(2)]), [message(1), message(2)])
    stalled = false; await wait(1100); await ready(cache)
    let reloads = 0
    const recovered = await cache.recent(1, 1, async () => { reloads++; return [message(1), message(2)] })
    assert.equal(reloads, 1); assert.equal(recovered.length, 2)
    await cache.recent(1, 1, () => assert.fail('recovered cache should hit'))
  } finally {
    await cache.close()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => proxy.close(resolve))
  }
})

test('Disabled and unavailable Redis preserve PostgreSQL errors and permit normal reads', async () => {
  const disabled = createConversationCache({ env: { REDIS_ENABLED: 'false' } })
  const unavailable = makeCache({ REDIS_URL: 'redis://127.0.0.1:1' })
  try {
    await unavailable.start()
    assert.equal(unavailable.status().ready, false)
    for (const cache of [disabled, unavailable]) {
      assert.deepEqual(await cache.recent(1, 1, async () => [message(1)]), [message(1)])
      await cache.recordMessage(1, 1, message(2))
      await assert.rejects(() => cache.recent(1, 1, async () => { throw new Error('POSTGRES_FAILURE') }), /POSTGRES_FAILURE/)
    }
  } finally { await disabled.close(); await unavailable.close() }
})
