<template>
  <div class="page">
    <AppNav />
    <main class="content">
      <header class="title">
        <div>
          <span class="eyebrow">COURSE RESOURCE HUB</span>
          <h1>课程资料库</h1>
          <p>上传讲义、笔记、题单和课件。文件会自动解析为可供专属 Agent 检索的正文；发布者可删除自己的资料，管理员可管理全部资料。</p>
        </div>
        <button class="primary" @click="dialog = true">＋ 上传资料</button>
      </header>

      <section class="course-tabs">
        <button v-for="course in courses" :key="course.id" :class="{ active: selected === course.id }" @click="selected = course.id; loadResources()">
          <i :style="{ background: course.color }" />
          <b>{{ course.name }}</b>
          <span>{{ course.resource_count }} 份资料</span>
        </button>
      </section>

      <section class="toolbar panel">
        <el-input v-model="query" placeholder="搜索标题、标签或文件名" clearable @input="loadResources" />
        <span>{{ resources.length }} 条结果</span>
      </section>

      <section class="resources">
        <article v-for="resource in resources" :key="resource.id" class="resource-card">
          <div class="file">{{ icon(resource.type) }}</div>
          <div class="resource-main">
            <span>{{ resource.course_name }} · {{ resource.type }} <b v-if="resource.is_pinned" class="pinned">置顶</b></span>
            <h2>{{ resource.title }}</h2>
            <p>{{ resource.description || '发布者暂未填写说明。' }}</p>
            <small>
              {{ resource.file_name ? `文件：${resource.file_name} · ${formatSize(resource.file_size)}` : '外部链接资料' }}<br>
              标签：{{ resource.tags || '未标注' }} · {{ resource.uploader_name || '课程管理员' }}
              <em v-if="resource.file_path" class="index-status" :class="resource.ingestion_status">{{ indexLabel(resource) }}</em>
              <em v-if="resource.ingestion_status === 'failed' && resource.ingestion_error" class="index-error">{{ resource.ingestion_error }}</em>
            </small>
          </div>
          <div class="actions">
            <a v-if="resource.file_path" :href="resource.file_path" target="_blank">打开文件 ↗</a>
            <a v-else-if="resource.url" :href="resource.url" target="_blank">查看链接 ↗</a>
            <button v-if="canReprocess(resource)" class="plain" @click="reprocess(resource)">重新解析</button>
            <button v-if="isAdmin" class="plain" @click="togglePin(resource)">{{ resource.is_pinned ? '取消置顶' : '置顶' }}</button>
            <button v-if="canDelete(resource)" class="delete" @click="remove(resource)">删除</button>
          </div>
        </article>
        <div v-if="!resources.length" class="empty">暂时没有匹配资料。上传第一份课程资料吧。</div>
      </section>
    </main>

    <el-dialog v-model="dialog" title="上传课程资料" width="520px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="所属课程">
          <el-select v-model="form.course_id" style="width:100%"><el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" /></el-select>
        </el-form-item>
        <el-form-item label="资料文件">
          <input ref="fileInput" class="file-input" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg" @change="chooseFile">
          <small class="upload-note">支持 PDF、DOCX、PPTX、Excel、CSV、TXT、PNG、JPG，单个文件不超过 20MB。文字版文件会自动建立 Agent 检索索引；图片和扫描件暂不支持正文识别。</small>
          <p v-if="file" class="selected-file">已选择：{{ file.name }}（{{ formatSize(file.size) }}）</p>
        </el-form-item>
        <el-form-item label="资料标题（不填则使用文件名）"><el-input v-model="form.title" maxlength="100" /></el-form-item>
        <el-form-item label="资料类型">
          <el-select v-model="form.type" style="width:100%">
            <el-option label="讲义 / 笔记" value="note" />
            <el-option label="练习题" value="exercise" />
            <el-option label="课件" value="slide" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="2000" show-word-limit /></el-form-item>
        <el-form-item label="标签（用逗号分隔）"><el-input v-model="form.tags" placeholder="如：链表，栈，期中复习" /></el-form-item>
      </el-form>
      <template #footer><button class="primary" :disabled="uploading" @click="publish">{{ uploading ? '上传中…' : '上传到资料库' }}</button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api } from '../utils/api'

const courses = ref([])
const resources = ref([])
const selected = ref(0)
const query = ref('')
const dialog = ref(false)
const file = ref(null)
const fileInput = ref(null)
const uploading = ref(false)
const form = ref({ course_id: null, title: '', type: 'note', description: '', tags: '' })
const me = computed(() => JSON.parse(localStorage.getItem('user') || '{}'))
const isAdmin = computed(() => Boolean(me.value.is_admin))
const icon = type => ({ note: '▣', exercise: '✦', slide: '▤' }[type] || '▣')
const formatSize = size => size ? `${(size / 1024 / 1024).toFixed(size < 1024 * 1024 ? 1 : 2)} MB` : '—'
const canDelete = resource => Number(resource.uploader_id) === Number(me.value.id) || isAdmin.value
const canReprocess = resource => Boolean(resource.file_path) && canDelete(resource) && resource.ingestion_status !== 'processing'
const indexLabel = resource => ({ ready: `AI 已可检索 · ${resource.chunk_count || 0} 段`, processing: 'AI 正在解析', pending: '等待建立 AI 索引', failed: 'AI 解析失败' }[resource.ingestion_status] || '等待建立 AI 索引')

async function loadResources () {
  resources.value = await api(`/resources?course_id=${selected.value || ''}&query=${encodeURIComponent(query.value)}`)
}
function chooseFile (event) { file.value = event.target.files?.[0] || null }
async function publish () {
  if (!file.value) return ElMessage.warning('请选择要上传的资料文件')
  if (file.value.size > 20 * 1024 * 1024) return ElMessage.error('文件不能超过 20MB')
  if (!form.value.course_id) return ElMessage.warning('请选择所属课程')
  uploading.value = true
  const body = new FormData()
  for (const [key, value] of Object.entries(form.value)) body.append(key, value || '')
  body.append('file', file.value)
  try {
    const data = await api('/resources/upload', { method: 'POST', body })
    ElMessage.success(data.message || '资料文件已上传')
    dialog.value = false
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    form.value = { course_id: selected.value, title: '', type: 'note', description: '', tags: '' }
    await loadResources()
  } catch (error) { ElMessage.error(error.message) } finally { uploading.value = false }
}
async function reprocess (resource) {
  try {
    const data = await api(`/resources/${resource.id}/reprocess`, { method: 'POST' })
    ElMessage.success(data.message)
    await loadResources()
    setTimeout(loadResources, 1800)
  } catch (error) { ElMessage.error(error.message) }
}
async function remove (resource) {
  if (!confirm(`确定删除“${resource.title}”吗？文件和 AI 索引也会从服务器删除。`)) return
  try { await api(`/resources/${resource.id}`, { method: 'DELETE' }); ElMessage.success('资料已删除'); await loadResources() } catch (error) { ElMessage.error(error.message) }
}
async function togglePin (resource) {
  try { const data = await api(`/resources/${resource.id}/pin`, { method: 'PATCH', body: JSON.stringify({ pinned: !resource.is_pinned }) }); ElMessage.success(data.message); await loadResources() } catch (error) { ElMessage.error(error.message) }
}
onMounted(async () => {
  try { courses.value = await api('/courses'); selected.value = courses.value[0]?.id || 0; form.value.course_id = selected.value; await loadResources() } catch (error) { ElMessage.error(error.message) }
})
</script>

<style scoped>
.content{max-width:1120px;margin:auto;padding:36px 5vw}.title{display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.title h1{color:#623a2b;margin:5px 0;font-size:31px}.title p{color:#92776a;max-width:700px}.primary{border:0;border-radius:13px;background:#c96d42;color:#fff;padding:11px 15px;font-weight:700;cursor:pointer;white-space:nowrap}.primary:disabled{opacity:.65;cursor:wait}.course-tabs{display:flex;gap:10px;overflow:auto;margin:28px 0 16px}.course-tabs button{min-width:185px;text-align:left;padding:14px;border:1px solid #efdfd4;border-radius:17px;background:#fffdfa;color:#7e6154;cursor:pointer}.course-tabs button.active{background:#fff0e4;border-color:#e9bca6}.course-tabs i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px}.course-tabs span{display:block;margin:6px 0 0 15px;font-size:12px;color:#a78d80}.panel,.resource-card,.empty{background:#fffdfa;border:1px solid #f1e2d8;border-radius:21px;box-shadow:0 10px 30px #9f4c2b0d}.toolbar{display:flex;align-items:center;gap:16px;padding:11px 15px}.toolbar span{font-size:13px;color:#987d70;white-space:nowrap}.resources{display:grid;gap:12px;margin-top:16px}.resource-card{padding:18px;display:flex;gap:15px;align-items:flex-start}.file{width:44px;height:44px;display:grid;place-items:center;border-radius:15px;background:#fff0e4;color:#b95d38;font-size:22px}.resource-main{flex:1;min-width:0}.resource-main>span,.resource-main small{font-size:12px;color:#a48475}.resource-main h2{font-size:17px;color:#634030;margin:5px 0}.resource-main p{color:#866d61;margin:0 0 7px;line-height:1.5}.pinned{margin-left:6px;background:#f8dfc9;color:#a95331;border-radius:9px;padding:3px 6px;font-size:11px}.index-status,.index-error{display:block;margin-top:6px;font-style:normal}.index-status{color:#a76d37}.index-status.ready{color:#5f8a62}.index-status.failed,.index-error{color:#bd5d4c}.actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end;max-width:150px}.actions a,.plain{color:#af5937;font-size:13px;text-decoration:none;padding:7px;border:0;background:transparent;cursor:pointer}.delete{border:0;background:#fff0ed;color:#ba5541;border-radius:9px;padding:6px 9px;font-size:12px;cursor:pointer}.empty{padding:35px;text-align:center;color:#9c8173}.file-input{width:100%;padding:9px;border:1px dashed #e2bba7;border-radius:12px;box-sizing:border-box;background:#fffaf6}.upload-note{display:block;color:#a48676;line-height:1.6;margin-top:6px}.selected-file{color:#8c593d;margin:8px 0 0;word-break:break-all}@media(max-width:640px){.content{padding:20px}.title h1{font-size:26px}.title{align-items:start;flex-direction:column}.resource-card{padding:14px;gap:10px}.actions{max-width:110px}.resource-main h2{word-break:break-word}}
</style>
