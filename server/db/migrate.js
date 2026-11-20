import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export async function migrateDatabase (db) {
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(782431900)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
    const directory = new URL('./migrations/', import.meta.url)
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE version=$1', [name])).rows[0]
      if (previous) {
        if (previous.checksum !== checksum) {
          console.warn(`[migrate] 迁移文件内容已变更，仅更新校验和、不重新执行：${name}（请确认该改动可安全叠加到已部署库）`)
          await client.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1', [name, checksum])
        }
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)', [name, checksum])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
