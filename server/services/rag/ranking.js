export function reciprocalRankFusion(lanes, k = 60) {
  const combined = new Map()
  for (const [lane, rows] of Object.entries(lanes)) {
    const seen = new Set()
    rows.forEach((row, index) => {
      if (seen.has(row.chunk_id)) return
      seen.add(row.chunk_id)
      const candidate = combined.get(row.chunk_id) || { ...row, rrf_score: 0, ranks: {} }
      candidate.rrf_score += 1 / (k + index + 1)
      candidate.ranks[lane] = index + 1
      combined.set(row.chunk_id, candidate)
    })
  }
  return [...combined.values()].sort((a, b) => b.rrf_score - a.rrf_score || a.chunk_id - b.chunk_id)
}

// Jina/Cohere-compatible endpoint. A reranker may reorder these candidates only.
export function createReranker({ url, apiKey = '', model, timeout = 3000, fetchImpl = fetch }) {
  const endpoint = new URL(url)
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'reranker'].includes(endpoint.hostname))) throw new Error('RAG_INVALID_RERANK_URL')
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30000) throw new Error('RAG_INVALID_RERANK_TIMEOUT')
  return async (query, rows) => {
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, query, documents: rows.map(row => `${row.title}\n${row.content}`), top_n: rows.length }) })
    if (!response.ok) { await response.body?.cancel(); throw new Error('RAG_RERANK_UNAVAILABLE') }
    const results = (await response.json()).results
    if (!Array.isArray(results) || !results.length) throw new Error('RAG_RERANK_INVALID')
    const used = new Set(), ordered = []
    for (const item of results) {
      if (!Number.isInteger(item.index) || !rows[item.index] || used.has(item.index) || !Number.isFinite(item.relevance_score)) throw new Error('RAG_RERANK_INVALID')
      used.add(item.index); ordered.push({ ...rows[item.index], rerank_score: item.relevance_score })
    }
    return [...ordered, ...rows.filter((row, index) => !used.has(index))]
  }
}

export function assembleContext(rows, { limit = 8, budget = 7000 } = {}) {
  const result = [], parents = new Set()
  let used = 0
  for (const row of rows) {
    const key = row.index_revision ? `${row.resource_id}:${row.index_revision}:${row.parent_index}` : `chunk:${row.chunk_id}`
    if (parents.has(key)) continue
    let excerpt = row.parent_content || row.content
    let expanded = Boolean(row.parent_content)
    if (excerpt.length + used > budget) { excerpt = row.content; expanded = false }
    if (excerpt.length + used > budget) continue
    const page = expanded ? row.parent_page_number ?? row.page_number : row.page_number
    const pageEnd = expanded ? row.parent_page_end ?? row.page_end : row.page_end
    parents.add(key); used += excerpt.length
    result.push({
      source: `${row.course_name}｜${row.file_name || row.title}${page ? `｜第 ${page}${pageEnd && pageEnd !== page ? `–${pageEnd}` : ''} 页/张` : ''}${row.section_title ? `｜${row.section_title}` : ''}`,
      title: row.title, file_path: row.file_path || row.url || '', excerpt,
      chunk_id: row.chunk_id, resource_id: row.resource_id, page_number: page, page_end: pageEnd,
      section_title: row.section_title, ranks: row.ranks, rrf_score: row.rrf_score,
      ...(row.rerank_score === undefined ? {} : { rerank_score: row.rerank_score })
    })
    if (result.length >= limit) break
  }
  return result
}
