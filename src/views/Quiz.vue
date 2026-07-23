<template>
  <div class="page">
    <AppNav />
    <main class="quiz-page">
      <section class="hero panel">
        <div><span class="eyebrow">PERSONAL AGENT · ACTIVE RECALL</span><h1>让专属 Agent 为你出题</h1><p>从平台已解析的课程资料中生成练习。提交答案后，客观题自动判定，简答题由 Agent 逐项批改并生成复习建议。</p></div>
        <div class="hero-mark">✦</div>
      </section>

      <section v-if="step === 'config'" class="config panel">
        <div class="section-title"><div><span class="eyebrow">STEP 1</span><h2>设置本次练习</h2></div><span>题目只依据资料库内容生成</span></div>
        <label>选择课程</label>
        <el-select v-model="courseId" placeholder="请选择课程" size="large" style="width:100%"><el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" /></el-select>
        <label>补充知识点（可选）</label>
        <el-input v-model="topic" placeholder="例如：第一章、链表、二叉树遍历；不填则覆盖整门课程" maxlength="120" size="large" />
        <label>各题型数量</label>
        <div class="type-grid"><label v-for="item in quizTypes" :key="item.key"><span>{{ item.label }}</span><el-input-number v-model="typeCounts[item.key]" :min="0" :max="10" controls-position="right" /></label></div>
        <label>出题备注（可选）</label>
        <el-input v-model="note" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="例如：侧重第一章概念辨析；难度偏期末考试；多考易混淆知识点。" />
        <div class="notice">当前共 {{ totalQuestions }} 题。请先在“课程资料”中上传并等待资料显示“AI 已可检索”；Agent 会严格按题型数量和备注生成。</div>
        <button class="primary" :disabled="loading || !courseId || totalQuestions < 1 || totalQuestions > 20" @click="generateQuiz">{{ loading ? 'Agent 正在出题…' : '生成互动练习' }}</button>
      </section>

      <section v-else-if="step === 'taking'" class="exam panel">
        <header class="exam-header"><div><span class="eyebrow">AI GENERATED QUIZ</span><h2>{{ quiz.title }}</h2><p>{{ quiz.topic }} · {{ quiz.questions.length }} 道题</p></div><button class="plain" :disabled="loading" @click="restart">重新设置</button></header>
        <article v-for="(question, index) in quiz.questions" :key="question.id" class="question-card">
          <div class="question-title"><b>{{ index + 1 }}</b><span>{{ typeLabel(question.type) }}</span><p>{{ question.stem }}</p></div>
          <el-radio-group v-if="question.type === 'single' || question.type === 'true_false'" v-model="answers[question.id]" class="options"><el-radio v-for="(option, optionIndex) in question.options" :key="optionIndex" :value="letter(optionIndex)">{{ letter(optionIndex) }}. {{ displayOption(option) }}</el-radio></el-radio-group>
          <el-checkbox-group v-else-if="question.type === 'multiple'" v-model="answers[question.id]" class="options"><el-checkbox v-for="(option, optionIndex) in question.options" :key="optionIndex" :value="letter(optionIndex)">{{ letter(optionIndex) }}. {{ displayOption(option) }}</el-checkbox></el-checkbox-group>
          <el-input v-else-if="question.type === 'fill_blank'" v-model="answers[question.id]" maxlength="300" placeholder="请填写答案…" />
          <el-input v-else v-model="answers[question.id]" type="textarea" :rows="5" maxlength="1200" show-word-limit placeholder="请写下你的理解、推导或关键要点…" />
          <button class="favorite-button" :disabled="favoriteLoading[question.id]" @click="toggleFavorite(question)">{{ favoriteIds[question.id] ? '★ 已收藏' : '☆ 收藏此题' }}</button>
        </article>
        <footer class="exam-footer"><span>作答后会由 Agent 给出逐题解析和薄弱点建议</span><button class="primary" :disabled="loading" @click="submitQuiz">{{ loading ? 'Agent 正在批改…' : '提交并获取 AI 批改' }}</button></footer>
      </section>

      <section v-else class="result panel">
        <div class="score-card"><span>本次得分</span><strong>{{ quiz.score }}<small> / {{ quiz.total_score }}</small></strong><p>{{ quiz.result?.analysis }}</p></div>
        <div class="next-steps"><b>Agent 的复习建议</b><ul><li v-for="(item, index) in quiz.result?.next_steps || []" :key="index">{{ item }}</li></ul></div>
        <article v-for="(question, index) in quiz.result?.question_results || []" :key="question.id" class="feedback-card" :class="{ correct: question.correct }"><div><b>第 {{ index + 1 }} 题 · {{ question.score }}/{{ question.max_score }} 分</b><span>{{ question.correct ? '掌握不错' : '需要复盘' }}</span></div><p>{{ question.feedback }}</p><small>参考答案：{{ formatAnswer(question.correct_answer) }}<br>解析：{{ question.explanation }}<br>资料来源：{{ question.source }}</small><button class="favorite-button" :disabled="favoriteLoading[question.id]" @click="toggleFavorite(question)">{{ favoriteIds[question.id] ? '★ 已收藏' : '☆ 收藏此题' }}</button></article>
        <footer class="result-footer"><button class="primary" @click="restart">再来一套练习</button></footer>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api, post } from '../utils/api'

const step = ref('config')
const topic = ref('')
const courses = ref([])
const courseId = ref(null)
const typeCounts = ref({ single: 2, multiple: 1, true_false: 0, fill_blank: 1, short: 1 })
const note = ref('')
const quizTypes = [{ key: 'single', label: '单选题' }, { key: 'multiple', label: '多选题' }, { key: 'true_false', label: '判断题' }, { key: 'fill_blank', label: '填空题' }, { key: 'short', label: '简答题' }]
const totalQuestions = computed(() => Object.values(typeCounts.value).reduce((sum, count) => sum + (Number(count) || 0), 0))
const loading = ref(false)
const quiz = ref(null)
const answers = ref({})
const favoriteIds = ref({})
const favoriteLoading = ref({})
const letter = index => String.fromCharCode(65 + index)
const typeLabel = type => ({ single: '单选题', multiple: '多选题', true_false: '判断题', fill_blank: '填空题', short: '简答题' })[type] || '练习题'
const displayOption = option => String(option || '').trim().replace(/^(?:选项\s*)?[A-F]\s*[\.、．)）:：]\s*/i, '')
const formatAnswer = answer => Array.isArray(answer) ? answer.join('、') : String(answer || '—')

async function generateQuiz () {
  loading.value = true
  try {
    const data = await post('/quizzes/generate', { course_id: courseId.value, topic: topic.value.trim(), question_counts: typeCounts.value, note: note.value.trim() })
    quiz.value = data.quiz
    answers.value = Object.fromEntries(data.quiz.questions.map(question => [question.id, question.type === 'multiple' ? [] : '']))
    favoriteIds.value = {}
    step.value = 'taking'
  } catch (error) { ElMessage.error(error.message) } finally { loading.value = false }
}
async function submitQuiz () {
  const unanswered = quiz.value.questions.some(question => question.type === 'multiple' ? !answers.value[question.id]?.length : !String(answers.value[question.id] || '').trim())
  if (unanswered && !confirm('还有题目未作答，仍要提交吗？')) return
  loading.value = true
  try { const data = await post(`/quizzes/${quiz.value.id}/submit`, { answers: answers.value }); quiz.value = data.quiz; step.value = 'result' } catch (error) { ElMessage.error(error.message) } finally { loading.value = false }
}
function restart () { step.value = 'config'; quiz.value = null; answers.value = {} }
async function toggleFavorite (question) {
  if (!quiz.value) return
  favoriteLoading.value = { ...favoriteLoading.value, [question.id]: true }
  try {
    if (favoriteIds.value[question.id]) {
      await api(`/favorites/${favoriteIds.value[question.id]}`, { method: 'DELETE' })
      const next = { ...favoriteIds.value }; delete next[question.id]; favoriteIds.value = next; ElMessage.success('已取消收藏')
    } else {
      const data = await post(`/quizzes/${quiz.value.id}/questions/${question.id}/favorite`, {})
      favoriteIds.value = { ...favoriteIds.value, [question.id]: data.id }; ElMessage.success(data.message)
    }
  } catch (error) { ElMessage.error(error.message) } finally { favoriteLoading.value = { ...favoriteLoading.value, [question.id]: false } }
}
onMounted(async () => { try { courses.value = await api('/courses'); courseId.value = courses.value[0]?.id || null } catch (error) { ElMessage.error(error.message) } })
</script>

<style scoped>
.quiz-page{max-width:900px;margin:auto;padding:34px 5vw 60px}.panel{background:#fffdfa;border:1px solid #f1e2d8;border-radius:24px;box-shadow:0 10px 30px #9f4c2b0d}.hero{padding:31px;display:flex;justify-content:space-between;gap:20px;align-items:center;background:linear-gradient(135deg,#fff6ee,#fce5d5)}.eyebrow{font-size:11px;letter-spacing:1.4px;color:#b47b62;font-weight:800}.hero h1{font-size:32px;color:#603827;margin:7px 0}.hero p{max-width:620px;margin:0;color:#927567;line-height:1.7}.hero-mark{display:grid;place-items:center;width:76px;height:76px;flex:none;border-radius:25px;background:#c96d42;color:#fff;font-size:36px;box-shadow:0 10px 24px #c96d4266}.config,.exam,.result{margin-top:20px;padding:28px}.section-title,.exam-header{display:flex;justify-content:space-between;align-items:flex-start;gap:15px}.section-title h2,.exam-header h2{margin:5px 0;color:#63402f}.section-title>span,.exam-header p{font-size:12px;color:#a08375;margin:6px 0}.config label{display:block;color:#805b49;font-size:13px;font-weight:700;margin:20px 0 8px}.count-select{display:flex;flex-wrap:wrap}.notice{margin:22px 0;padding:14px;border-radius:15px;background:#fff1e6;color:#956a56;font-size:13px;line-height:1.65}.primary{background:#c96d42;color:white;border:0;border-radius:14px;padding:11px 17px;font-weight:700;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.plain{border:0;background:#fff0e5;color:#a75b3e;border-radius:12px;padding:9px 12px;font-weight:700;cursor:pointer}.question-card{padding:18px;margin-top:15px;border:1px solid #efdfd5;border-radius:19px;background:#fffdfb}.question-title{display:flex;align-items:flex-start;gap:9px;color:#5d3d2f}.question-title>b{display:grid;place-items:center;width:25px;height:25px;flex:none;border-radius:9px;background:#fce2d1;color:#ae5e3c}.question-title>span{font-size:11px;color:#af6949;background:#fff0e5;border-radius:9px;padding:4px 6px;white-space:nowrap}.question-title p{margin:2px 0 0;line-height:1.65;flex:1}.options{display:grid;gap:9px;margin:16px 0 0 34px}.exam-footer,.result-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;margin-top:25px}.exam-footer span{font-size:12px;color:#a08375}.score-card{text-align:center;padding:25px;border-radius:21px;background:linear-gradient(135deg,#fff0e5,#fbdfcc);color:#744431}.score-card span{font-size:13px}.score-card strong{display:block;font-size:52px;line-height:1.15;color:#c5623a;margin:4px}.score-card strong small{font-size:18px;color:#9e745e}.score-card p{font-size:13px;line-height:1.65;margin:10px 0 0}.next-steps{padding:16px;margin:16px 0;border-radius:17px;background:#f9eee6;color:#725343}.next-steps ul{margin:7px 0 0;padding-left:20px;font-size:13px;line-height:1.75}.feedback-card{padding:16px;margin:12px 0;border-radius:17px;background:#fff4ef;border-left:4px solid #d47a58}.feedback-card.correct{background:#f0f8ef;border-left-color:#74a570}.feedback-card>div{display:flex;justify-content:space-between;color:#714837;font-size:13px}.feedback-card>div span{font-size:12px;color:#a5735d}.feedback-card p{color:#73584a;margin:9px 0;font-size:13px;line-height:1.6}.feedback-card small{color:#9a7e70;line-height:1.65}@media(max-width:650px){.quiz-page{padding:18px 4vw}.hero,.config,.exam,.result{padding:20px}.hero h1{font-size:26px}.hero-mark{width:55px;height:55px;border-radius:18px;font-size:26px}.exam-footer{align-items:flex-end;flex-direction:column}.section-title>span{display:none}.options{margin-left:8px}.score-card strong{font-size:42px}}
.type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.type-grid label{margin:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #f0ded3;border-radius:13px;background:#fffaf7}.type-grid span{font-size:13px;color:#805b49}.type-grid :deep(.el-input-number){width:105px}.favorite-button{margin-top:13px;border:0;border-radius:10px;background:#fff0e5;color:#a85a3d;padding:7px 10px;font-size:12px;font-weight:700;cursor:pointer}.favorite-button:disabled{opacity:.6;cursor:wait}
</style>
