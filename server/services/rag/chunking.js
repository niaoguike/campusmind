import { cleanText } from './text.js'
export const CHUNKING_VERSION = 2
const heading = line => /^(?:#{1,6}\s+|第[\d一二三四五六七八九十百]+[章节篇]\s*|\d+(?:\.\d+){1,3}\s+)/.test(line)
const question = text => /^(?:例题|习题|题目|问题|练习|例\s*\d|\d+[.、．]\s*).{0,100}/.test(text)

// Split an oversized paragraph at sentence/line boundaries. Normal questions,
// formula blocks and code fences remain atomic even when above the target size.
function boundedUnits (text, maximum = 2400) {
  if (text.length <= maximum) return [text]
  const code = text.startsWith('```'), math = text.startsWith('$$')
  const opener = code ? text.split('\n')[0] : '$$'
  const closed = code ? /\n```\s*$/.test(text) : math && /\n\$\$\s*$/.test(text)
  const body = code || math ? text.slice(opener.length).replace(/^\n/, '').replace(closed ? /\n(?:```|\$\$)\s*$/ : /$^/, '') : text
  // Include punctuation-only/empty lines; dropping them can change code or math.
  const lines = body.match(code || math ? /[^\n]*\n|[^\n]+$/g : /[^。！？\n]*[。！？\n]|[^。！？\n]+$/g) || [body]
  const pieces = []; let part = ''
  for (let line of lines) {
    while (line.length > 1100) { if (part) { pieces.push(part); part = '' }; pieces.push(line.slice(0, 1100)); line = line.slice(1100) }
    if (part.length + line.length > 1100) { pieces.push(part); part = '' }
    part += line
  }
  if (part) pieces.push(part)
  return pieces.map(piece => {
    if (code || math) return `${opener}\n${piece.replace(/^\n+|\n+$/g, '')}\n${code ? '```' : '$$'}`
    return piece.trim()
  }).filter(Boolean)
}

export function chunkPages (pages, { target = 700, parentTarget = 2200, overlap = 100 } = {}) {
  if (!Number.isInteger(target) || target < 100 || target > 2400 || parentTarget < target) throw new Error('RAG_INVALID_CHUNK_SIZE')
  const sections = [], result = []; let section = '', blocks = [], parentIndex = 0
  const flushSection = () => { if (blocks.length) sections.push({ title: section, blocks }); blocks = [] }
  for (const page of pages) {
    let paragraph = [], fence = false, math = false
    const flushParagraph = () => { if (paragraph.length) { blocks.push({ content: paragraph.join('\n'), pageNumber: page.pageNumber ?? null, pageEnd: page.pageNumber ?? null }); paragraph = [] } }
    for (const line of cleanText(page.text).split('\n')) {
      if (!fence && !math && heading(line.trim())) { flushParagraph(); flushSection(); section = line.trim().replace(/^#+\s*/, ''); continue }
      if (/^\s*```/.test(line)) fence = !fence
      if (/^\s*\$\$/.test(line) && (line.match(/\$\$/g) || []).length % 2) math = !math
      if (!line.trim() && !fence && !math) flushParagraph()
      else paragraph.push(line)
    }
    flushParagraph()
    if (page.hardBoundary) flushSection()
  }
  flushSection()
  // A heading-only document still contains useful searchable text.
  if (!sections.length && section) sections.push({ title: section, blocks: [{ content: section, pageNumber: pages[0]?.pageNumber ?? null, pageEnd: pages.at(-1)?.pageNumber ?? null }] })
  for (const entry of sections) {
      const grouped = []
      for (const block of entry.blocks) {
        const previous = grouped.at(-1)
        if (previous && question(previous.content) && !question(block.content) && previous.content.length + block.content.length + 2 <= 2400) {
          previous.content += '\n\n' + block.content; previous.pageEnd = block.pageEnd
        } else grouped.push({ ...block })
      }
      const units = grouped.flatMap(block => boundedUnits(block.content).map(content => ({ ...block, content }))), parents = []; let parent = []
      for (const unit of units) {
        if (parent.length && parent.map(x => x.content).join('\n\n').length + unit.content.length + 2 > parentTarget) { parents.push(parent); parent = [] }
        parent.push(unit)
      }
      if (parent.length) parents.push(parent)
      for (const group of parents) {
        const parentContent = group.map(x => x.content).join('\n\n'), children = []; let current = []
        for (const unit of group) {
          if (current.length && current.map(x => x.content).join('\n\n').length + unit.content.length + 2 > target) {
            children.push(current)
            const last = current.at(-1); current = last.content.length <= overlap ? [last] : []
          }
          current.push(unit)
        }
        if (current.length) children.push(current)
        for (const child of children) {
          const content = child.map(x => x.content).join('\n\n')
          if (content.trim()) result.push({ content, pageNumber: child[0].pageNumber, pageEnd: child.at(-1).pageEnd, sectionTitle: entry.title, parentIndex, parentContent, parentPageNumber: group[0].pageNumber, parentPageEnd: group.at(-1).pageEnd })
        }
        parentIndex++
      }
  }
  return result
}
