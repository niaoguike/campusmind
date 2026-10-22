import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const identifier=name=>{if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw new Error('IMPORT_INVALID_IDENTIFIER');return `"${name}"`}
export async function importSQLite (db,{sourcePath,backupDirectory,dryRun=false}) {
  const {default:SQLite}=await import('better-sqlite3')
  const source=new SQLite(sourcePath,{readonly:true,fileMustExist:true})
  let snapshot,backupPath
  try{
    const sourceTables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name).filter(name=>!/^resource_chunks_fts(?:_|$)/.test(name))
    const {rows:targetRows}=await db.query('SELECT table_name,column_name,is_identity FROM information_schema.columns WHERE table_schema=current_schema()')
    const targets=new Map()
    for(const row of targetRows){if(!targets.has(row.table_name))targets.set(row.table_name,[]);targets.get(row.table_name).push(row)}
    for(const table of sourceTables){
      if(!targets.has(table))throw new Error(`IMPORT_UNKNOWN_TABLE_${table}`)
      const allowed=new Set(targets.get(table).map(row=>row.column_name))
      for(const column of source.prepare(`PRAGMA table_info(${identifier(table)})`).all())if(!allowed.has(column.name))throw new Error(`IMPORT_UNKNOWN_COLUMN_${table}_${column.name}`)
    }
    const counts=Object.fromEntries(sourceTables.map(table=>[table,source.prepare(`SELECT COUNT(*) n FROM ${identifier(table)}`).get().n]))
    if(dryRun)return {dry_run:true,tables:sourceTables.length,counts}
    await mkdir(backupDirectory,{recursive:true})
    backupPath=path.join(backupDirectory,`campusmind-${Date.now()}-${randomUUID()}.db`)
    await source.backup(backupPath)
    snapshot=new SQLite(backupPath,{readonly:true,fileMustExist:true})
    const sourceHash=createHash('sha256').update(await readFile(backupPath)).digest('hex')
    const client=await db.pool.connect()
    try{
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(782431899)')
      const previous=(await client.query('SELECT report FROM sqlite_imports WHERE source_hash=$1',[sourceHash])).rows[0]
      if(previous){await client.query('ROLLBACK');return {...previous.report,already_imported:true,backup:backupPath}}
      // Never merge into an initialized business database or silently overwrite records.
      const businessTables=[...targets.keys()].filter(name=>!['schema_migrations','sqlite_imports','resource_chunks_fts'].includes(name))
      for(const table of businessTables){if(Number((await client.query(`SELECT COUNT(*) n FROM ${identifier(table)}`)).rows[0].n)!==0)throw new Error(`IMPORT_TARGET_NOT_EMPTY_${table}`)}
      const imported={}
      for(const table of sourceTables){
        const columns=snapshot.prepare(`PRAGMA table_info(${identifier(table)})`).all().map(row=>row.name)
        let batch=[],total=0
        const write=async()=>{
          if(!batch.length)return
          const values=[],tuples=batch.map(row=>`(${columns.map(column=>{values.push(row[column]);return `$${values.length}`}).join(',')})`)
          await client.query(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES ${tuples.join(',')}`,values)
          total+=batch.length;batch=[]
        }
        for(const row of snapshot.prepare(`SELECT * FROM ${identifier(table)}`).iterate()){batch.push(row);if(batch.length>=100)await write()}
        await write()
        const actual=Number((await client.query(`SELECT COUNT(*) n FROM ${identifier(table)}`)).rows[0].n)
        if(actual!==total)throw new Error('IMPORT_ROW_COUNT_MISMATCH')
        for(const column of targets.get(table).filter(row=>row.is_identity==='YES')){
          const sequence=(await client.query('SELECT pg_get_serial_sequence($1,$2) name',[table,column.column_name])).rows[0].name
          await client.query(`SELECT setval($1::regclass,COALESCE(MAX(${identifier(column.column_name)}),1),COUNT(*)>0) FROM ${identifier(table)}`,[sequence])
        }
        imported[table]=actual
      }
      await client.query('INSERT INTO resource_chunks_fts(chunk_id,resource_id,content) SELECT id,resource_id,content FROM resource_chunks ON CONFLICT DO NOTHING')
      await client.query(`INSERT INTO memory_excluded_messages(message_id,user_id)
        WITH origins AS (SELECT m.*,MAX(CASE WHEN role='user' THEN id END) OVER(PARTITION BY thread_id ORDER BY id) origin FROM agent_messages m)
        SELECT m.id,t.user_id FROM origins m JOIN agent_messages u ON u.id=m.origin JOIN agent_threads t ON t.id=m.thread_id
        WHERE u.content ~* '(不要|别)(记住|记下|保存|记录)|do not remember|don''t remember' ON CONFLICT DO NOTHING`)
      const queued=await client.query(`INSERT INTO conversation_summary_jobs(thread_id,user_id,target_message_id,force)
        SELECT t.id,t.user_id,MAX(m.id),1 FROM agent_threads t JOIN agent_messages m ON m.thread_id=t.id
        WHERE m.role='assistant' GROUP BY t.id,t.user_id ON CONFLICT DO NOTHING`)
      const report={counts:imported,tables:sourceTables.length,summary_threads_queued:queued.rowCount}
      await client.query('INSERT INTO sqlite_imports(source_hash,report) VALUES ($1,$2::jsonb)',[sourceHash,JSON.stringify(report)])
      await client.query('COMMIT')
      return {...report,backup:backupPath,already_imported:false}
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }finally{snapshot?.close();source.close()}
}
