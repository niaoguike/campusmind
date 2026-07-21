<template>
  <main class="auth-page">
    <section class="brand-side">
      <div class="brand"><span class="brand-mark">✦</span> CampusMind</div>
      <div class="brand-copy">
        <p class="eyebrow">YOUR INTELLIGENT LEARNING SPACE</p>
        <h1>让每一次学习，<br><em>都有清晰的方向。</em></h1>
        <p>课程资料、学习计划与专属智能体，陪你把目标拆成每天都做得到的小事。</p>
      </div>
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
        <h2>{{ activeTab === 'login' ? '欢迎回来' : '创建你的学习空间' }}</h2>
        <p class="sub">{{ activeTab === 'login' ? '使用学号登录，继续你的学习旅程。' : '完成身份信息后，即可拥有专属学习 Agent。' }}</p>
        <el-tabs v-model="activeTab" stretch class="auth-tabs">
          <el-tab-pane label="学号登录" name="login">
            <el-form :model="loginForm" class="form" @submit.prevent="handleLogin">
              <el-form-item label="学号"><el-input v-model="loginForm.student_id" inputmode="numeric" autocomplete="username" placeholder="请输入 8 位学号" size="large" /></el-form-item>
              <el-form-item label="密码"><el-input v-model="loginForm.password" type="password" autocomplete="current-password" placeholder="请输入密码" size="large" show-password @keyup.enter="handleLogin" /></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">使用学号登录 <span>→</span></el-button>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="注册账号" name="register">
            <el-form :model="regForm" class="form compact" @submit.prevent="handleRegister">
              <div class="two-col"><el-form-item label="姓名"><el-input v-model="regForm.name" placeholder="真实姓名" /></el-form-item><el-form-item label="8 位学号"><el-input v-model="regForm.student_id" inputmode="numeric" placeholder="例如 20240101" /></el-form-item></div>
              <el-form-item label="手机号"><el-input v-model="regForm.phone" placeholder="用于联系" /></el-form-item>
              <div class="two-col"><el-form-item label="学院"><el-select v-model="regForm.college" filterable placeholder="选择或搜索学院"><el-option v-for="college in colleges" :key="college" :label="college" :value="college"/></el-select></el-form-item><el-form-item label="班级"><el-input v-model="regForm.class" placeholder="如：软件工程 2401" /></el-form-item></div>
              <el-form-item label="设置密码"><el-input v-model="regForm.password" type="password" autocomplete="new-password" placeholder="至少 6 位" show-password /></el-form-item>
              <el-button class="main-button" :loading="loading" size="large" native-type="submit">创建学习账号 <span>→</span></el-button>
            </el-form>
          </el-tab-pane>
        </el-tabs>
        <p class="privacy">登录即表示你同意平台仅将你的学习数据用于个性化学习服务。</p>
      </div>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()
const activeTab = ref('login')
const loading = ref(false)
const loginForm = ref({ student_id: '', password: '' })
const regForm = ref({ student_id: '', name: '', phone: '', college: '', class: '', password: '' })
const colleges = ['哲学社会学院','文学院','新闻与传播学院','经济学院','法学院','商学与管理学院','数学学院','物理学院','化学学院','计算机科学与技术学院','软件学院','人工智能学院','电子科学与工程学院','通信工程学院','机械与航空航天工程学院','汽车工程学院','材料科学与工程学院','地球科学学院','建设工程学院','公共卫生学院','药学院','护理学院','基础医学院','动物医学学院','植物科学学院']

async function handleLogin () {
  const { student_id, password } = loginForm.value
  if (!student_id || !password) return ElMessage.warning('请填写学号和密码')
  if (!/^\d{8}$/.test(student_id)) return ElMessage.warning('请输入 8 位数字学号')
  loading.value = true
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id, password }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '登录失败')
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
    ElMessage.success(`欢迎回来，${data.user.name}`)
    router.push(data.user.hasApiKey ? '/dashboard' : '/setup-key')
  } catch { ElMessage.error('无法连接后端服务，请确认 server 终端正在运行') } finally { loading.value = false }
}

async function handleRegister () {
  const { student_id, name, phone, college, class: className, password } = regForm.value
  if (![student_id, name, phone, college, className, password].every(Boolean)) return ElMessage.warning('请填写所有必填信息')
  if (!/^\d{8}$/.test(student_id)) return ElMessage.warning('学号必须为 8 位数字')
  if (password.length < 6) return ElMessage.warning('密码至少需要 6 位')
  loading.value = true
  try {
    const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id, name, phone, college, class: className, password }) })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '注册失败')
    ElMessage.success('注册成功，请使用学号登录')
    activeTab.value = 'login'; loginForm.value.student_id = student_id
  } catch { ElMessage.error('无法连接后端服务，请确认 server 终端正在运行') } finally { loading.value = false }
}
</script>

<style scoped>
.auth-page{min-height:100vh;display:grid;grid-template-columns:minmax(420px,45%) 1fr;background:#fffaf6}.brand-side{color:#fff6ef;padding:42px clamp(40px,7vw,100px);background:radial-gradient(circle at 85% 18%,#efaf82 0 3%,transparent 3.5%),radial-gradient(circle at 72% 78%,#d8754a 0 11%,transparent 11.5%),linear-gradient(145deg,#9f452b,#c96d42 54%,#e79d70);display:flex;flex-direction:column}.brand,.mobile-brand{font-weight:800;letter-spacing:.2px;font-size:21px}.brand-mark,.mobile-brand span{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:#fff8f1;color:#bb5a35;margin-right:7px}.brand-copy{margin:auto 0 38px}.eyebrow,.welcome{font-size:11px;letter-spacing:1.6px;font-weight:800;color:#ffdcc7}.brand-copy h1{font-size:clamp(34px,4vw,53px);line-height:1.14;margin:10px 0 18px;color:#fff8f1}.brand-copy em{font-family:Georgia,serif;font-weight:400}.brand-copy>p:last-child{line-height:1.75;max-width:410px;color:#ffe4d4}.feature-list{display:grid;gap:12px}.feature-list>div{display:flex;gap:11px;align-items:center;padding:11px 14px;border:1px solid #ffffff35;border-radius:17px;background:#ffffff13;backdrop-filter:blur(5px)}.feature-list span{font-size:18px}.feature-list p{margin:0}.feature-list b,.feature-list small{display:block}.feature-list small{color:#ffe0cf;font-size:12px;margin-top:3px}.form-side{display:grid;place-items:center;padding:30px}.auth-card{width:min(470px,100%);padding:18px 8px}.mobile-brand{display:none;color:#a95130;margin-bottom:32px}.welcome{color:#bd7659;margin:0}.auth-card h2{font-size:32px;color:#613c2c;margin:8px 0}.sub{color:#9d8173;line-height:1.6;margin:0 0 24px}.form{padding:14px 2px 0}.form :deep(.el-form-item__label){color:#765c50;font-weight:700;padding-bottom:5px}.form :deep(.el-input__wrapper){border-radius:13px;background:#fffdfb;box-shadow:0 0 0 1px #ead8cd inset;padding:2px 12px}.form :deep(.el-input__wrapper.is-focus){box-shadow:0 0 0 1px #c96d42 inset}.form :deep(.el-select){width:100%}.form :deep(.el-select__wrapper){border-radius:13px;min-height:38px;background:#fffdfb;box-shadow:0 0 0 1px #ead8cd inset}.main-button{width:100%;height:46px;margin-top:8px;border:0;border-radius:14px;background:#c96d42;color:#fff;font-weight:800;font-size:15px;box-shadow:0 9px 20px #c96d4240}.main-button:hover{background:#ad512f}.main-button span{margin-left:8px;font-size:18px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:13px}.privacy{text-align:center;font-size:11px;color:#b49b8f;line-height:1.6;margin-top:20px}.auth-tabs :deep(.el-tabs__nav-wrap:after){background:#f0e0d6}.auth-tabs :deep(.el-tabs__item){color:#9e8173;font-weight:700}.auth-tabs :deep(.el-tabs__item.is-active){color:#b65836}.auth-tabs :deep(.el-tabs__active-bar){background:#c96d42;border-radius:4px}@media(max-width:820px){.auth-page{grid-template-columns:1fr}.brand-side{display:none}.form-side{padding:38px 24px}.mobile-brand{display:block}.auth-card{padding:0}}@media(max-width:460px){.form-side{padding:25px 18px}.auth-card h2{font-size:28px}.two-col{grid-template-columns:1fr;gap:0}.compact :deep(.el-form-item){margin-bottom:13px}}
</style>
