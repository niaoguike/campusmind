import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../db/database.js'
import { checkEmbedding } from '../services/memory/checkEmbedding.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })
let db
try {
  db = await createDatabase()
  const report = await checkEmbedding({ db })
  console.log(JSON.stringify(report, null, 2))
  if (report.semantic_sample !== 'passed') {
    console.error('Embedding vectors are valid; the synthetic semantic ranking needs review before enabling memory.')
    process.exitCode = 1
  }
} catch (error) {
  const code = /^(EMBEDDING|MEMORY)_[A-Z_0-9]+$/.test(error.message) ? error.message : 'EMBEDDING_CHECK_FAILED'
  console.error(`Embedding check failed (${code}). Check server/.env, provider access and PostgreSQL; no personal memories were written.`)
  process.exitCode = 1
} finally { if (db) await db.close() }
