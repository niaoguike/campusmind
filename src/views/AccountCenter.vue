<template>
  <div class="page-shell">
    <AppNav />
    <main class="account-page">
      <section class="hero"><p class="eyebrow">ACCOUNT CENTER</p><h1>个人主页与账户安全</h1><p>管理你的学习身份、模型资料和账户安全设置。</p></section>
      <section class="profile-card">
        <div class="avatar">{{ profile.avatar || '🌱' }}</div>
        <div><h2>{{ profile.name }}</h2><p>{{ profile.student_id }} · {{ profile.college }} · {{ profile.class }}</p></div>
        <button class="profile-link" @click="router.push(`/profile/${profile.id}`)">编辑个人与 Agent 资料</button>
      </section>
      <section class="danger-card">
        <div><p class="eyebrow danger-eyebrow">DANGER ZONE</p><h2>申请注销账户</h2><p>注销申请由管理员审核。审核通过后，你的个人资料、学习记录、对话和上传资料会被永久删除，无法恢复。</p>
          <p v-if="deletionRequest?.status==='pending'" class="pending">你的注销申请已提交，正在等待管理员处理。</p>
          <p v-else-if="deletionRequest?.status==='reviewed'" class="pending">管理员已处理该申请；如需继续，请联系管理员。</p>
        </div>
        <button v-if="deletionRequest?.status==='pending'" class="secondary" @click="withdrawRequest">撤回申请</button>
        <button v-else class="danger-button" @click="dialog=true">申请注销</button>
      </section>
    </main>
    <el-dialog v-model="dialog" title="确认申请注销账户" width="min(500px,92vw)" :close-on-click-modal="false">
      <div class="warning-box">此操作需要管理员审核，但一旦审核通过，账户数据无法恢复。请确认这是你本人发起的操作。</div>
      <el-checkbox v-model="understood">我已了解注销后数据将被永久删除</el-checkbox>
      <el-form label-position="top" class="dialog-form">
        <el-form-item label="输入当前密码以验证身份"><el-input v-model="password" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="请输入“注销账户”完成第二次确认"><el-input v-model="confirmText" placeholder="注销账户" /></el-form-item>
        <el-form-item label="备注（可选）"><el-input v-model="note" type="textarea" :rows="3" maxlength="300" show-word-limit placeholder="可说明注销原因，供管理员查看" /></el-form-item>
      </el-form>
      <template #footer><button class="secondary" @click="dialog=false">暂不注销</button><button class="danger-button" :disabled="!understood || submitting" @click="submitRequest">确认提交申请</button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api } from '../utils/api'

const router = useRouter()
const profile = ref({})
const deletionRequest = ref(null)
const dialog = ref(false), understood = ref(false), password = ref(''), confirmText = ref(''), note = ref(''), submitting = ref(false)
async function load () { try { profile.value = await api('/user/profile'); deletionRequest.value = (await api('/account/deletion-request')).request } catch (error) { ElMessage.error(error.message) } }
async function submitRequest () {
  if (!understood.value || !password.value || confirmText.value !== '注销账户') return ElMessage.warning('请完成密码验证和两次确认')
  submitting.value = true
  try { const data = await api('/account/deletion-request',{method:'POST',body:JSON.stringify({password:password.value,confirm:true,confirm_text:confirmText.value,note:note.value})}); ElMessage.success(data.message); dialog.value=false; understood.value=false; password.value=''; confirmText.value=''; note.value=''; await load() } catch (error) { ElMessage.error(error.message) } finally { submitting.value=false }
}
async function withdrawRequest () { if (!window.confirm('确定撤回本次注销申请吗？')) return; try { const data=await api('/account/deletion-request',{method:'DELETE'}); ElMessage.success(data.message); await load() } catch (error) { ElMessage.error(error.message) } }
onMounted(load)
</script>

<style scoped>
.page-shell{min-height:100vh;background:#fffaf6}.account-page{width:min(960px,92vw);margin:0 auto;padding:46px 0 80px}.hero{margin-bottom:24px}.eyebrow{font-size:11px;letter-spacing:1.4px;font-weight:800;color:#bd7558;margin:0 0 7px}.hero h1{margin:0;color:#603c2c;font-size:32px}.hero>p:last-child{color:#977b6c}.profile-card,.danger-card{display:flex;align-items:center;gap:18px;padding:25px 28px;border-radius:22px;background:#fffdfb;border:1px solid #efded4;box-shadow:0 9px 25px #7f493112;margin-bottom:18px}.avatar{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:#fde6d6;font-size:30px}.profile-card h2,.danger-card h2{margin:0 0 7px;color:#6a4333}.profile-card p,.danger-card p{margin:0;color:#917467;line-height:1.65}.profile-link{margin-left:auto;background:#f7e7dc;border:0;border-radius:13px;padding:11px 14px;color:#9f4c2b;font-weight:800}.danger-card{align-items:flex-end;background:#fff8f5;border-color:#f0cfc4}.danger-card>div{flex:1}.danger-eyebrow{color:#bd593d}.pending{margin-top:12px!important;color:#a7553b!important;font-weight:700}.danger-button,.secondary{border:0;border-radius:13px;padding:11px 16px;font-weight:800;cursor:pointer;white-space:nowrap}.danger-button{background:#bc5639;color:#fff}.danger-button:disabled{opacity:.5;cursor:not-allowed}.secondary{background:#f4e7df;color:#805d4e;margin-right:9px}.warning-box{padding:12px 14px;margin-bottom:15px;border-radius:13px;background:#fff0e8;color:#8c513c;line-height:1.6}.dialog-form{margin-top:14px}@media(max-width:650px){.profile-card,.danger-card{align-items:flex-start;flex-wrap:wrap}.profile-link{margin-left:0}.danger-card>button{width:100%}}
</style>
