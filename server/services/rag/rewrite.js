import { cleanText, tokens } from './text.js'

const followup = text => !/(?:改讲|换到|转到|换成|接下来讲|继续讲).{2}/.test(text) && (/(?:它|这个|那个|这些|那些|上述|上面|刚才|前面|继续|接着|再讲|举个例|具体一点|详细一点|那.{0,8}(?:呢|怎么|如何))/.test(text) || /^(?:怎么|如何)?(?:推导|证明|计算|使用|求解|举例|解释)(?:一下|呢|的|出来|它)?[？?。!！]*$/.test(text))

// Only user turns from this conversation may supply an omitted topic. Assistant
// evidence, system instructions and long-term memories are never rewrite inputs.
export async function rewriteQuery(query, { history = [], originalQuery = query, mode = 'rules', rewriteModel, timeout = 2000 } = {}) {
  const original = cleanText(query).slice(0, 240)
  if (mode === 'off' || !followup(originalQuery)) return { original, query: original, rewritten: false }
  const turns = history.filter(turn => turn.role === 'user' && typeof turn.content === 'string')
    .map(turn => cleanText(turn.content)).filter(Boolean)
  while (turns.at(-1) === cleanText(originalQuery)) turns.pop()
  const anchor = turns.slice(-8).reverse().find(turn => !followup(turn) && !/^(?:谢谢|好的?|嗯+|明白了?|知道了|可以)[！!。\.\s]*$/.test(turn) && tokens(turn).length)
  if (!anchor) return { original, query: original, rewritten: false }
  const fallback = `${anchor.slice(0, 140)}；${original}`.slice(0, 240)
  if (mode !== 'model' || !rewriteModel) return { original, query: fallback, rewritten: true }
  let timer
  try {
    const controller = new AbortController()
    const result = await Promise.race([
      rewriteModel({ anchor: anchor.slice(0, 240), question: original, signal: controller.signal }),
      new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('REWRITE_TIMEOUT')) }, timeout) })
    ])
    const parsed = typeof result === 'string' ? JSON.parse(result) : result
    if (typeof parsed?.query !== 'string' || !parsed.query.trim() || parsed.query.length > 240) throw new Error('REWRITE_INVALID')
    return { original, query: cleanText(parsed.query), rewritten: true }
  } catch { return { original, query: fallback, rewritten: true } }
  finally { clearTimeout(timer) }
}
