import path from 'path'
import { promises as fs, createWriteStream } from 'fs'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx'
import PDFDocument from 'pdfkit'
import PptxGenJS from 'pptxgenjs'

const warm = 'C96D42'
const ink = '5F4437'
const paper = 'FFF9F4'

function safeTitle (value = '') { return String(value).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 42) || '学习资料' }
function plainLines (value = '') { return String(value).replace(/\r/g, '').split('\n').map(line => line.replace(/^\s*(#{1,6}|[-*+] |\d+[.)]\s*)/, '').trim()).filter(Boolean) }
function sections (value = '') {
  const result = []; let current = { title: '', lines: [] }
  for (const raw of String(value).replace(/\r/g, '').split('\n')) {
    const line = raw.trim(); if (!line) continue
    const heading = line.match(/^#{1,4}\s+(.+)/)
    if (heading) { if (current.title || current.lines.length) result.push(current); current = { title: heading[1].trim(), lines: [] }; continue }
    current.lines.push(line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, ''))
  }
  if (current.title || current.lines.length) result.push(current)
  if (!result.length) result.push({ title: '学习要点', lines: ['暂无可整理内容'] })
  return result
}
function paragraphFor (line) {
  const heading = line.match(/^#{1,3}\s+(.+)/)
  if (heading) return new Paragraph({ text: heading[1], heading: heading[1].length < 20 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } })
  const bullet = line.match(/^[-*+]\s+(.+)/)
  if (bullet) return new Paragraph({ text: bullet[1], bullet: { level: 0 }, spacing: { after: 80 } })
  return new Paragraph({ children: [new TextRun(line.replace(/^\d+[.)]\s+/, ''))], spacing: { after: 110 }, lineSpacing: 360 })
}
export function markdownStudyNote (title, content) { return `# ${safeTitle(title)}\n\n${String(content || '').trim()}\n\n---\n由 CampusMind 专属学习 Agent 根据当前对话生成。\n` }

export async function writeDocx ({ title, content, outputPath }) {
  const doc = new Document({
    creator: 'CampusMind',
    title: safeTitle(title),
    sections: [{ properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children: [
      new Paragraph({ text: safeTitle(title), heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 130 } }),
      new Paragraph({ text: 'CampusMind · 专属学习 Agent 生成', alignment: AlignmentType.CENTER, spacing: { after: 320 }, border: { bottom: { color: warm, space: 8, style: BorderStyle.SINGLE, size: 8 } } }),
      ...String(content || '').replace(/\r/g, '').split('\n').filter(line => line.trim()).map(paragraphFor),
      new Paragraph({ text: '生成内容仅供学习参考，请结合课程资料核对。', spacing: { before: 260 }, style: 'Caption' })
    ] }]
  })
  await fs.writeFile(outputPath, await Packer.toBuffer(doc))
}

async function findPdfFont () {
  const candidates = [
    process.env.PDF_FONT_PATH,
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    'C:\\Windows\\Fonts\\simhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  ].filter(Boolean)
  for (const candidate of candidates) { try { await fs.access(candidate); return candidate } catch {} }
  return ''
}
export async function writePdf ({ title, content, outputPath }) {
  const fontPath = await findPdfFont()
  if (!fontPath) { const error = new Error('服务器缺少中文 PDF 字体'); error.code = 'PDF_FONT_UNAVAILABLE'; throw error }
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: safeTitle(title), Author: 'CampusMind' } })
    const stream = createWriteStream(outputPath); doc.pipe(stream); stream.on('finish', resolve); stream.on('error', reject)
    doc.registerFont('CampusMindCJK', fontPath); doc.font('CampusMindCJK')
    doc.fillColor(`#${warm}`).fontSize(11).text('CAMPUSMIND · 专属学习 Agent', { align: 'center' })
    doc.moveDown(.8).fillColor(`#${ink}`).fontSize(25).text(safeTitle(title), { align: 'center' })
    doc.moveDown(.6).strokeColor(`#${warm}`).moveTo(54, doc.y).lineTo(541, doc.y).stroke().moveDown(1)
    for (const section of sections(content)) { if (section.title) { doc.fillColor(`#${warm}`).fontSize(16).text(section.title); doc.moveDown(.25) }; for (const line of section.lines) { doc.fillColor(`#${ink}`).fontSize(11).text(`• ${line}`, { lineGap: 5, indent: 8 }); doc.moveDown(.2) }; doc.moveDown(.55) }
    doc.fillColor('#9A7B6D').fontSize(9).text('生成内容仅供学习参考，请结合课程资料核对。', { align: 'center' })
    doc.end()
  })
}

function slideLines (lines) { return lines.flatMap(line => String(line).split(/[；。；]/).map(part => part.trim()).filter(Boolean)) }
export async function writePptx ({ title, content, outputPath }) {
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'CampusMind'; pptx.subject = '学习资料'; pptx.title = safeTitle(title); pptx.company = 'CampusMind'
  pptx.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN' }
  const addFooter = (slide, index) => { slide.addText('CampusMind · 专属学习 Agent', { x: .55, y: 7.15, w: 5, h: .18, fontFace: 'Microsoft YaHei', fontSize: 8, color: '9A7B6D' }); slide.addText(String(index), { x: 12.2, y: 7.12, w: .45, h: .2, fontSize: 8, color: '9A7B6D', align: 'right' }) }
  const first = pptx.addSlide(); first.background = { color: paper }; first.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: .25, fill: { color: warm }, line: { color: warm } }); first.addShape(pptx.ShapeType.ellipse, { x: 10.5, y: .65, w: 2.2, h: 2.2, fill: { color: 'F5D0B9', transparency: 15 }, line: { color: 'F5D0B9', transparency: 100 } }); first.addText('CAMPUSMIND LEARNING BRIEF', { x: .7, y: 1.1, w: 5.2, h: .35, fontFace: 'Microsoft YaHei', fontSize: 12, color: warm, bold: true, charSpacing: 1.1 }); first.addText(safeTitle(title), { x: .7, y: 1.8, w: 10.4, h: 1.1, fontFace: 'Microsoft YaHei', fontSize: 32, color: ink, bold: true, breakLine: false, fit: 'shrink' }); first.addText('根据当前 Agent 对话整理 · 适合课堂汇报与复习分享', { x: .72, y: 3.2, w: 7.5, h: .36, fontFace: 'Microsoft YaHei', fontSize: 15, color: '8A6A5A' }); first.addText(new Date().toLocaleDateString('zh-CN'), { x: .72, y: 6.5, w: 3, h: .3, fontSize: 11, color: '9A7B6D' }); addFooter(first, 1)
  const items = sections(content).flatMap(section => { const lines = slideLines(section.lines); return lines.length > 5 ? lines.reduce((chunks, line, index) => { const group = Math.floor(index / 5); (chunks[group] ||= []).push(line); return chunks }, []).map((chunk, index) => ({ title: section.title || '学习要点', lines: chunk, suffix: index + 1 })) : [{ title: section.title || '学习要点', lines }] }).slice(0, 8)
  items.forEach((item, index) => { const slide = pptx.addSlide(); slide.background = { color: paper }; slide.addShape(pptx.ShapeType.rect, { x: .55, y: .55, w: .1, h: 1.05, fill: { color: warm }, line: { color: warm } }); slide.addText(item.title + (item.suffix ? `（${item.suffix}）` : ''), { x: .85, y: .62, w: 10.8, h: .6, fontFace: 'Microsoft YaHei', fontSize: 27, color: ink, bold: true, fit: 'shrink' }); item.lines.forEach((line, lineIndex) => { const y = 1.7 + lineIndex * .87; slide.addShape(pptx.ShapeType.roundRect, { x: .9, y, w: 11.35, h: .63, rectRadius: .08, fill: { color: lineIndex % 2 ? 'FFF3EA' : 'FFFFFF' }, line: { color: 'F0DDD1', transparency: 20 } }); slide.addText(line, { x: 1.18, y: y + .13, w: 10.75, h: .32, fontFace: 'Microsoft YaHei', fontSize: 17, color: ink, breakLine: false, fit: 'shrink' }) }); addFooter(slide, index + 2) })
  await pptx.writeFile({ fileName: outputPath })
}

export async function createAgentExport ({ mode, title, content, directory, id }) {
  const label = safeTitle(title); const stamp = Date.now(); const suffixes = { markdown: '.md', word: '.docx', pdf: '.pdf', ppt: '.pptx' }; const labels = { markdown: '学习笔记', word: '学习报告', pdf: '学习报告', ppt: '学习汇报' }
  const normalized = mode === 'file' ? 'markdown' : mode
  if (!suffixes[normalized]) throw new Error('不支持的导出格式')
  await fs.mkdir(directory, { recursive: true }); const fileName = `${labels[normalized]}-${label}-${stamp}${suffixes[normalized]}`; const savedName = `${id}${suffixes[normalized]}`; const outputPath = path.join(directory, savedName)
  if (normalized === 'markdown') await fs.writeFile(outputPath, markdownStudyNote(label, content), 'utf8')
  if (normalized === 'word') await writeDocx({ title: label, content, outputPath })
  if (normalized === 'pdf') await writePdf({ title: label, content, outputPath })
  if (normalized === 'ppt') await writePptx({ title: label, content, outputPath })
  const info = await fs.stat(outputPath); const mime = { markdown: 'text/markdown', word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }[normalized]
  return { fileName, savedName, mime, size: info.size, mode: normalized }
}
