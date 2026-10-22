import mammoth from 'mammoth';
import JSZip from 'jszip';
import XLSX from 'xlsx';

import { chunkPages } from './rag/chunking.js';
import { getResourceRag } from './rag/service.js';
export { createResourceRag, getResourceRag } from './rag/service.js';

function decodeXml(value = '') {
  return String(value).
  replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').
  replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function pdfPages(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages?.length ? result.pages.map(page => ({ pageNumber: page.num, text: page.text || '' })) : [{ pageNumber: null, text: result.text || '' }];
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function pptxPages(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).
  filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).
  sort((left, right) => Number(left.match(/slide(\d+)/i)?.[1]) - Number(right.match(/slide(\d+)/i)?.[1]));
  const pages = [];
  for (let index = 0; index < slideNames.length; index++) {
    const xml = await zip.file(slideNames[index]).async('string');
    const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1])).join('\n');
    pages.push({ pageNumber: index + 1, text, hardBoundary: true });
  }
  return pages;
}

export async function extractResourcePages(fileName, buffer) {
  const extension = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (extension === 'pdf') return await pdfPages(buffer);
  if (extension === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return [{ pageNumber: null, text: result.value || '' }];
  }
  if (extension === 'pptx') return await pptxPages(buffer);
  if (['xlsx', 'xls'].includes(extension)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.map((name, index) => ({ pageNumber: index + 1, hardBoundary: true, text: `工作表：${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}` }));
  }
  if (['txt', 'csv'].includes(extension)) return [{ pageNumber: null, text: buffer.toString('utf8').replace(/^\uFEFF/, '') }];
  if (['doc', 'ppt'].includes(extension)) throw new Error(`暂不支持旧版 .${extension} 文件，请另存为 .docx 或 .pptx 后重新上传`);
  if (['png', 'jpg', 'jpeg'].includes(extension)) throw new Error('图片与扫描件暂未接入 OCR，无法读取正文；请上传可复制文字的 PDF 或 Office 文件');
  throw new Error('当前文件类型无法建立正文索引');
}

export async function extractResourceChunks(fileName, buffer) {
  const pages = await extractResourcePages(fileName, buffer);
  const chunks = chunkPages(pages);
  if (!chunks.length) throw new Error('未从该文件中提取到可检索正文；如为扫描型 PDF，请改传文字版文件');
  return chunks;
}

export async function searchKnowledgeChunks(db, query, limit = 8, courseId = 0, options = {}) {
  return getResourceRag(db).search(query, limit, courseId, options);
}
