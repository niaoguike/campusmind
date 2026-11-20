<template>
  <div class="folder-page"><AppNav />
    <main class="content" v-if="folder">
      <button class="back" @click="router.push('/course')">← 返回课程资料</button>
      <header class="folder-hero"><div class="folder-icon">📁</div><div><p class="eyebrow">COURSE RESOURCE FOLDER</p><h1>{{ folder.name }}</h1><p>{{ folder.course_name }} · {{ resources.length }} 个资料文件 · 上传者：{{ folder.uploader_name || '课程管理员' }}</p><p v-if="folder.description" class="description">{{ folder.description }}</p><small v-if="folder.tags">标签：{{ folder.tags }}</small></div><button v-if="canManage" class="delete-folder" @click="removeFolder">删除文件夹</button></header>
      <div class="notice">本文件夹中的每一个已解析资料都已加入 Agent 的课程资料检索。你可以按章节路径查找并打开单个文件。</div>
      <section class="file-list"><article v-for="resource in resources" :key="resource.id" class="file-card"><div class="file-icon">{{ icon(resource.type) }}</div><div class="main"><p class="path">{{ resource.relative_path || resource.file_name }}</p><h2>{{ resource.title }}</h2><p>{{ resource.description || '暂无说明' }}</p><small>{{ resource.file_name }} · {{ formatSize(resource.file_size) }} <em :class="resource.ingestion_status">{{ indexLabel(resource) }}</em></small><small v-if="resource.ingestion_status==='failed' && resource.ingestion_error" class="error">{{ resource.ingestion_error }}</small></div><aside><button v-if="resource.file_path" @click="openResource(resource)">打开 / 下载</button><button v-if="canManage && resource.ingestion_status!=='processing'" @click="reprocess(resource)">重新解析</button><button v-if="canManage" class="danger" @click="removeFile(resource)">删除文件</button></aside></article><p v-if="!resources.length" class="empty">这个文件夹暂时没有资料文件。</p></section>
    </main>
    <main v-else class="content loading">正在加载资料文件夹…</main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api, openFile } from '../utils/api'
const route=useRoute(),router=useRouter(),folder=ref(null),resources=ref([])
const me=computed(()=>JSON.parse(localStorage.getItem('user')||'{}'))
const canManage=computed(()=>folder.value&&(Number(folder.value.uploader_id)===Number(me.value.id)||me.value.is_admin))
const icon=type=>({note:'📄',exercise:'✎',slide:'▣'}[type]||'📄')
const formatSize=size=>size?`${(size/1024/1024).toFixed(size<1024*1024?1:2)} MB`:'—'
const indexLabel=resource=>({ready:`AI 已可检索 · ${resource.chunk_count||0} 段`,processing:'AI 正在解析',pending:'等待建立 AI 索引',failed:'AI 解析失败'}[resource.ingestion_status]||'等待建立 AI 索引')
async function load(){try{const data=await api(`/resource-folders/${route.params.id}`);folder.value=data.folder;resources.value=data.resources}catch(error){ElMessage.error(error.message);router.replace('/course')}}
async function openResource(resource){try{await openFile(resource.file_path)}catch(error){ElMessage.error(error.message)}}
async function reprocess(resource){try{const data=await api(`/resources/${resource.id}/reprocess`,{method:'POST'});ElMessage.success(data.message);await load();setTimeout(load,1800)}catch(error){ElMessage.error(error.message)}}
async function removeFile(resource){if(!window.confirm(`确定删除“${resource.title}”吗？`))return;try{const data=await api(`/resources/${resource.id}`,{method:'DELETE'});ElMessage.success(data.message);await load()}catch(error){ElMessage.error(error.message)}}
async function removeFolder(){if(!window.confirm(`确定删除文件夹“${folder.value.name}”及其全部 ${resources.value.length} 个文件吗？此操作无法恢复。`))return;try{const data=await api(`/resource-folders/${folder.value.id}`,{method:'DELETE'});ElMessage.success(data.message);router.replace('/course')}catch(error){ElMessage.error(error.message)}}
onMounted(load)
</script>

<style scoped>
.folder-page{min-height:100vh;background:#fffaf6}.content{max-width:1060px;margin:auto;padding:34px 5vw 80px}.back{border:0;background:transparent;color:#a95a38;font-weight:800;padding:7px 0;cursor:pointer}.folder-hero{display:flex;align-items:flex-start;gap:17px;padding:25px;margin:12px 0 16px;border:1px solid #efd9cb;border-radius:23px;background:#fffdfb;box-shadow:0 10px 28px #96503012}.folder-icon,.file-icon{display:grid;place-items:center;background:#fde5d4;color:#b45d3b;border-radius:17px;font-size:30px;flex:0 0 auto}.folder-icon{width:66px;height:66px}.eyebrow{margin:0;color:#bd7558;font-size:11px;font-weight:800;letter-spacing:1.3px}.folder-hero h1{margin:5px 0;color:#633e2e;font-size:29px}.folder-hero p{margin:5px 0;color:#8e7162;line-height:1.55}.folder-hero small{color:#a28272}.description{white-space:pre-wrap}.delete-folder{margin-left:auto;border:0;border-radius:12px;background:#fff0ed;color:#b34f3a;padding:10px 13px;font-weight:800;cursor:pointer}.notice{padding:13px 15px;border-radius:15px;background:#fff0e4;color:#915d43;font-size:13px;line-height:1.6}.file-list{display:grid;gap:12px;margin-top:16px}.file-card{display:flex;align-items:flex-start;gap:14px;padding:17px;border-radius:19px;background:#fffdfb;border:1px solid #f0dfd5}.file-icon{width:45px;height:45px;font-size:21px}.main{flex:1;min-width:0}.path{margin:0;color:#ad6748;font-size:12px;word-break:break-all}.main h2{margin:5px 0;color:#674131;font-size:17px}.main>p:not(.path){margin:0 0 7px;color:#8f7465;line-height:1.5}.main small{display:block;color:#a28575;font-size:12px}.main em{font-style:normal;margin-left:7px;color:#a76d37}.main em.ready{color:#5f8a62}.main em.failed,.error{color:#bb5747!important;margin-top:5px}aside{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:150px}aside a,aside button{border:0;background:transparent;color:#af5b39;padding:7px;font-size:13px;cursor:pointer;text-decoration:none}aside .danger{background:#fff0ed;color:#b85541;border-radius:9px}.empty,.loading{text-align:center;color:#a28678;padding:38px}@media(max-width:650px){.folder-hero,.file-card{flex-wrap:wrap;padding:17px}.delete-folder{margin-left:0}.file-card aside{max-width:none;width:100%;justify-content:flex-start}}
</style>
