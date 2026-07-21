import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Home from '../views/Home.vue'
import Course from '../views/Course.vue'
import Admin from '../views/Admin.vue'
import SetupKey from '../views/SetupKey.vue'
import Dashboard from '../views/Dashboard.vue'
import Schedule from '../views/Schedule.vue'
import Messages from '../views/Messages.vue'
import Community from '../views/Community.vue'

const requireAuth = (to, from, next) => {
  const token = localStorage.getItem('token')
  token ? next() : next('/login')
}

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: Login },
  { path: '/setup-key', component: SetupKey, beforeEnter: requireAuth },
  { path: '/home', component: Home, beforeEnter: requireAuth },
  { path: '/dashboard', component: Dashboard, beforeEnter: requireAuth },
  { path: '/course', component: Course, beforeEnter: requireAuth },
  { path: '/schedule', component: Schedule, beforeEnter: requireAuth },
  { path: '/messages', redirect: '/home' },
  { path: '/community', component: Community, beforeEnter: requireAuth },
  { path: '/admin', component: Admin, beforeEnter: requireAuth }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
