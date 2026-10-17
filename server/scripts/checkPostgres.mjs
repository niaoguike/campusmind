import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import pg from 'pg'

// Deliberately use the local database file, never a production DATABASE_URL.
let client
try {
  const config = dotenv.parse(await readFile(new URL('../../deploy/postgres/.env', import.meta.url)))
  const port = Number(config.POSTGRES_PORT || 5432)
  if (!config.POSTGRES_PASSWORD || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_LOCAL_CONFIG')
  client = new pg.Client({ host: '127.0.0.1', port, user: 'campusmind', database: 'campusmind', password: config.POSTGRES_PASSWORD, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
  await client.connect()
  const { rows: extensions } = await client.query("SELECT extversion FROM pg_extension WHERE extname='vector'")
  if (!extensions.length) throw new Error('VECTOR_EXTENSION_MISSING')
  await client.query('BEGIN')
  try {
    await client.query('CREATE TEMP TABLE campusmind_connection_check (user_id INTEGER,embedding vector(3)) ON COMMIT DROP')
    await client.query("INSERT INTO campusmind_connection_check VALUES (1,'[1,0,0]'),(2,'[0,1,0]')")
    const { rows } = await client.query("SELECT user_id,1-(embedding <=> '[1,0,0]'::vector) AS similarity FROM campusmind_connection_check WHERE user_id=$1 ORDER BY embedding <=> '[1,0,0]'::vector LIMIT 1", [1])
    if (rows.length !== 1 || rows[0].user_id !== 1 || Number(rows[0].similarity) !== 1) throw new Error('VECTOR_QUERY_FAILED')
  } finally { await client.query('ROLLBACK') }
  console.log(`PostgreSQL ready: 127.0.0.1:${port}/campusmind`)
  console.log(`pgvector ${extensions[0].extversion}: transaction and scoped cosine-search checks passed.`)
  const installed=(await client.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name
  if(installed){const count=(await client.query('SELECT COUNT(*) n FROM schema_migrations')).rows[0].n;console.log(`Unified PostgreSQL: ${count} versioned migrations installed.`)}
  else console.log('Database engine ready. Apply the application migrations before starting the API.')
} catch (error) {
  const code = /^[A-Z_0-9]+$/.test(error.code || error.message) ? error.code || error.message : 'CHECK_FAILED'
  console.error(`Local PostgreSQL check failed (${code}). Check Docker status and deploy/postgres/.env.`)
  process.exitCode = 1
} finally { if (client) await client.end().catch(() => {}) }
