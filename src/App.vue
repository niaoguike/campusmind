<template>
  <router-view />
  <button v-if="showExit" class="exit-fallback" @click="logout">退出登录</button>
</template>
<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
const showExit = computed(() => route.path !== '/login' && route.path !== '/')
function logout () {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push('/login')
}
</script>

<style scoped>
.exit-fallback{position:fixed;right:20px;bottom:20px;z-index:50;border:0;border-radius:14px;background:#bb593c;color:#fff;padding:11px 15px;font-weight:800;box-shadow:0 8px 22px #7c371b4d;cursor:pointer}
.exit-fallback:hover{background:#9f442c}
</style>
