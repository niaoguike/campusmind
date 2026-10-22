import dotenv from 'dotenv'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createDatabase } from '../db/database.js'

const location = new URL('../.env', import.meta.url)
let db
try {
  let source = ''
  try { source = await readFile(location, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const current = dotenv.parse(source)
  const next = {
    MEMORY_ENABLED: 'true',
    MEMORY_EMBEDDING_BASE_URL: 'http://127.0.0.1:11434/v1',
    MEMORY_EMBEDDING_API_KEY: 'ollama',
    MEMORY_EMBEDDING_MODEL: 'bge-m3',
    MEMORY_EMBEDDING_DIMENSIONS: '1024',
    MEMORY_EMBEDDING_TIMEOUT_MS: '60000'
  }
  db = await createDatabase({ env: { ...current, ...process.env } })
  const existing = await db.prepare('SELECT identity,dimensions FROM campusmind_memory_space WHERE singleton=TRUE').get()
  const identity = createHash('sha256').update(`${next.MEMORY_EMBEDDING_BASE_URL}|${next.MEMORY_EMBEDDING_MODEL}|1024`).digest('hex')
  if (existing && (existing.identity !== identity || Number(existing.dimensions) !== 1024)) throw new Error('MEMORY_EMBEDDING_SPACE_CHANGED')
  // Preserve application secrets, other providers' keys and unrelated settings.
  for (const [key, value] of Object.entries(next)) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'gm')
    if (pattern.test(source)) source = source.replace(pattern, `${key}=${value}`)
    else source += `${source && !source.endsWith('\n') ? '\n' : ''}${key}=${value}\n`
  }
  await writeFile(location, source, { mode: 0o600 })
  console.log('Configured server/.env for local bge-m3 (1024 dimensions). Existing application secrets were preserved; restart the API to load the settings.')
} catch (error) {
  console.error(error.message === 'MEMORY_EMBEDDING_SPACE_CHANGED' ? 'Existing vectors use another embedding space; migrate/re-embed them before changing providers.' : 'Local embedding configuration failed; verify PostgreSQL and server/.env.')
  process.exitCode = 1
} finally { if (db) await db.close() }
