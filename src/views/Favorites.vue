<template>
  <div class="page"><AppNav /><main class="favorites-page">
    <header class="title"><div><span class="eyebrow">MY QUESTION COLLECTION</span><h1>我的收藏题库</h1><p>收藏的题目会按课程归类。复习时可先自行作答，再展开参考答案与资料解析。</p></div><router-link to="/quiz" class="primary">去 Agent 出题</router-link></header>
    <section class="course-tabs"><button :class="{ active: !activeCourse }" @click="activeCourse = 0">全部 <span>{{ favorites.length }}</span></button><button v-for="course in courseGroups" :key="course.id" :class="{ active: activeCourse === course.id }" @click="activeCourse = course.id"><i :style="{ background: course.color }" />{{ course.name }} <span>{{ course.count }}</span></button></section>
    <section class="favorites"><article v-for="item in visibleFavorites" :key="item.id" class="favorite-card"><header><div><span class="course-name">{{ item.course_name }}</span><span class="type">{{ typeLabel(item.question.type) }}</span></div><button class="remove" @click="remove(item)">取消收藏</button></header><h2>{{ item.question.stem }}</h2><div v-if="item.question.options?.length" class="options"><p v-for="(option, index) in item.question.options" :key="index">{{ letter(index) }}. {{ displayOption(option) }}</p></div><div class="meta">资料来源：{{ item.question.source }}</div><button class="answer-toggle" @click="toggleAnswer(item.id)">{{ expanded[item.id] ? '收起答案与解析' : '查看参考答案与解析' }}</button><div v-if="expanded[item.id]" class="answer"><b>参考答案：{{ formatAnswer(item.question.answer) }}</b><p>{{ item.question.explanation }}</p></div></article><div v-if="!visibleFavorites.length" class="empty">这里还没有收藏题目。完成出题后，点击题目下方的“收藏此题”即可加入题库。</div></section>
  </main></div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api } from '../utils/api'

const favorites = ref([]), activeCourse = ref(0), expanded = ref({})
const letter = index => String.fromCharCode(65 + index)
const displayOption = option => String(option || '').trim().replace(/^(?:选项\s*)?[A-F]\s*[\.、．)）:：]\s*/i, '')
const typeLabel = type => ({ single: '单选题', multiple: '多选题', true_false: '判断题', fill_blank: '填空题', short: '简答题' })[type] || '练习题'
const formatAnswer = answer => Array.isArray(answer) ? answer.join('、') : String(answer || '—')
const courseGroups = computed(() => Object.values(favorites.value.reduce((groups, item) => { const key = item.course_id; if (!groups[key]) groups[key] = { id: key, name: item.course_name, color: item.course_color, count: 0 }; groups[key].count++; return groups }, {})))
const visibleFavorites = computed(() => activeCourse.value ? favorites.value.filter(item => Number(item.course_id) === Number(activeCourse.value)) : favorites.value)
async function load () { favorites.value = await api('/favorites') }
function toggleAnswer (id) { expanded.value = { ...expanded.value, [id]: !expanded.value[id] } }
async function remove (item) { if (!confirm('确定取消收藏这道题吗？')) return; try { await api(`/favorites/${item.id}`, { method: 'DELETE' }); ElMessage.success('已取消收藏'); await load() } catch (error) { ElMessage.error(error.message) } }
onMounted(() => load().catch(error => ElMessage.error(error.message)))
</script>

<style scoped>
.favorites-page{max-width:980px;margin:auto;padding:36px 5vw 60px}.title{display:flex;justify-content:space-between;align-items:end;gap:20px}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.title h1{color:#623a2b;margin:5px 0;font-size:31px}.title p{color:#92776a;max-width:640px;line-height:1.6}.primary{background:#c96d42;color:#fff;border:0;border-radius:14px;padding:11px 16px;font-weight:700;text-decoration:none;white-space:nowrap}.course-tabs{display:flex;gap:9px;overflow:auto;margin:27px 0 16px}.course-tabs button{border:1px solid #edddd1;background:#fffdfa;color:#936f5e;border-radius:18px;padding:9px 13px;white-space:nowrap;cursor:pointer}.course-tabs button.active{background:#fff0e4;color:#aa552f;border-color:#eac0aa}.course-tabs i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}.course-tabs span{font-size:11px;background:#f2e2d6;border-radius:8px;padding:2px 5px;margin-left:4px}.favorites{display:grid;gap:14px}.favorite-card,.empty{background:#fffdfa;border:1px solid #f1e2d8;border-radius:21px;box-shadow:0 10px 30px #9f4c2b0d}.favorite-card{padding:20px}.favorite-card header{display:flex;justify-content:space-between;align-items:center}.course-name,.type{font-size:12px;border-radius:9px;padding:4px 7px}.course-name{background:#fff0e5;color:#a15839}.type{color:#967466;margin-left:6px}.favorite-card h2{font-size:17px;color:#66412f;line-height:1.65;margin:13px 0}.options{padding:9px 13px;border-radius:13px;background:#fff8f3;color:#785e50;font-size:14px}.options p{margin:5px 0}.meta{font-size:12px;color:#a38676;margin-top:12px}.answer-toggle,.remove{border:0;cursor:pointer;font-weight:700}.answer-toggle{margin-top:14px;color:#a85a3d;background:#fff0e5;border-radius:10px;padding:7px 10px}.remove{color:#bd5b45;background:#fff0ed;border-radius:9px;padding:6px 9px;font-size:12px}.answer{margin-top:10px;padding:13px;border-radius:13px;background:#f8eee7;color:#755445;font-size:13px;line-height:1.65}.answer p{margin:6px 0 0}.empty{padding:45px;text-align:center;color:#9c8173}@media(max-width:640px){.favorites-page{padding:20px}.title{align-items:start;flex-direction:column}.title h1{font-size:26px}}
</style>
