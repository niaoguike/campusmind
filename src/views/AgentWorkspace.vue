<template>
  <div class="page">
    <AppNav />
    <main class="workspace">
      <aside class="panel sidebar">
        <button class="primary new-thread" @click="newThread">＋ 新建学习对话</button>
        <p class="label">我的专属 Agent</p>
        <div class="agent-card"><b>✦ 知行</b><small>学习教练 · LangChain</small></div>
        <p class="hint">可以检索课程资料、规划学习、梳理错题，也能把回答生成学习成果文件。</p>
        <p class="label">近期对话</p>
        <div class="thread-list"><button v-for="thread in threads" :key="thread.id" :class="['thread', { active: thread.id === threadId }]" @click="openThread(thread.id)">{{ thread.title }}</button></div>
      </aside>
      <section class="panel chat">
        <header><div><span>PRIVATE LEARNING AGENT</span><h1>和你的学习伙伴一起进步</h1></div><em>● 已连接 DeepSeek</em></header>
        <div class="shortcuts"><button @click="ask('帮我根据本周课表安排一个学习计划')">安排本周计划</button><button @click="ask('帮我找数据结构相关的复习资料')">检索课程资料</button><button @click="ask('请记住：我每天晚上 8 点后适合学习')">记录学习偏好</button></div>
        <div class="export-tip">得到回答后，直接点击回答下方的 <b>PPT / Word / PDF / 图片</b> 按钮即可下载；也可以直接说“生成 PPT”。</div>
        <div ref="scrollBox" class="messages">
          <div v-if="!messages.length" class="empty"><strong>✦ 今天想从哪里开始？</strong><p>可以问概念、检索课程资料、梳理错题，或让知行生成学习计划。</p></div>
          <article v-for="(message, index) in messages" :key="index" :class="['bubble', message.role]"><b>{{ message.role === 'user' ? '我' : '知行' }}</b><p>{{ message.content }}</p><time>{{ formatTime(message.created_at) }}</time><div v-if="message.attachments?.length" class="attachments"><button v-for="file in message.attachments" :key="file.id" @click="downloadAttachment(file)">📎 {{ file.file_name }}</button></div><div v-if="message.role === 'assistant'" class="exports"><button :disabled="outputLoading" @click="generateOutput('ppt')">生成 PPT</button><button :disabled="outputLoading" @click="generateOutput('word')">导出 Word</button><button :disabled="outputLoading" @click="generateOutput('pdf')">导出 PDF</button><button :disabled="outputLoading" @click="generateOutput('image')">生成图片</button><button :disabled="outputLoading" @click="generateOutput('file')">学习笔记</button></div></article>
          <article v-if="loading" class="bubble assistant"><b>知行</b><p>正在思考并调用学习工具…</p></article>
        </div>
        <form @submit.prevent="send">
          <input ref="attachmentInput" class="hidden" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" @change="chooseAttachment">
          <div v-if="pendingAttachments.length" class="pending"><span v-for="file in pendingAttachments" :key="file.id">📎 {{ file.file_name }} <button type="button" @click="removeAttachment(file.id)">×</button></span></div>
          <textarea v-model="input" :disabled="loading" placeholder="输入你的学习问题，Enter 发送，Shift + Enter 换行" @keydown.enter.exact.prevent="send" />
          <div class="composer"><small>主动发送的附件正文会交由你配置的模型分析</small><span><button class="attach" type="button" :disabled="loading || uploading" @click="attachmentInput?.click()">{{ uploading ? '上传中…' : '📎 附件' }}</button><button class="primary" :disabled="loading || (!input.trim() && !pendingAttachments.length)">{{ loading ? '思考中…' : '发送 ↗' }}</button></span></div>
        </form>
      </section>
    </main>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api, post } from '../utils/api'

const threads = ref([]), threadId = ref(null), messages = ref([]), input = ref(''), loading = ref(false), outputLoading = ref(false), uploading = ref(false), pendingAttachments = ref([]), attachmentInput = ref(null), scrollBox = ref(null)
const scroll = () => nextTick(() => { if (scrollBox.value) scrollBox.value.scrollTop = scrollBox.value.scrollHeight })
async function loadThreads () { threads.value = await api('/agent/threads'); if (!threadId.value && threads.value[0]) await openThread(threads.value[0].id) }
async function openThread (id) { threadId.value = id; pendingAttachments.value = []; messages.value = await api(`/agent/threads/${id}/messages`); scroll() }
async function newThread () { const data = await post('/agent/threads', {}); await loadThreads(); await openThread(data.id) }
const ask = text => { input.value = text; send() }
async function chooseAttachment (event) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 15 * 1024 * 1024) { ElMessage.warning('单个附件不能超过 15MB'); event.target.value = ''; return }; uploading.value = true; const body = new FormData(); body.append('file', file); body.append('thread_id', threadId.value || ''); try { const data = await api('/agent/attachments', { method: 'POST', body }); threadId.value = data.thread_id; pendingAttachments.value.push(data.attachment); ElMessage.success(data.message); threads.value = await api('/agent/threads') } catch (error) { ElMessage.error(error.message) } finally { uploading.value = false; event.target.value = '' } }
const removeAttachment = id => { pendingAttachments.value = pendingAttachments.value.filter(file => file.id !== id) }
async function send () { const content = input.value.trim(), attachmentIds = pendingAttachments.value.map(file => file.id); if ((!content && !attachmentIds.length) || loading.value) return; loading.value = true; input.value = ''; messages.value.push({ role: 'user', content: content || '请阅读我上传的附件。', attachments: [...pendingAttachments.value], created_at: new Date().toISOString() }); pendingAttachments.value = []; scroll(); try { const data = await post('/agent/chat', { thread_id: threadId.value, content, attachment_ids: attachmentIds }); threadId.value = data.thread_id; messages.value = await api(`/agent/threads/${threadId.value}/messages`); threads.value = await api('/agent/threads') } catch (error) { ElMessage.error(error.message); messages.value.pop() } finally { loading.value = false; scroll() } }
const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
async function generateOutput (mode) { if (!threadId.value || outputLoading.value) return; outputLoading.value = true; try { const data = await api(`/agent/threads/${threadId.value}/generate-output`, { method: 'POST', body: JSON.stringify({ mode }) }); ElMessage.success(data.message); messages.value = await api(`/agent/threads/${threadId.value}/messages`); scroll() } catch (error) { ElMessage.error(error.message) } finally { outputLoading.value = false } }
async function downloadAttachment (file) { try { const response = await fetch(file.download_url, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } }); if (!response.ok) throw new Error('下载失败'); const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a'); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url) } catch (error) { ElMessage.error(error.message) } }
onMounted(() => loadThreads().catch(error => ElMessage.error(error.message)))
</script>

<style scoped>
.workspace{max-width:1360px;min-height:calc(100vh - 72px);margin:auto;padding:28px 5vw;display:grid;grid-template-columns:280px 1fr;gap:20px}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.sidebar{padding:18px;overflow:hidden}.primary{border:0;border-radius:14px;background:#c96d42;color:#fff;padding:10px 16px;font-weight:700;cursor:pointer}.new-thread{width:100%}.label,header span{color:#a68779;font-size:11px;font-weight:800;letter-spacing:1px}.agent-card{display:grid;gap:3px;padding:13px;border-radius:17px;background:#fff0e5;color:#73422e}.agent-card small,.hint,.composer small{color:#907b70}.hint{font-size:12px;line-height:1.65}.thread-list{max-height:calc(100vh - 390px);overflow:auto}.thread{display:block;width:100%;padding:10px;border:0;border-radius:12px;background:transparent;color:#725f55;text-align:left;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;cursor:pointer}.thread:hover,.thread.active{background:#f9ece3;color:#a44e2c}.chat{height:calc(100vh - 128px);min-height:560px;max-height:760px;display:flex;flex-direction:column;overflow:hidden}.chat header{display:flex;justify-content:space-between;padding:23px 28px 12px}.chat h1{margin:5px 0;color:#5a3527;font-size:25px}.chat em{height:max-content;padding:7px 10px;border-radius:20px;background:#eff8ef;color:#57915d;font-size:12px;font-style:normal}.shortcuts,.exports,.attachments,.pending{display:flex;gap:6px;flex-wrap:wrap}.shortcuts{padding:0 28px 10px}.shortcuts button,.exports button,.attachments button,.pending span{padding:6px 9px;border:1px solid #f0d4c4;border-radius:10px;background:#fff7f1;color:#a05d41;font-size:11px;cursor:pointer}.exports button:nth-child(-n+4){background:#fff0e5;font-weight:700}.export-tip{margin:0 28px 13px;padding:8px 11px;border-radius:12px;background:#fff2e9;color:#96624c;font-size:12px}.messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 28px;background:#fffcf9;border-top:1px solid #f5e8df;border-bottom:1px solid #f5e8df}.empty{padding:100px 15%;text-align:center;color:#9c8377;line-height:1.7}.bubble{max-width:78%;margin:12px 0;padding:12px 15px;border-radius:17px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.bubble>b{font-size:11px;color:#b47b62}.bubble p{margin:4px 0}.bubble time{display:block;color:#ad9183;font-size:10px}.bubble.assistant{background:#f9ece3;color:#5f4437;border-bottom-left-radius:4px}.bubble.user{margin-left:auto;background:#c96d42;color:#fff;border-bottom-right-radius:4px}.bubble.user>b,.bubble.user time{color:#ffe1cf}.hidden{display:none}.chat form{padding:16px 24px}.chat textarea{box-sizing:border-box;width:100%;height:72px;resize:none;padding:12px;border:1px solid #ead8cd;border-radius:16px;background:#fff;color:#553a2d;font:inherit}.composer{display:flex;justify-content:space-between;align-items:center;margin-top:8px}.composer span{display:flex;gap:8px}.attach{border:0;border-radius:12px;padding:10px 12px;background:#fff0e5;color:#a85a3d;font-weight:700;cursor:pointer}@media(max-width:800px){.workspace{grid-template-columns:1fr;padding:15px}.sidebar{display:none}.chat{height:calc(100vh - 100px);min-height:0;max-height:none}.chat header{padding:20px}.chat em{display:none}.messages{padding:15px}.bubble{max-width:92%}.export-tip{margin:0 20px 12px}}
</style>
