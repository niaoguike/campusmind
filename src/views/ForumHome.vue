<template>
  <div class="page"><AppNav /><main class="content">
    <header class="title"><div><span class="eyebrow">CAMPUS LEARNING COMMUNITY</span><h1>校园学习论坛 <small v-if="me.is_admin" class="admin-badge">管理员模式</small></h1><p>向同学和老师提问、分享资料与复习方法。帖子与评论会经过基础敏感词审核。</p></div><button class="primary" @click="dialog = true">＋ 发布交流帖</button></header>
    <section class="categories"><button v-for="item in categories" :key="item" :class="{ active: category === item }" @click="category = item">{{ item }}</button></section>
    <section class="posts"><article v-for="post in filtered" :key="post.id" class="post" @click="router.push(`/community/${post.id}`)"><div class="avatar"><AvatarBadge :value="post.author_avatar" :fallback="post.author_name?.slice(0, 1) || '🌿'" :alt="post.author_name" /></div><div class="post-main"><span>{{ post.category }} · {{ post.author_name }}</span><h2>{{ post.title }}</h2><p>{{ post.content }}</p><div v-if="post.poll" class="poll-preview">投票 · {{ post.poll.question }} <b>{{ post.poll.total }} 人参与</b></div><small>◌ {{ post.comment_count }} 条评论</small></div><button v-if="canDelete(post.author_id)" class="delete" @click.stop="removePost(post)">删除</button><span class="arrow">→</span></article><div v-if="!filtered.length" class="empty">这个分区还没有帖子，来分享第一个学习话题吧。</div></section>
  </main>
  <el-dialog v-model="dialog" title="发布交流帖" width="min(540px, 94vw)" :close-on-click-modal="false"><el-form label-position="top"><el-form-item label="分区"><el-select v-model="form.category" style="width:100%"><el-option v-for="item in categories.slice(1)" :key="item" :label="item" :value="item" /></el-select></el-form-item><el-form-item label="标题"><el-input v-model="form.title" maxlength="60" show-word-limit /></el-form-item><el-form-item label="正文"><el-input v-model="form.content" type="textarea" :rows="6" maxlength="5000" show-word-limit /></el-form-item><el-form-item><el-checkbox v-model="withPoll">为这篇帖子添加投票</el-checkbox></el-form-item><template v-if="withPoll"><el-form-item label="投票问题"><el-input v-model="form.poll_question" maxlength="120" placeholder="例如：你认为哪种复习方式最有效？" /></el-form-item><el-form-item v-for="(_, index) in form.poll_options" :key="index" :label="`选项 ${index + 1}`"><div class="option-row"><el-input v-model="form.poll_options[index]" maxlength="80" /><button v-if="form.poll_options.length > 2" class="remove-option" type="button" @click="form.poll_options.splice(index, 1)">删除</button></div></el-form-item><button v-if="form.poll_options.length < 6" class="add-option" type="button" @click="form.poll_options.push('')">＋ 添加选项</button></template></el-form><template #footer><button class="primary" :disabled="publishing" @click="publish">{{ publishing ? '审核并发布中…' : '发布' }}</button></template></el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import AppNav from '../components/AppNav.vue'
import AvatarBadge from '../components/AvatarBadge.vue'
import { api, post } from '../utils/api'

const router = useRouter()
const categories = ['全部', '学习交流', '课程答疑', '资料分享', '项目协作']
const posts = ref([]), category = ref('全部'), dialog = ref(false), publishing = ref(false), withPoll = ref(false)
const form = ref({ category: '学习交流', title: '', content: '', poll_question: '', poll_options: ['', ''] })
const me = JSON.parse(localStorage.getItem('user') || '{}')
const filtered = computed(() => category.value === '全部' ? posts.value : posts.value.filter(post => post.category === category.value))
const canDelete = authorId => Number(authorId) === Number(me.id) || me.is_admin
async function load () { posts.value = await api('/forum/posts') }
async function publish () {
  if (!form.value.title.trim() || !form.value.content.trim()) return ElMessage.warning('请填写标题和正文')
  if (withPoll.value && (!form.value.poll_question.trim() || form.value.poll_options.filter(Boolean).length < 2)) return ElMessage.warning('投票需填写问题和至少两个选项')
  publishing.value = true
  try {
    await post('/forum/posts', { ...form.value, poll_question: withPoll.value ? form.value.poll_question : '', poll_options: withPoll.value ? form.value.poll_options : [] })
    ElMessage.success('帖子已审核并发布'); dialog.value = false; withPoll.value = false; form.value = { category: '学习交流', title: '', content: '', poll_question: '', poll_options: ['', ''] }; await load()
  } catch (error) { ElMessage.error(error.message) } finally { publishing.value = false }
}
async function removePost (postItem) {
  if (!confirm(`确定删除“${postItem.title}”及其评论吗？`)) return
  try { await api(`/forum/posts/${postItem.id}`, { method: 'DELETE' }); ElMessage.success('帖子已删除'); await load() } catch (error) { ElMessage.error(error.message) }
}
onMounted(() => load().catch(error => ElMessage.error(error.message)))
</script>

<style scoped>
.content{max-width:980px;margin:auto;padding:36px 5vw}.title{display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.title h1{color:#623a2b;margin:5px 0;font-size:31px}.admin-badge{vertical-align:middle;background:#6c4c90;color:#fff;border-radius:11px;padding:5px 8px;font-size:11px}.title p{color:#92776a;max-width:670px;line-height:1.6}.primary{border:0;border-radius:13px;background:#c96d42;color:white;padding:11px 15px;font-weight:700;cursor:pointer;white-space:nowrap}.primary:disabled{opacity:.65;cursor:wait}.categories{display:flex;gap:8px;margin:26px 0;overflow:auto}.categories button{border:1px solid #edddd1;background:#fffdfa;color:#936f5e;border-radius:18px;padding:8px 13px;white-space:nowrap;cursor:pointer}.categories .active{background:#fff0e4;color:#aa552f;border-color:#eac0aa}.posts{display:grid;gap:12px}.post,.empty{background:#fffdfa;border:1px solid #f1e2d8;border-radius:20px;box-shadow:0 10px 30px #9f4c2b0d}.post{padding:18px;display:flex;gap:13px;align-items:start;cursor:pointer}.post:hover{transform:translateY(-1px);border-color:#e8c8b6}.avatar{width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:#f8dfce;color:#a95431;font-weight:800}.post-main{flex:1;min-width:0}.post-main span,.post-main small{font-size:12px;color:#a18070}.post-main h2{font-size:18px;color:#684231;margin:5px 0}.post-main p{color:#866c5e;margin:0 0 7px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.poll-preview{font-size:12px;color:#aa5c3b;background:#fff0e5;border-radius:10px;padding:6px 8px;width:max-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:7px}.poll-preview b{margin-left:5px;color:#8e7467}.arrow{color:#bc6944;font-size:21px}.delete{border:0;background:#fff0ed;color:#ba5541;border-radius:9px;padding:6px 9px;font-size:12px;cursor:pointer}.empty{padding:35px;text-align:center;color:#9c8173}.option-row{display:flex;width:100%;gap:8px}.option-row :deep(.el-input){flex:1}.remove-option,.add-option{border:0;background:#fff0e5;color:#ad5f3f;border-radius:10px;padding:7px 10px;cursor:pointer}.add-option{margin-top:-8px}@media(max-width:640px){.content{padding:20px}.title{align-items:start;flex-direction:column}.title h1{font-size:26px}}
.avatar{overflow:hidden}
</style>
