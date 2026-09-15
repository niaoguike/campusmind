<template>
  <div class="group-management">
    <button class="group-settings-trigger" type="button" @click="openDialog">⚙ 群设置</button>
    <el-dialog v-model="visible" title="群聊设置" width="min(480px, 92vw)" class="group-management-dialog" :close-on-click-modal="!saving">
      <div class="group-management-content">
        <section class="group-overview">
          <span>STUDY GROUP</span>
          <h3>{{ conversation.title }}</h3>
          <p v-if="isOwner">你是群主，可以修改群名称或解散群聊。</p>
          <p v-else>退出后将不再收到该群消息，个人资料和个人 Agent 记忆不会受影响。</p>
        </section>

        <template v-if="isOwner">
          <section class="setting-card">
            <div><b>修改群名称</b><small>群成员会立即看到新的名称。</small></div>
            <el-input v-model="titleDraft" maxlength="60" show-word-limit placeholder="输入新的群名称" />
            <button class="primary" type="button" :disabled="saving || !titleDraft.trim() || titleDraft.trim() === conversation.title" @click="renameGroup">{{ saving ? '保存中…' : '保存群名称' }}</button>
          </section>

          <section class="danger-card">
            <div><b>解散群聊</b><small>群成员、聊天消息、群任务、群协作记录和群内 Agent 会一并移除，此操作不可恢复。</small></div>
            <el-input v-model="dissolveConfirm" :placeholder="`输入“${conversation.title}”确认解散`" />
            <button class="danger" type="button" :disabled="saving || dissolveConfirm.trim() !== conversation.title" @click="dissolveGroup">解散群聊</button>
          </section>
          <section class="danger-card leave-card">
            <div><b>退出群聊</b><small>请先指定一名仍在群内的成员接任群主，再安全退出；群内消息与任务会保留。</small></div>
            <el-select v-model="successorId" placeholder="选择接任群主" style="width:100%"><el-option v-for="item in ownerSuccessors" :key="item.id" :label="item.name" :value="item.id" /></el-select>
            <button class="danger" type="button" :disabled="saving || !successorId" @click="leaveGroup">移交群主并退出</button>
          </section>
        </template>

        <section v-else class="danger-card leave-card">
          <div><b>退出群聊</b><small>你仍可在个人 Agent 中保留已明确保存的学习成果；退出后不能再查看或参与本群聊天。</small></div>
          <button class="danger" type="button" :disabled="saving" @click="leaveGroup">退出群聊</button>
        </section>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../utils/api'

const props = defineProps({
  conversation: { type: Object, required: true },
  isOwner: { type: Boolean, default: false }
})
const emit = defineEmits(['updated', 'removed'])
const visible = ref(false), saving = ref(false), titleDraft = ref(''), dissolveConfirm = ref(''), successorId = ref(null), groupMembers = ref([])
const currentUserId = Number(JSON.parse(localStorage.getItem('user') || '{}').id || 0)
const ownerSuccessors = computed(() => groupMembers.value.filter(item => Number(item.id) !== currentUserId))

function syncDrafts () {
  titleDraft.value = props.conversation?.title || ''
  dissolveConfirm.value = ''
  successorId.value = null
}
async function openDialog () {
  syncDrafts()
  if (props.isOwner) {
    try { groupMembers.value = await api(`/conversations/${props.conversation.id}/members`) } catch (error) { ElMessage.error(error.message); return }
  }
  visible.value = true
}
async function renameGroup () {
  const title = titleDraft.value.trim()
  if (!title || title === props.conversation.title) return
  saving.value = true
  try {
    const data = await api(`/conversations/${props.conversation.id}/title`, { method: 'PATCH', body: JSON.stringify({ title }) })
    ElMessage.success(data.message || '群名称已修改')
    emit('updated')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    saving.value = false
  }
}
async function leaveGroup () {
  try {
    await ElMessageBox.confirm('退出后你将失去该群的聊天、任务与协作空间访问权。已明确保存到个人记忆的成果不会被删除。', '确认退出群聊', { confirmButtonText: '确认退出', cancelButtonText: '取消', type: 'warning' })
    saving.value = true
    const payload = props.isOwner ? { successor_id: successorId.value } : {}
    const data = await api(`/conversations/${props.conversation.id}/members/me`, { method: 'DELETE', body: JSON.stringify(payload) })
    ElMessage.success(data.message || '已退出群聊')
    visible.value = false
    emit('removed')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '退出失败')
  } finally {
    saving.value = false
  }
}
async function dissolveGroup () {
  try {
    await ElMessageBox.confirm('此操作会永久移除群成员关系、聊天消息、群任务、群协作记录和群内 Agent。确认后无法恢复。', '确认解散群聊', { confirmButtonText: '确认解散', cancelButtonText: '取消', type: 'error' })
    saving.value = true
    const data = await api(`/conversations/${props.conversation.id}`, { method: 'DELETE' })
    ElMessage.success(data.message || '群聊已解散')
    visible.value = false
    emit('removed')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '解散失败')
  } finally {
    saving.value = false
  }
}

watch(() => props.conversation?.id, syncDrafts, { immediate: true })
</script>

<style scoped>
.group-management{display:inline-flex;flex:none}.group-settings-trigger{border:1px solid #edcdbd;background:#fff6ef;color:#9b5437;border-radius:11px;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px #9e4f2d14;white-space:nowrap}.group-settings-trigger:hover{background:#fbe9dc}.group-management-content{display:grid;gap:14px}.group-overview{padding:16px;border-radius:17px;background:linear-gradient(135deg,#fff3e8,#fbe7dc)}.group-overview span{font-size:10px;letter-spacing:1.4px;color:#be7654;font-weight:800}.group-overview h3{margin:7px 0 4px;color:#6b3f2d;font-size:20px}.group-overview p{margin:0;color:#956f5e;font-size:12px;line-height:1.65}.setting-card,.danger-card{padding:15px;border:1px solid #efded3;border-radius:16px;background:#fffdfa;display:grid;gap:11px}.setting-card>div,.danger-card>div{display:grid;gap:4px}.setting-card b,.danger-card b{color:#714432;font-size:14px}.setting-card small,.danger-card small{color:#9b7b6c;font-size:12px;line-height:1.55}.danger-card{border-color:#f1d0ca;background:#fff8f6}.danger-card b{color:#a6473a}.primary,.danger{justify-self:end;border:0;border-radius:11px;padding:9px 13px;color:#fff;font-weight:700;cursor:pointer}.primary{background:#c96d42}.danger{background:#bd5a4b}.primary:disabled,.danger:disabled{opacity:.55;cursor:not-allowed}.leave-card{margin-top:2px}@media(max-width:850px){.group-settings-trigger{padding:7px 8px;font-size:11px}}
</style>
