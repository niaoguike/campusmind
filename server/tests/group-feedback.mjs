import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { createTestDatabase } from './helpers/postgres.mjs'
import { classifyFeedbackCandidate, normalizeFeedbackResult, observerEligible } from '../services/groupFeedback.js'

assert.equal(classifyFeedbackCandidate('普通聊天'), null)
assert.equal(classifyFeedbackCandidate('@AI 这一步为什么不对？')?.type, 'help_request')
assert.equal(classifyFeedbackCandidate('为什么这里不会算？', 'suggest')?.type, 'help_request')
assert.equal(observerEligible('你好'),false)
assert.equal(observerEligible('向量检索一定比关键词检索快'),true)
const normalized = normalizeFeedbackResult(JSON.stringify({ summary:'核验', claims:[{ claim:'结论', source_message_ids:[1,999], evidence:[{ resource_id:4,chunk_id:7 },{ resource_id:999,chunk_id:999 }], status:'supported' }] }),[{ id:1 }],[{ resource_id:4,chunk_id:7 }])
assert.deepEqual(normalized.claims[0].source_message_ids,[1])
assert.equal(normalized.claims[0].evidence.length,1)
assert.equal(normalizeFeedbackResult('{bad',[],[]).claims.length,0)

const fixture = await createTestDatabase()
const port = 19379, secret = 'isolated-group-feedback-test'
const fakeGateway = createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json')
  if (req.url === '/key/generate') return res.end(JSON.stringify({key:'sk-isolated-observer-test'}))
  if (req.url !== '/chat/completions') {res.statusCode=404;return res.end('{}')}
  const chunks=[]
  for await (const chunk of req) chunks.push(chunk)
  const payload=JSON.parse(Buffer.concat(chunks).toString())
  const system=payload.messages?.find(message=>message.role==='system')?.content || ''
  const content=system.includes('私人观察助手')
    ? JSON.stringify({needed:true,kind:'possible_error',title:'检索说法值得核对',teaser:'两种检索方式的速度取决于条件，建议核查。'})
    : '速度取决于索引和查询条件；请对照课程资料再下结论。'
  res.end(JSON.stringify({id:'chatcmpl-test',object:'chat.completion',created:1,model:payload.model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}))
})
await new Promise(resolve=>fakeGateway.listen(19400,'127.0.0.1',resolve))
const child = spawn(process.execPath, ['server/index.js'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true,
  env: { ...process.env, DATABASE_URL: fixture.connectionString, LLM_GATEWAY_URL:'http://127.0.0.1:19400',LLM_GATEWAY_MASTER_KEY:'sk-isolated-master', MEMORY_ENABLED: 'false', REDIS_ENABLED: 'false', MEMORY_DATABASE_URL: '', PORT: String(port), JWT_SECRET: secret, ADMIN_STUDENT_ID: '', ADMIN_PASSWORD: '' }, stdio: ['ignore','pipe','pipe'] })
let output = '', checks = 0
child.stdout.on('data', chunk => output += chunk)
child.stderr.on('data', chunk => output += chunk)
async function call (user, url, method = 'GET', body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ id: user }, secret)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`)
  checks++
  return data
}
try {
  for (let i = 0; i < 600 && !output.includes('CampusMind server:'); i++) { if (child.exitCode !== null) throw new Error(output); await new Promise(resolve => setTimeout(resolve,100)) }
  assert.match(output,/CampusMind server:/)
  const db = fixture.db
  const addUser = db.prepare('INSERT INTO users (student_id,name,phone,college,class,password,role) VALUES (?,?,?,?,?,?,?)')
  const ids = []
  for (let i=0;i<3;i++) ids.push(Number((await addUser.run(`8990000${i}`,`group-test-${i}`,`1399000000${i}`,'学院','1班','unused','student')).insertId))
  const [owner, member, outsider] = ids
  const group = Number((await db.prepare("INSERT INTO conversations (title,type,owner_id) VALUES (?,'group',?)").run('测试群',owner)).insertId)
  await db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?),(?,?)').run(group,owner,group,member)
  await call(outsider,`/conversations/${group}/feedback-settings`,'GET',undefined,403)
  await call(member,`/conversations/${group}/feedback-settings`,'PATCH',{ observer_enabled:true },403)
  await call(owner,`/conversations/${group}/feedback-settings`,'PATCH',{ observer_enabled:true,trigger_mode:'explicit',analysis_mode:'single' })
  await call(owner,`/conversations/${group}/feedback-consent`,'PATCH',{ allow_context:true })
  await call(member,`/conversations/${group}/feedback-consent`,'PATCH',{ allow_context:true })
  assert.equal((await call(owner,`/conversations/${group}/feedback-settings`)).receive_hints,false)
  await call(owner,`/conversations/${group}/feedback-consent`,'PATCH',{ receive_hints:true },400)
  await db.prepare('UPDATE users SET api_key=? WHERE id=?').run('isolated-test-placeholder',owner)
  await call(owner,`/conversations/${group}/feedback-consent`,'PATCH',{ receive_hints:true,hint_daily_limit:2 })
  assert.equal((await call(owner,`/conversations/${group}/feedback-settings`)).hint_daily_limit,2)
  const observed = await call(member,`/conversations/${group}/messages`,'POST',{content:'向量检索一定比关键词检索快吗？'},201)
  let automatic=[]
  for (let wait=0;wait<40;wait++) {automatic=await call(owner,`/conversations/${group}/observer-hints`);if (automatic.length) break;await new Promise(resolve=>setTimeout(resolve,300))}
  assert.equal(automatic.length,1,'已授权成员的学习讨论应产生私人提示')
  assert.equal(automatic[0].anchor_message_id,observed.id)
  assert.equal((await call(member,`/conversations/${group}/observer-hints`)).length,0)
  const followup=await call(owner,`/conversations/${group}/observer-hints/${automatic[0].id}/followups`,'POST',{question:'为什么值得核对？'},201)
  assert.match(followup.answer,/索引和查询条件/)
  await call(owner,`/conversations/${group}/observer-hints/${automatic[0].id}`,'PATCH',{status:'dismissed'})
  assert.equal((await call(owner,`/conversations/${group}/observer-hints`)).length,0)
  const first = await call(member,`/conversations/${group}/messages`,'POST',{ content:'第一条' },201)
  const second = await call(member,`/conversations/${group}/messages`,'POST',{ content:'第二条',reply_to_id:first.id },201)
  await call(outsider,`/conversations/${group}/messages?limit=1`,'GET',undefined,403)
  await call(owner,`/conversations/${group}/messages`,'POST',{ content:'跨群回复',reply_to_id:999999 },400)
  const latest = await call(owner,`/conversations/${group}/messages?limit=1`)
  assert.equal(latest[0].id,second.id)
  assert.equal((await call(owner,`/conversations/${group}/messages?before=${second.id}&limit=1`))[0].id,first.id)
  await call(owner,`/conversations/${group}/messages/${second.id}`,'PATCH',{ content:'越权编辑' },404)
  await call(member,`/conversations/${group}/messages/${second.id}`,'PATCH',{ content:'已修改' })
  const secondVersion = (await db.prepare('SELECT version FROM messages WHERE id=?').get(second.id)).version
  const hint = Number((await db.prepare("INSERT INTO group_observer_hints (conversation_id,recipient_id,anchor_message_id,anchor_version,source_message_ids,kind,title,teaser,created_at,updated_at) VALUES (?,?,?,?,?,'possible_error','值得核对','需要核查原消息',?,?)").run(group,owner,second.id,secondVersion,JSON.stringify([second.id]),new Date().toISOString(),new Date().toISOString())).insertId)
  assert.equal((await call(owner,`/conversations/${group}/observer-hints`)).length,1)
  await call(member,`/conversations/${group}/observer-hints/${hint}/followups`,'GET',undefined,404)
  await call(owner,`/conversations/${group}/observer-hints/${hint}`,'PATCH',{status:'read'})
  await call(member,`/conversations/${group}/messages/${second.id}`,'PATCH',{content:'再次修改'})
  assert.equal((await call(owner,`/conversations/${group}/observer-hints`)).length,0)
  const version = (await db.prepare('SELECT version FROM messages WHERE id=?').get(first.id)).version
  const feedback = Number((await db.prepare("INSERT INTO group_feedback (conversation_id,requester_id,anchor_message_id,anchor_version,trigger_type,mode,status,result_json,created_at,updated_at) VALUES (?,?,?,?,?,'single','completed',?,?,?)").run(group,member,first.id,version,'manual',JSON.stringify({ summary:'测试反馈' }),new Date().toISOString(),new Date().toISOString())).insertId)
  assert.equal((await call(member,`/conversations/${group}/feedback/${feedback}`)).result.summary,'测试反馈')
  await call(owner,`/conversations/${group}/feedback/${feedback}`,'GET',undefined,404)
  await call(outsider,`/conversations/${group}/feedback/${feedback}`,'GET',undefined,403)
  await call(member,`/conversations/${group}/feedback/${feedback}`,'PATCH',{ action:'share' })
  assert.equal((await call(owner,`/conversations/${group}/feedback/${feedback}`)).visibility,'group')
  await call(member,`/conversations/${group}/messages/${first.id}`,'DELETE')
  assert.equal((await call(member,`/conversations/${group}/feedback/${feedback}`)).stale,true)
  await call(member,`/conversations/${group}/feedback-consent`,'PATCH',{ allow_context:false })
  await call(owner,`/conversations/${group}/feedback/${feedback}`,'GET',undefined,404)
  assert.equal((await call(owner,`/conversations/${group}/feedback-settings`)).my_consent,true)
  console.log(`PASS group feedback: ${checks} HTTP assertions plus trigger checks`)
} finally {
  child.kill()
  await fixture.close()
  await new Promise(resolve=>fakeGateway.close(resolve))
}
