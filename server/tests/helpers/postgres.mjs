import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { createDatabase, databaseConfig } from '../../db/database.js'
import { migrateDatabase } from '../../db/migrate.js'

export async function createTestDatabase () {
  const config = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : await databaseConfig({ NODE_ENV: 'development' })
  const admin = new pg.Pool({ ...config, max: 1 })
  const schema = `campusmind_test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  const url = config.connectionString ? new URL(config.connectionString) : new URL(`postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${config.database}`)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  const db = await createDatabase({ env: { DATABASE_URL: url.href } })
  await migrateDatabase(db)
  return {
    db, schema, connectionString: url.href,
    async close () {
      await db.close()
      if (!/^campusmind_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
      try { await admin.query(`DROP SCHEMA ${schema} CASCADE`) } finally { await admin.end() }
    }
  }
}
