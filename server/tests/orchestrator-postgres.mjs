import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createSocket } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { createTestDatabase } from './helpers/postgres.mjs'

test('HTTP orchestration executes specialists, persists real traces, isolates users and records degradation', { timeout: 60000 }, async () => {
  const fixture = await createTestDatabase(), db = fixture.db
  let child, output = '', sequence = 0, failRetrieval = false, invalidPlan = false
  const calls = []
  const plan = { intent: 'planner', steps: [
    { agent: 'retrieval', task: '检索高数复习资料', dependsOn: [] },
    { agent: 'reflection', task: '分析当前用户的学习状态', dependsOn: [] },
    { agent: 'planner', task: '结合资料和薄弱点创建用户要求的计划草稿', dependsOn: ['retrieval', 'reflection'] }
  ] }
  const mock = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = JSON.parse(raw || '{}')
      if (req.url === '/key/generate') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ key: `sk-test-user-${body.metadata.campusmind_user_id}` }))
      calls.push(body)
      const prompt = body.messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.map(block => block.text || '').join('\n')).join('\n')
      if (failRetrieval && prompt.includes('你是 CampusMind 资料检索 Agent')) return res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'fake-private-error' } }))
      let message = { role: 'assistant', content: '复习结果：资料来源为高数讲义，计划草稿待确认。' }, finish = 'stop'
      if (prompt.includes('学习任务编排器')) message.content = invalidPlan ? 'invalid JSON' : JSON.stringify(plan)
      else if (body.tools?.length) {
        const used = body.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)
        const names = body.tools.map(t => t.function.name)
        const name = names.find(n => n !== 'save_learning_profile' && !used.includes(`call_${n}`))
        if (name) {
          const args = name === 'search_course_resources' ? { query: '高数' } : name === 'create_plan_draft' ? { title: '高数复习', content: '周三下午复习导数概念，再完成三道基础习题。' } : {}
          message = { role: 'assistant', content: null, tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
          finish = 'tool_calls'
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `chat-orchestration-${++sequence}`, object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }))
    } catch (error) { res.writeHead(500).end(JSON.stringify({ error: { message: error.message } })) }
  })
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening')
  const provider = `http://127.0.0.1:${mock.address().port}`
  const reservation = createSocket(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  const secret = 'orchestrator-test'
  try {
    const addUser = async (id, key) => (await db.prepare('INSERT INTO users(student_id,name,phone,college,class,password,api_key,model_type) VALUES (?,?,?,?,?,?,?,?)').run(id, id, id, 'college', 'class', 'unused', key, 'deepseek-v4-flash')).insertId
    const owner = await addUser('orchestration-owner', 'fake-owner-key'), other = await addUser('orchestration-other', '')
    const course = (await db.prepare("INSERT INTO courses(name) VALUES ('高数')").run()).insertId
    const resource = (await db.prepare("INSERT INTO resources(course_id,title,file_name,url) VALUES (?,'高数讲义','calculus.pdf','/test-source.pdf')").run(course)).insertId
    await db.prepare("INSERT INTO resource_chunks(resource_id,chunk_index,content,page_number) VALUES (?,0,'高数导数的定义与基础应用，以及复习时可以练习的例题。',3)").run(resource)
    await db.prepare("INSERT INTO schedules(user_id,course_name,weekday,start_time,end_time) VALUES (?,'仅另一个用户可见的课程',1,'08:00','10:00')").run(other)
    child = spawn(process.execPath, ['server/index.js'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATABASE_URL: fixture.connectionString, PORT: String(port), JWT_SECRET: secret, ADMIN_STUDENT_ID: '', ADMIN_PASSWORD: '', REDIS_ENABLED: 'false', MEMORY_ENABLED: 'false', LLM_GATEWAY_URL: provider, LLM_GATEWAY_MASTER_KEY: 'sk-test-master' } })
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    for (let i = 0; i < 500 && !output.includes('CampusMind server:'); i++) {
      if (child.exitCode !== null) throw new Error(output)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.match(output, /CampusMind server:/)
    const request = async (path, body, actor = owner) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${jwt.sign({ id: actor }, secret)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: response.status, data: await response.json() }
    }
    const thread = (await request('/agent/threads', { mode: 'study' })).data.id
    const chat = await request('/agent/chat', { thread_id: thread, content: '结合高数资料与薄弱点，创建一份复习计划草稿', mode: 'study' })
    assert.equal(chat.status, 200, JSON.stringify(chat.data))
    assert.equal(chat.data.orchestration.status, 'done')
    assert.equal(chat.data.orchestration.plan.source, 'model')
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM study_plans WHERE user_id=?').get(owner)).count, 1)
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM study_plans WHERE user_id=?').get(other)).count, 0)
    const trace = (await request(`/agent/runs/${chat.data.run_id}`)).data
    assert.equal(trace.status, 'done')
    assert.deepEqual(trace.steps.map(s => s.agent_type), ['coordinator', 'retrieval', 'reflection', 'planner', 'synthesis'])
    assert(trace.steps.every(s => s.status === 'done' && s.started_at && s.completed_at))
    assert.equal(trace.steps.find(s => s.agent_type === 'retrieval').citations[0].file_path, '/test-source.pdf')
    assert.deepEqual(JSON.parse(trace.steps.find(s => s.agent_type === 'planner').input_summary).dependsOn, ['retrieval', 'reflection'])
    assert.equal((await request(`/agent/runs/${chat.data.run_id}`, undefined, other)).status, 404)
    const snapshotCalls = calls.flatMap(c => c.messages.filter(m => m.role === 'tool' && m.name === 'get_my_learning_snapshot'))
    assert(snapshotCalls.length)
    assert(snapshotCalls.every(m => !m.content.includes('仅另一个用户可见')))
    const events = await db.prepare('SELECT * FROM agent_events WHERE run_id=? ORDER BY id').all(chat.data.run_id)
    assert.equal(events.length, 2)
    assert.equal(JSON.parse(events[0].payload_json).plan.steps.length, 3)

    failRetrieval = true
    const degraded = await request('/agent/chat', { thread_id: thread, content: '根据高数资料创建新的复习计划草稿', mode: 'study' })
    assert.equal(degraded.status, 200, JSON.stringify(degraded.data))
    assert.equal(degraded.data.orchestration.status, 'degraded', JSON.stringify({ data: degraded.data, recent: calls.slice(-10).map(c => ({ prompt: c.messages.filter(m => m.role === 'system').map(m => m.content).join('\n').slice(0, 200), tools: c.tools?.map(t => t.function.name) })) }))
    const partial = (await request(`/agent/runs/${degraded.data.run_id}`)).data
    assert.equal(partial.status, 'partial')
    assert.equal(partial.steps.find(s => s.agent_type === 'retrieval').status, 'failed')
    assert.equal(partial.steps.find(s => s.agent_type === 'planner').status, 'skipped')
    assert(!partial.steps.some(s => ['running', 'pending'].includes(s.status)))
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM study_plans WHERE user_id=?').get(owner)).count, 1)
    assert(!JSON.stringify(partial).includes('fake-private-error'))

    failRetrieval = false; invalidPlan = true
    const fallback = await request('/agent/chat', { thread_id: thread, content: '请找高数课件', mode: 'study' })
    assert.equal(fallback.status, 200)
    assert.equal(fallback.data.orchestration.plan.source, 'fallback')
    const single = (await request(`/agent/runs/${fallback.data.run_id}`)).data
    assert.deepEqual(single.steps.map(s => s.agent_type), ['coordinator', 'retrieval'])
    assert(single.steps.every(s => s.status === 'done'))
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    mock.closeAllConnections(); await new Promise(resolve => mock.close(resolve)); await fixture.close()
  }
})
