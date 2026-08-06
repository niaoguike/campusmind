<template>
  <div class="page"><AppNav /><main class="detail-page" v-loading="loading">
    <button class="back" @click="router.push('/community')">← 返回论坛</button>
    <template v-if="post">
      <article class="post-detail panel"><header><div class="avatar"><AvatarBadge :value="post.author_avatar" :fallback="post.author_name?.slice(0, 1) || '🌿'" :alt="post.author_name" /></div><div><span>{{ post.category }} · {{ post.author_name }}</span><h1>{{ post.title }}</h1></div><button v-if="canDelete(post.author_id)" class="delete" @click="removePost">删除帖子</button></header><div class="post-content">{{ post.content }}</div>
        <section v-if="post.poll" class="poll-box"><span class="eyebrow">COMMUNITY POLL</span><h2>{{ post.poll.question }}</h2><el-radio-group v-model="selectedVote" class="vote-options"><el-radio v-for="(option, index) in post.poll.options" :key="index" :value="index"><span>{{ option }}</span><small>{{ post.poll.counts[index] }} 票</small></el-radio></el-radio-group><button class="primary" :disabled="voting || selectedVote === null" @click="vote">{{ voting ? '提交中…' : post.poll.my_vote === null ? '参与投票' : '更新我的投票' }}</button><p>{{ post.poll.total }} 人已参与</p></section>
      </article>
      <section class="comments panel"><header><div><span class="eyebrow">DISCUSSION</span><h2>{{ comments.length }} 条评论</h2></div><span>可滚动浏览全部讨论</span></header><div class="comment-scroll"><article v-for="comment in comments" :key="comment.id" class="comment"><div class="comment-avatar"><AvatarBadge :value="comment.author_avatar" :fallback="comment.author_name?.slice(0, 1) || '🌿'" :alt="comment.author_name" /></div><div class="comment-main"><div class="comment-head"><b>{{ comment.author_name }}</b><button v-if="canDelete(comment.author_id)" class="delete" @click="removeComment(comment)">删除</button></div><p>{{ comment.content }}</p></div></article><div v-if="!comments.length" class="no-comment">暂时还没有评论，来留下第一条学习想法吧。</div></div><div class="comment-form"><el-input v-model="commentInput" type="textarea" :rows="3" maxlength="2000" show-word-limit placeholder="发表你的学习想法；内容会自动进行敏感词审核。" /><button class="primary" :disabled="sending || !commentInput.trim()" @click="sendComment">{{ sending ? '发布中…' : '发表评论' }}</button></div></section>
    </template>
  </main></div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import AppNav from '../components/AppNav.vue'
import AvatarBadge from '../components/AvatarBadge.vue'
import { api, post as postApi } from '../utils/api'

const route = useRoute(), router = useRouter()
const postItem = ref(null), comments = ref([]), loading = ref(true), voting = ref(false), sending = ref(false), selectedVote = ref(null), commentInput = ref('')
const me = JSON.parse(localStorage.getItem('user') || '{}')
const post = postItem
const canDelete = authorId => Number(authorId) === Number(me.id) || me.is_admin
async function load () {
  loading.value = true
  try { const data = await api(`/forum/posts/${route.params.id}`); postItem.value = data.post; comments.value = data.comments; selectedVote.value = data.post.poll?.my_vote ?? null } catch (error) { ElMessage.error(error.message); router.replace('/community') } finally { loading.value = false }
}
async function vote () {
  voting.value = true
  try { const data = await postApi(`/forum/posts/${postItem.value.id}/vote`, { option_index: selectedVote.value }); postItem.value = { ...postItem.value, poll: data.poll }; selectedVote.value = data.poll.my_vote; ElMessage.success(data.message) } catch (error) { ElMessage.error(error.message) } finally { voting.value = false }
}
async function sendComment () {
  if (!commentInput.value.trim()) return
  sending.value = true
  try { await postApi(`/forum/posts/${postItem.value.id}/comments`, { content: commentInput.value }); commentInput.value = ''; ElMessage.success('评论已发布'); await load() } catch (error) { ElMessage.error(error.message) } finally { sending.value = false }
}
async function removeComment (comment) {
  if (!confirm('确定删除这条评论吗？')) return
  try { await api(`/forum/comments/${comment.id}`, { method: 'DELETE' }); await load(); ElMessage.success('评论已删除') } catch (error) { ElMessage.error(error.message) }
}
async function removePost () {
  if (!confirm(`确定删除“${postItem.value.title}”及其全部评论吗？`)) return
  try { await api(`/forum/posts/${postItem.value.id}`, { method: 'DELETE' }); ElMessage.success('帖子已删除'); router.replace('/community') } catch (error) { ElMessage.error(error.message) }
}
onMounted(load)
</script>

<style scoped>
.detail-page{max-width:900px;margin:auto;padding:26px 5vw 50px}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.back{border:0;background:transparent;color:#aa5a3a;font-weight:700;cursor:pointer;padding:0 0 15px}.post-detail{padding:28px}.post-detail header{display:flex;align-items:flex-start;gap:12px}.avatar{width:43px;height:43px;flex:none;display:grid;place-items:center;border-radius:14px;background:#f8dfce;color:#a95431;font-weight:800}.post-detail header>div:nth-child(2){flex:1}.post-detail header span{font-size:12px;color:#a18070}.post-detail h1{font-size:28px;color:#613d2d;margin:5px 0}.delete{border:0;background:#fff0ed;color:#ba5541;border-radius:9px;padding:6px 9px;font-size:12px;cursor:pointer}.post-content{white-space:pre-wrap;color:#77594b;line-height:1.85;margin:24px 0;font-size:15px}.poll-box{padding:19px;border:1px solid #efd8c9;background:#fff5ee;border-radius:20px}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.poll-box h2{font-size:18px;color:#6b4331;margin:7px 0 15px}.vote-options{display:grid;gap:9px;margin-bottom:15px}.vote-options :deep(.el-radio){height:auto;min-height:32px;margin-right:0;display:flex;align-items:center}.vote-options small{margin-left:8px;color:#a08273}.poll-box p{font-size:12px;color:#9a7a6a;margin:10px 0 0}.primary{border:0;border-radius:13px;background:#c96d42;color:white;padding:10px 15px;font-weight:700;cursor:pointer}.primary:disabled{opacity:.65;cursor:wait}.comments{margin-top:18px;padding:23px}.comments header{display:flex;justify-content:space-between;align-items:end;padding-bottom:13px;border-bottom:1px solid #f0e1d8}.comments h2{font-size:20px;color:#633d2c;margin:5px 0 0}.comments header>span{font-size:12px;color:#9a7d6e}.comment-scroll{max-height:430px;overflow-y:auto;padding-right:7px}.comment{padding:15px 3px;border-bottom:1px solid #f3e7df}.comment-head{display:flex;justify-content:space-between;align-items:center}.comment b{font-size:13px;color:#a15738}.comment p{white-space:pre-wrap;color:#785f52;margin:7px 0;line-height:1.65}.no-comment{text-align:center;padding:45px 10px;color:#a08476}.comment-form{padding-top:16px}.comment-form .primary{margin-top:10px;float:right}@media(max-width:640px){.detail-page{padding:19px 4vw}.post-detail,.comments{padding:19px}.post-detail h1{font-size:23px}.comments header>span{display:none}.comment-scroll{max-height:360px}}
.avatar,.comment-avatar{overflow:hidden}.comment{display:flex;gap:10px}.comment-main{min-width:0;flex:1}.comment-avatar{width:32px;height:32px;flex:none;border-radius:11px;background:#f8dfce;color:#a95431;display:grid;place-items:center}
</style>
