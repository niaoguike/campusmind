import test from 'node:test'
import assert from 'node:assert/strict'
import { tool } from 'langchain'
import { z } from 'zod'
import { createLlmService } from '../services/llmClient.js'
import { createLearningOrchestrator, fallbackLearningPlan, planLearningTasks, specialistTools, validateLearningPlan } from '../agents/orchestrator.js'

const step = (agent, dependsOn = []) => ({ agent, task: `完成${agent}任务`, dependsOn })
const compound = { intent: 'planner', steps: [step('retrieval'), step('reflection'), step('tutor', ['retrieval']), step('planner', ['reflection', 'tutor'])] }
const user = { id: 7, name: '学生', api_key: 'fake-test-key', model_type: 'deepseek-v4-flash' }
const messages = [{ role: 'system', content: '当前是学习问答，禁止平台外部写操作。' }, { role: 'user', content: '找课件并结合薄弱点讲解，再创建复习计划草稿。' }]
const planningModel = (plan, synthesize = () => ({ content: '整合回答' })) => ({ invoke: async input => input[0].content.includes('学习任务编排器') ? { content: JSON.stringify(plan) } : synthesize(input) })

test('rejects unknown roles, duplicate workers, missing dependencies, cycles and excessive tasks', () => {
  const invalid = [
    { intent: 'shell', steps: [step('shell')] },
    { intent: 'planner', steps: [step('planner'), step('planner')] },
    { intent: 'planner', steps: [step('planner', ['retrieval'])] },
    { intent: 'planner', steps: [step('planner', ['tutor']), step('tutor', ['planner'])] },
    { intent: 'planner', steps: [step('retrieval')] },
    { intent: 'planner', steps: [...compound.steps, step('planner')] },
    { intent: 'planner', steps: [{ ...step('planner'), task: 'x'.repeat(501) }] }
  ]
  for (const plan of invalid) assert.throws(() => validateLearningPlan(plan))
  assert.equal(validateLearningPlan(compound).steps.length, 4)
})

test('planning errors and invalid plans use a valid deterministic graph; timeout cancels planning', async () => {
  for (const model of [{ invoke: async () => { throw new Error('offline') } }, { invoke: async () => ({ content: 'not JSON' }) }, planningModel({ intent: 'shell', steps: [] })]) {
    const plan = await planLearningTasks({ content: '结合薄弱点制定复习计划', model })
    assert.equal(plan.source, 'fallback')
    validateLearningPlan(plan)
    assert.deepEqual(plan.steps.find(s => s.agent === 'planner').dependsOn, ['retrieval', 'reflection'])
  }
  let signal
  const plan = await planLearningTasks({ content: '找课件', timeoutMs: 10, model: { invoke: (_input, config) => { signal = config.signal; return new Promise(() => {}) } } })
  assert(signal.aborted)
  assert.equal(plan.source, 'fallback')
  assert.deepEqual(fallbackLearningPlan('找课件').steps.map(s => s.agent), ['retrieval'])
})

test('parallel workers are bounded, dependencies receive transitive evidence, synthesis preserves mode', async () => {
  let active = 0, peak = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const events = [], calls = new Map()
  let synthesisInput
  const run = await createLearningOrchestrator({ content: messages[1].content, user, tools: {}, model: planningModel(compound, input => { synthesisInput = input; return { content: '最终回答' } }), createSpecialist: role => ({ invoke: async (input, config) => {
    calls.set(role, input)
    assert.equal(config.recursionLimit, 12)
    active++; peak = Math.max(peak, active)
    if (role === 'retrieval' || role === 'reflection') { if (active === 2) release(); await gate }
    if (role === 'planner') {
      const context = input.messages.at(-1).content
      assert(context.includes('retrieval-output'))
      assert(context.includes('reflection-output'))
      assert(context.includes('tutor-output'))
    }
    active--
    return { messages: [{ role: 'assistant', content: `${role}-output` }] }
  } }) })
  const result = await run.invoke({ messages, onStep: async (agent, data) => events.push(`${agent}:${data.status}`) })
  assert.equal(peak, 2)
  assert.equal(calls.size, 4)
  assert(events.indexOf('retrieval:done') < events.indexOf('tutor:running'))
  assert(events.indexOf('tutor:done') < events.indexOf('planner:running'))
  assert.equal(synthesisInput[0].content, messages[0].content)
  assert.equal(events.at(-1), 'synthesis:done')
  assert.equal(result.answer, '最终回答')
  assert.equal(result.status, 'done')
})

test('tool allocation keeps one memory writer, draft creation belongs only to planner', () => {
  const tools = Object.fromEntries(['search', 'snapshot', 'remember', 'createPlanDraft'].map(name => [name, { name }]))
  const selected = role => specialistTools(role, tools, compound).map(t => t.name)
  assert.deepEqual(selected('retrieval'), ['search'])
  assert.deepEqual(selected('reflection'), ['snapshot', 'remember'])
  assert.deepEqual(selected('tutor'), ['search', 'snapshot'])
  assert.deepEqual(selected('planner'), ['search', 'snapshot', 'createPlanDraft'])
})

test('failed prerequisite skips dependent workers without retrying; independent work survives', async () => {
  const calls = [],events = []
  const run = await createLearningOrchestrator({ content: '复习计划', user, tools: {}, model: planningModel(compound), createSpecialist: role => ({ invoke: async () => {
    calls.push(role)
    if (role === 'retrieval') throw new Error('fake-provider-secret')
    return { messages: [{ content: '独立分析结果' }] }
  } }) })
  const result = await run.invoke({ messages, onStep: async (role, fields) => events.push([role, fields.status]) })
  assert.deepEqual(calls.sort(), ['reflection', 'retrieval'])
  assert(events.some(([role, status]) => role === 'planner' && status === 'skipped'))
  assert.equal(result.status, 'degraded')
  assert.match(result.answer, /本次未完成/)
  assert(!JSON.stringify(result).includes('fake-provider-secret'))
})

test('all failed workers fail the run; synthesis failure returns completed results as degraded', async () => {
  const fail = await createLearningOrchestrator({ content: '找课件', user, tools: {}, model: planningModel({ intent: 'retrieval', steps: [step('retrieval')] }), createSpecialist: () => ({ invoke: async () => { throw new Error('offline') } }) })
  await assert.rejects(() => fail.invoke({ messages }), /均未完成/)
  const run = await createLearningOrchestrator({ content: '计划', user, tools: {}, model: planningModel(compound, () => { throw new Error('synthesis failed') }), createSpecialist: role => ({ invoke: async () => ({ messages: [{ content: `${role} 的真实结果` }] }) }) })
  const result = await run.invoke({ messages })
  assert.equal(result.status, 'degraded')
  assert.match(result.answer, /planner 的真实结果/)
  assert.match(result.answer, /自动汇总未完成/)
})

test('trace persistence errors propagate after all started workers settle', async () => {
  const run = await createLearningOrchestrator({ content: '找课件', user, tools: {}, model: planningModel({ intent: 'retrieval', steps: [step('retrieval')] }), createSpecialist: () => ({ invoke: async () => ({ messages: [{ content: '资料结果' }] }) }) })
  await assert.rejects(() => run.invoke({ messages, onStep: async (_role, fields) => { if (fields.status === 'done') throw new Error('trace unavailable') } }), /trace unavailable/)
})

test('real LangChain specialists call tools; citations and draft receipts reach synthesis once', async () => {
  const calls = [],writes = [], toolCalls = []
  const plan = { intent: 'planner', steps: [step('retrieval'), step('reflection'), step('planner', ['retrieval', 'reflection'])] }
  const llm = createLlmService({ db: {}, encryptSecret: x => x, decryptSecret: x => x, env: {}, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body)
    calls.push(body)
    const prompt = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    let message = { role: 'assistant', content: '专业分析完成。草稿 #42 待确认。' }, finish = 'stop'
    if (prompt.includes('学习任务编排器')) message.content = JSON.stringify(plan)
    else if (prompt.includes('结果整合 Agent')) {
      assert(!body.tools?.length)
      assert(body.messages.at(-1).content.includes('/uploads/calculus.pdf'))
      assert(body.messages.at(-1).content.includes('#42'))
      message.content = '已结合资料和画像创建草稿 #42，待确认。资料来源：高数 /uploads/calculus.pdf'
    } else {
      const used = body.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id)
      const toolNames = body.tools.map(t => t.function.name)
      const name = toolNames.find(n => !used.includes(`call_${n}`) && n !== 'save_learning_profile')
      if (name) {
        const args = name === 'search_course_resources' ? { query: '高数' } : name === 'create_plan_draft' ? { title: '高数复习', content: '根据已授权资料和学习状态安排复习' } : {}
        message = { role: 'assistant', content: null, tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
        finish = 'tool_calls'
      }
    }
    return Response.json({ id: `orchestrator-test-${calls.length}`, object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } })
  } })
  const wrap = (name, schema, value) => tool(async args => { toolCalls.push(name); return typeof value === 'function' ? value(args) : value }, { name, description: name, schema })
  const tools = {
    search: wrap('search_course_resources', z.object({ query: z.string() }), JSON.stringify([{ source: '高数', file_path: '/uploads/calculus.pdf', page_number: 3, excerpt: '导数的定义' }])),
    snapshot: wrap('get_my_learning_snapshot', z.object({}), '薄弱点：导数；周三下午空闲'),
    createPlanDraft: wrap('create_plan_draft', z.object({ title: z.string(), content: z.string() }), args => { writes.push(args); return '草稿 #42 待确认' }),
    remember: wrap('save_learning_profile', z.object({ summary: z.string() }), '未请求记忆写入')
  }
  const run = await createLearningOrchestrator({ content: messages[1].content, model: llm.createModel(user), user, tools })
  const result = await run.invoke({ messages })
  assert.equal(result.status, 'done', JSON.stringify({ result, toolCalls, calls: calls.map(c => ({ toolNames: c.tools?.map(t => t.function.name), roles: c.messages.map(m => m.role), last: c.messages.at(-1) })) }))
  assert.equal(writes.length, 1)
  assert.equal(result.results.find(s => s.agent === 'planner').receipts[0].result, '草稿 #42 待确认')
  assert(toolCalls.includes('get_my_learning_snapshot'))
  assert.equal(result.results.find(s => s.agent === 'retrieval').citations[0].pageNumber, 3)
  assert.match(result.answer, /#42/)
  assert(!calls.some(c => c.tools?.some(t => /shell|forum|group/.test(t.function.name))))
})
