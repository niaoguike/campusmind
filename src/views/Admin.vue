<template>
  <div class="container">
    <el-page-header content="后台管理系统" />
    <el-menu mode="horizontal" router class="nav">
      <el-menu-item index="/home">AI对话</el-menu-item>
      <el-menu-item index="/course">课程中心</el-menu-item>
      <el-menu-item index="/admin">后台管理</el-menu-item>
      <el-menu-item @click="logout">退出登录</el-menu-item>
    </el-menu>

    <el-button type="success" @click="openDialog">新增课程</el-button>
    <!-- 新增弹窗 -->
    <el-dialog v-model="dialogVisible" title="添加课程">
      <el-form :model="form">
        <el-form-item label="课程名">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="适用年级">
          <el-input v-model="form.grade" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCourse">确认提交</el-button>
      </template>
    </el-dialog>

    <el-table :data="tableData" border style="width:100%;margin-top:20px">
      <el-table-column label="ID" prop="id" />
      <el-table-column label="课程名称" prop="name" />
      <el-table-column label="年级" prop="grade" />
      <el-table-column label="操作">
        <template #default="scope">
          <el-button type="danger" size="small" @click="delRow(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
const router = useRouter()

const dialogVisible = ref(false)
const form = ref({ name: '', grade: '' })
const tableData = ref([
  { id: 1, name: '高等数学基础', grade: '大一' },
  { id: 2, name: 'Python编程入门', grade: '大二' }
])

// 打开弹窗
const openDialog = () => {
  form.value = { name: '', grade: '' }
  dialogVisible.value = true
}

// 提交课程
const submitCourse = () => {
  const newId = tableData.value.length + 1
  tableData.value.push({ id: newId, ...form.value })
  dialogVisible.value = false
  ElMessage.success('新增成功')
}

// 删除课程
const delRow = (row) => {
  tableData.value = tableData.value.filter(item => item.id !== row.id)
  ElMessage.success('删除完成')
}

const logout = () => {
  localStorage.removeItem('token')
  router.push('/login')
  ElMessage.info('已退出登录')
}
</script>

<style scoped>
.container {
  padding: 30px;
  background: #f5f7fa;
  min-height: 100vh;
}
.nav {
  margin: 20px 0;
}
</style>