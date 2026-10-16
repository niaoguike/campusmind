const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]))

const inline = value => String(value || '')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')

function renderTextBlock (source) {
  return source.split(/\r?\n/).map(line => {
    if (!line.trim()) return '<div class="md-space"></div>'
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const tag = ['h2', 'h3', 'h4'][heading[1].length - 1]
      return `<${tag}>${inline(heading[2])}</${tag}>`
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/)
    if (ordered) return `<div class="md-item ordered"><i>${ordered[1]}</i><span>${inline(ordered[2])}</span></div>`
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) return `<div class="md-item"><i>•</i><span>${inline(bullet[1])}</span></div>`
    if (/^\s*---+\s*$/.test(line)) return '<hr>'
    return `<p>${inline(line)}</p>`
  }).join('')
}

// This is intentionally a small, safe renderer: model text is HTML-escaped before formatting.
export function renderLearningMarkdown (value) {
  const escaped = escapeHtml(value)
  return escaped.split(/```(?:[a-z0-9_-]+)?\r?\n?/i).map((block, index) => {
    if (index % 2) return `<pre><code>${block.trim()}</code></pre>`
    return renderTextBlock(block)
  }).join('')
}

export function stripAgentDisplayPrefix (value, agentName = '') {
  const text = String(value || '')
  return text.replace(/^\s*[【\[]\s*([^】\]]{1,30})\s*[】\]]\s*[:：-]?\s*/, (whole, label) => {
    const normalized = String(label).toLowerCase()
    const ownName = String(agentName || '').trim().toLowerCase()
    return normalized.includes('agent') || normalized.includes('智能体') || (ownName && normalized === ownName) ? '' : whole
  })
}
