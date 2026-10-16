<template>
  <section class="forum-discussion panel" v-loading="loading">
    <header class="discussion-head">
      <div>
        <span class="eyebrow">DISCUSSION</span>
        <h2>{{ comments.length }} 条讨论</h2>
      </div>
      <span>支持回复一级评论</span>
    </header>

    <div class="discussion-scroll">
      <template v-for="comment in rootComments" :key="comment.id">
        <article class="discussion-comment">
          <div class="comment-avatar"><AvatarBadge :value="comment.author_avatar" :fallback="comment.author_name?.slice(0, 1) || '🌿'" :alt="comment.author_name" /></div>
          <div class="comment-body">
            <div class="comment-meta"><b>{{ comment.author_name }}</b><time>{{ formatTime(comment.created_at) }}</time><button v-if="canDelete(comment.author_id)" class="delete-button" type="button" @click="removeComment(comment)">删除</button></div>
            <p>{{ comment.content }}</p>
            <button class="reply-button" type="button" @click="startReply(comment)">↩ 回复</button>
            <div v-if="replyTarget?.id === comment.id" class="reply-editor">
              <div><b>回复 @{{ comment.author_name }}</b><button type="button" @click="cancelReply">取消</button></div>
              <el-input v-model="replyInput" type="textarea" :rows="2" maxlength="2000" show-word-limit :placeholder="`回复 ${comment.author_name} 的学习想法…`" />
              <button class="primary reply-submit" type="button" :disabled="replying || !replyInput.trim()" @click="sendReply">{{ replying ? '发布中…' : '发布回复' }}</button>
            </div>
          </div>
        </article>

        <article v-for="reply in repliesFor(comment.id)" :key="reply.id" class="discussion-comment reply-comment">
          <div class="comment-avatar"><AvatarBadge :value="reply.author_avatar" :fallback="reply.author_name?.slice(0, 1) || '🌿'" :alt="reply.author_name" /></div>
          <div class="comment-body">
            <div class="comment-meta"><b>{{ reply.author_name }}</b><time>{{ formatTime(reply.created_at) }}</time><button v-if="canDelete(reply.author_id)" class="delete-button" type="button" @click="removeComment(reply)">删除</button></div>
            <div class="reply-reference">回复 <b>@{{ reply.parent_author_name || comment.author_name }}</b></div>
            <p>{{ reply.content }}</p>
          </div>
        </article>
      </template>
      <div v-if="!loading && !comments.length" class="empty">暂时还没有评论，来留下第一条学习想法吧。</div>
    </div>

    <div class="new-comment">
      <label>发表一条评论</label>
      <el-input v-model="commentInput" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="分享你的学习想法；内容会自动进行敏感词审核。" />
      <div class="new-comment-footer"><span>文明讨论，让每一条建议都真正有帮助。</span><button class="primary" type="button" :disabled="sending || !commentInput.trim()" @click="sendComment">{{ sending ? '发布中…' : '发表评论' }}</button></div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AvatarBadge from './AvatarBadge.vue'
import { api, post } from '../utils/api'

const props = defineProps({ postId: { type: [String, Number], required: true } })
const emit = defineEmits(['changed'])
const comments = ref([]), loading = ref(false), sending = ref(false), replying = ref(false)
const commentInput = ref(''), replyInput = ref(''), replyTarget = ref(null)
const me = JSON.parse(localStorage.getItem('user') || '{}')
const commentIds = computed(() => new Set(comments.value.map(comment => Number(comment.id))))
const rootComments = computed(() => comments.value.filter(comment => !comment.parent_comment_id || !commentIds.value.has(Number(comment.parent_comment_id))))
const repliesFor = parentId => comments.value.filter(comment => Number(comment.parent_comment_id) === Number(parentId))
const canDelete = authorId => Number(authorId) === Number(me.id) || Boolean(me.is_admin)

const formatTime = value => {
  const text = String(value || '').trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

async function load () {
  loading.value = true
  try {
    comments.value = await api(`/forum/posts/${props.postId}/comments`)
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    loading.value = false
  }
}

function startReply (comment) {
  replyTarget.value = comment
  replyInput.value = ''
}

function cancelReply () {
  replyTarget.value = null
  replyInput.value = ''
}

async function sendComment () {
  const content = commentInput.value.trim()
  if (!content) return
  sending.value = true
  try {
    const data = await post(`/forum/posts/${props.postId}/comments`, { content })
    commentInput.value = ''
    ElMessage.success(data.message || '评论已发布')
    await load()
    emit('changed')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    sending.value = false
  }
}

async function sendReply () {
  const content = replyInput.value.trim()
  if (!replyTarget.value || !content) return
  replying.value = true
  try {
    const data = await post(`/forum/posts/${props.postId}/comments`, { content, parent_comment_id: replyTarget.value.id })
    ElMessage.success(data.message || '回复已发布')
    cancelReply()
    await load()
    emit('changed')
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    replying.value = false
  }
}

async function removeComment (comment) {
  try {
    await ElMessageBox.confirm('删除后无法恢复。若该评论下有回复，回复会保留并显示为独立评论。', '删除评论', { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' })
    await api(`/forum/comments/${comment.id}`, { method: 'DELETE' })
    if (replyTarget.value?.id === comment.id) cancelReply()
    ElMessage.success('评论已删除')
    await load()
    emit('changed')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '删除失败')
  }
}

watch(() => props.postId, () => { cancelReply(); load() })
onMounted(load)
</script>

<style scoped>
.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.forum-discussion{max-width:900px;margin:18px auto 0;padding:23px}.discussion-head{display:flex;justify-content:space-between;align-items:end;padding-bottom:14px;border-bottom:1px solid #f0e1d8}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.discussion-head h2{font-size:20px;color:#633d2c;margin:5px 0 0}.discussion-head>span{font-size:12px;color:#9a7d6e}.discussion-scroll{max-height:490px;overflow-y:auto;padding-right:7px}.discussion-comment{display:flex;gap:10px;padding:15px 3px;border-bottom:1px solid #f3e7df}.comment-avatar{width:34px;height:34px;flex:none;overflow:hidden;border-radius:11px;background:#f8dfce;color:#a95431;display:grid;place-items:center}.comment-body{min-width:0;flex:1}.comment-meta{display:flex;align-items:center;gap:9px}.comment-meta b{font-size:13px;color:#a15738}.comment-meta time{margin-right:auto;font-size:11px;color:#ab8d7f}.comment-body p{white-space:pre-wrap;overflow-wrap:anywhere;color:#785f52;margin:7px 0;line-height:1.65}.delete-button,.reply-button{border:0;background:transparent;color:#b15d3d;font-size:12px;font-weight:700;cursor:pointer;padding:2px 0}.delete-button{color:#ba5541;font-weight:600}.reply-comment{margin-left:43px;padding-left:14px;border-left:2px solid #efd7c8}.reply-reference{font-size:11px;color:#aa806b;margin:5px 0 -1px}.reply-reference b{color:#b35f3f}.reply-editor{margin-top:12px;padding:12px;border:1px solid #f0d9ca;border-radius:14px;background:#fff8f3}.reply-editor>div:first-child{display:flex;align-items:center;gap:5px;font-size:12px;color:#9a705d;margin-bottom:8px}.reply-editor b{color:#a95232}.reply-editor button{margin-left:auto;border:0;background:transparent;color:#9b7e6f;font-size:12px;font-weight:600;cursor:pointer}.primary{border:0;border-radius:13px;background:#c96d42;color:white;padding:10px 15px;font-weight:700;cursor:pointer}.primary:disabled{opacity:.65;cursor:wait}.reply-submit{display:block;margin-top:9px;margin-left:auto!important;background:#c96d42!important;color:#fff!important;padding:8px 12px!important}.new-comment{margin-top:16px;padding-top:16px;border-top:1px solid #f0e1d8}.new-comment>label{display:block;margin-bottom:8px;color:#7c5543;font-size:13px;font-weight:700}.new-comment-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.new-comment-footer span{font-size:11px;color:#a18475}.empty{text-align:center;padding:45px 10px;color:#a08476}@media(max-width:640px){.forum-discussion{margin-top:14px;padding:19px}.discussion-head>span{display:none}.discussion-scroll{max-height:400px}.reply-comment{margin-left:18px;padding-left:10px}.new-comment-footer span{display:none}}
</style>
