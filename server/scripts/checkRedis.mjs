import dotenv from 'dotenv'
import { randomUUID } from 'node:crypto'
import { createConversationCache, conversationCacheConfig } from '../services/conversationCache.js'
dotenv.config()
const env = await conversationCacheConfig()
const cache = createConversationCache({ env: { ...env, REDIS_KEY_PREFIX: `campusmind:check:${randomUUID()}`, REDIS_CACHE_TTL_SECONDS: '2' } })
try {
  await cache.start()
  if (!cache.status().ready) throw new Error('REDIS_NOT_READY')
  let reads = 0
  const load = async () => { reads++; return [{ id: 1, role: 'user', content: 'cache check', attachments_json: '[]' }] }
  await cache.recent(1, 1, load)
  await cache.recent(1, 1, load)
  await cache.recordMessage(1, 1, { id: 2, role: 'assistant', content: 'ok' })
  const rows = await cache.recent(1, 1, load)
  if (reads !== 1 || rows.length !== 2) throw new Error('REDIS_CACHE_CHECK_FAILED')
  console.log('Redis ready: authenticated connection, cache hit and incremental context update passed.')
} catch { console.error('Redis check failed; verify the service and Redis configuration.'); process.exitCode = 1 }
finally { await cache.close() }
