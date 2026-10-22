import dotenv from 'dotenv'
import { createDatabase } from '../db/database.js'
import { migrateDatabase } from '../db/migrate.js'
dotenv.config()
let db
try{
  db=await createDatabase();await migrateDatabase(db)
  const arg=process.argv.indexOf('--user'),user=arg>=0?Number(process.argv[arg+1]):null
  if(user!==null&&(!Number.isSafeInteger(user)||user<1))throw new Error('INVALID_USER')
  const {rowCount}=await db.query(`INSERT INTO conversation_summary_jobs(thread_id,user_id,target_message_id,force)
    SELECT t.id,t.user_id,MAX(m.id),1 FROM agent_threads t JOIN users u ON u.id=t.user_id JOIN agent_messages m ON m.thread_id=t.id
    WHERE m.role='assistant' ${user===null?'':'AND t.user_id=$1'} GROUP BY t.id,t.user_id
    ON CONFLICT(thread_id) DO UPDATE SET target_message_id=GREATEST(conversation_summary_jobs.target_message_id,excluded.target_message_id),force=1,
    state=CASE WHEN conversation_summary_jobs.state='running' THEN 'running' ELSE 'pending' END,attempts=0,next_at=0`,user===null?[]:[user])
  console.log(`Queued ${rowCount} conversation(s). The API memory worker processes them when embedding is configured and the user has a valid chat-model key.`)
}catch(error){console.error('Summary backfill failed:',error.code||'BACKFILL_FAILED');process.exitCode=1}
finally{if(db)await db.close()}
