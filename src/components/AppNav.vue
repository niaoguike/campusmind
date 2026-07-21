<template>
  <header class="app-nav">
    <router-link to="/dashboard" class="brand"><span>◒</span> CampusMind</router-link>
    <nav>
      <router-link v-for="item in links" :key="item.to" :to="item.to">{{ item.icon }} {{ item.label }}</router-link>
    </nav>
    <div class="nav-user">
      <button class="user-name" @click="router.push(`/profile/${user.id}`)">{{ user.name || '同学' }}</button>
      <button @click="router.push('/setup-key')">模型设置</button>
      <button class="logout" title="清除当前登录状态并返回登录页" @click="logout">退出登录</button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
const router = useRouter()
const user = computed(() => JSON.parse(localStorage.getItem('user') || '{}'))
const links = [
  { to: '/dashboard', label: '学习首页', icon: '⌂' }, { to: '/home', label: '我的 Agent', icon: '✦' },
  { to: '/course', label: '课程资料', icon: '▣' }, { to: '/schedule', label: '课表计划', icon: '◷' }, { to: '/messages', label: '学习协作', icon: '◉' },
  { to: '/community', label: '校园论坛', icon: '◇' }
]
function logout () { localStorage.removeItem('token'); localStorage.removeItem('user'); router.push('/login') }
</script>

<style scoped>
.app-nav{height:72px;display:flex;align-items:center;gap:18px;padding:0 4vw;background:rgba(255,253,248,.93);border-bottom:1px solid #f1dfd2;position:sticky;top:0;z-index:20;backdrop-filter:blur(12px)}
.brand{font-weight:800;color:#9f4c2b;font-size:20px;text-decoration:none;white-space:nowrap}.brand span{display:inline-grid;place-items:center;background:#c96d42;color:#fff;width:28px;height:28px;border-radius:10px}
nav{display:flex;gap:2px;flex:1;overflow:auto}nav a,.nav-user button{border:0;background:transparent;color:#7a6258;text-decoration:none;padding:9px 8px;border-radius:12px;font-size:13px;white-space:nowrap}nav a.router-link-active{color:#9f4c2b;background:#fbe9dc;font-weight:700}.nav-user{display:flex;align-items:center;gap:3px;font-size:14px;color:#8a6a5e}.nav-user button:hover,nav a:hover{background:#f7eee6}.user-name{font-weight:700}.logout{color:#fff!important;background:#bb593c!important;font-weight:800!important}.logout:hover{background:#9f442c!important}@media(max-width:950px){.app-nav{height:auto;padding:12px 4vw;flex-wrap:wrap;gap:10px}nav{order:3;overflow:auto;width:100%}.nav-user{margin-left:auto}.user-name{display:none}}
</style>
