<template>
  <div class="page">
    <AppNav />
    <main class="workspace">
      <aside class="panel sidebar">
        <button class="primary new-thread" @click="newThread">＋ 新建学习对话</button>
        <p class="label">我的专属 Agent</p>
        <div class="agent-card"><span class="agent-photo"><AvatarBadge :value="myProfile.agent_avatar || '✦'" :alt="myProfile.agent_name || '我的 Agent'" /></span><div><b>{{ myProfile.agent_name || '知行' }}</b><small>学习教练 · LangChain</small></div></div>
        <p class="hint">可以检索课程资料、规划学习、梳理错题，也能把回答生成学习成果文件。</p>
        <button class="collaboration-entry" type="button" @click="openCollaboration">✦ 同课程 Agent 协作 <em v-if="incomingDelegations.length">{{ incomingDelegations.length }}</em></button>
        <p class="label">近期对话</p>
        <div class="thread-list"><button v-for="thread in threads" :key="thread.id" :class="['thread', { active: thread.id === threadId }]" :title="threadPreview(thread)" @click="openThread(thread.id)">{{ threadPreview(thread) }}</button></div>
      </aside>
      <section class="panel chat">
        <header><div><span>PRIVATE LEARNING AGENT</span><h1>和你的学习伙伴一起进步</h1></div><div class="model-actions"><em>● 已连接 DeepSeek</em><button type="button" class="artifact-compact" @click="openArtifactStudio">✨ 专业生成成果</button></div></header>
        <div class="shortcuts"><button @click="ask('帮我根据本周课表安排一个学习计划')">安排本周计划</button><button @click="ask('帮我找数据结构相关的复习资料')">检索课程资料</button><button @click="ask('请根据我的学习状态生成本周复盘')">生成本周复盘</button><button @click="ask('请记住：我每天晚上 8 点后适合学习')">记录学习偏好</button></div>
        <div v-if="showExportTip" class="export-tip"><span>得到回答后，直接点击回答下方的 <b>PPT / Word / PDF / 图片</b> 按钮即可下载；也可以直接说“生成 PPT”。</span><button type="button" aria-label="关闭提示" title="关闭本次提示" @click="showExportTip = false">×</button></div>
        <div ref="scrollBox" class="messages">
          <div v-if="!messages.length" class="empty"><strong>✦ 今天想从哪里开始？</strong><p>可以问概念、检索课程资料、梳理错题，或让知行生成学习计划。</p></div>
          <article v-for="(message, index) in messages" :key="index" :class="['bubble', message.role]"><b>{{ message.role === 'user' ? '我' : agentLabel(message.agent_type) }}</b><p>{{ message.content }}</p><time>{{ formatTime(message.created_at) }}</time><div v-if="message.attachments?.length" class="attachments"><button v-for="file in message.attachments" :key="file.id" @click="downloadAttachment(file)">📎 {{ file.file_name }}</button></div><button v-if="message.role === 'assistant' && message.agent_run_id" class="trace-toggle" type="button" @click="toggleRunTrace(message.agent_run_id)">{{ openRunId === message.agent_run_id ? '收起协作过程' : '查看本次 Agent 协作过程' }}</button><div v-if="message.role === 'assistant' && message.agent_run_id && openRunId === message.agent_run_id && runTraces[message.agent_run_id]" class="trace-box"><div v-for="step in runTraces[message.agent_run_id].steps" :key="step.id" :class="['trace-step', step.status]"><span>{{ step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : '·' }}</span><div><b>{{ step.label }}</b><small>{{ step.output_summary || step.meta?.description }}</small><em v-if="step.citations?.length">引用 {{ step.citations.length }} 条课程资料</em></div></div></div><div v-if="message.role === 'assistant'" class="exports"><button :disabled="outputLoading" @click="generateOutput('ppt')">生成 PPT</button><button :disabled="outputLoading" @click="generateOutput('word')">导出 Word</button><button :disabled="outputLoading" @click="generateOutput('pdf')">导出 PDF</button><button :disabled="outputLoading" @click="generateOutput('image')">生成图片</button><button :disabled="outputLoading" @click="generateOutput('file')">学习笔记</button></div></article>
          <article v-if="loading" class="bubble assistant"><b>协调器</b><p>正在选择合适的学习 Agent 并调用工具…</p></article>
        </div>
        <form @submit.prevent="send">
          <input ref="attachmentInput" class="hidden" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" @change="chooseAttachment">
          <div v-if="pendingAttachments.length" class="pending"><span v-for="file in pendingAttachments" :key="file.id">📎 {{ file.file_name }} <button type="button" @click="removeAttachment(file.id)">×</button></span></div>
          <textarea v-model="input" :disabled="loading" placeholder="输入你的学习问题，Enter 发送，Shift + Enter 换行" @keydown.enter.exact.prevent="send" />
          <div class="composer"><small>主动发送的附件正文会交由你配置的模型分析</small><span><button class="attach" type="button" :disabled="loading || uploading" @click="attachmentInput?.click()">{{ uploading ? '上传中…' : '📎 附件' }}</button><button class="primary" :disabled="loading || (!input.trim() && !pendingAttachments.length)">{{ loading ? '思考中…' : '发送 ↗' }}</button></span></div>
        </form>
      </section>
    </main>
    <el-dialog v-model="collaborationDialog" title="同课程 Agent 协作" width="min(680px, 94vw)"><div class="collaboration-panel"><p>系统只会向允许协作的同课程 Agent 发送受控学习任务卡。跨用户协作使用你的 DeepSeek API Key，且不共享私聊、课表、完整计划或密钥。</p><label>协作课程<select v-model.number="collaborationCourseId" @change="loadCollaborationPolicy"><option :value="0">请选择课程</option><option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option></select></label><div v-if="collaborationCourseId" class="policy-card"><b>我的协作设置</b><label class="switch-row"><span>允许同课程 Agent 向我发起学习协作</span><input v-model="collaborationPolicy.allow_matching" type="checkbox"></label><label class="switch-row"><span>同意后自动响应（会使用发起者的 API Key）</span><input v-model="collaborationPolicy.auto_respond" type="checkbox" :disabled="!collaborationPolicy.allow_matching"></label><label class="switch-row"><span>可分享知识点掌握度摘要</span><input v-model="collaborationPolicy.share_mastery" type="checkbox"></label><label class="switch-row"><span>可分享我上传的资料标题</span><input v-model="collaborationPolicy.share_resource_titles" type="checkbox"></label><button class="soft-button" type="button" @click="saveCollaborationPolicy">保存本课程设置</button></div><hr><label>想向同课程 Agent 了解什么？<textarea v-model="delegationQuestion" maxlength="1200" placeholder="例如：我想在三天内复习树和图，请给我一个可执行的复习顺序。"></textarea></label><button class="primary" type="button" :disabled="!collaborationCourseId || !delegationQuestion.trim() || collaborationLoading" @click="searchCollaborationCandidates">{{ collaborationLoading ? '正在匹配…' : '寻找可协作的 Agent' }}</button><div v-if="candidates.length" class="candidate-list"><b>可协作的同课程 Agent</b><div v-for="candidate in candidates" :key="candidate.owner_id" class="candidate"><AvatarBadge :value="candidate.agent_avatar" :alt="candidate.agent_name" /><div><b>{{ candidate.agent_name }}</b><small>{{ candidate.label }} · {{ candidate.sharing.auto_respond ? '可自动响应' : '需主人同意' }}</small></div><button class="soft-button" type="button" @click="requestDelegation(candidate)">发起委托</button></div></div><hr><div v-if="incomingDelegations.length" class="delegation-section"><b>等待你授权的协作申请</b><div v-for="item in incomingDelegations" :key="item.id" class="delegation"><div><b>{{ item.requester_agent_name || '学习伙伴 Agent' }}</b><small>{{ item.course_name }} · {{ item.question }}</small></div><span><button class="soft-button" type="button" @click="respondDelegation(item, 'reject')">拒绝</button><button class="primary small-primary" type="button" @click="respondDelegation(item, 'approve')">同意并协作</button></span></div></div><div v-if="outgoingDelegations.length" class="delegation-section"><b>我的协作记录</b><div v-for="item in outgoingDelegations" :key="item.id" class="delegation result"><div><b>{{ item.owner_agent_name || '学习伙伴 Agent' }} · {{ delegationStatus(item.status) }}</b><small>{{ item.course_name }} · {{ item.question }}</small><p v-if="item.synthesis"><strong>整合建议：</strong>{{ item.synthesis }}</p><p v-else-if="item.peer_answer"><strong>同伴建议：</strong>{{ item.peer_answer }}</p></div><button v-if="['pending','processing','completed'].includes(item.status)" class="text-button" type="button" @click="revokeDelegation(item)">撤回</button></div></div></div></el-dialog>
    <div v-if="artifactStudio" class="artifact-modal" role="dialog" aria-modal="true">
      <form class="artifact-dialog" @submit.prevent="createProfessionalArtifact">
        <div class="dialog-head"><div><span>AI ARTIFACT STUDIO</span><h2>专业生成学习成果</h2></div><button type="button" class="close" @click="artifactStudio = false">×</button></div>
        <p>DeepSeek 会先重新设计内容结构，再由平台生成可下载文件。</p>
        <label>成果类型<select v-model="artifactForm.mode"><option value="ppt">PPT 学习汇报</option><option value="word">Word 学习报告</option><option value="pdf">PDF 学习报告</option></select></label>
        <label>{{ artifactForm.mode === 'ppt' ? '总页数（含封面）' : '内容篇幅级别' }}<input v-model.number="artifactForm.pages" type="number" min="4" max="16"></label>
        <label>使用场景<select v-model="artifactForm.style"><option>课程复习</option><option>课堂汇报</option><option>大创答辩</option></select></label>
        <label>侧重点备注<textarea v-model="artifactForm.focus" maxlength="180" placeholder="例如：重点讲清楚链表插入和删除，适合 5 分钟课堂汇报"></textarea></label>
        <small>将使用你在模型设置中保存的 DeepSeek Key；生成后文件仅在你的 Agent 对话中可下载。</small>
        <div class="dialog-actions"><button type="button" @click="artifactStudio = false">取消</button><button class="primary" :disabled="artifactLoading">{{ artifactLoading ? '正在设计与生成…' : '开始专业生成' }}</button></div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import AvatarBadge from '../components/AvatarBadge.vue'
import { api, post } from '../utils/api'

const threads = ref([]), threadId = ref(null), messages = ref([]), input = ref(''), loading = ref(false), outputLoading = ref(false), uploading = ref(false), pendingAttachments = ref([]), attachmentInput = ref(null), scrollBox = ref(null), myProfile = ref({}), showExportTip = ref(true), runTraces = ref({}), openRunId = ref(null)
const courses = ref([]), collaborationDialog = ref(false), collaborationCourseId = ref(0), collaborationLoading = ref(false), candidates = ref([]), delegations = ref([]), delegationQuestion = ref('')
const collaborationPolicy = ref({ allow_matching: false, auto_respond: false, share_mastery: false, share_resource_titles: true })
const artifactStudio = ref(false), artifactLoading = ref(false), artifactForm = ref({ mode: 'ppt', pages: 8, style: '课程复习', focus: '' })
const incomingDelegations = computed(() => delegations.value.filter(item => !item.is_requester && item.status === 'pending'))
const outgoingDelegations = computed(() => delegations.value.filter(item => item.is_requester))
const scroll = () => nextTick(() => { if (scrollBox.value) scrollBox.value.scrollTop = scrollBox.value.scrollHeight })
const agentLabel = type => ({ tutor: '学习导师 Agent', retrieval: '资料检索 Agent', planner: '学习计划 Agent', reflection: '学习画像 Agent', artifact: '成果生成 Agent' }[type] || myProfile.value.agent_name || '知行')
const threadPreview = thread => { const text = String(thread.preview || thread.title || '新的学习对话').replace(/\s+/g, ' ').trim() || '新的学习对话'; return text.length > 24 ? `${text.slice(0, 24)}…` : text }
async function toggleRunTrace (runId) { if (openRunId.value === runId) { openRunId.value = null; return }; try { if (!runTraces.value[runId]) runTraces.value[runId] = await api(`/agent/runs/${runId}`); openRunId.value = runId } catch (error) { ElMessage.error(error.message) } }
async function loadThreads () { threads.value = await api('/agent/threads'); if (!threadId.value && threads.value[0]) await openThread(threads.value[0].id) }
async function openThread (id) { threadId.value = id; openRunId.value = null; pendingAttachments.value = []; messages.value = await api(`/agent/threads/${id}/messages`); scroll() }
async function newThread () { const data = await post('/agent/threads', {}); await loadThreads(); await openThread(data.id) }
const ask = text => { input.value = text; send() }
async function chooseAttachment (event) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 15 * 1024 * 1024) { ElMessage.warning('单个附件不能超过 15MB'); event.target.value = ''; return }; uploading.value = true; const body = new FormData(); body.append('file', file); body.append('thread_id', threadId.value || ''); try { const data = await api('/agent/attachments', { method: 'POST', body }); threadId.value = data.thread_id; pendingAttachments.value.push(data.attachment); ElMessage.success(data.message); threads.value = await api('/agent/threads') } catch (error) { ElMessage.error(error.message) } finally { uploading.value = false; event.target.value = '' } }
const removeAttachment = id => { pendingAttachments.value = pendingAttachments.value.filter(file => file.id !== id) }
async function send () { const content = input.value.trim(), attachmentIds = pendingAttachments.value.map(file => file.id); if ((!content && !attachmentIds.length) || loading.value) return; loading.value = true; input.value = ''; messages.value.push({ role: 'user', content: content || '请阅读我上传的附件。', attachments: [...pendingAttachments.value], created_at: new Date().toISOString() }); pendingAttachments.value = []; scroll(); try { const data = await post('/agent/chat', { thread_id: threadId.value, content, attachment_ids: attachmentIds }); threadId.value = data.thread_id; messages.value = await api(`/agent/threads/${threadId.value}/messages`); threads.value = await api('/agent/threads') } catch (error) { ElMessage.error(error.message); messages.value.pop() } finally { loading.value = false; scroll() } }
const formatTime = value => {
  if (!value) return ''
  const text = String(value).trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
async function generateOutput (mode) { if (!threadId.value || outputLoading.value) return; outputLoading.value = true; try { const professional = ['ppt', 'word', 'pdf'].includes(mode); const data = await api(`/agent/threads/${threadId.value}/${professional ? 'generate-artifact' : 'generate-output'}`, { method: 'POST', body: JSON.stringify(professional ? { mode, pages: mode === 'ppt' ? 8 : 7, style: '课程复习', focus: '' } : { mode }) }); ElMessage.success(data.message); messages.value = await api(`/agent/threads/${threadId.value}/messages`); scroll() } catch (error) { ElMessage.error(error.message) } finally { outputLoading.value = false } }
function openArtifactStudio () { if (!threadId.value || !messages.value.length) { ElMessage.warning('请先在 Agent 对话中获得一段学习内容'); return }; artifactStudio.value = true }
async function createProfessionalArtifact () { if (artifactLoading.value) return; artifactLoading.value = true; try { const data = await api(`/agent/threads/${threadId.value}/generate-artifact`, { method: 'POST', body: JSON.stringify(artifactForm.value) }); ElMessage.success(data.message); artifactStudio.value = false; messages.value = await api(`/agent/threads/${threadId.value}/messages`); scroll() } catch (error) { ElMessage.error(error.message) } finally { artifactLoading.value = false } }
async function downloadAttachment (file) { try { const response = await fetch(file.download_url, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } }); if (!response.ok) throw new Error('下载失败'); const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a'); anchor.href = url; anchor.download = file.file_name; anchor.click(); URL.revokeObjectURL(url) } catch (error) { ElMessage.error(error.message) } }
async function refreshDelegations () { delegations.value = await api('/agent/collaboration/delegations') }
async function loadCollaborationPolicy () {
  candidates.value = []
  if (!collaborationCourseId.value) return
  collaborationPolicy.value = await api(`/agent/collaboration/policy?course_id=${collaborationCourseId.value}`)
}
async function openCollaboration () {
  try {
    await Promise.all([
      courses.value.length ? Promise.resolve() : api('/courses').then(data => { courses.value = data }),
      refreshDelegations()
    ])
    collaborationDialog.value = true
    if (!collaborationCourseId.value && courses.value[0]) collaborationCourseId.value = courses.value[0].id
    await loadCollaborationPolicy()
  } catch (error) { ElMessage.error(error.message) }
}
async function saveCollaborationPolicy () {
  if (!collaborationCourseId.value) return ElMessage.warning('请先选择课程')
  try {
    const data = await api('/agent/collaboration/policy', { method: 'PUT', body: JSON.stringify({ course_id: collaborationCourseId.value, ...collaborationPolicy.value }) })
    collaborationPolicy.value = data.policy
    ElMessage.success(data.message)
  } catch (error) { ElMessage.error(error.message) }
}
async function searchCollaborationCandidates () {
  if (!collaborationCourseId.value) return ElMessage.warning('请先选择课程')
  collaborationLoading.value = true
  try {
    candidates.value = await api(`/agent/collaboration/candidates?course_id=${collaborationCourseId.value}`)
    if (!candidates.value.length) ElMessage.info('目前没有开启协作的同课程 Agent，可稍后再试。')
  } catch (error) { ElMessage.error(error.message) } finally { collaborationLoading.value = false }
}
async function requestDelegation (candidate) {
  try {
    const data = await post('/agent/collaboration/delegations', { course_id: collaborationCourseId.value, agent_owner_id: candidate.owner_id, question: delegationQuestion.value.trim() })
    ElMessage.success(data.message)
    candidates.value = candidates.value.filter(item => item.owner_id !== candidate.owner_id)
    await refreshDelegations()
  } catch (error) { ElMessage.error(error.message) }
}
const delegationStatus = status => ({ pending: '等待对方授权', processing: '协作处理中', completed: '已完成', rejected: '对方已拒绝', revoked: '已撤回', failed: '协作失败' }[status] || status)
async function respondDelegation (item, action) {
  try {
    const data = await api(`/agent/collaboration/delegations/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
    ElMessage.success(data.message)
    await refreshDelegations()
  } catch (error) { ElMessage.error(error.message) }
}
async function revokeDelegation (item) {
  try {
    const data = await api(`/agent/collaboration/delegations/${item.id}`, { method: 'DELETE' })
    ElMessage.success(data.message)
    await refreshDelegations()
  } catch (error) { ElMessage.error(error.message) }
}
onMounted(() => Promise.all([loadThreads(), api('/user/profile').then(data => { myProfile.value = data }), api('/courses').then(data => { courses.value = data }), refreshDelegations()]).catch(error => ElMessage.error(error.message)))
</script>

<style scoped>
.workspace{max-width:1360px;min-height:calc(100vh - 72px);margin:auto;padding:28px 5vw;display:grid;grid-template-columns:280px 1fr;gap:20px}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.sidebar{padding:18px;overflow:hidden}.primary{border:0;border-radius:14px;background:#c96d42;color:#fff;padding:10px 16px;font-weight:700;cursor:pointer}.new-thread{width:100%}.label,header span{color:#a68779;font-size:11px;font-weight:800;letter-spacing:1px}.agent-card{display:grid;gap:3px;padding:13px;border-radius:17px;background:#fff0e5;color:#73422e}.agent-card small,.hint,.composer small{color:#907b70}.hint{font-size:12px;line-height:1.65}.thread-list{max-height:calc(100vh - 390px);overflow:auto}.thread{display:block;width:100%;padding:10px;border:0;border-radius:12px;background:transparent;color:#725f55;text-align:left;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;cursor:pointer}.thread:hover,.thread.active{background:#f9ece3;color:#a44e2c}.chat{height:calc(100vh - 128px);min-height:560px;max-height:760px;display:flex;flex-direction:column;overflow:hidden}.chat header{display:flex;justify-content:space-between;padding:23px 28px 12px}.chat h1{margin:5px 0;color:#5a3527;font-size:25px}.chat em{height:max-content;padding:7px 10px;border-radius:20px;background:#eff8ef;color:#57915d;font-size:12px;font-style:normal}.shortcuts,.exports,.attachments,.pending{display:flex;gap:6px;flex-wrap:wrap}.shortcuts{padding:0 28px 10px}.shortcuts button,.exports button,.attachments button,.pending span{padding:6px 9px;border:1px solid #f0d4c4;border-radius:10px;background:#fff7f1;color:#a05d41;font-size:11px;cursor:pointer}.exports button:nth-child(-n+4){background:#fff0e5;font-weight:700}.export-tip{margin:0 28px 13px;padding:8px 11px;border-radius:12px;background:#fff2e9;color:#96624c;font-size:12px}.messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 28px;background:#fffcf9;border-top:1px solid #f5e8df;border-bottom:1px solid #f5e8df}.empty{padding:100px 15%;text-align:center;color:#9c8377;line-height:1.7}.bubble{max-width:78%;margin:12px 0;padding:12px 15px;border-radius:17px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.bubble>b{font-size:11px;color:#b47b62}.bubble p{margin:4px 0}.bubble time{display:block;color:#ad9183;font-size:10px}.bubble.assistant{background:#f9ece3;color:#5f4437;border-bottom-left-radius:4px}.bubble.user{margin-left:auto;background:#c96d42;color:#fff;border-bottom-right-radius:4px}.bubble.user>b,.bubble.user time{color:#ffe1cf}.hidden{display:none}.chat form{padding:16px 24px}.chat textarea{box-sizing:border-box;width:100%;height:72px;resize:none;padding:12px;border:1px solid #ead8cd;border-radius:16px;background:#fff;color:#553a2d;font:inherit}.composer{display:flex;justify-content:space-between;align-items:center;margin-top:8px}.composer span{display:flex;gap:8px}.attach{border:0;border-radius:12px;padding:10px 12px;background:#fff0e5;color:#a85a3d;font-weight:700;cursor:pointer}@media(max-width:800px){.workspace{grid-template-columns:1fr;padding:15px}.sidebar{display:none}.chat{height:calc(100vh - 100px);min-height:0;max-height:none}.chat header{padding:20px}.chat em{display:none}.messages{padding:15px}.bubble{max-width:92%}.export-tip{margin:0 20px 12px}}
.artifact-launch{display:flex;justify-content:space-between;align-items:center;margin:0 28px 13px;padding:9px 12px;border-radius:14px;background:#fff8f3;color:#8f6652;font-size:12px}.artifact-launch button{border:0;border-radius:11px;background:#c96d42;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}.artifact-modal{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:18px;background:#4f2a1f66}.artifact-dialog{width:min(520px,100%);padding:24px;border-radius:24px;background:#fffdfa;box-shadow:0 24px 70px #3e160b44}.dialog-head{display:flex;justify-content:space-between;gap:16px}.dialog-head span{color:#b47b62;font-size:11px;font-weight:800;letter-spacing:1px}.dialog-head h2{margin:5px 0 0;color:#5a3527}.artifact-dialog>p{color:#826d62;font-size:13px;line-height:1.6}.artifact-dialog label{display:grid;gap:6px;margin:14px 0;color:#694838;font-size:13px;font-weight:700}.artifact-dialog select,.artifact-dialog input,.artifact-dialog textarea{width:100%;box-sizing:border-box;border:1px solid #ead8cd;border-radius:12px;padding:10px;background:#fff;color:#553a2d;font:inherit}.artifact-dialog textarea{height:72px;resize:vertical}.artifact-dialog small{display:block;color:#9a8175;line-height:1.55}.close,.dialog-actions button:not(.primary){border:0;border-radius:10px;background:#f7ebe4;color:#a05d41;padding:8px 11px;cursor:pointer}.close{height:max-content;font-size:20px;line-height:1}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.dialog-actions .primary:disabled{opacity:.6}@media(max-width:800px){.artifact-launch{margin:0 20px 12px}.artifact-launch span{display:none}}
.model-actions{display:grid;justify-items:end;gap:7px}.artifact-compact{border:0;border-radius:11px;background:#c96d42;color:#fff;padding:8px 11px;font-size:12px;font-weight:700;cursor:pointer}.agent-photo{display:inline-grid;width:38px;height:38px;overflow:hidden;vertical-align:middle;border-radius:13px;background:#eee1f5;color:#745288;font-size:19px}.agent-card{display:flex;align-items:center;gap:10px}.agent-card b,.agent-card small{display:block}.export-tip{display:flex;align-items:flex-start;gap:8px}.export-tip span{flex:1}.export-tip button{flex:none;border:0;background:transparent;color:#aa725a;font-size:19px;line-height:15px;cursor:pointer}
@media(min-width:801px){.workspace{align-items:start}.panel{box-sizing:border-box}.sidebar,.chat{height:clamp(680px,calc(100vh - 80px),900px);min-height:680px;max-height:900px}.sidebar{display:flex;flex-direction:column}.thread-list{flex:1;min-height:0;max-height:none;overflow:auto}}
.trace-toggle{margin-top:8px;border:0;border-radius:10px;padding:6px 9px;background:#f1e9f7;color:#73528a;font-size:11px;font-weight:700;cursor:pointer}.trace-box{margin-top:8px;padding:9px;border-radius:13px;background:#fff8f4;border:1px solid #efded3}.trace-step{display:flex;gap:7px;padding:6px 0;color:#8a6b5c}.trace-step>span{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#eadfd5;color:#a06a51;font-size:11px;font-weight:800}.trace-step.done>span{background:#e6f3e5;color:#53835a}.trace-step.failed>span{background:#fde7e1;color:#b14d39}.trace-step div{min-width:0}.trace-step b,.trace-step small,.trace-step em{display:block}.trace-step b{font-size:11px;color:#704735}.trace-step small{margin-top:2px;font-size:11px;line-height:1.45}.trace-step em{margin-top:2px;color:#8a678f;font-size:10px;font-style:normal}
.collaboration-entry{width:100%;margin:6px 0 12px;border:1px dashed #e6c9b7;border-radius:13px;padding:9px 10px;background:#fff8f3;color:#9b583c;text-align:left;font-size:12px;font-weight:800;cursor:pointer}.collaboration-entry:hover{background:#fff0e5}.collaboration-entry em{float:right;min-width:17px;padding:1px 4px;border-radius:10px;background:#cf6943;color:#fff;text-align:center;font-size:10px;font-style:normal}.collaboration-panel{color:#694838}.collaboration-panel>p{margin:0 0 14px;color:#8d7568;font-size:12px;line-height:1.65}.collaboration-panel>label{display:grid;gap:6px;margin:12px 0;color:#694838;font-size:13px;font-weight:800}.collaboration-panel select,.collaboration-panel textarea{box-sizing:border-box;width:100%;border:1px solid #ead8cd;border-radius:12px;padding:10px;background:#fffdfa;color:#553a2d;font:inherit}.collaboration-panel textarea{min-height:76px;resize:vertical}.collaboration-panel hr{margin:16px 0;border:0;border-top:1px solid #f0e2d8}.policy-card{display:grid;gap:8px;margin-top:12px;padding:13px;border-radius:15px;background:#fff7f1}.policy-card>b,.candidate-list>b,.delegation-section>b{font-size:13px;color:#704735}.switch-row{display:flex!important;grid-template-columns:1fr auto!important;align-items:center;margin:0!important;font-size:12px!important;font-weight:600!important}.switch-row input{width:16px;height:16px;accent-color:#c96d42}.soft-button,.text-button{border:0;border-radius:10px;padding:7px 9px;background:#f7ebe4;color:#a05d41;font-size:12px;font-weight:700;cursor:pointer}.soft-button:hover,.text-button:hover{background:#f2ded1}.candidate-list,.delegation-section{display:grid;gap:8px;margin-top:15px}.candidate,.delegation{display:flex;align-items:center;gap:9px;padding:10px;border:1px solid #f0dfd4;border-radius:14px;background:#fffdfa}.candidate>div,.delegation>div{min-width:0;flex:1}.candidate b,.candidate small,.delegation b,.delegation small{display:block}.candidate small,.delegation small{margin-top:3px;color:#927b6e;font-size:11px;line-height:1.45}.candidate .avatar-badge{width:34px;height:34px}.delegation{align-items:flex-start}.delegation>span{display:flex;gap:6px;flex:none}.delegation.result{align-items:flex-start}.delegation p{margin:7px 0 0;color:#76594b;font-size:12px;line-height:1.55;white-space:pre-wrap}.small-primary{padding:7px 9px;font-size:12px}.text-button{flex:none;background:transparent;color:#b56a4a}.primary:disabled,.soft-button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:560px){.candidate,.delegation{align-items:flex-start;flex-wrap:wrap}.candidate .soft-button{margin-left:43px}.delegation>span{margin-left:43px}}
</style>
