<template>
  <div class="page">
    <AppNav />
    <main :class="['workspace', { 'action-mode': agentMode === 'action' }]">
      <aside class="panel sidebar">
        <button class="primary new-thread" @click="newThread">＋ 新建学习对话</button>
        <p class="label">我的专属 Agent</p>
        <div class="agent-card"><span class="agent-photo"><AvatarBadge :value="myProfile.agent_avatar || '✦'" :alt="myProfile.agent_name || '我的 Agent'" /></span><div><b>{{ myProfile.agent_name || '知行' }}</b><small>学习教练 · LangChain</small></div></div>
        <p class="hint">{{ agentMode === 'study' ? '专注课程问答、资料检索、学习规划与成果生成。' : '拆解复杂目标并调用平台能力；所有对外操作仍由你最终确认。' }}</p>
        <template v-if="agentMode === 'action'">
          <p class="label capability-label">行动能力</p>
          <button class="collaboration-entry" type="button" @click="openCollaboration">✦ 同课程 Agent 协作 <em v-if="pendingIncomingDelegations.length">{{ pendingIncomingDelegations.length }}</em></button>
          <button class="collaboration-entry memory-entry" type="button" @click="openMemoryDialog">▣ 群学习成果记忆 <em v-if="pendingMemoryCount">{{ pendingMemoryCount }}</em></button>
          <button class="collaboration-entry permission-entry" type="button" @click="openPermissionDialog">⚙ 行动权限与确认</button>
        </template>
        <p class="label">近期对话</p>
        <div class="thread-list"><button v-for="thread in threads" :key="thread.id" :class="['thread', { active: thread.id === threadId }]" :title="threadPreview(thread)" @click="openThread(thread.id)">{{ threadPreview(thread) }}</button></div>
      </aside>
      <section class="panel chat">
        <header><div><span>{{ agentMode === 'study' ? 'LEARNING Q&A' : 'ACTION WORKSPACE' }}</span><h1>{{ agentMode === 'study' ? '专注问答与学习' : '让总 Agent 带你完成任务' }}</h1></div><div class="model-actions"><div class="mode-switch" role="tablist" aria-label="Agent 工作模式"><button type="button" :class="{ active: agentMode === 'study' }" @click="setAgentMode('study')">学习问答</button><button type="button" :class="{ active: agentMode === 'action' }" @click="setAgentMode('action')">行动工作台</button></div><em>● 已连接 DeepSeek</em><button type="button" class="artifact-compact" @click="openArtifactStudio">✨ 专业生成成果</button></div></header>
        <div v-if="agentMode === 'study'" class="shortcuts"><button @click="ask('帮我根据本周课表安排一个学习计划')">安排本周计划</button><button @click="ask('帮我找数据结构相关的复习资料')">检索课程资料</button><button @click="ask('请根据我的学习状态生成本周复盘')">生成本周复盘</button><button @click="ask('请记住：我每天晚上 8 点后适合学习')">记录学习偏好</button></div>
        <div v-else class="shortcuts action-shortcuts"><button @click="focusProjectGoal('帮我完成一个完整学习目标，并拆解为可执行步骤')">规划复杂任务</button><button @click="focusProjectGoal('帮我检查并整理我上传但尚未归档的课程资料')">整理个人资料</button><button @click="ask('帮我找同课程的其他 Agent 咨询学习经验')">调用同课程 Agent</button><button @click="openPermissionDialog">配置行动权限</button></div>
        <div v-if="showExportTip" class="export-tip"><span>得到回答后，直接点击回答下方的 <b>PPT / Word / PDF / 图片</b> 按钮即可下载；也可以直接说“生成 PPT”。</span><button type="button" aria-label="关闭提示" title="关闭本次提示" @click="showExportTip = false">×</button></div>
        <div ref="scrollBox" class="messages">
          <div v-if="!messages.length" class="empty"><strong>{{ agentMode === 'study' ? '✦ 今天想学习什么？' : '◈ 今天要完成什么任务？' }}</strong><p>{{ agentMode === 'study' ? '可以问概念、检索课程资料、梳理错题，或生成学习成果。' : '说明目标与期限，总 Agent 会拆解步骤，并在你确认后调用平台能力。' }}</p></div>
          <article v-for="(message, index) in messages" :key="index" :class="['bubble', message.role]">
            <b>{{ message.role === 'user' ? '我' : agentLabel(message.agent_type) }}</b>
            <div v-if="message.role === 'assistant'" class="learning-markdown" v-html="renderLearningMarkdown(message.content)"></div>
            <p v-else>{{ message.content }}</p>
            <time>{{ formatTime(message.created_at) }}</time>
            <div v-if="imageAttachments(message).length" class="inline-images">
              <button v-for="file in imageAttachments(message)" :key="file.id" type="button" :title="`下载 ${file.file_name}`" @click="downloadAttachment(file)">
                <img v-if="attachmentImageUrls[file.id]" :src="attachmentImageUrls[file.id]" :alt="file.file_name">
                <span v-else>正在加载学习图解…</span>
              </button>
            </div>
            <div v-if="message.attachments?.length" class="attachments"><button v-for="file in message.attachments.filter(file => !isImageAttachment(file))" :key="file.id" @click="downloadAttachment(file)">📎 {{ file.file_name }}</button></div>
            <div v-if="agentMode === 'action' && message.role === 'assistant' && message.actions?.length" class="supervisor-actions">
              <span>行动工作台待确认</span>
              <button v-for="action in message.actions" :key="action.request_id || action.type" type="button" :disabled="action.status && action.status !== 'pending'" @click="handleSupervisorAction(action)">{{ action.status === 'executed' ? '✓ 已执行' : action.status === 'cancelled' ? '已取消' : action.label }}</button>
              <small v-for="action in message.actions" :key="`${action.request_id || action.type}-description`">{{ action.description }}</small>
            </div>
            <button v-if="message.role === 'assistant' && message.agent_run_id" class="trace-toggle" type="button" @click="toggleRunTrace(message.agent_run_id)">{{ openRunId === message.agent_run_id ? '收起协作过程' : '查看本次 Agent 协作过程' }}</button>
            <div v-if="message.role === 'assistant' && message.agent_run_id && openRunId === message.agent_run_id && runTraces[message.agent_run_id]" class="trace-box"><div v-for="step in runTraces[message.agent_run_id].steps" :key="step.id" :class="['trace-step', step.status]"><span>{{ step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : '·' }}</span><div><b>{{ step.label }}</b><small>{{ step.output_summary || step.meta?.description }}</small><em v-if="step.citations?.length">引用 {{ step.citations.length }} 条课程资料</em></div></div></div>
            <div v-if="message.role === 'assistant'" class="exports"><button :disabled="outputLoading" @click="generateOutput('ppt')">生成 PPT</button><button :disabled="outputLoading" @click="generateOutput('word')">导出 Word</button><button :disabled="outputLoading" @click="generateOutput('pdf')">导出 PDF</button><button :disabled="outputLoading" @click="generateOutput('image')">生成学习图解</button><button :disabled="outputLoading" @click="generateOutput('file')">学习笔记</button></div>
          </article>
          <article v-if="loading" class="bubble assistant"><b>{{ agentMode === 'study' ? '学习协调器' : '行动协调器' }}</b><p>{{ agentMode === 'study' ? '正在选择合适的学习 Agent 并检索所需信息…' : '正在分析目标、权限与可执行步骤…' }}</p></article>
        </div>
        <form @submit.prevent="send">
          <input ref="attachmentInput" class="hidden" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp" @change="chooseAttachment">
          <div v-if="pendingAttachments.length" class="pending"><span v-for="file in pendingAttachments" :key="file.id">📎 {{ file.file_name }} <button type="button" @click="removeAttachment(file.id)">×</button></span></div>
          <textarea v-model="input" :disabled="loading" :placeholder="agentMode === 'study' ? '输入学习问题，Enter 发送，Shift + Enter 换行' : '说明要完成的任务、目标对象和限制条件'" @keydown.enter.exact.prevent="send" />
          <div class="composer"><small>主动发送的附件正文会交由你配置的模型分析</small><span><button class="attach" type="button" :disabled="loading || uploading" @click="attachmentInput?.click()">{{ uploading ? '上传中…' : '📎 附件' }}</button><button class="primary" :disabled="loading || (!input.trim() && !pendingAttachments.length)">{{ loading ? '思考中…' : '发送 ↗' }}</button></span></div>
        </form>
      </section>
      <aside v-if="agentMode === 'action'" class="panel action-console">
        <header><div><span>ACTION PROJECTS</span><h2>任务与执行</h2></div><em v-if="activeProjectCount">{{ activeProjectCount }} 个进行中</em></header>
        <p class="action-note">行动工作台可以管理你在 CampusMind 内的学习事务。发消息、移动资料、公开发帖和联系他人 Agent 前都会显示确认。</p>
        <form class="project-create action-project-create" @submit.prevent="createProjectFromGoal()">
          <textarea ref="projectGoalInput" v-model="projectGoal" maxlength="1000" placeholder="输入一个完整目标，例如：两周内完成数据结构期末复习，并整理资料和咨询高分同学的 Agent。"></textarea>
          <button class="primary" :disabled="projectLoading || projectGoal.trim().length < 6">{{ projectLoading ? '拆解中…' : '建立任务' }}</button>
        </form>
        <div v-if="!projects.length" class="action-empty">还没有行动任务。你也可以直接在聊天框描述目标。</div>
        <template v-else>
          <select v-model.number="selectedProjectId" class="project-select" aria-label="选择行动项目"><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.status === 'completed' ? '✓ ' : '' }}{{ project.title }}（{{ project.progress.done }}/{{ project.progress.total }}）</option></select>
          <section v-if="selectedProject" class="action-project-detail">
            <div class="action-project-head"><div><b>{{ selectedProject.title }}</b><small>{{ selectedProject.goal }}</small></div><button type="button" class="text-button" @click="deleteProject(selectedProject)">删除</button></div>
            <article v-for="step in selectedProject.steps" :key="step.id" :class="['action-step', step.status]">
              <span>{{ step.status === 'done' ? '✓' : step.step_order }}</span><div><b>{{ step.title }}</b><small>{{ step.result?.message || step.description }}</small><details v-if="step.draft"><summary>预览论坛草稿</summary><p>{{ step.draft.content }}</p></details></div>
              <button v-if="['pending','prepared'].includes(step.status)" type="button" class="soft-button" :disabled="projectActionLoading" @click="prepareProjectStep(selectedProject, step)">准备</button><button v-else-if="step.status === 'awaiting_confirmation' && step.action?.status === 'pending'" type="button" class="primary tiny-primary" :disabled="projectActionLoading" @click="confirmProjectStep(step)">确认</button><em v-else>{{ projectStepStatus(step.status) }}</em>
            </article>
            <div class="action-project-footer"><button v-if="selectedProject.status !== 'completed'" type="button" class="soft-button" @click="setProjectStatus(selectedProject, 'completed')">标记项目完成</button><button v-else type="button" class="soft-button" @click="setProjectStatus(selectedProject, 'active')">重新开启</button></div>
          </section>
        </template>
      </aside>
    </main>
    <el-dialog v-model="collaborationDialog" title="同课程 Agent 协作" width="min(680px, 94vw)">
      <div class="collaboration-panel">
        <p>系统只会向允许协作的同课程 Agent 发送受控学习任务卡。跨用户协作使用你的 DeepSeek API Key，且不共享私聊、课表、完整计划或密钥。</p>
        <label>协作课程
          <select v-model.number="collaborationCourseId" @change="loadCollaborationPolicy">
            <option :value="0">请选择课程</option>
            <option v-for="course in courses" :key="course.id" :value="course.id">{{ course.name }}</option>
          </select>
        </label>
        <div v-if="collaborationCourseId" class="policy-card">
          <b>我的协作设置</b>
          <label class="switch-row"><span>允许同课程 Agent 向我发起学习协作</span><input v-model="collaborationPolicy.allow_matching" type="checkbox"></label>
          <label class="switch-row"><span>同意后自动响应（会使用发起者的 API Key）</span><input v-model="collaborationPolicy.auto_respond" type="checkbox" :disabled="!collaborationPolicy.allow_matching"></label>
          <label class="switch-row"><span>可分享知识点掌握度摘要</span><input v-model="collaborationPolicy.share_mastery" type="checkbox"></label>
          <label class="switch-row"><span>可分享我上传的资料标题</span><input v-model="collaborationPolicy.share_resource_titles" type="checkbox"></label>
          <button class="soft-button" type="button" @click="saveCollaborationPolicy">保存本课程设置</button>
        </div>
        <hr>
        <label>想向同课程 Agent 了解什么？
          <textarea v-model="delegationQuestion" maxlength="1200" placeholder="例如：我想在三天内复习树和图，请给我一个可执行的复习顺序。"></textarea>
        </label>
        <button class="primary" type="button" :disabled="!collaborationCourseId || !delegationQuestion.trim() || collaborationLoading" @click="searchCollaborationCandidates">{{ collaborationLoading ? '正在匹配…' : '寻找可协作的 Agent' }}</button>
        <div v-if="candidates.length" class="candidate-list">
          <b>可协作的同课程 Agent</b>
          <div v-for="candidate in candidates" :key="candidate.owner_id" class="candidate">
            <AvatarBadge :value="candidate.agent_avatar" :alt="candidate.agent_name" />
            <div><b>{{ candidate.agent_name }}</b><small>{{ candidate.label }} · {{ candidate.sharing.auto_respond ? '可自动响应' : '需主人同意' }}</small></div>
            <button class="soft-button" type="button" @click="requestDelegation(candidate)">发起委托</button>
          </div>
        </div>
        <hr>
        <div v-if="incomingDelegations.length" class="delegation-section">
          <b>等待你授权的协作申请</b>
          <div v-for="item in incomingDelegations" :key="item.id" class="delegation">
            <div><b>{{ item.requester_agent_name || '学习伙伴 Agent' }}</b><small>{{ item.course_name }} · {{ item.question }}</small></div>
            <span><button class="soft-button" type="button" @click="respondDelegation(item, 'reject')">拒绝</button><button class="primary small-primary" type="button" @click="respondDelegation(item, 'approve')">同意并协作</button></span>
          </div>
        </div>
        <div v-if="autoHandledDelegations.length" class="delegation-section">
          <b>已自动处理的协作请求</b>
          <div v-for="item in autoHandledDelegations" :key="item.id" class="delegation result">
            <div><b>{{ item.requester_agent_name || '学习伙伴 Agent' }} · {{ delegationStatus(item.status) }}</b><small>{{ item.course_name }} · {{ item.question }}</small><p>{{ delegationStatusNote(item.status) }}</p></div>
          </div>
        </div>
        <div v-if="outgoingDelegations.length" class="delegation-section">
          <b>我的协作记录</b>
          <div v-for="item in outgoingDelegations" :key="item.id" class="delegation result">
            <div><b>{{ item.owner_agent_name || '学习伙伴 Agent' }} · {{ delegationStatus(item.status) }}</b><small>{{ item.course_name }} · {{ item.question }}</small><p v-if="item.synthesis"><strong>整合建议：</strong>{{ item.synthesis }}</p><p v-else-if="item.peer_answer"><strong>同伴建议：</strong>{{ item.peer_answer }}</p></div>
            <span class="delegation-actions"><button v-if="item.status === 'completed'" class="soft-button" type="button" @click="openDelegation(item.id)">更多</button><button v-if="['pending','processing','completed'].includes(item.status)" class="text-button" type="button" @click="revokeDelegation(item)">撤回</button></span>
          </div>
        </div>
      </div>
    </el-dialog>
    <el-dialog v-model="memoryDialog" title="群学习成果记忆" width="min(640px, 94vw)">
      <div class="memory-panel">
        <p>这里保存的是群任务的结论摘要与来源指针，不会把整个群聊、好友私聊或他人的个人计划复制到你的 Agent 中。</p>
        <div v-if="!memories.length" class="memory-empty">还没有可同步的群协作成果。完成一次群内多 Agent 讨论后，成果会出现在这里。</div>
        <article v-for="item in memories" :key="item.id" :class="['memory-item', item.status]">
          <div><span>{{ memoryStatus(item.status) }}</span><b>{{ item.title }}</b><small>{{ item.summary }}</small><em>{{ item.created_at ? formatTime(item.created_at) : '' }}</em></div>
          <aside>
            <button v-if="item.status !== 'saved'" type="button" class="soft-button" @click="updateMemory(item, 'save')">保存</button>
            <button v-if="item.status !== 'hidden'" type="button" class="text-button" @click="updateMemory(item, 'hide')">隐藏</button>
            <button v-else type="button" class="soft-button" @click="updateMemory(item, 'restore')">恢复索引</button>
          </aside>
        </article>
      </div>
    </el-dialog>
    <el-dialog v-model="permissionDialog" title="行动工作台权限" width="min(620px, 94vw)">
      <div class="permission-panel">
        <p>这些权限只允许 Agent 为你准备操作，并且每一次真正的发送、转发、建任务或跨用户协作都仍需要你在对话内点击确认。系统会记录执行时间与范围。</p>
        <label class="permission-row"><span><b>准备群消息</b><small>识别你明确点名的学习群，并准备一条以你身份发送的消息。</small></span><el-switch v-model="platformPermissions.allow_group_post" /></label>
        <label class="permission-row"><span><b>准备好友转发</b><small>向所有当前好友转发前，展示收件人数和完整消息供你确认。</small></span><el-switch v-model="platformPermissions.allow_friend_broadcast" /></label>
        <label class="permission-row"><span><b>准备群任务</b><small>根据你的明确指令，在你所属学习群创建待办任务。</small></span><el-switch v-model="platformPermissions.allow_group_task" /></label>
        <label class="permission-row"><span><b>准备同课程 Agent 委托</b><small>仅匹配主动开启协作授权的 Agent；对方仍可审批、拒绝或撤回。</small></span><el-switch v-model="platformPermissions.allow_peer_delegation" /></label>
        <label class="permission-row"><span><b>整理我的资料库</b><small>只准备移动本人上传且尚未归档的资料，并补充文件夹和标签建议；不会删除文件。</small></span><el-switch v-model="platformPermissions.allow_resource_manage" /></label>
        <label class="permission-row"><span><b>发布论坛草稿</b><small>总 Agent 可先起草帖子；公开发布仍必须在项目步骤中逐次确认，并再次经过敏感词检查。</small></span><el-switch v-model="platformPermissions.allow_forum_publish" /></label>
      </div>
      <template #footer><button class="soft-button" type="button" @click="permissionDialog = false">取消</button><button class="primary" type="button" @click="savePlatformPermissions">保存权限</button></template>
    </el-dialog>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import AvatarBadge from '../components/AvatarBadge.vue'
import { api, post } from '../utils/api'
import { renderLearningMarkdown } from '../utils/learningMarkdown'

const router = useRouter()
const threads = ref([]), threadId = ref(null), messages = ref([]), input = ref(''), loading = ref(false), outputLoading = ref(false), uploading = ref(false), pendingAttachments = ref([]), attachmentInput = ref(null), scrollBox = ref(null), myProfile = ref({}), showExportTip = ref(true), runTraces = ref({}), openRunId = ref(null), attachmentImageUrls = ref({})
const agentMode = ref(localStorage.getItem('campusmind_agent_mode') === 'action' ? 'action' : 'study')
const courses = ref([]), collaborationDialog = ref(false), collaborationCourseId = ref(0), collaborationLoading = ref(false), candidates = ref([]), delegations = ref([]), delegationQuestion = ref('')
const collaborationPolicy = ref({ allow_matching: false, auto_respond: false, share_mastery: false, share_resource_titles: true })
const artifactStudio = ref(false), artifactLoading = ref(false), artifactForm = ref({ mode: 'ppt', pages: 8, style: '课程复习', focus: '' })
const memoryDialog = ref(false), memories = ref([]), memoryLoading = ref(false)
const permissionDialog = ref(false), platformPermissions = ref({ allow_group_post: false, allow_friend_broadcast: false, allow_group_task: false, allow_peer_delegation: false, allow_resource_manage: false, allow_forum_publish: false })
const projects = ref([]), projectGoal = ref(''), projectGoalInput = ref(null), projectLoading = ref(false), projectActionLoading = ref(false), selectedProjectId = ref(null)
const pendingIncomingDelegations = computed(() => delegations.value.filter(item => !item.is_requester && item.status === 'pending'))
const pendingMemoryCount = computed(() => memories.value.filter(item => item.status === 'indexed' && item.sync_request?.status === 'pending').length)
const activeProjectCount = computed(() => projects.value.filter(item => item.status === 'active').length)
const selectedProject = computed(() => projects.value.find(item => item.id === selectedProjectId.value) || projects.value[0] || null)
const incomingDelegations = computed(() => pendingIncomingDelegations.value)
const autoHandledDelegations = computed(() => delegations.value.filter(item => !item.is_requester && ['processing', 'completed', 'failed'].includes(item.status)))
const outgoingDelegations = computed(() => delegations.value.filter(item => item.is_requester))
let collaborationPollTimer = null
async function setAgentMode (mode) {
  const nextMode = mode === 'action' ? 'action' : 'study'
  const changed = agentMode.value !== nextMode
  agentMode.value = nextMode
  localStorage.setItem('campusmind_agent_mode', agentMode.value)
  if (changed) {
    threadId.value = null
    messages.value = []
    openRunId.value = null
    pendingAttachments.value = []
    await loadThreads()
  }
  if (agentMode.value === 'study') {
    collaborationDialog.value = false
    memoryDialog.value = false
    permissionDialog.value = false
  } else refreshProjects().catch(error => ElMessage.error(error.message))
  nextTick(() => scroll())
}
function focusProjectGoal (value = '') {
  setAgentMode('action')
  if (value && !projectGoal.value) projectGoal.value = value
  nextTick(() => projectGoalInput.value?.focus())
}
const scroll = () => nextTick(() => { if (scrollBox.value) scrollBox.value.scrollTop = scrollBox.value.scrollHeight })
const isImageAttachment = file => /^image\//i.test(String(file?.mime_type || '')) || /\.(svg|png|jpe?g|webp)$/i.test(String(file?.file_name || ''))
const imageAttachments = message => (message?.attachments || []).filter(isImageAttachment)
async function hydrateInlineImages (list) {
  const files = list.flatMap(message => imageAttachments(message))
  await Promise.all(files.map(async file => {
    if (!file?.id || attachmentImageUrls.value[file.id]) return
    try {
      const response = await fetch(file.download_url, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } })
      if (!response.ok) return
      attachmentImageUrls.value = { ...attachmentImageUrls.value, [file.id]: URL.createObjectURL(await response.blob()) }
    } catch {}
  }))
}
async function loadMessages (id = threadId.value) { const data = await api(`/agent/threads/${id}/messages`); messages.value = data; await hydrateInlineImages(data); return data }
const agentLabel = type => ({ tutor: '学习导师 Agent', retrieval: '资料检索 Agent', planner: '学习计划 Agent', reflection: '学习画像 Agent', artifact: '成果生成 Agent' }[type] || myProfile.value.agent_name || '知行')
const threadPreview = thread => { const text = String(thread.preview || thread.title || '新的学习对话').replace(/\s+/g, ' ').trim() || '新的学习对话'; return text.length > 24 ? `${text.slice(0, 24)}…` : text }
async function toggleRunTrace (runId) { if (openRunId.value === runId) { openRunId.value = null; return }; try { if (!runTraces.value[runId]) runTraces.value[runId] = await api(`/agent/runs/${runId}`); openRunId.value = runId } catch (error) { ElMessage.error(error.message) } }
async function loadThreads () { threads.value = await api(`/agent/threads?mode=${agentMode.value}`); if (!threadId.value && threads.value[0]) await openThread(threads.value[0].id) }
async function openThread (id) { threadId.value = id; openRunId.value = null; pendingAttachments.value = []; await loadMessages(id); scroll() }
async function newThread () { const data = await post('/agent/threads', { mode: agentMode.value }); await loadThreads(); await openThread(data.id) }
const ask = text => { input.value = text; send() }
async function chooseAttachment (event) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 15 * 1024 * 1024) { ElMessage.warning('单个附件不能超过 15MB'); event.target.value = ''; return }; uploading.value = true; const body = new FormData(); body.append('file', file); body.append('thread_id', threadId.value || ''); body.append('mode', agentMode.value); try { const data = await api('/agent/attachments', { method: 'POST', body }); threadId.value = data.thread_id; pendingAttachments.value.push(data.attachment); ElMessage.success(data.message); await loadThreads() } catch (error) { ElMessage.error(error.message) } finally { uploading.value = false; event.target.value = '' } }
const removeAttachment = id => { pendingAttachments.value = pendingAttachments.value.filter(file => file.id !== id) }
async function send () { const content = input.value.trim(), attachmentIds = pendingAttachments.value.map(file => file.id); if ((!content && !attachmentIds.length) || loading.value) return; loading.value = true; input.value = ''; messages.value.push({ role: 'user', content: content || '请阅读我上传的附件。', attachments: [...pendingAttachments.value], created_at: new Date().toISOString() }); pendingAttachments.value = []; scroll(); try { const data = await post('/agent/chat', { thread_id: threadId.value, content, attachment_ids: attachmentIds, mode: agentMode.value }); threadId.value = data.thread_id; await loadMessages(threadId.value); await loadThreads(); if (agentMode.value === 'action') await refreshProjects() } catch (error) { ElMessage.error(error.message); messages.value.pop() } finally { loading.value = false; scroll() } }
const formatTime = value => {
  if (!value) return ''
  const text = String(value).trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
async function generateOutput (mode) { if (!threadId.value || outputLoading.value) return; outputLoading.value = true; try { const professional = ['ppt', 'word', 'pdf'].includes(mode); const data = await api(`/agent/threads/${threadId.value}/${professional ? 'generate-artifact' : 'generate-output'}`, { method: 'POST', body: JSON.stringify(professional ? { mode, pages: mode === 'ppt' ? 8 : 7, style: '课程复习', focus: '' } : { mode }) }); ElMessage.success(data.message); await loadMessages(threadId.value); scroll() } catch (error) { ElMessage.error(error.message) } finally { outputLoading.value = false } }
function openArtifactStudio () { if (!threadId.value || !messages.value.length) { ElMessage.warning('请先在 Agent 对话中获得一段学习内容'); return }; artifactStudio.value = true }
async function createProfessionalArtifact () { if (artifactLoading.value) return; artifactLoading.value = true; try { const data = await api(`/agent/threads/${threadId.value}/generate-artifact`, { method: 'POST', body: JSON.stringify(artifactForm.value) }); ElMessage.success(data.message); artifactStudio.value = false; await loadMessages(threadId.value); scroll() } catch (error) { ElMessage.error(error.message) } finally { artifactLoading.value = false } }
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
const memoryStatus = status => ({ saved: '已保存', indexed: '待决定', hidden: '已隐藏' }[status] || '成果')
async function refreshMemories () { memories.value = await api('/agent/memories') }
async function openMemoryDialog () {
  try { await refreshMemories(); memoryDialog.value = true } catch (error) { ElMessage.error(error.message) }
}
async function updateMemory (item, action) {
  if (memoryLoading.value) return
  memoryLoading.value = true
  try {
    const data = await api(`/agent/memories/${item.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
    const index = memories.value.findIndex(memory => memory.id === item.id)
    if (index >= 0) memories.value.splice(index, 1, data.memory)
    ElMessage.success(data.message)
  } catch (error) { ElMessage.error(error.message) } finally { memoryLoading.value = false }
}
async function openPermissionDialog () {
  try { platformPermissions.value = await api('/agent/platform-permissions'); permissionDialog.value = true } catch (error) { ElMessage.error(error.message) }
}
async function savePlatformPermissions () {
  try { const data = await api('/agent/platform-permissions', { method: 'PUT', body: JSON.stringify(platformPermissions.value) }); platformPermissions.value = data.permissions; permissionDialog.value = false; ElMessage.success(data.message) } catch (error) { ElMessage.error(error.message) }
}
const projectStepStatus = status => ({ pending: '待准备', prepared: '已准备', awaiting_confirmation: '等待确认', done: '已完成', skipped: '已跳过' }[status] || status)
async function refreshProjects () {
  const data = await api('/agent/projects')
  projects.value = data
  if (!selectedProjectId.value || !data.some(item => item.id === selectedProjectId.value)) selectedProjectId.value = data[0]?.id || null
  return data
}
async function createProjectFromGoal (goal = projectGoal.value) {
  const content = String(goal || '').trim()
  if (content.length < 6) return ElMessage.warning('请先写清楚希望总 Agent 推进的学习目标')
  projectLoading.value = true
  try {
    const data = await api('/agent/projects', { method: 'POST', body: JSON.stringify({ goal: content }) })
    projectGoal.value = ''
    selectedProjectId.value = data.project.id
    await refreshProjects()
    ElMessage.success(data.message)
  } catch (error) { ElMessage.error(error.message) } finally { projectLoading.value = false }
}
async function prepareProjectStep (project, step) {
  projectActionLoading.value = true
  try {
    const data = await post(`/agent/projects/${project.id}/steps/${step.id}/prepare`, {})
    await refreshProjects()
    ElMessage.success(data.message)
  } catch (error) {
    ElMessage.error(error.message)
    if (error?.message?.includes('平台权限')) openPermissionDialog()
  } finally { projectActionLoading.value = false }
}
async function confirmProjectStep (step) {
  if (!step.action?.id) return
  projectActionLoading.value = true
  try {
    const data = await post(`/agent/platform-actions/${step.action.id}/confirm`, {})
    await refreshProjects()
    await refreshDelegations()
    ElMessage.success(data.message)
  } catch (error) { ElMessage.error(error.message) } finally { projectActionLoading.value = false }
}
async function setProjectStatus (project, status) {
  try { const data = await api(`/agent/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refreshProjects(); ElMessage.success(data.message) } catch (error) { ElMessage.error(error.message) }
}
async function deleteProject (project) {
  if (!window.confirm(`确定删除“${project.title}”吗？已实际创建的计划、资料文件夹和论坛帖子不会被删除。`)) return
  try { const data = await api(`/agent/projects/${project.id}`, { method: 'DELETE' }); await refreshProjects(); ElMessage.success(data.message) } catch (error) { ElMessage.error(error.message) }
}
async function handleSupervisorAction (action) {
  if (action.type === 'create_project') {
    setAgentMode('action')
    projectGoal.value = action.goal || ''
    return createProjectFromGoal(projectGoal.value)
  }
  if (['group_post', 'friend_broadcast', 'group_task', 'peer_delegation', 'forum_publish'].includes(action.type) && action.request_id) {
    try {
      const data = await post(`/agent/platform-actions/${action.request_id}/confirm`, {})
      action.status = data.status
      ElMessage.success(data.message)
      await loadMessages(threadId.value)
      await refreshDelegations()
    } catch (error) { ElMessage.error(error.message) }
    return
  }
  if (action.type === 'open_platform_permissions') return openPermissionDialog()
  if (action.type === 'open_group_discussion') return router.push('/messages')
  if (action.type === 'open_peer_collaboration') return openCollaboration()
  ElMessage.info(action.description || '此协作入口暂不可用')
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
const delegationStatusNote = status => ({ processing: '已按你的“自动响应”设置处理，无需手动同意。', completed: '该协作已按你的授权完成，结果已发送给发起者。', failed: '协作未完成，请让发起者检查自己的模型配置或稍后重试。' }[status] || '')
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
function openDelegation (id) { collaborationDialog.value = false; router.push(`/agent-collaboration/${id}`) }
onMounted(() => {
  Promise.all([loadThreads(), api('/user/profile').then(data => { myProfile.value = data }), api('/courses').then(data => { courses.value = data }), refreshDelegations(), refreshMemories(), refreshProjects(), api('/agent/platform-permissions').then(data => { platformPermissions.value = data })]).catch(error => ElMessage.error(error.message))
  collaborationPollTimer = window.setInterval(() => { refreshDelegations().catch(() => {}) }, 10000)
})
onBeforeUnmount(() => { if (collaborationPollTimer) window.clearInterval(collaborationPollTimer) })
</script>

<style scoped>
.workspace{max-width:1360px;min-height:calc(100vh - 72px);margin:auto;padding:28px 5vw;display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px}.workspace.action-mode{max-width:1680px;grid-template-columns:250px minmax(520px,1fr) minmax(320px,410px);padding-inline:3vw}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.sidebar{padding:18px;overflow:hidden}.primary{border:0;border-radius:14px;background:#c96d42;color:#fff;padding:10px 16px;font-weight:700;cursor:pointer}.new-thread{width:100%}.label,header span{color:#a68779;font-size:11px;font-weight:800;letter-spacing:1px}.capability-label{margin-bottom:5px}.agent-card{display:grid;gap:3px;padding:13px;border-radius:17px;background:#fff0e5;color:#73422e}.agent-card small,.hint,.composer small{color:#907b70}.hint{font-size:12px;line-height:1.65}.thread-list{max-height:calc(100vh - 390px);overflow:auto}.thread{display:block;width:100%;padding:10px;border:0;border-radius:12px;background:transparent;color:#725f55;text-align:left;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;cursor:pointer}.thread:hover,.thread.active{background:#f9ece3;color:#a44e2c}.chat{height:calc(100vh - 128px);min-height:560px;max-height:760px;display:flex;flex-direction:column;overflow:hidden}.chat header{display:flex;justify-content:space-between;gap:20px;padding:23px 28px 12px}.chat h1{margin:5px 0;color:#5a3527;font-size:25px}.chat em{height:max-content;padding:7px 10px;border-radius:20px;background:#eff8ef;color:#57915d;font-size:12px;font-style:normal}.shortcuts,.exports,.attachments,.pending{display:flex;gap:6px;flex-wrap:wrap}.shortcuts{padding:0 28px 10px}.shortcuts button,.exports button,.attachments button,.pending span{padding:6px 9px;border:1px solid #f0d4c4;border-radius:10px;background:#fff7f1;color:#a05d41;font-size:11px;cursor:pointer}.action-shortcuts button{border-color:#dccbea;background:#f8f2fb;color:#725486}.exports button:nth-child(-n+4){background:#fff0e5;font-weight:700}.export-tip{margin:0 28px 13px;padding:8px 11px;border-radius:12px;background:#fff2e9;color:#96624c;font-size:12px}.messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 28px;background:#fffcf9;border-top:1px solid #f5e8df;border-bottom:1px solid #f5e8df}.empty{padding:100px 15%;text-align:center;color:#9c8377;line-height:1.7}.bubble{max-width:78%;margin:12px 0;padding:12px 15px;border-radius:17px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.bubble>b{font-size:11px;color:#b47b62}.bubble p{margin:4px 0}.bubble time{display:block;color:#ad9183;font-size:10px}.bubble.assistant{background:#f9ece3;color:#5f4437;border-bottom-left-radius:4px}.bubble.user{margin-left:auto;background:#c96d42;color:#fff;border-bottom-right-radius:4px}.bubble.user>b,.bubble.user time{color:#ffe1cf}.hidden{display:none}.chat form{padding:16px 24px}.chat textarea{box-sizing:border-box;width:100%;height:72px;resize:none;padding:12px;border:1px solid #ead8cd;border-radius:16px;background:#fff;color:#553a2d;font:inherit}.composer{display:flex;justify-content:space-between;align-items:center;margin-top:8px}.composer span{display:flex;gap:8px}.attach{border:0;border-radius:12px;padding:10px 12px;background:#fff0e5;color:#a85a3d;font-weight:700;cursor:pointer}.mode-switch{display:flex;padding:3px;border-radius:13px;background:#f2e9e3}.mode-switch button{border:0;border-radius:10px;padding:7px 10px;background:transparent;color:#917568;font-size:11px;font-weight:800;cursor:pointer}.mode-switch button.active{background:#fffdfa;color:#a65031;box-shadow:0 2px 8px #70402a1a}.action-mode .mode-switch{background:#eee6f4}.action-mode .mode-switch button.active{color:#674879}.action-console{height:calc(100vh - 128px);min-height:560px;max-height:760px;box-sizing:border-box;padding:18px;overflow:auto}.action-console>header{display:flex;justify-content:space-between;align-items:flex-start}.action-console h2{margin:4px 0;color:#583a60;font-size:20px}.action-console>header em{padding:4px 8px;border-radius:9px;background:#eee3f3;color:#765086;font-size:10px;font-style:normal;font-weight:800}.action-note{padding:10px;border-radius:12px;background:#faf5fc;color:#7f6a84;font-size:11px;line-height:1.55}.action-project-create{grid-template-columns:1fr}.action-project-create textarea{min-height:74px}.action-project-create button{justify-self:end}.action-empty{padding:38px 10px;color:#9a849e;text-align:center;font-size:12px}.project-select{box-sizing:border-box;width:100%;margin:4px 0 10px;padding:9px;border:1px solid #e5d9e9;border-radius:12px;background:#fff;color:#604c65}.action-project-detail{display:grid;gap:8px}.action-project-head{display:flex;justify-content:space-between;gap:8px;padding:10px;border-radius:13px;background:#faf5fc}.action-project-head>div{min-width:0}.action-project-head b,.action-project-head small{display:block}.action-project-head b{color:#5c3e63;font-size:13px}.action-project-head small{display:-webkit-box;overflow:hidden;margin-top:4px;color:#8a748e;font-size:10px;line-height:1.4;-webkit-line-clamp:2;-webkit-box-orient:vertical}.action-step{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:start;padding:9px;border:1px solid #eee3f1;border-radius:13px;background:#fff}.action-step>span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#eee5f1;color:#765286;font-size:10px;font-weight:800}.action-step.done>span{background:#dff0da;color:#518257}.action-step>div{min-width:0}.action-step b,.action-step small{display:block}.action-step b{color:#624c67;font-size:12px}.action-step small{margin-top:3px;color:#8d7a90;font-size:10px;line-height:1.45}.action-step button{padding:5px 7px;font-size:10px}.action-step>em{color:#9b879e;font-size:10px;font-style:normal}.action-step details{margin-top:6px;color:#806888;font-size:10px}.action-step details p{white-space:pre-wrap}.tiny-primary{border-radius:9px!important}.action-project-footer{display:flex;justify-content:flex-end}@media(max-width:1180px){.workspace.action-mode{grid-template-columns:240px minmax(0,1fr)}.action-console{grid-column:1/-1;height:auto;min-height:0;max-height:none}}@media(max-width:800px){.workspace,.workspace.action-mode{grid-template-columns:1fr;padding:15px}.sidebar{display:none}.chat{height:calc(100vh - 100px);min-height:0;max-height:none}.chat header{padding:20px;align-items:flex-start}.chat header>div:first-child h1{font-size:20px}.model-actions{max-width:190px}.chat em{display:none}.messages{padding:15px}.bubble{max-width:92%}.export-tip{margin:0 20px 12px}.action-console{grid-column:auto}.mode-switch button{padding:6px 8px}}
.artifact-launch{display:flex;justify-content:space-between;align-items:center;margin:0 28px 13px;padding:9px 12px;border-radius:14px;background:#fff8f3;color:#8f6652;font-size:12px}.artifact-launch button{border:0;border-radius:11px;background:#c96d42;color:#fff;padding:8px 12px;font-weight:700;cursor:pointer}.artifact-modal{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:18px;background:#4f2a1f66}.artifact-dialog{width:min(520px,100%);padding:24px;border-radius:24px;background:#fffdfa;box-shadow:0 24px 70px #3e160b44}.dialog-head{display:flex;justify-content:space-between;gap:16px}.dialog-head span{color:#b47b62;font-size:11px;font-weight:800;letter-spacing:1px}.dialog-head h2{margin:5px 0 0;color:#5a3527}.artifact-dialog>p{color:#826d62;font-size:13px;line-height:1.6}.artifact-dialog label{display:grid;gap:6px;margin:14px 0;color:#694838;font-size:13px;font-weight:700}.artifact-dialog select,.artifact-dialog input,.artifact-dialog textarea{width:100%;box-sizing:border-box;border:1px solid #ead8cd;border-radius:12px;padding:10px;background:#fff;color:#553a2d;font:inherit}.artifact-dialog textarea{height:72px;resize:vertical}.artifact-dialog small{display:block;color:#9a8175;line-height:1.55}.close,.dialog-actions button:not(.primary){border:0;border-radius:10px;background:#f7ebe4;color:#a05d41;padding:8px 11px;cursor:pointer}.close{height:max-content;font-size:20px;line-height:1}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.dialog-actions .primary:disabled{opacity:.6}@media(max-width:800px){.artifact-launch{margin:0 20px 12px}.artifact-launch span{display:none}}
.model-actions{display:grid;justify-items:end;gap:7px}.artifact-compact{border:0;border-radius:11px;background:#c96d42;color:#fff;padding:8px 11px;font-size:12px;font-weight:700;cursor:pointer}.agent-photo{display:inline-grid;width:38px;height:38px;overflow:hidden;vertical-align:middle;border-radius:13px;background:#eee1f5;color:#745288;font-size:19px}.agent-card{display:flex;align-items:center;gap:10px}.agent-card b,.agent-card small{display:block}.export-tip{display:flex;align-items:flex-start;gap:8px}.export-tip span{flex:1}.export-tip button{flex:none;border:0;background:transparent;color:#aa725a;font-size:19px;line-height:15px;cursor:pointer}
@media(min-width:801px){.workspace{align-items:start}.panel{box-sizing:border-box}.sidebar,.chat{height:clamp(680px,calc(100vh - 80px),900px);min-height:680px;max-height:900px}.sidebar{display:flex;flex-direction:column}.thread-list{flex:1;min-height:0;max-height:none;overflow:auto}}
.trace-toggle{margin-top:8px;border:0;border-radius:10px;padding:6px 9px;background:#f1e9f7;color:#73528a;font-size:11px;font-weight:700;cursor:pointer}.trace-box{margin-top:8px;padding:9px;border-radius:13px;background:#fff8f4;border:1px solid #efded3}.trace-step{display:flex;gap:7px;padding:6px 0;color:#8a6b5c}.trace-step>span{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#eadfd5;color:#a06a51;font-size:11px;font-weight:800}.trace-step.done>span{background:#e6f3e5;color:#53835a}.trace-step.failed>span{background:#fde7e1;color:#b14d39}.trace-step div{min-width:0}.trace-step b,.trace-step small,.trace-step em{display:block}.trace-step b{font-size:11px;color:#704735}.trace-step small{margin-top:2px;font-size:11px;line-height:1.45}.trace-step em{margin-top:2px;color:#8a678f;font-size:10px;font-style:normal}
.learning-markdown{margin:5px 0 2px;color:#5f4437;line-height:1.75;overflow-wrap:anywhere}.learning-markdown :deep(p){margin:6px 0}.learning-markdown :deep(h2),.learning-markdown :deep(h3),.learning-markdown :deep(h4){margin:13px 0 6px;color:#6d3f2c;line-height:1.35}.learning-markdown :deep(h2){font-size:17px}.learning-markdown :deep(h3){font-size:15px}.learning-markdown :deep(h4){font-size:13px}.learning-markdown :deep(strong){color:#8d452d;font-weight:800}.learning-markdown :deep(em){color:#9a6552}.learning-markdown :deep(code){padding:2px 5px;border-radius:5px;background:#efe3db;color:#87503a;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}.learning-markdown :deep(pre){margin:9px 0;padding:11px;overflow:auto;border-radius:12px;background:#3f302b;color:#fff4e8;white-space:pre-wrap;line-height:1.55}.learning-markdown :deep(pre code){padding:0;background:transparent;color:inherit}.learning-markdown :deep(hr){border:0;border-top:1px solid #e8d4c7;margin:12px 0}.learning-markdown :deep(.md-item){display:flex;gap:8px;margin:5px 0}.learning-markdown :deep(.md-item i){display:inline-grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#f2d6c4;color:#9a5135;font-size:11px;font-style:normal;font-weight:800}.learning-markdown :deep(.md-item.ordered i){background:#e9e0f2;color:#72547f}.learning-markdown :deep(.md-space){height:5px}.inline-images{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}.inline-images button{max-width:min(100%,520px);overflow:hidden;border:1px solid #ecd9cd;border-radius:14px;padding:0;background:#fff;cursor:pointer}.inline-images img{display:block;width:100%;max-height:340px;object-fit:contain;background:#fff8f3}.inline-images span{display:block;padding:20px;color:#9b7667;font-size:12px}
.collaboration-entry{width:100%;margin:6px 0 12px;border:1px dashed #e6c9b7;border-radius:13px;padding:9px 10px;background:#fff8f3;color:#9b583c;text-align:left;font-size:12px;font-weight:800;cursor:pointer}.collaboration-entry:hover{background:#fff0e5}.collaboration-entry em{float:right;min-width:17px;padding:1px 4px;border-radius:10px;background:#cf6943;color:#fff;text-align:center;font-size:10px;font-style:normal}.collaboration-panel{color:#694838}.collaboration-panel>p{margin:0 0 14px;color:#8d7568;font-size:12px;line-height:1.65}.collaboration-panel>label{display:grid;gap:6px;margin:12px 0;color:#694838;font-size:13px;font-weight:800}.collaboration-panel select,.collaboration-panel textarea{box-sizing:border-box;width:100%;border:1px solid #ead8cd;border-radius:12px;padding:10px;background:#fffdfa;color:#553a2d;font:inherit}.collaboration-panel textarea{min-height:76px;resize:vertical}.collaboration-panel hr{margin:16px 0;border:0;border-top:1px solid #f0e2d8}.policy-card{display:grid;gap:8px;margin-top:12px;padding:13px;border-radius:15px;background:#fff7f1}.policy-card>b,.candidate-list>b,.delegation-section>b{font-size:13px;color:#704735}.switch-row{display:flex!important;grid-template-columns:1fr auto!important;align-items:center;margin:0!important;font-size:12px!important;font-weight:600!important}.switch-row input{width:16px;height:16px;accent-color:#c96d42}.soft-button,.text-button{border:0;border-radius:10px;padding:7px 9px;background:#f7ebe4;color:#a05d41;font-size:12px;font-weight:700;cursor:pointer}.soft-button:hover,.text-button:hover{background:#f2ded1}.candidate-list,.delegation-section{display:grid;gap:8px;margin-top:15px}.candidate,.delegation{display:flex;align-items:center;gap:9px;padding:10px;border:1px solid #f0dfd4;border-radius:14px;background:#fffdfa}.candidate>div,.delegation>div{min-width:0;flex:1}.candidate b,.candidate small,.delegation b,.delegation small{display:block}.candidate small,.delegation small{margin-top:3px;color:#927b6e;font-size:11px;line-height:1.45}.candidate .avatar-badge{width:34px;height:34px}.delegation{align-items:flex-start}.delegation>span{display:flex;gap:6px;flex:none}.delegation.result{align-items:flex-start}.clickable-delegation{cursor:zoom-in}.clickable-delegation:hover{border-color:#dfbba7;background:#fff8f3}.delegation p{margin:7px 0 0;color:#76594b;font-size:12px;line-height:1.55;white-space:pre-wrap}.small-primary{padding:7px 9px;font-size:12px}.text-button{flex:none;background:transparent;color:#b56a4a}.primary:disabled,.soft-button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:560px){.candidate,.delegation{align-items:flex-start;flex-wrap:wrap}.candidate .soft-button{margin-left:43px}.delegation>span{margin-left:43px}}
.memory-entry{margin-top:-5px}.permission-entry{margin-top:-5px}.supervisor-actions{display:grid;gap:6px;margin-top:9px;padding:9px;border:1px dashed #dbbda9;border-radius:13px;background:#fff8f3}.supervisor-actions>span{font-size:11px;font-weight:800;color:#95644d}.supervisor-actions button{border:0;border-radius:10px;padding:7px 9px;background:#f3e3d8;color:#955036;text-align:left;font-size:12px;font-weight:700;cursor:pointer}.supervisor-actions button:hover{background:#eed4c5}.supervisor-actions button:disabled{opacity:.62;cursor:default}.supervisor-actions small{color:#9b7a69;font-size:11px;line-height:1.45}.memory-panel,.permission-panel{display:grid;gap:10px;color:#694838}.memory-panel>p,.permission-panel>p{margin:0;padding:10px 12px;border-radius:13px;background:#fff7f1;color:#8d7568;font-size:12px;line-height:1.65}.memory-empty{padding:25px 12px;color:#987d6e;text-align:center;font-size:13px}.memory-item{display:flex;align-items:flex-start;gap:10px;padding:11px;border:1px solid #f0dfd4;border-radius:15px;background:#fffdfa}.memory-item>div{display:grid;gap:4px;min-width:0;flex:1}.memory-item span{width:max-content;padding:2px 7px;border-radius:10px;background:#f4e5d8;color:#9a5d43;font-size:10px;font-weight:800}.memory-item.saved span{background:#e6f2e4;color:#4f8056}.memory-item.hidden{opacity:.7}.memory-item.hidden span{background:#eee8e3;color:#867569}.memory-item b{color:#704735;font-size:13px}.memory-item small{color:#856f63;font-size:12px;line-height:1.55;white-space:pre-wrap}.memory-item em{color:#ae9081;font-size:10px;font-style:normal}.memory-item aside{display:flex;flex:none;gap:5px}.permission-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px;border:1px solid #f0dfd4;border-radius:14px;background:#fffdfa}.permission-row span{display:grid;gap:4px;min-width:0}.permission-row b{font-size:13px;color:#704735}.permission-row small{color:#8d7568;font-size:11px;line-height:1.5}
.project-entry{margin-top:-4px}.project-panel{display:grid;gap:13px;color:#694838}.project-panel>p{margin:0;padding:10px 12px;border-radius:13px;background:#fff7f1;color:#8d7568;font-size:12px;line-height:1.65}.project-create{display:grid;grid-template-columns:1fr auto;gap:9px}.project-create textarea{box-sizing:border-box;min-height:76px;width:100%;resize:vertical;border:1px solid #ead8cd;border-radius:14px;padding:11px;background:#fffdfa;color:#553a2d;font:inherit}.project-create .primary{align-self:end}.project-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;max-height:205px;overflow:auto;padding-right:2px}.project-card{display:grid;gap:5px;min-height:92px;padding:11px;border:1px solid #f0dfd4;border-radius:15px;background:#fffdfa;cursor:pointer}.project-card:hover,.project-card.selected{border-color:#d99a7d;background:#fff6ef}.project-card-head{display:flex;justify-content:space-between;gap:8px}.project-card-head span{padding:2px 7px;border-radius:9px;background:#f7e5da;color:#a25b3d;font-size:10px;font-weight:800}.project-card b{overflow:hidden;color:#704735;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.project-card small{display:-webkit-box;overflow:hidden;color:#8d7568;font-size:11px;line-height:1.45;-webkit-line-clamp:2;-webkit-box-orient:vertical}.project-card-head small{color:#a48879;white-space:nowrap}.project-detail{display:grid;gap:9px;max-height:55vh;overflow:auto;padding:14px;border:1px solid #ead8cd;border-radius:18px;background:#fffcf9}.project-detail>header{display:flex;justify-content:space-between;gap:12px}.project-detail>header span{color:#a68779;font-size:10px;font-weight:800;letter-spacing:1px}.project-detail>header h3{margin:4px 0;color:#5a3527;font-size:19px}.project-detail>header small{display:block;max-width:630px;color:#8d7568;font-size:11px;line-height:1.55}.project-detail>header aside{display:flex;align-items:flex-start;gap:5px;white-space:nowrap}.project-step{display:flex;gap:10px;align-items:flex-start;padding:11px;border:1px solid #f0dfd4;border-radius:15px;background:#fffdfa}.project-step.done{background:#f5fbf3;border-color:#d8ead4}.step-index{display:grid;place-items:center;flex:0 0 25px;width:25px;height:25px;border-radius:50%;background:#f0ded1;color:#a45b3d;font-size:12px;font-weight:800}.project-step.done .step-index{background:#dff0da;color:#518257}.step-main{display:grid;gap:4px;min-width:0;flex:1}.step-main b{color:#704735;font-size:13px}.step-main small,.step-main p{margin:0;color:#876f62;font-size:11px;line-height:1.55}.step-main p{padding:6px 8px;border-radius:9px;background:#fff6ef;color:#9a654d}.step-actions{display:grid;justify-items:end;gap:6px;flex:0 0 auto}.step-actions>span{padding:3px 7px;border-radius:9px;background:#f6e7dc;color:#a05b40;font-size:10px;font-weight:800;white-space:nowrap}.project-step.done .step-actions>span{background:#dff0da;color:#518257}.forum-draft{margin-top:4px;padding:8px 9px;border-radius:10px;background:#fff7f1;color:#76594b;font-size:12px}.forum-draft summary{cursor:pointer;color:#9b583c;font-weight:800}.forum-draft h4{margin:9px 0 5px;font-size:13px}.forum-draft p{margin:0 0 7px;padding:0;background:transparent;white-space:pre-wrap}.forum-draft small{display:block}@media(max-width:640px){.project-create{grid-template-columns:1fr}.project-create .primary{justify-self:end}.project-detail>header,.project-step{flex-direction:column}.project-detail>header aside,.step-actions{align-self:stretch;justify-items:start}.project-detail{max-height:60vh}.project-list{grid-template-columns:1fr}.step-actions{display:flex;align-items:center;flex-wrap:wrap}}
</style>
