<template>
  <header class="app-nav">
    <router-link :to="user.role==='teacher'?'/teacher':'/dashboard'" class="brand"><span>◒</span> CampusMind</router-link>
    <nav>
      <router-link v-for="item in visibleLinks" :key="item.to" :to="item.to">{{ item.icon }} {{ item.label }}</router-link>
    </nav>
    <div class="nav-user">
      <div class="notice-wrap">
        <button class="notice-button" title="平台公告" @click="toggleAnnouncements">🔔<i v-if="announcements.length"></i></button>
        <section v-if="showAnnouncements" class="notice-panel">
          <div class="notice-title"><b>平台公告</b><button @click="showAnnouncements=false">×</button></div>
          <article v-for="item in announcements" :key="item.id" class="notice-item"><b>{{ item.is_pinned ? '置顶 · ' : '' }}{{ item.title }}</b><p>{{ item.content }}</p></article>
          <p v-if="!announcements.length" class="notice-empty">暂无公告</p>
        </section>
      </div>
      <button v-if="user.role!=='teacher'" class="user-name" @click="router.push('/account')">{{ user.name || '同学' }}</button>
      <button v-if="user.is_admin" @click="router.push('/admin')">管理后台</button>
      <button @click="router.push('/setup-key')">模型设置</button>
      <button class="logout" title="清除当前登录状态并返回登录页" @click="logout">退出登录</button>
    </div>
  </header>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../utils/api'
import { sessionUser, clearSession } from '../utils/session'
const router = useRouter()
const user = computed(() => sessionUser.value || {})
const visibleLinks=computed(()=>user.value.role==='teacher'?[{to:'/teacher',label:'教师工作台',icon:'▣'}]:links)
const announcements = ref([])
const showAnnouncements = ref(false)
const links = [
  { to: '/favorites', label: '收藏题库', icon: '★' },
  { to: '/quiz', label: 'AI 答题', icon: '✦' },
  { to: '/dashboard', label: '学习首页', icon: '⌂' }, { to: '/home', label: '我的 Agent', icon: '✦' },
  { to: '/course', label: '课程资料', icon: '▣' }, { to: '/schedule', label: '课表计划', icon: '◷' }, { to: '/messages', label: '学习协作', icon: '◉' },
  { to: '/community', label: '校园论坛', icon: '◇' }
]
async function loadAnnouncements () { try { announcements.value = await api('/announcements') } catch { announcements.value = [] } }
function toggleAnnouncements () { showAnnouncements.value = !showAnnouncements.value; if (showAnnouncements.value) loadAnnouncements() }
function logout () { clearSession(); router.push('/login') }
onMounted(loadAnnouncements)
</script>

<style scoped>
.notice-wrap{position:relative}.notice-button{position:relative;font-size:17px!important}.notice-button i{position:absolute;width:7px;height:7px;border-radius:50%;background:#c65738;right:5px;top:5px;border:1px solid #fff}.notice-panel{position:absolute;right:0;top:42px;width:min(350px,80vw);max-height:430px;overflow:auto;padding:14px;background:#fffdf9;border:1px solid #edd8cc;border-radius:17px;box-shadow:0 15px 35px #7d47342b;color:#65483c;z-index:40}.notice-title{display:flex;justify-content:space-between;align-items:center;color:#9f4c2b}.notice-title button{font-size:18px!important;padding:0 4px!important}.notice-item{padding:11px 0;border-bottom:1px solid #f4e5dc}.notice-item:last-child{border:0}.notice-item b{font-size:13px;color:#704331}.notice-item p{margin:5px 0 0;font-size:12px;line-height:1.55;color:#936f60;white-space:pre-wrap}.notice-empty{font-size:13px;color:#a98a7c;text-align:center}
.app-nav{height:72px;display:flex;align-items:center;gap:18px;padding:0 4vw;background:rgba(255,253,248,.93);border-bottom:1px solid #f1dfd2;position:sticky;top:0;z-index:20;backdrop-filter:blur(12px)}
.brand{font-weight:800;color:#9f4c2b;font-size:20px;text-decoration:none;white-space:nowrap}.brand span{display:inline-grid;place-items:center;background:#c96d42;color:#fff;width:28px;height:28px;border-radius:10px}
nav{display:flex;gap:2px;flex:1;overflow:auto}nav a,.nav-user button{border:0;background:transparent;color:#7a6258;text-decoration:none;padding:9px 8px;border-radius:12px;font-size:13px;white-space:nowrap}nav a.router-link-active{color:#9f4c2b;background:#fbe9dc;font-weight:700}.nav-user{display:flex;align-items:center;gap:3px;font-size:14px;color:#8a6a5e}.nav-user button:hover,nav a:hover{background:#f7eee6}.user-name{font-weight:700}.logout{color:#fff!important;background:#bb593c!important;font-weight:800!important}.logout:hover{background:#9f442c!important}@media(max-width:950px){.app-nav{height:auto;padding:12px 4vw;flex-wrap:wrap;gap:10px}nav{order:3;overflow:auto;width:100%}.nav-user{margin-left:auto}.user-name{display:none}}
nav a[href="/dashboard"]{order:-1}
</style>
