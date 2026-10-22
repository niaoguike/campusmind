export const cleanText = value => String(value || '').replace(/\u0000/g, ' ').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const stop = new Set('的 了 是 在 和 与 或 也 都 就 把 被 这 那 个 吗 呢 啊 请 请问 帮 帮我 一下 什么 怎么 如何 为什么 这个 那个 它 继续 上面 上述 刚才 之前 我 你 我们 你们'.split(' '))
export function tokens (text) {
  return [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())].filter(x => x.isWordLike)
    .map(x => x.segment.replace(/[^\p{L}\p{N}_]/gu, '')).filter(x => x && !stop.has(x))
}
export const indexTokens = text => tokens(text).join(' ')
export function aliases (query) {
  const result = []
  for (const [pattern, value] of [[/毛概/, '毛泽东思想 中国特色社会主义理论体系概论'], [/马原/, '马克思主义基本原理'], [/思修/, '思想道德与法治'], [/高数/, '高等数学'], [/\bdp\b/i, '动态规划']]) if (pattern.test(query)) result.push(value)
  return result
}
export const metadata = row => [row.course_name, row.title, row.file_name, row.tags, row.description, row.section_title].filter(Boolean).join('\n')
