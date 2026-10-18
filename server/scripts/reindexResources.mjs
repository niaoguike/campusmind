import dotenv from 'dotenv'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../db/database.js'
import { migrateDatabase } from '../db/migrate.js'
import { extractResourceChunks, createResourceRag } from '../services/resourceRag.js'
import { hash } from '../services/rag/config.js'
import { CHUNKING_VERSION } from '../services/rag/chunking.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true })
const args = new Set(process.argv.slice(2)), allowed = new Set(['--force', '--vectors', '--retry-failed'])
if ([...args].some(arg => !allowed.has(arg))) throw new Error('Usage: reindexResources.mjs [--force] [--vectors] [--retry-failed]')
const directory = fileURLToPath(new URL('../uploads/resources/', import.meta.url))
let db, rag
try {
  db = await createDatabase(); await migrateDatabase(db)
  rag = createResourceRag({ db })
  let cursor = 0, rebuilt = 0, failed = 0
  while (true) {
    const resources = await db.prepare(`SELECT r.* FROM resources r LEFT JOIN resource_documents d ON d.resource_id=r.id
      WHERE r.id>? AND COALESCE(r.file_path,'')<>'' AND (? OR d.status IS DISTINCT FROM 'ready' OR d.chunking_version<?)
      ORDER BY r.id LIMIT 30`).all(cursor, args.has('--force'), CHUNKING_VERSION)
    if (!resources.length) break
    for (const resource of resources) {
      cursor = resource.id
      try {
        const target = path.resolve(directory, path.basename(resource.file_path))
        if (path.dirname(target) !== path.resolve(directory)) throw new Error('INVALID_RESOURCE_PATH')
        const buffer = await readFile(target)
        const chunks = await extractResourceChunks(resource.file_name || path.basename(target), buffer)
        if (!await rag.replace(resource.id, chunks, { sourceHash: hash(buffer) })) continue
        rebuilt++
        console.log(`Resource #${resource.id}: ${chunks.length} chunks`)
      } catch {
        failed++
        await db.prepare(`INSERT INTO resource_documents(resource_id,status,error_message,chunk_count,processed_at)
          SELECT id,'failed','源文件不可用或格式不支持，请重新上传',0,? FROM resources WHERE id=?
          ON CONFLICT(resource_id) DO UPDATE SET status='failed',error_message=excluded.error_message,processed_at=excluded.processed_at`).run(new Date().toISOString(), resource.id)
        console.error(`Resource #${resource.id}: source unavailable or unsupported; re-upload a text-based document`)
      }
    }
  }
  let synchronized = 0, batch
  if (args.has('--retry-failed')) await rag.synchronize({ retryFailed: true })
  do { batch = await rag.synchronize(); synchronized += batch } while (batch === 100)
  let processed = 0
  if (args.has('--vectors')) {
    if (!rag.config.embed) throw new Error('RAG_EMBEDDING_NOT_CONFIGURED')
    while (await rag.drainOne()) processed++
  }
  const jobs = await rag.status()
  console.log(JSON.stringify({ rebuilt, failed, synchronized, processed, vectorEnabled: Boolean(rag.config.embed), jobs }))
  if (failed || jobs.some(job => job.state === 'failed')) process.exitCode = 1
} catch (error) { console.error('Resource reindex failed:', error.code || (error.message.startsWith('RAG_') ? error.message : 'see database/embedding configuration')); process.exitCode = 1 }
finally { if (rag) await rag.close(); if (db) await db.close() }
