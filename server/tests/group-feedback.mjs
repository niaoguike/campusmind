import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { createTestDatabase } from './helpers/postgres.mjs'
import { classifyFeedbackCandidate } from '../services/groupFeedback.js'

assert.equal(classifyFeedbackCandidate('普通聊天'), null)
assert.equal(classifyFeedbackCandidate('@AI 这一步为什么不对？')?.type, 'help_request')
assert.equal(classifyFeedbackCandidate('为什么这里不会算？', 'suggest')?.type, 'help_request')

const fixture = await createTestDatabase()
const port = 19379, secret = 'isolated-group-feedback-test'
const child = spawn(process.execPath, ['server/index.js'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true,
  env: { ...process.env, DATABASE_URL: fixture.connectionString, MEMORY_ENABLED: 'false', REDIS_ENABLED: 'false', MEMORY_DATABASE_URL: '', PORT: String(port), JWT_SECRET: secret, ADMIN_STUDENT_ID: '', ADMIN_PASSWORD: '' }, stdio: ['ignore','pipe','pipe'] })
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
  const first = await call(member,`/conversations/${group}/messages`,'POST',{ content:'第一条' },201)
  const second = await call(member,`/conversations/${group}/messages`,'POST',{ content:'第二条',reply_to_id:first.id },201)
  await call(outsider,`/conversations/${group}/messages?limit=1`,'GET',undefined,403)
  await call(owner,`/conversations/${group}/messages`,'POST',{ content:'跨群回复',reply_to_id:999999 },400)
  const latest = await call(owner,`/conversations/${group}/messages?limit=1`)
  assert.equal(latest[0].id,second.id)
  assert.equal((await call(owner,`/conversations/${group}/messages?before=${second.id}&limit=1`))[0].id,first.id)
  await call(owner,`/conversations/${group}/messages/${second.id}`,'PATCH',{ content:'越权编辑' },404)
  await call(member,`/conversations/${group}/messages/${second.id}`,'PATCH',{ content:'已修改' })
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
  console.log(`PASS group feedback: ${checks} HTTP assertions plus trigger checks`)
} finally {
  child.kill()
  await fixture.close()
}
