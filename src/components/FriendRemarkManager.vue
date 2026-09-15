<template>
  <div class="friend-remark-manager">
    <button class="remark-trigger" type="button" :disabled="!friends.length" @click="openDialog">✎ 好友备注</button>
    <el-dialog v-model="visible" title="设置好友备注" width="min(430px, 92vw)">
      <div class="remark-dialog">
        <p>备注仅对你可见，会同步显示在好友列表和与该好友的私聊会话中。</p>
        <el-select v-model="selectedId" placeholder="选择好友" style="width:100%" @change="syncDraft">
          <el-option v-for="friend in friends" :key="friend.id" :label="friend.remark ? `${friend.remark}（${friend.real_name || friend.name}）` : friend.name" :value="friend.id" />
        </el-select>
        <template v-if="selectedFriend">
          <div class="friend-preview"><AvatarBadge :value="selectedFriend.avatar" :alt="selectedFriend.real_name || selectedFriend.name" /><span><b>{{ selectedFriend.real_name || selectedFriend.name }}</b><small>{{ selectedFriend.college }}</small></span></div>
          <el-input v-model="draft" maxlength="30" show-word-limit placeholder="如：高数搭子、数据结构组长" />
          <div class="remark-hint">留空后保存即可恢复显示好友原名称。</div>
        </template>
      </div>
      <template #footer><button class="soft" type="button" @click="visible = false">取消</button><button class="primary" type="button" :disabled="saving || !selectedFriend" @click="save">{{ saving ? '保存中…' : '保存备注' }}</button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AvatarBadge from './AvatarBadge.vue'
import { api } from '../utils/api'

const props = defineProps({ friends: { type: Array, default: () => [] } })
const emit = defineEmits(['updated'])
const visible = ref(false), selectedId = ref(null), draft = ref(''), saving = ref(false)
const selectedFriend = computed(() => props.friends.find(friend => Number(friend.id) === Number(selectedId.value)) || null)

function syncDraft () {
  draft.value = selectedFriend.value?.remark || ''
}
function openDialog () {
  if (!selectedFriend.value && props.friends.length) selectedId.value = props.friends[0].id
  syncDraft()
  visible.value = true
}
async function save () {
  if (!selectedFriend.value) return
  saving.value = true
  try {
    const data = await api(`/friends/${selectedFriend.value.id}/remark`, { method: 'PUT', body: JSON.stringify({ remark: draft.value.trim() }) })
    ElMessage.success(data.message || '好友备注已保存')
    visible.value = false
    emit('updated')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    saving.value = false
  }
}

watch(() => props.friends, () => {
  if (selectedId.value && !props.friends.some(friend => Number(friend.id) === Number(selectedId.value))) selectedId.value = null
}, { deep: true })
</script>

<style scoped>
.friend-remark-manager{margin:16px 2px 2px;padding-top:12px;border-top:1px dashed #ecdacf}.remark-trigger{width:100%;border:1px dashed #ebcdbd;border-radius:11px;background:#fff9f4;color:#a55a3c;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer}.remark-trigger:hover{background:#fff0e5}.remark-trigger:disabled{opacity:.55;cursor:not-allowed}.remark-dialog{display:grid;gap:13px}.remark-dialog>p{margin:0;padding:10px 12px;border-radius:12px;background:#fff6ef;color:#8f6a59;font-size:12px;line-height:1.65}.friend-preview{display:flex;align-items:center;gap:9px;padding:10px;border-radius:13px;background:#fff8f3}.friend-preview :deep(.avatar-badge){width:36px;height:36px;border-radius:11px;overflow:hidden}.friend-preview span{display:grid;gap:2px}.friend-preview b{font-size:13px;color:#774735}.friend-preview small{font-size:11px;color:#9f7f70}.remark-hint{font-size:11px;color:#a38576}.primary,.soft{border:0;border-radius:10px;padding:9px 13px;font-weight:700;cursor:pointer}.primary{background:#c96d42;color:#fff}.soft{background:#fff0e4;color:#ad5938;margin-right:8px}.primary:disabled{opacity:.6;cursor:not-allowed}
</style>
