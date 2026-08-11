<template>
  <div class="page">
    <AppNav />
    <main class="wrap">
      <section class="chat panel">
        <header>
          <button class="back" type="button" @click="router.push('/home')">← 返回我的 Agent</button>
          <div class="agent-avatar"><AvatarBadge :value="delegation.owner_agent_avatar || '✦'" :alt="delegation.owner_agent_name || '学习伙伴 Agent'" /></div>
          <div class="title"><span class="eyebrow">PEER AGENT COLLABORATION</span><h1>{{ delegation.owner_agent_name || '学习伙伴 Agent' }}</h1><p>{{ delegation.course_name || '同课程' }} · 已授权协作过程</p></div>
          <em :class="delegation.status">{{ statusLabel(delegation.status) }}</em>
        </header>
        <p class="notice">此处只展示本次经授权的 Agent 协作消息。你可以继续追问；调用将使用发起者自己的模型配置，且不会读取对方私聊、课表或完整学习记录。</p>
        <div ref="box" class="messages">
          <div v-if="!messages.length" class="empty">协作记录加载中…</div>
          <article v-for="message in messages" :key="message.id" :class="message.role">
            <span>{{ senderLabel(message.role) }}</span>
            <div class="learning-markdown" v-html="renderLearningMarkdown(message.content)"></div>
            <time>{{ formatTime(message.created_at) }}</time>
          </article>
          <article v-if="loading" class="synthesis"><span>协作协调器</span><p>正在向学习伙伴 Agent 发起追问并整合建议…</p></article>
        </div>
        <form v-if="canContinue" @submit.prevent="send">
          <textarea v-model="input" :disabled="loading" placeholder="继续追问，例如：请把这个三天计划拆成每天上午、下午和晚上的任务。" @keydown.enter.exact.prevent="send" />
          <button class="primary" :disabled="loading || !input.trim()">{{ loading ? '协作中…' : '继续协作' }}</button>
        </form>
        <p v-else class="closed">{{ delegation.is_requester ? '本次协作尚未完成或已撤回，暂不能继续追问。' : '你可以查看自己的 Agent 已授权完成的协作过程。' }}</p>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import AvatarBadge from '../components/AvatarBadge.vue'
import { api, post } from '../utils/api'
import { renderLearningMarkdown } from '../utils/learningMarkdown'

const route = useRoute(), router = useRouter(), delegation = ref({}), messages = ref([]), input = ref(''), loading = ref(false), box = ref(null)
const canContinue = computed(() => delegation.value.is_requester && delegation.value.status === 'completed')
const statusLabel = status => ({ pending: '等待授权', processing: '协作中', completed: '已完成', rejected: '已拒绝', revoked: '已撤回', failed: '失败' }[status] || status || '')
const senderLabel = role => ({ requester: '我', peer: `${delegation.value.owner_agent_name || '学习伙伴 Agent'} · 同课程建议`, synthesis: `${delegation.value.requester_agent_name || '我的 Agent'} · 整合建议` }[role] || '协作消息')
const formatTime = value => {
  if (!value) return ''
  const text = String(value).trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
const scroll = () => nextTick(() => { if (box.value) box.value.scrollTop = box.value.scrollHeight })
async function load () {
  const data = await api(`/agent/collaboration/delegations/${route.params.id}/messages`)
  delegation.value = data.delegation
  messages.value = data.messages
  scroll()
}
async function send () {
  const content = input.value.trim()
  if (!content || loading.value) return
  loading.value = true
  input.value = ''
  messages.value.push({ id: `local-${Date.now()}`, role: 'requester', content, created_at: new Date().toISOString() })
  scroll()
  try {
    const data = await post(`/agent/collaboration/delegations/${route.params.id}/messages`, { content })
    messages.value = data.messages
  } catch (error) {
    messages.value.pop()
    ElMessage.error(error.message)
  } finally {
    loading.value = false
    scroll()
  }
}
onMounted(() => load().catch(error => { ElMessage.error(error.message); router.push('/home') }))
</script>

<style scoped>
.wrap{max-width:1000px;margin:auto;padding:32px 5vw}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.chat{height:calc(100vh - 138px);min-height:570px;max-height:790px;display:flex;flex-direction:column;overflow:hidden}.chat header{display:flex;align-items:center;gap:12px;padding:20px 25px}.back{border:0;border-radius:11px;padding:8px 10px;background:#fff0e4;color:#a95638;font-weight:700;cursor:pointer}.agent-avatar{width:44px;height:44px;overflow:hidden;border-radius:14px;background:#eee1f5;display:grid;place-items:center}.title{min-width:0;flex:1}.eyebrow{font-size:11px;letter-spacing:1px;color:#ad8b7a;font-weight:800}.chat h1{margin:3px 0;color:#633c2c;font-size:22px}.chat header p{margin:0;color:#9c7c6e;font-size:13px}.chat header em{padding:5px 8px;border-radius:9px;background:#f7eae1;color:#966048;font-size:11px;font-style:normal;font-weight:800}.chat header em.completed{background:#e6f3e5;color:#53835a}.chat header em.processing{background:#fff0d8;color:#9b692c}.notice{margin:0;padding:10px 25px;background:#fff5e9;color:#8e6d5a;font-size:12px;line-height:1.55}.messages{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:20px 28px;background:#fffcf9}.messages article{max-width:80%;margin:13px 0;padding:11px 14px;border-radius:16px;background:#f3eaf8;color:#5e496b}.messages article.requester{margin-left:auto;background:#c96d42;color:#fff}.messages article.synthesis{background:#f8eee5;color:#684839}.messages span{font-size:11px;font-weight:800}.messages time{display:block;margin-top:5px;color:#aa8d7e;font-size:10px}.messages article.requester time{color:#ffe0cc;text-align:right}.learning-markdown{margin-top:4px;line-height:1.7;overflow-wrap:anywhere}.learning-markdown :deep(p){margin:5px 0}.learning-markdown :deep(h2),.learning-markdown :deep(h3),.learning-markdown :deep(h4){margin:10px 0 5px;color:#6d3f2c}.learning-markdown :deep(h2){font-size:16px}.learning-markdown :deep(h3){font-size:14px}.learning-markdown :deep(h4){font-size:13px}.learning-markdown :deep(strong){font-weight:800}.learning-markdown :deep(code){padding:2px 5px;border-radius:5px;background:#eadfd6;font-family:ui-monospace,Consolas,monospace}.learning-markdown :deep(pre){overflow:auto;padding:10px;border-radius:10px;background:#3f302b;color:#fff4e8;white-space:pre-wrap}.learning-markdown :deep(.md-item){display:flex;gap:8px;margin:5px 0}.learning-markdown :deep(.md-item i){display:inline-grid;place-items:center;flex:0 0 18px;width:18px;height:18px;border-radius:50%;background:#ead4c5;color:#93513a;font-style:normal;font-size:11px}.learning-markdown :deep(.md-space){height:4px}.chat form{display:flex;gap:10px;padding:15px 22px}.chat textarea{flex:1;min-height:46px;max-height:100px;resize:vertical;border:1px solid #ead8cd;border-radius:15px;padding:10px;font:inherit}.primary{align-self:end;border:0;border-radius:13px;padding:11px 15px;background:#c96d42;color:#fff;font-weight:700;cursor:pointer}.closed{margin:0;padding:14px 22px;color:#9a7a6a;background:#fff7f1;font-size:12px}.empty{text-align:center;margin:100px 0;color:#a08475}@media(max-width:650px){.wrap{padding:15px}.chat{height:calc(100vh - 104px);min-height:0;max-height:none}.chat header{padding:16px;gap:8px}.back{font-size:0;padding:10px}.back::after{content:'←';font-size:17px}.messages{padding:15px}.messages article{max-width:93%}.chat form{padding:12px}.chat header em{display:none}}
</style>
