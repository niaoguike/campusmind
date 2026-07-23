import mammoth from 'mammoth'
import JSZip from 'jszip'
import XLSX from 'xlsx'

const cleanText = (value = '') => String(value)
  .replace(/\u0000/g, ' ')
  .replace(/\r/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

function decodeXml (value = '') {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function splitText (text, pageNumber = null, size = 800, overlap = 120) {
  const source = cleanText(text)
  if (!source) return []
  const chunks = []
  let start = 0
  while (start < source.length) {
    let end = Math.min(source.length, start + size)
    if (end < source.length) {
      const punctuation = Math.max(source.lastIndexOf('。', end), source.lastIndexOf('！', end), source.lastIndexOf('？', end), source.lastIndexOf('\n', end))
      if (punctuation > start + Math.floor(size * 0.45)) end = punctuation + 1
    }
    const content = source.slice(start, end).trim()
    if (content.length >= 20) chunks.push({ content, pageNumber })
    if (end >= source.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

async function pdfPages (buffer) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return [{ pageNumber: null, text: result.text || '' }]
  } finally {
    await parser.destroy().catch(() => {})
  }
}

async function pptxPages (buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1]) - Number(right.match(/slide(\d+)/i)?.[1]))
  const pages = []
  for (let index = 0; index < slideNames.length; index++) {
    const xml = await zip.file(slideNames[index]).async('string')
    const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1])).join(' ')
    pages.push({ pageNumber: index + 1, text })
  }
  return pages
}

export async function extractResourcePages (fileName, buffer) {
  const extension = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  if (extension === 'pdf') return pdfPages(buffer)
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return [{ pageNumber: null, text: result.value || '' }]
  }
  if (extension === 'pptx') return pptxPages(buffer)
  if (['xlsx', 'xls'].includes(extension)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    return workbook.SheetNames.map((name, index) => ({ pageNumber: index + 1, text: `工作表：${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}` }))
  }
  if (['txt', 'csv'].includes(extension)) return [{ pageNumber: null, text: buffer.toString('utf8').replace(/^\uFEFF/, '') }]
  if (['doc', 'ppt'].includes(extension)) throw new Error(`暂不支持旧版 .${extension} 文件，请另存为 .docx 或 .pptx 后重新上传`)
  if (['png', 'jpg', 'jpeg'].includes(extension)) throw new Error('图片与扫描件暂未接入 OCR，无法读取正文；请上传可复制文字的 PDF 或 Office 文件')
  throw new Error('当前文件类型无法建立正文索引')
}

export async function extractResourceChunks (fileName, buffer) {
  const pages = await extractResourcePages(fileName, buffer)
  const chunks = pages.flatMap(page => splitText(page.text, page.pageNumber))
  if (!chunks.length) throw new Error('未从该文件中提取到可检索正文；如为扫描型 PDF，请改传文字版文件')
  return chunks
}

function aliasesFor (query) {
  const aliases = []
  if (query.includes('毛概')) aliases.push('毛泽东思想', '中国特色社会主义理论体系概论')
  if (query.includes('马原')) aliases.push('马克思主义基本原理')
  if (query.includes('思修')) aliases.push('思想道德与法治')
  return aliases
}

export function searchKnowledgeChunks (db, query, limit = 8, courseId = 0) {
  const rawQuery = cleanText(query).slice(0, 120)
  if (!rawQuery) return []
  const terms = [...new Set([rawQuery, ...aliasesFor(rawQuery)])]
  let rows = []
  const ftsTerms = terms.map(term => term.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()).filter(Boolean)
  if (ftsTerms.length) {
    try {
      const ftsQuery = ftsTerms.map(term => `"${term}"`).join(' OR ')
      rows = db.prepare(`SELECT rc.id chunk_id,rc.content,rc.page_number,r.title,r.file_name,r.file_path,r.url,c.name course_name
        FROM resource_chunks_fts f JOIN resource_chunks rc ON rc.id=f.chunk_id JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id
        WHERE resource_chunks_fts MATCH ? ${courseId ? 'AND r.course_id=?' : ''} ORDER BY r.is_pinned DESC,rc.id DESC LIMIT ?`).all(...(courseId ? [ftsQuery, courseId, limit] : [ftsQuery, limit]))
    } catch {
      // SQLite FTS may reject a malformed query; LIKE retrieval below remains available.
    }
  }
  const filters = terms.map(() => '(rc.content LIKE ? OR r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ? OR r.file_name LIKE ? OR c.name LIKE ?)')
  const values = terms.flatMap(term => Array(6).fill(`%${term}%`))
  if (!rows.length) rows = db.prepare(`SELECT rc.id chunk_id,rc.content,rc.page_number,r.title,r.file_name,r.file_path,r.url,c.name course_name
    FROM resource_chunks rc JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id
    WHERE (${filters.join(' OR ')}) ${courseId ? 'AND r.course_id=?' : ''} ORDER BY r.is_pinned DESC,rc.id DESC LIMIT ?`).all(...values,...(courseId ? [courseId, limit] : [limit]))
  if (!rows.length) {
    const keyword = rawQuery.match(/[A-Za-z0-9]{3,}|[\u4e00-\u9fff]{2,8}/g)?.sort((a, b) => b.length - a.length)[0]
    if (keyword) rows = db.prepare(`SELECT rc.id chunk_id,rc.content,rc.page_number,r.title,r.file_name,r.file_path,r.url,c.name course_name
      FROM resource_chunks rc JOIN resources r ON r.id=rc.resource_id JOIN courses c ON c.id=r.course_id
      WHERE (rc.content LIKE ? OR r.title LIKE ? OR r.file_name LIKE ? OR c.name LIKE ?) ${courseId ? 'AND r.course_id=?' : ''} ORDER BY r.is_pinned DESC,rc.id DESC LIMIT ?`).all(`%${keyword}%`,`%${keyword}%`,`%${keyword}%`,`%${keyword}%`,...(courseId ? [courseId, limit] : [limit]))
  }
  return rows.map(row => ({
    source: `${row.course_name}｜${row.file_name || row.title}${row.page_number ? `｜第 ${row.page_number} 页/张` : ''}`,
    title: row.title,
    file_path: row.file_path || row.url || '',
    excerpt: cleanText(row.content).slice(0, 900)
  }))
}
