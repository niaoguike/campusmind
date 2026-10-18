// Embeddings use their own provider credentials, never a student's chat key.
export function createEmbeddingClient ({ baseUrl, apiKey, model, dimensions, timeout = 8000, fetchImpl = fetch }) {
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000) throw new Error('EMBEDDING_INVALID_TIMEOUT')
  const url = new URL(baseUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('无效的 embedding 服务地址')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'embeddings'].includes(url.hostname)) throw new Error('远程 embedding 服务必须使用 HTTPS')
  return async text => {
    let response
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: text, dimensions, encoding_format: 'float' })
      })
    } catch { throw new Error('EMBEDDING_UNAVAILABLE') }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`EMBEDDING_HTTP_${response.status}`) }
    let vector
    try { vector = (await response.json()).data?.[0]?.embedding } catch { /* validate below */ }
    if (!Array.isArray(vector) || vector.length !== dimensions || vector.some(n => typeof n !== 'number' || !Number.isFinite(n)) || !vector.some(n => n !== 0)) throw new Error('EMBEDDING_INVALID_VECTOR')
    return vector
  }
}
