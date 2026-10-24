import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import Home from '../views/AgentWorkspace.vue'
import Course from '../views/Course.vue'
import AdminConsole from '../views/AdminConsole.vue'
import SetupKey from '../views/SetupKey.vue'
import Dashboard from '../views/Dashboard.vue'
import Schedule from '../views/Schedule.vue'
import Messages from '../views/Messages.vue'
import ForumHome from '../views/ForumHome.vue'
import ForumPost from '../views/ForumPost.vue'
import MessagesSocial from '../views/MessagesSocial.vue'
import Profile from '../views/ProfileSettings.vue'
import FriendAgentChat from '../views/FriendAgentChat.vue'
import PeerAgentCollaboration from '../views/PeerAgentCollaboration.vue'
import CourseResource from '../views/CourseResource.vue'
import CourseFolder from '../views/CourseFolder.vue'
import Quiz from '../views/Quiz.vue'
import Favorites from '../views/Favorites.vue'
import AccountCenter from '../views/AccountCenter.vue'
import { api } from '../utils/api'
import { ElMessage } from 'element-plus'
import { setSession, clearSession, destinationForUser } from '../utils/session'
import TeacherConsole from '../views/TeacherConsole.vue'
import CourseSpaces from '../views/CourseSpaces.vue'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/login', component: Login },
  { path: '/setup-key', component: SetupKey },
  { path: '/home', component: Home },
  { path: '/dashboard', component: Dashboard },
  { path: '/course', component: CourseResource },
  { path: '/course/folders/:id', component: CourseFolder },
  { path: '/quiz', component: Quiz },
  { path: '/favorites', component: Favorites },
  { path: '/schedule', component: Schedule },
  { path: '/messages', component: MessagesSocial },
  { path: '/courses', component: CourseSpaces },
  { path: '/account', component: AccountCenter },
  { path: '/profile/:id', component: Profile },
  { path: '/friend-agent/:id', component: FriendAgentChat },
  { path: '/agent-collaboration/:id', component: PeerAgentCollaboration },
  { path: '/community', component: ForumHome },
  { path: '/community/:id', component: ForumPost },
  { path: '/admin', component: AdminConsole }
  ,{ path: '/teacher', component: TeacherConsole }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async to => {
  if(to.path==='/login')return
  if(!localStorage.getItem('token')){clearSession();return '/login'}
  try {
    const user=await api('/user/profile',{redirectOnUnauthorized:false,cache:'no-store'})
    if(!user?.id||!['student','teacher','admin'].includes(user.role))throw new Error('登录身份无效，请重新登录')
    setSession(user)
    return destinationForUser(to.path,user)||true
  }catch(error){
    ElMessage.error(error.message||'无法读取登录身份，请重新登录')
    clearSession()
    return {path:'/login',query:{reason:error.message||'身份校验失败'}}
  }
})
export default router
