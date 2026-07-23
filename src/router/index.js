import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Home from '../views/Home.vue'
import Course from '../views/Course.vue'
import Admin from '../views/Admin.vue'
import SetupKey from '../views/SetupKey.vue'
import Dashboard from '../views/Dashboard.vue'
import Schedule from '../views/Schedule.vue'
import Messages from '../views/Messages.vue'
import ForumHome from '../views/ForumHome.vue'
import ForumPost from '../views/ForumPost.vue'
import MessagesSocial from '../views/MessagesSocial.vue'
import Profile from '../views/Profile.vue'
import FriendAgentChat from '../views/FriendAgentChat.vue'
import CourseResource from '../views/CourseResource.vue'
import Quiz from '../views/Quiz.vue'

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
  { path: '/course', component: CourseResource, beforeEnter: requireAuth },
  { path: '/quiz', component: Quiz, beforeEnter: requireAuth },
  { path: '/schedule', component: Schedule, beforeEnter: requireAuth },
  { path: '/messages', component: MessagesSocial, beforeEnter: requireAuth },
  { path: '/profile/:id', component: Profile, beforeEnter: requireAuth },
  { path: '/friend-agent/:id', component: FriendAgentChat, beforeEnter: requireAuth },
  { path: '/community', component: ForumHome, beforeEnter: requireAuth },
  { path: '/community/:id', component: ForumPost, beforeEnter: requireAuth },
  { path: '/admin', component: Admin, beforeEnter: requireAuth }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
