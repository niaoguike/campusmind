<template>
  <button type="button" class="memory-entry" @click="open">◈ 跨会话长期记忆</button>
  <el-dialog v-model="visible" title="跨会话长期记忆" width="min(680px, 94vw)">
    <div class="memory-panel" aria-live="polite">
      <p>Agent 会从个人对话中提取稳定的学习偏好、目标和薄弱点，在新的学习对话中按需使用。你可以修改或删除；群聊和好友对话不会自动写入这里。</p>
      <div class="toolbar"><span>{{ modeLabel }}</span><button type="button" :disabled="loading || busy" @click="refresh">{{ loading ? '刷新中…' : '刷新' }}</button></div>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-else-if="state && !state.enabled" class="empty">跨会话长期记忆尚未开启，请联系平台管理员。</p>
      <template v-if="state?.enabled">
        <p>个人画像和相关历史对话摘要会跨会话使用。修改或删除画像时，已有历史摘要也会清除，后续从新对话重新积累。</p>
        <p v-if="state.queue?.pending">有 {{ state.queue.pending }} 条对话正在分析或等待重试，写入后会自动刷新。</p>
        <p v-if="state.queue?.failed" class="error">{{ state.queue.failed }} 条对话的记忆分析未完成。<button type="button" :disabled="busy" @click="retry">重新尝试</button></p>
        <p v-if="!state.items.length && !loading" class="empty">还没有长期记忆。正常交流学习习惯、目标或薄弱点后，Agent 会自动整理。</p>
        <article v-for="item in state.items" :key="item.id">
          <header><b>{{ kindLabel(item.kind) }}</b><small>{{ item.authority === 'user' ? '由你修改' : '自动整理' }}</small></header>
          <textarea v-if="editing === item.id" v-model="draft" maxlength="600" aria-label="修改学习记忆" />
          <p v-else class="content">{{ item.content }}</p>
          <blockquote v-if="item.evidence">来源原话：{{ item.evidence }}</blockquote>
          <footer><small>{{ item.source_thread_id ? `来源对话 #${item.source_thread_id} · ` : '' }}{{ formatDate(item.updated_at) }}{{ item.expires_at ? ` · 有效至 ${formatDate(item.expires_at)}` : '' }}</small>
            <span v-if="editing === item.id"><button type="button" :disabled="busy || draft.trim().length < 3" @click="save(item)">保存</button><button type="button" :disabled="busy" @click="editing = null">取消</button></span>
            <span v-else><button type="button" :disabled="busy" @click="edit(item)">修改</button><button type="button" class="delete" :disabled="busy" @click="erase(item)">删除</button></span>
          </footer>
        </article>
        <div v-if="state.offset || state.next_offset !== null" class="toolbar"><button type="button" :disabled="loading || busy || !state.offset" @click="page(Math.max(0, state.offset - 100))">上一页</button><span>第 {{ Math.floor(state.offset / 100) + 1 }} 页</span><button type="button" :disabled="loading || busy || state.next_offset === null" @click="page(state.next_offset)">下一页</button></div>
        <h3>历史对话摘要</h3>
        <p v-if="!state.episodes?.length" class="empty">还没有历史摘要。对话积累到一定长度，或新建会话后，会自动整理之前的讨论。</p>
        <article v-for="item in state.episodes || []" :key="item.id">
          <header><b>对话 #{{ item.thread_id }}</b><small>{{ formatDate(item.created_at) }}</small></header>
          <p class="content">{{ summaryText(item) }}</p>
          <footer><small>来源消息 {{ item.start_message_id }} 至 {{ item.end_message_id }} · 版本 {{ item.revision }}</small><button type="button" :disabled="busy" @click="eraseSummary(item)">清除历史摘要</button></footer>
        </article>
      </template>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, post } from '../utils/api'

const visible = ref(false), state = ref(null), loading = ref(false), busy = ref(false), error = ref(''), editing = ref(null), draft = ref('')
const offset = ref(0)
let timer
const modeLabel = computed(() => state.value?.enabled ? ({ auto: '自动整理学习记忆', explicit: '仅在你明确要求记住时整理', off: '已暂停自动写入' }[state.value.write_mode] || '') : '')
const kindLabel = kind => ({ preference: '学习偏好', goal: '学习目标', weakness: '薄弱知识点' }[kind] || '学习记忆')
const formatDate = value => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
async function refresh () {
  if (loading.value) return
  loading.value = true
  try { state.value = await api(`/agent/long-term-memories?offset=${offset.value}`); error.value = '' } catch (e) { error.value = e.message } finally { loading.value = false }
}
async function open () { offset.value = 0; visible.value = true; editing.value = null; await refresh() }
async function page (value) { offset.value = value; editing.value = null; await refresh() }
function edit (item) { editing.value = item.id; draft.value = item.content }
async function save (item) {
  busy.value = true
  try {
    await api(`/agent/long-term-memories/${item.id}`, { method: 'PATCH', body: JSON.stringify({ content: draft.value.trim(), revision: item.revision }) })
    editing.value = null
    ElMessage.success('记忆已更新')
    await refresh()
  } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
async function erase (item) {
  try { await ElMessageBox.confirm('删除后，这条画像和已有历史摘要不再用于后续回答。原始聊天记录仍会保留。', '删除学习记忆', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  busy.value = true
  try { await api(`/agent/long-term-memories/${item.id}`, { method: 'DELETE' }); ElMessage.success('记忆已删除'); await refresh() } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
const summaryText = item => { try { return JSON.parse(item.content).summary || item.content } catch { return item.content } }
async function eraseSummary (item) {
  try { await ElMessageBox.confirm('为避免旧内容通过其他摘要再次召回，将清除已有历史摘要记忆。原始聊天保留，之后从新对话重新积累。', '清除历史摘要', { confirmButtonText: '清除', cancelButtonText: '取消' }) } catch { return }
  busy.value = true
  try { await api(`/agent/history-summaries/${item.id}`, { method: 'DELETE' }); await refresh(); ElMessage.success('历史摘要已清除') } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
async function retry () {
  busy.value = true
  try { await post('/agent/long-term-memories/retry', {}); await refresh() } catch (e) { ElMessage.error(e.message) } finally { busy.value = false }
}
watch(visible, value => { clearInterval(timer); if (value) timer = setInterval(() => { if (!busy.value) refresh() }, 4000) })
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.memory-entry{width:100%;margin:12px 0 0;padding:10px 12px;border:1px solid #e9d5c6;border-radius:12px;background:#fff6ee;color:#925434;text-align:left;cursor:pointer;font:inherit;font-size:13px}.memory-panel{color:#765b4b;font-size:13px;line-height:1.7}.memory-panel>p{margin-top:0}.toolbar,header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.toolbar{padding:8px 0}.memory-panel button{border:1px solid #e6d3c4;border-radius:8px;padding:5px 10px;background:#fff8f2;color:#925434;cursor:pointer}.memory-panel button:disabled{opacity:.5;cursor:default}.memory-panel article{margin:12px 0;padding:14px;border:1px solid #ecdfd5;border-radius:14px;background:#fffcf8}.memory-panel small{color:#987f6d;font-size:11px}.content{white-space:pre-wrap;overflow-wrap:anywhere}.memory-panel blockquote{margin:10px 0;padding-left:10px;border-left:3px solid #dfc0a8;color:#947660;overflow-wrap:anywhere}.memory-panel textarea{box-sizing:border-box;width:100%;min-height:90px;padding:10px;margin:12px 0;border:1px solid #dbc5b4;border-radius:9px;font:inherit;resize:vertical}.memory-panel footer{flex-wrap:wrap}.memory-panel footer span{display:flex;gap:6px}.memory-panel .delete,.error{color:#b04c3b}.empty{padding:20px 0;color:#987f6d}
</style>
