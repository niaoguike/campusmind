import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createDatabase } from '../db/database.js'
import { migrateDatabase } from '../db/migrate.js'
import { importSQLite } from '../services/sqliteImport.js'
dotenv.config()
let db
try{
  const option=process.argv.indexOf('--source')
  const sourcePath=option>=0?process.argv[option+1]:process.env.CAMPUSMIND_DB_PATH||fileURLToPath(new URL('../data.db',import.meta.url))
  db=await createDatabase();await migrateDatabase(db)
  const report=await importSQLite(db,{sourcePath,backupDirectory:fileURLToPath(new URL('../../data/backups/',import.meta.url)),dryRun:process.argv.includes('--dry-run')})
  console.log(JSON.stringify(report,null,2))
}catch(error){console.error('SQLite import failed:',error.code||(/^IMPORT_/.test(error.message)?error.message:'IMPORT_FAILED'));process.exitCode=1}
finally{if(db)await db.close()}
