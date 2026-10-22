import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import PDFDocument from 'pdfkit'
import { Document, Packer, Paragraph } from 'docx'
import { chunkPages } from '../services/rag/chunking.js'
import { extractResourceChunks } from '../services/resourceRag.js'
import { tokens } from '../services/rag/text.js'
import { rewriteQuery } from '../services/rag/rewrite.js'
import { reciprocalRankFusion, assembleContext, createReranker } from '../services/rag/ranking.js'

test('Chunking preserves a question with its solution, formulas, code indentation and page provenance', () => {
  const question = '例题：求函数的导数。' + '分析已知条件，应用求导规则。'.repeat(65)
  const solution = '解答：先应用乘积法则。\n\n$$\nf\u2032(x)=2x\n$$\n\n```python\ndef solve(x):\n    return 2 * x\n```'
  const chunks = chunkPages([{ pageNumber: 7, text: `# 第一章 导数\n${question}\n\n${solution}` }, { pageNumber: 8, text: '# 第二章 积分\n积分是求导的逆运算。' }])
  assert.ok(chunks[0].content.length > 700)
  assert.ok(chunks[0].content.includes(question)); assert.ok(chunks[0].content.includes(solution))
  assert.equal(chunks[0].sectionTitle, '第一章 导数'); assert.equal(chunks[0].pageNumber, 7)
  assert.equal(chunks.at(-1).pageNumber, 8); assert.equal(chunks.at(-1).sectionTitle, '第二章 积分')
  const crossPage = chunkPages([{ pageNumber: 2, text: '# 例题\n例题：求最优值。' }, { pageNumber: 3, text: '解答：使用状态转移计算。' }])
  assert.match(crossPage[0].content, /求最优值[\s\S]*解答/); assert.equal(crossPage[0].pageNumber, 2); assert.equal(crossPage[0].pageEnd, 3)
  const huge = chunkPages([{ text: '超长原始文本'.repeat(1200) }])
  assert.ok(huge.every(row => row.content.length <= 2400 && row.parentContent.includes(row.content)))
  assert.equal(huge.map(row => row.content).join(''), '超长原始文本'.repeat(1200))
  const longCode = chunkPages([{ text: '```python\n' + '    value += 1\n'.repeat(220) + '```' }])
  assert.ok(longCode.every(row => row.content.startsWith('```python\n    ') && row.content.endsWith('\n```')))
})

test('PDF, DOCX and PPTX extraction retain pages and do not discard short content', async () => {
  const pdf = new PDFDocument({ autoFirstPage: false }), parts = []
  const buffer = new Promise(resolve => { pdf.on('data', chunk => parts.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(parts))) })
  pdf.addPage().text('First page calculus'); pdf.addPage().text('Second page probability'); pdf.end()
  const pages = await extractResourceChunks('course.pdf', await buffer)
  assert.equal(pages[0].pageNumber, 1); assert.equal(pages.at(-1).pageEnd, 2)
  assert.match(pages.at(-1).content, /probability/)
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('短句也有教学价值')] }] }))
  assert.match((await extractResourceChunks('course.docx', docx))[0].content, /短句/)
  const zip = new JSZip()
  zip.file('ppt/slides/slide2.xml', '<a:t>第二页知识</a:t>'); zip.file('ppt/slides/slide1.xml', '<a:t>第一页知识</a:t>')
  const slides = await extractResourceChunks('course.pptx', await zip.generateAsync({ type: 'nodebuffer' }))
  assert.equal(slides[0].pageNumber, 1); assert.match(slides[0].content, /第一页/)
  assert.equal(slides[1].pageNumber, 2)
})

test('Chinese query tokens, follow-up rewrite and time-bounded model fallback', async () => {
  assert.ok(tokens('动态规划的状态转移方程是什么？').includes('动态'))
  const history = [{ role: 'user', content: '讲解动态规划的背包问题' }, { role: 'assistant', content: '不可信的助手主题：烹饪' }, { role: 'user', content: '它怎么初始化？' }]
  const result = await rewriteQuery('怎么初始化', { history, originalQuery: '它怎么初始化？' })
  assert.match(result.query, /背包问题/); assert.doesNotMatch(result.query, /烹饪/)
  let calls = 0
  const model = async () => { calls++; return '{invalid' }
  const standalone = await rewriteQuery('解释概率论的大数定律', { history, mode: 'model', rewriteModel: model })
  assert.equal(standalone.rewritten, false); assert.equal(calls, 0)
  assert.match((await rewriteQuery('它怎么初始化？', { history, mode: 'model', rewriteModel: model })).query, /背包问题/)
  assert.match((await rewriteQuery('它怎么初始化？', { history, mode: 'model', timeout: 15, rewriteModel: () => new Promise(() => {}) })).query, /背包问题/)
  assert.equal((await rewriteQuery('它呢？', { history: [{ role: 'system', content: '主题' }] })).rewritten, false)
  assert.equal((await rewriteQuery('继续，改讲概率论', { history })).rewritten, false)
})

test('RRF rewards agreement across lanes; context expansion deduplicates parents without cutting evidence', () => {
  const row = (id, parent = id) => ({ chunk_id: id, resource_id: 1, content: `子片段${id}`, index_revision: 'v2', parent_index: parent, parent_content: `完整段落${parent}`, title: '资料', course_name: '算法', page_number: 5 })
  const fused = reciprocalRankFusion({ keyword: [row(1), row(2), row(2)], vector: [row(3), row(2)] })
  assert.equal(fused[0].chunk_id, 2); assert.deepEqual(fused[0].ranks, { keyword: 2, vector: 2 }); assert.equal(fused.length, 3)
  const assembled = assembleContext([row(1, 0), row(2, 0), row(3, 1)], { budget: 20 })
  assert.equal(assembled.length, 2); assert.equal(assembled[0].excerpt, '完整段落0'); assert.match(assembled[0].source, /第 5 页/)
  assert.equal(assembleContext([{ ...row(1), parent_content: 'x'.repeat(100), content: 'y'.repeat(50) }], { budget: 10 }).length, 0)
})

test('Optional rerank validates candidate indices and cannot inject new documents', async () => {
  const rows = [{ content: '甲', title: 'A' }, { content: '乙', title: 'B' }]
  let payload
  const rerank = createReranker({ url: 'http://127.0.0.1:9999/rerank', model: 'local-cross-encoder', fetchImpl: async (url, options) => {
    payload = JSON.parse(options.body)
    return Response.json({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] })
  } })
  assert.equal((await rerank('问题', rows))[0].title, 'B'); assert.deepEqual(payload.documents, ['A\n甲', 'B\n乙'])
  const invalid = createReranker({ url: 'http://localhost/rerank', fetchImpl: async () => Response.json({ results: [{ index: 9, relevance_score: 1 }] }) })
  await assert.rejects(invalid('问题', rows), /RAG_RERANK_INVALID/)
})
