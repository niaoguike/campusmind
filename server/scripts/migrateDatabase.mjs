import dotenv from 'dotenv'
import { createDatabase } from '../db/database.js'
import { migrateDatabase } from '../db/migrate.js'

dotenv.config()
let db
try {
  db = await createDatabase()
  await migrateDatabase(db)
  console.log('PostgreSQL business and memory workflow migrations are current.')
} catch (error) {
  console.error('Database migration failed:', error.code || error.message)
  process.exitCode = 1
} finally { if (db) await db.close() }
