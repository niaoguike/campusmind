<template>
  <main class="auth-page">
    <section class="brand-side">
      <div class="brand"><span class="brand-mark">✦</span> CampusMind</div>
      <div class="brand-copy">
        <p class="eyebrow">YOUR INTELLIGENT LEARNING SPACE</p>
        <h1>让每一次学习，<br><em>都有清晰的方向。</em></h1>
        <p>课程资料、学习计划与专属智能体，陪你把目标拆成每天都做得到的小事。</p>
      </div>
      <section v-if="announcements.length" class="announcement-panel" aria-label="平台公告">
        <div class="announcement-heading"><span>📣 平台公告</span><small>最新动态</small></div>
        <article v-for="item in announcements.slice(0, 3)" :key="item.id" class="announcement-item">
          <b>{{ item.is_pinned ? '置顶 · ' : '' }}{{ item.title }}</b>
          <p>{{ item.content }}</p>
        </article>
      </section>
      <div class="feature-list">
        <div><span>✦</span><p><b>专属学习 Agent</b><small>记住你的目标与学习节奏</small></p></div>
        <div><span>◌</span><p><b>课程资料中心</b><small>集中整理与检索学习资料</small></p></div>
        <div><span>◷</span><p><b>课表与计划</b><small>从安排到复盘，形成学习闭环</small></p></div>
      </div>
    </section>

    <section class="form-side">
      <div class="auth-card">
        <div class="mobile-brand"><span>✦</span> CampusMind</div>
        <p class="welcome">WELCOME BACK</p>
        <h2>{{ activeTab === 'register' ? '创建你的 CampusMind 账号' : activeTab === 'reset' ? '重设登录密码' : '欢迎回来' }}</h2>
        <p class="sub">{{ activeTab === 'register' ? '选择学生或教师身份，注册后进入对应工作台。' : activeTab === 'reset' ? '验证已绑定的手机号后，即可设置新密码。' : activeTab === 'sms' ? '使用已绑定手机号的验证码安全登录。' : '使用学号或教师工号登录。' }}</p>
        <el-alert v-if="loginFailure" :title="loginFailure" type="error" show-icon @close="loginFailure=''"/>
        <el-tabs v-model="activeTab" stretch class="auth-tabs">
          <el-tab-pane label="账号登录" name="login">
            <el-form :model="loginForm" class="form" @submit.prevent="handleLogin">
              <el-form-item label="学号 / 教师工号"><el-input v-model="loginForm.student_id" autocomplete="username" placeholder="请输入学号或教师工号" size="large" /></el-form-item>
              <el-form-item label="密码"><el-input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" size="large" show-password @keyup.enter="handleLogin" /></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">登录 <span>→</span></el-button>
              <div class="login-links"><button type="button" @click="activeTab = 'sms'">验证码登录</button><button type="button" @click="activeTab = 'reset'">忘记密码？</button></div>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="验证码登录" name="sms">
            <el-form :model="smsLoginForm" class="form" @submit.prevent="handleSmsLogin">
              <el-form-item label="已绑定手机号"><el-input v-model="smsLoginForm.phone" inputmode="numeric" autocomplete="tel" placeholder="请输入 11 位手机号" size="large" /></el-form-item>
              <el-form-item label="短信验证码"><div class="code-row"><el-input v-model="smsLoginForm.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" size="large" /><button type="button" class="code-button" :disabled="smsSending || cooldowns.login" @click="sendCode('login')">{{ cooldowns.login ? `${cooldowns.login}s 后重发` : '获取验证码' }}</button></div></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">验证码登录 <span>→</span></el-button>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="忘记密码" name="reset">
            <el-form :model="resetForm" class="form" @submit.prevent="handleResetPassword">
              <el-form-item label="已绑定手机号"><el-input v-model="resetForm.phone" inputmode="numeric" autocomplete="tel" placeholder="请输入 11 位手机号" size="large" /></el-form-item>
              <el-form-item label="短信验证码"><div class="code-row"><el-input v-model="resetForm.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" size="large" /><button type="button" class="code-button" :disabled="smsSending || cooldowns.reset" @click="sendCode('reset')">{{ cooldowns.reset ? `${cooldowns.reset}s 后重发` : '获取验证码' }}</button></div></el-form-item>
              <el-form-item label="新密码"><el-input v-model="resetForm.password" type="password" autocomplete="new-password" show-password placeholder="至少 6 位" size="large" /></el-form-item>
              <el-form-item label="确认新密码"><el-input v-model="resetForm.confirmPassword" type="password" autocomplete="new-password" show-password placeholder="再次输入新密码" size="large" /></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">验证并重设密码 <span>→</span></el-button>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="注册账号" name="register">
            <el-form :model="regForm" class="form compact" @submit.prevent="handleRegister">
              <el-form-item label="注册身份"><el-radio-group v-model="regForm.role"><el-radio-button value="student">学生</el-radio-button><el-radio-button value="teacher">教师</el-radio-button></el-radio-group></el-form-item>
              <div class="two-col"><el-form-item label="姓名"><el-input v-model="regForm.name" placeholder="真实姓名" /></el-form-item><el-form-item v-if="regForm.role==='student'" label="8 位学号"><el-input v-model="regForm.student_id" inputmode="numeric" placeholder="例如 55240101" /></el-form-item><el-form-item v-else label="教师工号"><el-input v-model="regForm.teacher_id" maxlength="32" placeholder="请输入教师工号" /></el-form-item></div>
              <el-form-item label="手机号"><el-input v-model="regForm.phone" placeholder="用于联系" /></el-form-item>
              <div class="two-col"><el-form-item label="所属学院"><el-select v-model="regForm.college" filterable allow-create default-first-option placeholder="选择或搜索学院"><el-option v-for="college in colleges" :key="college" :label="college" :value="college"/></el-select></el-form-item><el-form-item v-if="regForm.role==='student'" label="班级"><el-input v-model="regForm.class" placeholder="如：552413" /></el-form-item></div>
              <el-form-item label="设置密码"><el-input v-model="regForm.password" type="password" autocomplete="new-password" placeholder="至少 6 位" show-password /></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">{{ regForm.role==='teacher'?'注册并进入教师端':'注册并进入学生端' }} <span>→</span></el-button>
            </el-form>
          </el-tab-pane>
        </el-tabs>
        <p class="privacy">登录即表示你同意平台仅将你的学习数据用于个性化学习服务。</p>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { setSession, clearSession, homeForUser } from '../utils/session'

const router = useRouter(),route=useRoute()
// A redirect can carry the failure of a previous session.  Keep it dismissible
// and clear it as soon as the user starts a new authentication attempt.
const loginFailure=ref(route.query.reason==='session_expired'?'登录已过期，请重新登录':String(route.query.reason||''))
const activeTab = ref('login')
const loading = ref(false)
const smsSending = ref(false)
const loginForm = ref({ student_id: '', password: '' })
const smsLoginForm = ref({ phone: '', code: '' })
const resetForm = ref({ phone: '', code: '', password: '', confirmPassword: '' })
const cooldowns = ref({ login: 0, reset: 0 })
const regForm = ref({ role:'student', teacher_id:'', student_id: '', name: '', phone: '', college: '', class: '', password: '' })
const colleges = ['哲学社会学院','文学院','新闻与传播学院','经济学院','法学院','商学与管理学院','数学学院','物理学院','化学学院','计算机科学与技术学院','软件学院','人工智能学院','电子科学与工程学院','通信工程学院','机械与航空航天工程学院','汽车工程学院','材料科学与工程学院','地球科学学院','建设工程学院','公共卫生学院','药学院','护理学院','基础医学院','动物医学学院','植物科学学院']
const announcements = ref([])

async function loadAnnouncements () {
  try {
    const response = await fetch('/api/announcements')
    if (response.ok) announcements.value = await response.json()
  } catch { /* 公告加载失败不影响登录。 */ }
}

onMounted(loadAnnouncements)

const validPhone = value => /^1[3-9]\d{9}$/.test(String(value || '').trim())
function startCooldown (purpose) {
  cooldowns.value[purpose] = 60
  const timer = window.setInterval(() => {
    cooldowns.value[purpose] -= 1
    if (cooldowns.value[purpose] <= 0) window.clearInterval(timer)
  }, 1000)
}
async function sendCode (purpose) {
  const form = purpose === 'login' ? smsLoginForm.value : resetForm.value
  if (!validPhone(form.phone)) return ElMessage.warning('请输入正确的 11 位中国大陆手机号')
  smsSending.value = true
  try {
    const response = await fetch('/api/auth/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: form.phone.trim(), purpose }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '验证码发送失败')
    ElMessage.success(data.message || '验证码已发送')
    startCooldown(purpose)
  } catch { ElMessage.error('无法连接后端服务，请稍后重试') } finally { smsSending.value = false }
}
async function completeLogin (data) {
  if(!data.token||!data.user?.role)throw new Error('登录服务版本不匹配，请刷新后重试')
  clearSession()
  localStorage.setItem('token', data.token)
  setSession(data.user)
  await router.replace(homeForUser(data.user))
  if(router.currentRoute.value.path!=='/login')ElMessage.success(`欢迎回来，${data.user.name}`)
}

async function handleLogin () {
  loginFailure.value = ''
  const { student_id, password } = loginForm.value
  if (!student_id.trim() || !password) return ElMessage.warning('请填写学号或教师工号和密码')
  loading.value = true
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id, password }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '登录失败')
    await completeLogin(data)
  } catch (error) { ElMessage.error(error.message || '无法连接登录服务，请稍后重试') } finally { loading.value = false }
}

async function handleSmsLogin () {
  loginFailure.value = ''
  const { phone, code } = smsLoginForm.value
  if (!validPhone(phone) || !/^\d{6}$/.test(code)) return ElMessage.warning('请输入手机号和 6 位验证码')
  loading.value = true
  try {
    const response = await fetch('/api/auth/sms/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), code }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '验证码登录失败')
    await completeLogin(data)
  } catch { ElMessage.error('无法连接后端服务，请确认服务器正常运行') } finally { loading.value = false }
}

async function handleResetPassword () {
  const { phone, code, password, confirmPassword } = resetForm.value
  if (!validPhone(phone) || !/^\d{6}$/.test(code)) return ElMessage.warning('请输入手机号和 6 位验证码')
  if (password.length < 6) return ElMessage.warning('新密码至少需要 6 位')
  if (password !== confirmPassword) return ElMessage.warning('两次输入的新密码不一致')
  loading.value = true
  try {
    const response = await fetch('/api/auth/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: phone.trim(), code, password }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '密码重设失败')
    ElMessage.success(data.message || '密码已重设')
    loginForm.value = { student_id: '', password: '' }
    activeTab.value = 'login'
  } catch { ElMessage.error('无法连接后端服务，请确认服务器正常运行') } finally { loading.value = false }
}

async function handleRegister () {
  loginFailure.value = ''
  const { role, teacher_id, student_id, name, phone, college, class: className, password } = regForm.value
  const account = role==='teacher'?teacher_id.trim():student_id.trim()
  if (![account, name.trim(), phone, college.trim(), password].every(Boolean)||(role==='student'&&!className.trim())) return ElMessage.warning('请填写所有必填信息')
  if (role==='student'&&!/^\d{8}$/.test(account)) return ElMessage.warning('学号必须为 8 位数字')
  if(role==='teacher'&&!/^[A-Za-z0-9_-]{2,32}$/.test(account))return ElMessage.warning('教师工号需为2至32位字母、数字、下划线或短横线')
  if (!validPhone(phone)) return ElMessage.warning('请输入正确的 11 位中国大陆手机号')
  if (password.length < 6) return ElMessage.warning('密码至少需要 6 位')
  loading.value = true
  try {
    const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, teacher_id, student_id, name, phone, college, class: className, password }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '注册失败')
    await completeLogin(data)
  } catch (error) { ElMessage.error(error.message || '无法连接登录服务，请稍后重试') } finally { loading.value = false }
}
</script>

<style scoped>
.announcement-panel{margin:0 0 22px;padding:14px;border:1px solid #ffffff42;border-radius:18px;background:#7e331d30;backdrop-filter:blur(5px)}.announcement-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:800}.announcement-heading small{color:#ffe0cf;font-size:11px}.announcement-item{padding:8px 0;border-top:1px solid #ffffff28}.announcement-item:first-of-type{border-top:0}.announcement-item b{display:block;font-size:13px;color:#fff9f2}.announcement-item p{margin:4px 0 0;color:#ffe6d8;font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.auth-page{min-height:100vh;display:grid;grid-template-columns:minmax(420px,45%) 1fr;background:#fffaf6}.brand-side{color:#fff6ef;padding:42px clamp(40px,7vw,100px);background:radial-gradient(circle at 85% 18%,#efaf82 0 3%,transparent 3.5%),radial-gradient(circle at 72% 78%,#d8754a 0 11%,transparent 11.5%),linear-gradient(145deg,#9f452b,#c96d42 54%,#e79d70);display:flex;flex-direction:column}.brand,.mobile-brand{font-weight:800;letter-spacing:.2px;font-size:21px}.brand-mark,.mobile-brand span{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#fff8f1;color:#bb5a35;margin-right:7px}.brand-copy{margin:auto 0 38px}.eyebrow,.welcome{font-size:11px;letter-spacing:1.6px;font-weight:800;color:#ffdcc7}.brand-copy h1{font-size:clamp(34px,4vw,53px);line-height:1.14;margin:10px 0 18px;color:#fff8f1}.brand-copy em{font-family:Georgia,serif;font-weight:400}.brand-copy>p:last-child{line-height:1.75;max-width:410px;color:#ffe4d4}.feature-list{display:grid;gap:12px}.feature-list>div{display:flex;gap:11px;align-items:center;padding:11px 14px;border:1px solid #ffffff35;border-radius:17px;background:#ffffff13;backdrop-filter:blur(5px)}.feature-list span{font-size:18px}.feature-list p{margin:0}.feature-list b,.feature-list small{display:block}.feature-list small{color:#ffe0cf;font-size:12px;margin-top:3px}.form-side{display:grid;place-items:center;padding:30px}.auth-card{width:min(470px,100%);padding:18px 8px}.mobile-brand{display:none;color:#a95130;margin-bottom:32px}.welcome{color:#bd7659;margin:0}.auth-card h2{font-size:32px;color:#613c2c;margin:8px 0}.sub{color:#9d8173;line-height:1.6;margin:0 0 24px}.form{padding:14px 2px 0}.form :deep(.el-form-item__label){color:#765c50;font-weight:700;padding-bottom:5px}.form :deep(.el-input__wrapper){border-radius:13px;background:#fffdfb;box-shadow:0 0 0 1px #ead8cd inset;padding:2px 12px}.form :deep(.el-input__wrapper.is-focus){box-shadow:0 0 0 1px #c96d42 inset}.form :deep(.el-select){width:100%}.form :deep(.el-select__wrapper){border-radius:13px;min-height:38px;background:#fffdfb;box-shadow:0 0 0 1px #ead8cd inset}.main-button{width:100%;height:46px;margin-top:8px;border:0;border-radius:14px;background:#c96d42;color:#fff;font-weight:800;font-size:15px;box-shadow:0 9px 20px #c96d4240}.main-button:hover{background:#ad512f}.main-button span{margin-left:8px;font-size:18px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:13px}.privacy{text-align:center;font-size:11px;color:#b49b8f;line-height:1.6;margin-top:20px}.auth-tabs :deep(.el-tabs__nav-wrap:after){background:#f0e0d6}.auth-tabs :deep(.el-tabs__item){color:#9e8173;font-weight:700}.auth-tabs :deep(.el-tabs__item.is-active){color:#b65836}.auth-tabs :deep(.el-tabs__active-bar){background:#c96d42;border-radius:4px}@media(max-width:820px){.auth-page{grid-template-columns:1fr}.brand-side{display:none}.form-side{padding:38px 24px}.mobile-brand{display:block}.auth-card{padding:0}}@media(max-width:460px){.form-side{padding:25px 18px}.auth-card h2{font-size:28px}.two-col{grid-template-columns:1fr;gap:0}.compact :deep(.el-form-item){margin-bottom:13px}}
.login-links{display:flex;justify-content:space-between;margin-top:14px}.login-links button{border:0;background:transparent;padding:0;color:#b45f3d;font-size:12px;cursor:pointer}.code-row{display:flex;width:100%;gap:8px}.code-row :deep(.el-input){flex:1;min-width:0}.code-button{flex:none;border:0;border-radius:12px;background:#fff0e5;color:#a95739;font-weight:700;padding:0 11px;cursor:pointer;font-size:12px}.code-button:disabled{opacity:.55;cursor:not-allowed}
</style>
