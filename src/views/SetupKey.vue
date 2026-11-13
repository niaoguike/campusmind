<template>
  <main class="setup-page">
    <section class="setup-card">
      <div class="icon">✦</div>
      <p class="eyebrow">MODEL SETTINGS</p>
      <h1>配置你的学习模型</h1>
      <p class="intro">模型配置是可选的。保存后，API Key 会加密保存在你的账户中；下次登录无需再次输入。</p>

      <el-form label-position="top">
        <el-form-item label="模型服务商">
          <div class="provider"><b>DeepSeek</b><small>当前已接入 · 用于专属学习 Agent</small></div>
        </el-form-item>
        <el-form-item label="选择模型">
          <el-radio-group v-model="modelType" class="model-options">
            <el-radio-button value="deepseek-flash">Flash · V4.1 更快、更省</el-radio-button>
            <el-radio-button value="deepseek-v4-pro">Pro · 更强推理</el-radio-button>
          </el-radio-group>
          <p class="model-help">日常问答、计划与资料检索建议选择 Flash；复杂推理或较难题目可选择 Pro。</p>
        </el-form-item>
        <el-form-item label="DeepSeek API Key">
          <el-input v-model="apiKey" type="password" show-password placeholder="sk-..." autocomplete="off" />
        </el-form-item>
      </el-form>

      <div class="notice">🔒 密钥只用于代表你调用所选模型，数据库仅保存加密内容，页面不会再次显示完整 Key。</div>
      <button class="main-button" :disabled="saving" @click="save">{{ saving ? '正在安全保存…' : '安全保存模型配置' }}</button>
      <button class="back" @click="backToDashboard">暂不设置，返回学习首页</button>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()
const apiKey = ref('')
const saving = ref(false)
const currentUser = JSON.parse(localStorage.getItem('user') || '{}')
const allowedModels = ['deepseek-flash', 'deepseek-v4-pro']
const modelType = ref(currentUser.model_type === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash')

async function save () {
  if (!apiKey.value.trim()) return ElMessage.warning('请输入 DeepSeek API Key')
  saving.value = true
  try {
    const response = await fetch('/api/user/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ model_type: modelType.value, api_key: apiKey.value.trim() })
    })
    const data = await response.json()
    if (!response.ok) return ElMessage.error(data.error || '保存失败')
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    user.hasApiKey = true
    user.model_type = modelType.value
    localStorage.setItem('user', JSON.stringify(user))
    ElMessage.success('模型配置已安全保存')
    router.push('/dashboard')
  } catch {
    ElMessage.error('无法连接后端服务')
  } finally {
    saving.value = false
  }
}

function backToDashboard () { router.push('/dashboard') }
</script>

<style scoped>
.setup-page{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 18%,#ffe6d5,transparent 28%),radial-gradient(circle at 88% 82%,#f9d6bd,transparent 30%),#fff9f4}
.setup-card{width:min(500px,100%);box-sizing:border-box;background:#fffdfa;border:1px solid #f0dfd4;border-radius:28px;padding:36px;box-shadow:0 18px 50px #8d45221a;text-align:center}
.icon{margin:auto;width:56px;height:56px;display:grid;place-items:center;border-radius:20px;background:#c96d42;color:#fff;font-size:26px}.eyebrow{font-size:11px;letter-spacing:1.5px;font-weight:800;color:#bd7659;margin:19px 0 5px}.setup-card h1{color:#603a2a;margin:0;font-size:29px}.intro{color:#96786a;line-height:1.65;margin:10px 0 24px}
.provider{display:flex;justify-content:space-between;text-align:left;align-items:center;background:#fff0e5;border:1px solid #f2d1bf;border-radius:17px;padding:14px;color:#73412d}.provider small{color:#a27360;font-size:12px}.model-options{display:flex;width:100%}.model-options :deep(.el-radio-button){flex:1}.model-options :deep(.el-radio-button__inner){width:100%;padding:10px 7px;border-radius:12px!important;box-shadow:none!important}.model-options :deep(.el-radio-button:first-child .el-radio-button__inner){border-left:1px solid #ead8cd}.model-options :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner){background:#c96d42;border-color:#c96d42}.model-help{font-size:12px;line-height:1.55;text-align:left;color:#96786a;margin:10px 0 0}
.setup-card :deep(.el-form-item__label){font-weight:700;color:#765c50}.setup-card :deep(.el-input__wrapper){border-radius:13px;box-shadow:0 0 0 1px #ead8cd inset;padding:4px 12px}.notice{font-size:12px;line-height:1.65;text-align:left;color:#937568;background:#fff9f4;border-radius:13px;padding:11px;margin:18px 0}.main-button{width:100%;border:0;border-radius:14px;padding:13px;background:#c96d42;color:#fff;font-weight:800;cursor:pointer}.main-button:disabled{opacity:.7}.back{border:0;background:none;color:#ae6041;margin-top:16px;cursor:pointer}
</style>
