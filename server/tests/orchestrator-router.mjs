import test from 'node:test'
import assert from 'node:assert/strict'
import { createLearningOrchestrator } from '../agents/orchestrator.js'
import { routeComplexity } from '../agents/router.js'

const tools = { search: {}, snapshot: {}, remember: {}, createPlanDraft: {} }

function specialistReturning (content) {
  return { invoke: async () => ({ messages: [{ role: 'assistant', content }] }) }
}

test('注入单步计划时不调用规划模型，也不产生整合调用', async () => {
  const modelCalls = []
  const model = {
    invoke: async messages => {
      modelCalls.push(messages)
      return { role: 'assistant', content: '不该被调用' }
    }
  }

  const orchestrator = await createLearningOrchestrator({
    content: '什么是二分查找',
    model,
    user: { name: '测试学生' },
    tools,
    plan: { intent: 'tutor', source: 'router', steps: [{ agent: 'tutor', task: '回答概念问题', dependsOn: [] }] },
    createSpecialist: () => specialistReturning('二分查找是每次把区间折半的查找算法。')
  })

  assert.equal(orchestrator.plan.source, 'router')
  assert.equal(orchestrator.finalAgent, 'tutor')

  const result = await orchestrator.invoke({ messages: [{ role: 'user', content: '什么是二分查找' }] })
  assert.equal(result.answer, '二分查找是每次把区间折半的查找算法。')
  assert.equal(result.status, 'done')
  assert.equal(modelCalls.length, 0, '规划与整合都不应调用模型')
})

test('注入的计划同样要过校验', async () => {
  await assert.rejects(
    () => createLearningOrchestrator({
      content: '越权请求',
      model: null,
      user: { name: 'T' },
      tools,
      plan: { intent: 'hacker', source: 'router', steps: [{ agent: 'hacker', task: '越权', dependsOn: [] }] }
    }),
    /无效的编排计划/
  )
})

test('未注入计划时仍走模型规划，行为不变', async () => {
  const modelCalls = []
  const model = {
    invoke: async messages => {
      modelCalls.push(messages)
      return { role: 'assistant', content: '{"intent":"tutor","steps":[{"agent":"tutor","task":"回答概念问题","dependsOn":[]}]}' }
    }
  }

  const orchestrator = await createLearningOrchestrator({
    content: '什么是二分查找',
    model,
    user: { name: 'T' },
    tools,
    createSpecialist: () => specialistReturning('可直接回答。')
  })

  assert.equal(orchestrator.plan.source, 'model')
  const result = await orchestrator.invoke({ messages: [{ role: 'user', content: '什么是二分查找' }] })
  assert.equal(result.answer, '可直接回答。')
  assert.equal(modelCalls.length, 1, '单步任务只需要一次规划调用，不应再有整合调用')
})

test('路由结果能直接构成合法计划', async () => {
  const route = routeComplexity('帮我排个两周复习计划')
  assert.equal(route.mode, 'single')

  const orchestrator = await createLearningOrchestrator({
    content: '帮我排个两周复习计划',
    model: null,
    user: { name: 'T' },
    tools,
    plan: { intent: route.role, source: 'router', steps: [{ agent: route.role, task: '制定复习计划', dependsOn: [] }] },
    createSpecialist: () => specialistReturning('两周计划草稿如下。')
  })

  assert.equal(orchestrator.finalAgent, 'planner')
  const result = await orchestrator.invoke({ messages: [{ role: 'user', content: '帮我排个两周复习计划' }] })
  assert.equal(result.answer, '两周计划草稿如下。')
})
