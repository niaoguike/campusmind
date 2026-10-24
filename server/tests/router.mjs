import test from 'node:test'
import assert from 'node:assert/strict'
import { routeComplexity, classifyIntents, isDirectRequest, ROUTE_MODES } from '../agents/router.js'

function pick (input, options) {
  const route = routeComplexity(input, options)
  return { mode: route.mode, role: route.role }
}

test('返回的 mode 一定在合法集合内', () => {
  for (const input of ['', '你好', '找资料', '帮我排计划并找资料', '先分析薄弱点再找资料']) {
    assert.ok(ROUTE_MODES.includes(routeComplexity(input).mode), input)
  }
})

test('空输入与闲聊走 direct', () => {
  for (const input of ['', '   ', '你好', '您好！', '谢谢你', '好的', '你能做什么？', 'Hello']) {
    assert.equal(routeComplexity(input).mode, 'direct', input)
    assert.equal(routeComplexity(input).role, null, input)
  }
})

test('带诉求的问候不能走 direct', () => {
  assert.equal(isDirectRequest('你好，帮我排个两周复习计划'), false)
  assert.notEqual(routeComplexity('你好，帮我排个两周复习计划').mode, 'direct')
})

test('单一意图直达对应专业 Agent', () => {
  assert.deepEqual(pick('帮我找一下第三章的课件'), { mode: 'single', role: 'retrieval' })
  assert.deepEqual(pick('帮我排个两周复习计划'), { mode: 'single', role: 'planner' })
  assert.deepEqual(pick('帮我看看我的薄弱点'), { mode: 'single', role: 'reflection' })
})

test('没有命中关键词时退回通用问答', () => {
  assert.deepEqual(pick('什么是二分查找'), { mode: 'single', role: 'tutor' })
})

test('复合请求走 multi', () => {
  assert.equal(routeComplexity('帮我看看哪些课快跟不上了，再排个两周复习计划').mode, 'multi')
  assert.equal(routeComplexity('先分析我的薄弱点，然后帮我找资料').mode, 'multi')
  assert.equal(routeComplexity('找资料并且排计划').mode, 'multi')
  assert.deepEqual(classifyIntents('帮我看看哪些课快跟不上了，再排个两周复习计划').sort(), ['planner', 'reflection'])
})

test('带附件一律走 multi', () => {
  assert.equal(routeComplexity('这是今天的课件', { hasAttachment: true }).mode, 'multi')
})

test('空格与全角标点不影响判断', () => {
  assert.deepEqual(pick('帮我 找 资料 ！！'), { mode: 'single', role: 'retrieval' })
  assert.equal(routeComplexity('   ').mode, 'direct')
})

test('routeComplexity 不修改入参且返回原因', () => {
  const input = '帮我排个两周复习计划'
  const route = routeComplexity(input)
  assert.equal(input, '帮我排个两周复习计划')
  assert.equal(typeof route.reason, 'string')
  assert.ok(route.reason.length > 0)
})
