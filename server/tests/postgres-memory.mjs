import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import SQLite from 'better-sqlite3'
import { createTestDatabase } from './helpers/postgres.mjs'
import { createMemoryStore } from '../services/memory/store.js'
import { invalidateSummaryHistory } from '../services/memory/episodes.js'
import { createLongTermMemoryService,validateMemoryCandidates } from '../services/longTermMemory.js'
import { buildThreadHistory } from '../agents/contextBuilder.js'
import { searchKnowledgeChunks } from '../services/resourceRag.js'
import { importSQLite } from '../services/sqliteImport.js'

async function fixture(){
  const f=await createTestDatabase(),db=f.db
  await db.exec("INSERT INTO users(id,student_id,name,phone,college,class,password) VALUES (1,'test-1','Alice','test-1','test','test','unused'),(2,'test-2','Bob','test-2','test','test','unused'); INSERT INTO agent_threads(id,user_id) VALUES (11,1),(12,1),(21,2)")
  const store=createMemoryStore({pool:db.pool,dimensions:3,identity:'unit-vectors',ownsPool:false,onMutation:invalidateSummaryHistory})
  let fail=false,summaryCalls=0
  const embed=async text=>{if(fail)throw new Error('EMBEDDING_UNAVAILABLE');return /图论/.test(text)?[0,1,0]:[1,0,0]}
  const service=options=>createLongTermMemoryService({db,userOf:id=>db.prepare('SELECT * FROM users WHERE id=?').get(id),store,embed,env:{MEMORY_EMBEDDING_DIMENSIONS:'3'},onError(){},extract:async({source})=>source.includes('晚上')?[{key:'preference.study_time',kind:'preference',content:'偏好晚上八点之后学习',evidence:source,confidence:0.96}]:[],summarize:async()=>{summaryCalls++;return {summary:'讨论了动态规划状态定义，已理解状态转移，下一步练习背包问题。',topics:['动态规划'],open_questions:['如何初始化背包数组']}},...options})
  const add=async(id,thread,content,role='user')=>(await db.prepare('INSERT INTO agent_messages(id,thread_id,role,content) VALUES (?,?,?,?)').run(id,thread,role,content)).insertId
  return {...f,store,service,add,fail:value=>{fail=value},summaryCalls:()=>summaryCalls}
}

test('PostgreSQL transactions rollback, nest, and isolate concurrent connections',async()=>{
  const f=await createTestDatabase(),db=f.db
  try{
    await assert.rejects(()=>db.transaction(async()=>{await db.prepare("INSERT INTO courses(name) VALUES ('rollback')").run();throw new Error('stop')})(),/stop/)
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM courses').get()).n,0)
    await db.transaction(async()=>{
      await db.prepare("INSERT INTO courses(name) VALUES ('keep')").run()
      await assert.rejects(()=>db.transaction(async()=>{await db.prepare("INSERT INTO courses(name) VALUES ('nested rollback')").run();throw new Error('nested')})(),/nested/)
    })()
    await Promise.allSettled([db.transaction(async()=>{await db.prepare("INSERT INTO courses(name) VALUES ('parallel rollback')").run();await new Promise(r=>setTimeout(r,20));throw new Error('stop')})(),db.transaction(async()=>{await db.prepare("INSERT INTO courses(name) VALUES ('parallel keep')").run()})()])
    assert.deepEqual((await db.prepare('SELECT name FROM courses ORDER BY name').all()).map(x=>x.name),['keep','parallel keep'])
  }finally{await f.close()}
})

test('PostgreSQL: cross-session fact recall, tenant isolation, manual correction and forgetting',async()=>{
  const f=await fixture(),service=f.service()
  try{
    await f.add(1,11,'我晚上八点之后学习');await service.enqueue(1,11,1);await service.enqueue(2,11,1);await service.drain()
    await f.add(2,12,'按我的习惯安排复习')
    const history=await buildThreadHistory({db:f.db,threadId:12,userId:1,attachmentContext:()=>''})
    assert.equal(history.length,1)
    assert.equal((await buildThreadHistory({db:f.db,threadId:11,userId:2,attachmentContext:()=>''})).length,0)
    const result=await service.recall(1,'安排复习')
    assert.equal(result.items.length,1);assert.match(result.brief,/晚上八点/)
    assert.equal((await service.recall(2,'安排复习')).items.length,0)
    assert.equal((await service.recall(1,'图论')).items.length,0)
    const item=result.items[0]
    assert.equal(await service.edit(2,item.id,'下午学习',1),null)
    assert.equal(await service.erase(2,item.id),false)
    assert((await service.edit(1,item.id,'偏好下午学习',1)).authority==='user')
    await f.add(3,12,'我晚上学习');await service.enqueue(1,12,3);await service.drain()
    assert.equal((await service.list(1)).items[0].content,'偏好下午学习')
    assert(await service.erase(1,item.id))
    await f.add(4,12,'我晚上学习');await service.enqueue(1,12,4);await service.drain()
    assert.equal((await service.recall(1,'安排复习')).items.length,0)
    const erased=await f.db.prepare('SELECT content,evidence,embedding FROM campusmind_memories WHERE id=?').get(item.id)
    assert.equal(erased.content,'');assert.equal(erased.evidence,'');assert.equal(erased.embedding,null)
  }finally{await service.close();await f.close()}
})

test('PostgreSQL: summary tail flush, source ranges, restart recall and current-window deduplication',async()=>{
  const f=await fixture(),service=f.service()
  try{
    await f.add(1,11,'解释动态规划');await f.add(2,11,'先明确状态定义','assistant')
    await service.enqueueSummary(1,11,2);await service.drain()
    assert.equal((await service.list(1)).episodes.length,0)
    await service.flushUserThreads(1,12);await service.drain()
    const episode=(await service.list(1)).episodes[0]
    assert.equal(episode.start_message_id,1);assert.equal(episode.end_message_id,2)
    assert.equal((await service.recall(1,'动态规划',{threadId:12})).episodes.length,1)
    assert.equal((await service.recall(2,'动态规划')).episodes.length,0)
    assert.equal((await service.recall(1,'动态规划',{threadId:11,historyStartId:1})).episodes.length,0)
    assert.equal((await service.recall(1,'动态规划',{threadId:11,historyStartId:3})).episodes.length,1)
    await service.enqueueSummary(1,11,2,true);await service.drain()
    assert.equal(f.summaryCalls(),1,'replayed work must not regenerate an already summarized range')
    await service.close()
    const restarted=f.service()
    assert.equal((await restarted.recall(1,'动态规划',{threadId:12})).episodes.length,1)
    await restarted.close()
  }finally{await service.close();await f.close()}
})

test('PostgreSQL: profile correction invalidates summaries and barriers prevent regeneration from old messages',async()=>{
  const f=await fixture(),service=f.service()
  try{
    await f.add(1,11,'我晚上学习，讲讲动态规划');await f.add(2,11,'讨论动态规划','assistant')
    await service.enqueue(1,11,1);await service.enqueueSummary(1,11,2,true);await service.drain()
    assert.equal((await service.list(1)).episodes.length,1)
    const item=(await service.list(1)).items[0]
    await service.edit(1,item.id,'我喜欢下午学习',item.revision)
    assert.equal((await service.recall(1,'动态规划')).episodes.length,0)
    const old=await f.db.prepare('SELECT content,embedding FROM agent_thread_summaries').get()
    assert.equal(old.content,'');assert.equal(old.embedding,null)
    await service.enqueueSummary(1,11,2,true);await service.drain()
    assert.equal((await service.list(1)).episodes.length,0)
    await f.add(3,12,'继续学习背包问题');await f.add(4,12,'讨论背包初始化','assistant')
    await service.enqueueSummary(1,12,4,true);await service.drain()
    assert.equal((await service.list(1)).episodes.length,1)
    assert(await service.eraseSummary(1,(await service.list(1)).episodes[0].id))
    assert.equal((await service.list(1)).episodes.length,0)
    await service.eraseUser(1)
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM campusmind_memories WHERE user_id=1').get()).n,0)
    assert.equal(await f.store.writeAutomatic(1,[{key:'goal.stale',kind:'goal',content:'old',evidence:'old',confidence:1,vector:[1,0,0],messageId:1,threadId:11,expiresAt:null}]),0)
  }finally{await service.close();await f.close()}
})

test('PostgreSQL: durable retries, interrupted leases, and two-worker claim exclusivity',async()=>{
  const f=await fixture(),service=f.service(),other=f.service()
  try{
    await f.add(1,11,'我晚上学习');await service.enqueue(1,11,1);f.fail(true);await service.drain()
    assert.equal((await f.db.prepare('SELECT attempts FROM long_term_memory_jobs').get()).attempts,1)
    assert.equal((await service.recall(1,'复习')).status,'unavailable')
    f.fail(false);await f.db.exec("UPDATE long_term_memory_jobs SET state='running',lease_until=0,next_at=0")
    await Promise.all([service.drain(),other.drain()])
    assert.equal((await service.list(1)).items.length,1)
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM long_term_memory_jobs').get()).n,0)
    await f.add(2,11,'动态规划讨论','assistant');await service.enqueueSummary(1,11,2,true)
    await Promise.all([service.drain(),other.drain()])
    assert.equal(f.summaryCalls(),1)
  }finally{await service.close();await other.close();await f.close()}
})

test('PostgreSQL full-text course retrieval and explicit memory opt-out',async()=>{
  const f=await fixture(),service=f.service()
  try{
    const course=(await f.db.prepare("INSERT INTO courses(name) VALUES ('算法')").run()).insertId
    const resource=(await f.db.prepare("INSERT INTO resources(course_id,title,file_name) VALUES (?,'动态规划','dp.txt')").run(course)).insertId
    const chunk=(await f.db.prepare("INSERT INTO resource_chunks(resource_id,chunk_index,content) VALUES (?,0,'动态规划的核心是状态转移')").run(resource)).insertId
    await f.db.prepare('INSERT INTO resource_chunks_fts(chunk_id,resource_id,content) VALUES (?,?,?)').run(chunk,resource,'动态规划的核心是状态转移')
    assert.equal((await searchKnowledgeChunks(f.db,'动态规划',8,course)).length,1)
    await f.add(1,11,'不要记录：我晚上学习');await f.add(2,11,'好的','assistant')
    await service.enqueue(1,11,1);await service.enqueueSummary(1,11,2,true);await service.drain()
    assert.equal((await service.list(1)).items.length,0);assert.equal((await service.list(1)).episodes.length,0)
    assert.equal(validateMemoryCandidates([{key:'preference.time',kind:'preference',content:'晚上学习',evidence:'虚构证据',confidence:1}],'我晚上学习').length,0)
  }finally{await service.close();await f.close()}
})

test('SQLite import preserves IDs, encrypted fields and source; backup, sequence reset and repeat safety',async()=>{
  const f=await createTestDatabase(),dir=await mkdtemp(path.join(tmpdir(),'campusmind-import-')),source=path.join(dir,'source.db')
  const sqlite=new SQLite(source)
  sqlite.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,student_id TEXT,name TEXT,phone TEXT,college TEXT,class TEXT,password TEXT,api_key TEXT); INSERT INTO users VALUES (42,'student','name','phone','college','class','password-hash','v1:encrypted-key'); CREATE TABLE agent_threads(id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT); INSERT INTO agent_threads VALUES (71,42,'old conversation'); CREATE TABLE agent_messages(id INTEGER PRIMARY KEY,thread_id INTEGER,role TEXT,content TEXT); INSERT INTO agent_messages VALUES (101,71,'user','解释动态规划'),(102,71,'assistant','先明确状态')")
  sqlite.close();const before=await readFile(source)
  try{
    const report=await importSQLite(f.db,{sourcePath:source,backupDirectory:path.join(dir,'backups')})
    assert.equal(report.tables,3);assert.equal(report.summary_threads_queued,1)
    assert.equal((await f.db.prepare('SELECT api_key FROM users WHERE id=42').get()).api_key,'v1:encrypted-key')
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM agent_messages WHERE thread_id=71').get()).n,2)
    assert.deepEqual(await readFile(source),before)
    assert((await readFile(report.backup)).length>0)
    assert.equal((await importSQLite(f.db,{sourcePath:source,backupDirectory:path.join(dir,'backups')})).already_imported,true)
    const next=await f.db.prepare("INSERT INTO users(student_id,name,phone,college,class,password) VALUES ('next','next','next','next','next','next')").run()
    assert.equal(next.insertId,43)
  }finally{await f.close();assert(path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'campusmind-import-'));await rm(dir,{recursive:true,force:true})}
})
