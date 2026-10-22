import { createClient } from 'redis'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'

// Recovery advances a shared epoch, discarding entries from before missed writes.
const readScript = `
if redis.call('EXISTS',KEYS[3])==1 then return {} end
local epoch=redis.call('GET',KEYS[1])
if not epoch then epoch=ARGV[2];redis.call('SET',KEYS[1],epoch) end
local key=KEYS[2]..':'..epoch
local version=redis.call('HGET',key,'version')
if not version then
  version=ARGV[2]
  redis.call('HSET',key,'version',version)
  redis.call('EXPIRE',key,ARGV[3])
end
return {epoch,version,redis.call('HGET',key,ARGV[1]) or ''}`
const fillScript = `
if redis.call('EXISTS',KEYS[3])==1 or redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
local key=KEYS[2]..':'..ARGV[1]
if redis.call('HGET',key,'version')~=ARGV[2] then return 0 end
redis.call('HSET',key,ARGV[3],ARGV[4])
return 1`
const appendScript = `
if redis.call('EXISTS',KEYS[3])==1 then return 0 end
local epoch=redis.call('GET',KEYS[1])
if not epoch then epoch=ARGV[1];redis.call('SET',KEYS[1],epoch) end
local key=KEYS[2]..':'..epoch
local previous=redis.call('HGET',key,'recent')
redis.call('HSET',key,'version',ARGV[1])
redis.call('HDEL',key,'messages','recent')
if previous and ARGV[2]~='' then
  local ok,rows=pcall(cjson.decode,previous)
  if ok and type(rows)=='table' then
    local message=cjson.decode(ARGV[2])
    local found=false
    for i,row in ipairs(rows) do if row.id==message.id then rows[i]=message;found=true end end
    if not found then table.insert(rows,message) end
    table.sort(rows,function(a,b) return a.id<b.id end)
    while #rows>12 do table.remove(rows,1) end
    local encoded=#rows==0 and '[]' or cjson.encode(rows)
    if string.len(encoded)<=tonumber(ARGV[4]) then redis.call('HSET',key,'recent',encoded) end
  end
end
redis.call('EXPIRE',key,ARGV[3])
return 1`

export async function conversationCacheConfig (env = process.env) {
  if (env.REDIS_URL || env.REDIS_ENABLED === 'false' || env.NODE_ENV === 'production') return env
  try {
    const local = dotenv.parse(await readFile(new URL('../../deploy/redis/.env', import.meta.url), 'utf8'))
    if (local.REDIS_PASSWORD) return { ...env, REDIS_URL: `redis://:${encodeURIComponent(local.REDIS_PASSWORD)}@127.0.0.1:${local.REDIS_PORT || 6379}` }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return env
}

export function createConversationCache ({ env = process.env, onError = () => console.warn('Redis cache unavailable; using PostgreSQL') } = {}) {
  const enabled = env.REDIS_ENABLED !== 'false' && Boolean(env.REDIS_URL)
  if (env.REDIS_ENABLED === 'true' && !env.REDIS_URL) throw new Error('REDIS_ENABLED=true 时必须配置 REDIS_URL')
  const prefix = env.REDIS_KEY_PREFIX || 'campusmind:cache:v1'
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(prefix)) throw new Error('REDIS_KEY_PREFIX 无效')
  const ttl = Number(env.REDIS_CACHE_TTL_SECONDS || 600), timeout = Number(env.REDIS_TIMEOUT_MS || 200)
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) throw new Error('REDIS_CACHE_TTL_SECONDS 必须为 1 到 86400 的整数')
  if (!Number.isInteger(timeout) || timeout < 20 || timeout > 2000) throw new Error('REDIS_TIMEOUT_MS 必须为 20 到 2000 的整数')
  const maxBytes = 256 * 1024, inflight = new Map()
  const counters = { hits: 0, misses: 0, fallbacks: 0, writes: 0 }
  let client, opening, available = false, closed = false, retryAt = 0, warned = false
  const keys = (userId, threadId) => {
    if (![userId, threadId].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error('CACHE_INVALID_SCOPE')
    return [`${prefix}:epoch`, `${prefix}:u:${userId}:t:${threadId}`, `${prefix}:u:${userId}:erased`]
  }
  function fail (owner = client) {
    if (owner !== client) return
    available = false; retryAt = Date.now() + 1000
    if (!warned) { warned = true; onError() }
    if (client?.isOpen) client.destroy()
  }
  async function bounded (work, duration = timeout) {
    let timer
    try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CACHE_TIMEOUT')), duration) })]) }
    finally { clearTimeout(timer) }
  }
  function start () {
    if (!enabled || closed || Date.now() < retryAt) return Promise.resolve()
    if (opening) return opening
    if (available && client?.isReady) return Promise.resolve()
    opening = (async () => {
      try {
        if (client?.isOpen) client.destroy()
        const candidate = createClient({ url: env.REDIS_URL, disableOfflineQueue: true, commandsQueueMaxLength: 100,
          socket: { connectTimeout: 500, reconnectStrategy: false } })
        client = candidate
        candidate.on('error', () => { if (client === candidate) available = false })
        await bounded(client.connect(), 700)
        if (closed) { if (client.isOpen) client.destroy(); return }
        await bounded(client.set(`${prefix}:epoch`, randomUUID()))
        available = true; warned = false
      } catch { fail() }
    })().finally(() => { opening = null })
    return opening
  }
  async function command (run) {
    if (!enabled || closed) return null
    if (!available || !client?.isReady) { void start(); return null }
    const active = client
    try { return await bounded(run(active)) } catch { fail(active); return null }
  }
  async function read (userId, threadId, field, load) {
    const scope = keys(userId, threadId)
    const state = await command(c => c.eval(readScript, { keys: scope, arguments: [field, randomUUID(), String(ttl)] }))
    if (!state?.length) { counters.fallbacks++; return load() }
    const [epoch, version, raw] = state
    if (raw) {
      try { const rows = JSON.parse(raw); if (Array.isArray(rows)) { counters.hits++; return rows } } catch { /* replace malformed cache */ }
    }
    counters.misses++
    const pendingKey = `${scope[1]}:${epoch}:${version}:${field}`
    if (inflight.has(pendingKey)) return inflight.get(pendingKey)
    const work = (async () => {
      const rows = await load(), payload = JSON.stringify(rows)
      if (Buffer.byteLength(payload) <= maxBytes) await command(c => c.eval(fillScript, { keys: scope, arguments: [epoch, version, field, payload, String(ttl)] }))
      return rows
    })().finally(() => inflight.delete(pendingKey))
    inflight.set(pendingKey, work)
    return work
  }
  async function recordMessage (userId, threadId, message) {
    const scope = keys(userId, threadId)
    const value = message ? { id: message.id, role: message.role, content: message.content, attachments_json: message.attachments_json || '[]' } : null
    const result = await command(c => c.eval(appendScript, { keys: scope, arguments: [randomUUID(), value ? JSON.stringify(value) : '', String(ttl), String(maxBytes)] }))
    if (result) counters.writes++
  }
  async function eraseUser (userId) {
    keys(userId, 1)
    // Reject fills that were already in flight when account deletion committed.
    const marked = await command(c => c.set(`${prefix}:u:${userId}:erased`, '1'))
    if (!marked) return
    let cursor = '0'
    do {
      const page = await command(c => c.scan(cursor, { MATCH: `${prefix}:u:${userId}:t:*`, COUNT: 100 }))
      if (!page) return
      if (page.keys.length) await command(c => c.unlink(page.keys))
      cursor = String(page.cursor)
    } while (cursor !== '0')
  }
  async function close () {
    closed = true; available = false
    if (client?.isOpen) client.destroy()
    if (opening) await opening
  }
  return { enabled, start, close, recordMessage, eraseUser,
    recent: (userId, threadId, load) => read(userId, threadId, 'recent', load),
    messages: (userId, threadId, load) => read(userId, threadId, 'messages', load),
    invalidateThread: (userId, threadId) => recordMessage(userId, threadId, null),
    status: () => ({ enabled, ready: available && Boolean(client?.isReady), ...counters }) }
}
