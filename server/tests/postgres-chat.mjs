import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createSocket } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import { conversationCacheConfig } from '../services/conversationCache.js'
import { createTestDatabase } from './helpers/postgres.mjs'

test('HTTP: PostgreSQL chat writes facts and summaries, recalls across sessions, and forgets safely', {timeout:60000}, async()=>{
  const f=await createTestDatabase(),secret='pg-chat-test',calls=[]
  const redis=await conversationCacheConfig({ NODE_ENV: 'development', REDIS_URL: process.env.TEST_REDIS_URL })
  const redisPrefix=`campusmind:http-test:${randomUUID()}`
  let embeddingFailure=false,child,output='',redisObserver
  const mock=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw||'{}')
    if(req.url==='/key/generate')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({key:'sk-fake-virtual-user'}))
    if(req.url==='/v1/embeddings')return res.writeHead(embeddingFailure?503:200,{'Content-Type':'application/json'}).end(JSON.stringify(embeddingFailure?{error:'private-provider-detail'}:{data:[{embedding:[1,0,0]}]}))
    const prompts=body.messages.map(x=>String(x.content||'')).join('\n')
    let content='可以继续练习动态规划的背包问题。'
    if(prompts.includes('学习任务路由器'))content=JSON.stringify({intent:'tutor',confidence:0.99})
    else if(prompts.includes('学习记忆提取器'))content=JSON.stringify(body.messages.at(-1).content.includes('晚上')?[{key:'preference.study_time',kind:'preference',content:'偏好晚上八点后学习',evidence:'我晚上八点后学习',confidence:0.99}]:[])
    else if(prompts.includes('学习对话摘要器'))content=JSON.stringify({summary:'讨论了动态规划，下一步练习背包问题。',topics:['动态规划'],open_questions:[]})
    else calls.push(prompts)
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({id:'chat-test',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}))
  })
  mock.listen(0,'127.0.0.1');await once(mock,'listening')
  const provider=`http://127.0.0.1:${mock.address().port}`
  const reservation=createSocket();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r))
  try{
    const user=(await f.db.prepare("INSERT INTO users(student_id,name,phone,college,class,password,api_key,model_type) VALUES ('chat-user','test','phone','college','class','unused','provider-test-key','deepseek-v4-flash')").run()).insertId
    const other=(await f.db.prepare("INSERT INTO users(student_id,name,phone,college,class,password) VALUES ('other','test','other','college','class','unused')").run()).insertId
    child=spawn(process.execPath,['server/index.js'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:f.connectionString,REDIS_ENABLED:redis.REDIS_URL?'true':'false',REDIS_URL:redis.REDIS_URL||'',REDIS_KEY_PREFIX:redisPrefix,MEMORY_DATABASE_URL:'',PORT:String(port),JWT_SECRET:secret,ADMIN_STUDENT_ID:'',ADMIN_PASSWORD:'',LLM_GATEWAY_URL:provider,LLM_GATEWAY_MASTER_KEY:'sk-test-master',MEMORY_ENABLED:'true',MEMORY_EMBEDDING_BASE_URL:provider+'/v1',MEMORY_EMBEDDING_API_KEY:'embedding-test-key',MEMORY_EMBEDDING_MODEL:'test',MEMORY_EMBEDDING_DIMENSIONS:'3',MEMORY_WRITE_MODE:'auto'}})
    child.stdout.on('data',x=>{output+=x});child.stderr.on('data',x=>{output+=x})
    for(let i=0;i<500&&!output.includes('CampusMind server:');i++){if(child.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,50))}
    assert.match(output,/CampusMind server:/)
    const call=async(route,body,method='POST',actor=user)=>{
      const response=await fetch(`http://127.0.0.1:${port}/api${route}`,{method,headers:{Authorization:`Bearer ${jwt.sign({id:actor},secret)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
      const data=await response.json();assert([200,201].includes(response.status),JSON.stringify(data));return data
    }
    const poll=async predicate=>{for(let i=0;i<80;i++){const value=await call('/agent/long-term-memories',undefined,'GET');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100))}throw new Error('Memory worker did not complete: '+output)}
    const first=await call('/agent/threads',{mode:'study'})
    const answer=await call('/agent/chat',{thread_id:first.id,content:'我晚上八点后学习，请讲讲动态规划',mode:'study'})
    assert(answer.answer)
    if(redis.REDIS_URL){
      redisObserver=createClient({url:redis.REDIS_URL});redisObserver.on('error',()=>{});await redisObserver.connect()
      const epoch=await redisObserver.get(`${redisPrefix}:epoch`),key=`${redisPrefix}:u:${user}:t:${first.id}:${epoch}`
      const cached=JSON.parse(await redisObserver.hGet(key,'recent'))
      assert.equal(cached.length,2);assert.equal(cached[0].role,'user');assert.equal(cached[1].role,'assistant')
      const cancelRequest=await f.db.prepare("INSERT INTO agent_platform_action_requests(user_id,thread_id,action_type,payload_json) VALUES (?,?,'project_plan','{}')").run(user,first.id)
      await f.db.prepare('UPDATE agent_messages SET actions_json=? WHERE id=?').run(JSON.stringify([{request_id:cancelRequest.insertId,status:'pending'}]),cached[1].id)
      const listed=await call(`/agent/threads/${first.id}/messages`,undefined,'GET')
      assert.equal(listed.length,2)
      assert.deepEqual(await call(`/agent/threads/${first.id}/messages`,undefined,'GET'),listed)
      assert(await redisObserver.hGet(key,'messages'))
      await call(`/agent/platform-actions/${cancelRequest.insertId}/cancel`,{})
      assert.equal((await call(`/agent/threads/${first.id}/messages`,undefined,'GET'))[1].actions[0].status,'cancelled','live action state is hydrated even when message rows are cached')
      const project=await call('/agent/projects',{goal:'整理动态规划的学习目标和练习步骤',thread_id:first.id})
      assert.equal(await redisObserver.hGet(key,'messages'),null,'project summaries invalidate cached message lists')
      assert.equal(JSON.parse(await redisObserver.hGet(key,'recent')).length,3)
      assert.equal((await call(`/agent/threads/${first.id}/messages`,undefined,'GET')).length,3)
      const executeRequest=await f.db.prepare("INSERT INTO agent_platform_action_requests(user_id,thread_id,action_type,payload_json) VALUES (?,?,'project_plan',?)").run(user,first.id,JSON.stringify({project_id:project.project.id,title:'test plan',content:'test plan content'}))
      await call(`/agent/platform-actions/${executeRequest.insertId}/confirm`,{})
      assert.equal(await redisObserver.hGet(key,'messages'),null,'action completion invalidates cached message lists')
      assert.equal(JSON.parse(await redisObserver.hGet(key,'recent')).length,4)
      assert.equal((await call(`/agent/threads/${first.id}/messages`,undefined,'GET')).length,4)
      const denied=await fetch(`http://127.0.0.1:${port}/api/agent/threads/${first.id}/messages`,{headers:{Authorization:`Bearer ${jwt.sign({id:other},secret)}`}})
      assert.equal(denied.status,404)
    }
    await poll(data=>data.items.length===1)
    const second=await call('/agent/threads',{mode:'study'})
    const memories=await poll(data=>data.episodes.length===1)
    const next=await call('/agent/chat',{thread_id:second.id,content:'按照我的学习习惯，继续之前的动态规划讨论',mode:'study'})
    assert.equal(next.memory.recalled_count,1);assert.equal(next.memory.summary_count,1)
    assert(calls.at(-1).includes('晚上八点后'));assert(calls.at(-1).includes('相关历史对话的分段摘要'))
    assert.equal((await call('/agent/long-term-memories',undefined,'GET',other)).items.length,0)
    await call(`/agent/history-summaries/${memories.episodes[0].id}`,undefined,'DELETE')
    assert.equal((await call('/agent/long-term-memories',undefined,'GET')).episodes.length,0)
    await call(`/agent/long-term-memories/${memories.items[0].id}`,undefined,'DELETE')
    const forgotten=await call('/agent/long-term-memories',undefined,'GET')
    assert.equal(forgotten.items.length,0);assert.equal(forgotten.episodes.length,0)
    embeddingFailure=true
    const degraded=await call('/agent/chat',{thread_id:second.id,content:'再给我一道练习题',mode:'study'})
    assert.equal(degraded.memory.status,'unavailable');assert(degraded.answer)
  }finally{
    if(redisObserver?.isOpen)redisObserver.destroy()
    if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited}
    mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));await f.close()
  }
})
