import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectChatRun, directChatEligible } from '../agents/chatRouting.js'

test('only independent source-free turns take the direct path', () => {
  for (const content of ['你好', '谢谢！', '什么是栈？', '请简单解释二叉树']) {
    assert.equal(directChatEligible({ content }), true, content)
  }
  for (const content of ['这个是什么意思？', '根据老师课件解释栈', '结合我的错题讲讲二叉树', '帮我制定复习计划', '发送消息到班级群', '今天的课程是什么？']) {
    assert.equal(directChatEligible({ content }), false, content)
  }
  assert.equal(directChatEligible({ content: '什么是栈？', priorMessages: [{ id: 1 }] }), false)
  assert.equal(directChatEligible({ content: '什么是栈？', mode: 'action' }), false)
  assert.equal(directChatEligible({ content: '你好', attachments: [{ id: 1 }] }), false)
  assert.equal(directChatEligible({ content: '你好', exportMode: 'ppt' }), false)
})

test('direct run makes one model call, records the real answer and uses no tools', async () => {
  const calls = [], steps = []
  const run = createDirectChatRun({ model: { invoke: async (messages) => { calls.push(messages); return { content: '你好，有什么想一起学习的？' } } } })
  const result = await run.invoke({ messages: [{ role: 'user', content: '你好' }], onStep: async (agent, fields) => steps.push([agent, fields.status]) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].at(-1).content, '你好')
  assert.equal(result.answer, '你好，有什么想一起学习的？')
  assert.deepEqual(steps, [['tutor', 'running'], ['tutor', 'done']])
})
