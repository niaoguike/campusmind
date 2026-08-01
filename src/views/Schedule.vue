<template>
  <div class="page">
    <AppNav />
    <main class="content">
      <header class="title">
        <div>
          <span class="eyebrow">LEARNING RHYTHM</span>
          <h1>课表与学习计划</h1>
          <p>按周查看课程；课程卡片只会出现在它实际开课的周次。</p>
        </div>
        <div class="header-actions">
          <button class="secondary" @click="importDialog = true">⇧ 导入教务课表</button>
          <button class="primary" @click="dialog = true">＋ 添加课程</button>
        </div>
      </header>

      <section class="import-tip">
        <span>✦</span>
        <p><b>吉林大学课表导入</b><small>PDF 会保留课程的具体周次；请导入预览后选择“替换全部”，清除之前错误的记录。</small></p>
        <button @click="importDialog = true">开始导入</button>
      </section>

      <section class="panel timetable">
        <div class="week-head">
          <div>
            <span class="week-kicker">{{ semesterName }}</span>
            <h2>第 {{ selectedWeek }} 周</h2>
            <p>{{ weekRange }}</p>
          </div>
          <div class="week-actions">
            <button class="week-nav" :disabled="selectedWeek <= 1" @click="changeWeek(-1)">‹ 上一周</button>
            <button class="week-nav" :disabled="selectedWeek >= weekCount" @click="changeWeek(1)">下一周 ›</button>
            <button class="week-nav" @click="openTermDateDialog">修改第一周日期</button>
            <div class="more-wrap">
              <button class="secondary more" @click="moreWeeks = !moreWeeks">▦ 展开更多课表</button>
              <div v-if="moreWeeks" class="week-picker">
                <div class="picker-title"><b>选择周次</b><button @click="moreWeeks = false">×</button></div>
                <div class="week-grid">
                  <button v-for="week in weekCount" :key="week" :class="{ active: week === selectedWeek }" @click="pickWeek(week)">第{{ week }}周</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="schedule-grid">
          <div class="grid-corner">节次 / 时间</div>
          <div v-for="(day, index) in days" :key="day" class="day-head"><b>{{ day }}</b><small>{{ dateForDay(index) }}</small></div>
          <template v-for="slot in classSlots" :key="slot.no">
            <div class="time-slot" :style="{ gridRow: slot.no + 1 }"><b>第{{ slot.no }}节</b><small>{{ slot.time }}</small><em v-if="slot.breakAfter">{{ slot.breakAfter }}</em></div>
            <template v-for="day in 7" :key="`${slot.no}-${day}`">
              <div v-if="slotIsEmpty(day, slot.no)" class="empty-slot" :style="{ gridColumn: day + 1, gridRow: slot.no + 1 }">空闲</div>
            </template>
          </template>
          <article v-for="item in weekItems" :key="item.id" class="course-block" :style="cardStyle(item)">
            <button title="删除课程" @click="remove(item.id)">×</button>
            <b>{{ item.course_name }}</b>
            <small>{{ timeLabel(item) }} · {{ clockRange(item) }}<br>{{ item.location || '地点待补充' }}</small>
            <em>{{ weekText(item.weeks) }}</em>
          </article>
        </div>
      </section>

      <section class="plan-section">
        <div><h2>我的计划草稿</h2><p>Agent 写入的是草稿；确认后才会进入执行状态。</p></div>
        <article v-for="plan in plans" :key="plan.id" class="plan-card"><div><span :class="plan.status">{{ plan.status === 'active' ? '进行中' : '待确认' }}</span><b>{{ plan.title }}</b><p>{{ plan.content }}</p></div><div class="plan-actions"><button class="secondary" @click="editPlan(plan)">修改</button><button class="danger" @click="deletePlan(plan)">删除</button><button v-if="plan.status === 'draft'" class="primary" @click="activate(plan.id)">确认执行</button></div></article>
        <div v-if="!plans.length" class="empty-card">暂无计划。<router-link to="/home">去让 Agent 帮你安排</router-link></div>
      </section>
    </main>

    <el-dialog v-model="dialog" title="添加一节课" width="420px">
      <el-form label-position="top"><el-form-item label="课程名称"><el-input v-model="form.course_name" /></el-form-item><el-form-item label="星期"><el-select v-model="form.weekday" style="width:100%"><el-option v-for="(day, index) in days" :key="day" :label="day" :value="index + 1" /></el-select></el-form-item><div class="times"><el-form-item label="开始"><el-time-select v-model="form.start_time" start="08:00" step="00:30" end="21:00" /></el-form-item><el-form-item label="结束"><el-time-select v-model="form.end_time" start="08:00" step="00:30" end="21:00" /></el-form-item></div><el-form-item label="地点"><el-input v-model="form.location" /></el-form-item></el-form>
      <template #footer><button class="primary" @click="save">保存课程</button></template>
    </el-dialog>

    <el-dialog v-model="termDateDialog" title="修改第一周第一天" width="420px">
      <p class="date-dialog-note">请选择该学期第 1 周的周一。保存后，第 2 周及之后所有日期会自动顺延计算。</p>
      <el-date-picker v-model="editedTermStart" type="date" value-format="YYYY-MM-DD" format="YYYY 年 MM 月 DD 日" :clearable="false" style="width:100%" />
      <template #footer><button class="cancel" @click="termDateDialog = false">取消</button><button class="primary" @click="saveTermStart">保存并重新计算日期</button></template>
    </el-dialog>

    <el-dialog v-model="importDialog" title="导入吉林大学教务课表" width="620px" :close-on-click-modal="!importing">
      <template v-if="!preview.length">
        <div class="import-steps"><span>1</span><p>登录教务系统，在“我的教学 → 我的课表”选择导出。</p><span>2</span><p>将导出的 Excel、CSV 或 PDF 课表文件直接拖入下方区域。</p><span>3</span><p>上传后核对课程、周次和地点，再确认导入。</p></div>
        <input ref="fileInput" class="file-input" type="file" accept=".xlsx,.xls,.csv,.pdf" @change="chooseFile" />
        <div class="file-select-panel">
          <span>📄</span>
          <b>无需拖入文件，直接从电脑中选择</b>
          <small>支持 Excel、CSV、PDF 格式，单个文件最大 5MB</small>
          <button type="button" class="primary file-picker" :disabled="importing" @click="fileInput?.click()">{{ importing ? '正在识别课表…' : '选择课表文件' }}</button>
        </div>
        <div class="drop-zone" :class="{ dragging }" @click="fileInput?.click()" @dragenter.prevent="dragging = true" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dropFile"><span>⇧</span><b>{{ importing ? '正在识别课表…' : '将课表文件直接拖到这里' }}</b><small>或点击选择单个文件 · 支持 Excel、CSV、PDF · 最大 5MB</small></div>
        <p v-if="selectedFile" class="file-name">已选择：{{ selectedFile.name }}</p><p class="file-hint">平台不会保存原始课表文件，只保存你确认导入的课程、周次和地点。</p>
      </template>
      <template v-else>
        <div class="preview-head"><div><b>已识别 {{ preview.length }} 条上课安排</b><small>{{ previewSemesterText }}。请核对后导入。</small></div><el-radio-group v-model="importMode"><el-radio-button value="append">追加</el-radio-button><el-radio-button value="replace">替换全部</el-radio-button></el-radio-group></div>
        <el-alert v-for="warning in warnings" :key="warning" :title="warning" type="warning" :closable="false" show-icon />
        <el-table :data="preview" max-height="280" class="preview-table"><el-table-column label="课程" prop="course_name" /><el-table-column label="周次" width="100"><template #default="scope">{{ weekText(scope.row.weeks) }}</template></el-table-column><el-table-column label="星期" width="70"><template #default="scope">{{ days[scope.row.weekday - 1] }}</template></el-table-column><el-table-column label="节次" width="130"><template #default="scope">{{ timeLabel(scope.row) }}</template></el-table-column><el-table-column label="地点" prop="location" /></el-table>
        <p class="replace-note" v-if="importMode === 'replace'">确认后会删除当前课表，再写入本次解析出的准确周次记录。</p>
      </template>
      <template #footer><button v-if="preview.length" class="cancel" @click="resetImport">重新选择</button><button v-if="preview.length" class="primary" :disabled="importing" @click="confirmImport">确认导入 {{ preview.length }} 条安排</button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppNav from '../components/AppNav.vue'
import { api, post } from '../utils/api'

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const fallbackStart = '2026-03-09'
const classSlots = [
  { no: 1, time: '08:00–08:45' }, { no: 2, time: '08:55–09:40', breakAfter: '课间 09:40–10:00' },
  { no: 3, time: '10:00–10:45' }, { no: 4, time: '10:55–11:40', breakAfter: '午休 11:40–13:30' },
  { no: 5, time: '13:30–14:15' }, { no: 6, time: '14:25–15:10', breakAfter: '课间 15:10–15:30' },
  { no: 7, time: '15:30–16:15' }, { no: 8, time: '16:25–17:10', breakAfter: '晚餐 17:10–18:20' },
  { no: 9, time: '18:20–19:05' }, { no: 10, time: '19:05–19:50', breakAfter: '休息 19:50–20:00' },
  { no: 11, time: '20:00–20:45' }, { no: 12, time: '20:45–21:30' }
]
const items = ref([]), plans = ref([]), dialog = ref(false), moreWeeks = ref(false), selectedWeek = ref(1), termDateDialog = ref(false), editedTermStart = ref('')
const form = ref({ course_name: '', weekday: 1, start_time: '', end_time: '', location: '' })
const route = useRoute()
const importDialog = ref(false), fileInput = ref(null), selectedFile = ref(null), preview = ref([]), warnings = ref([]), importToken = ref(''), importing = ref(false), importMode = ref('replace'), dragging = ref(false), previewStart = ref(''), previewSemester = ref('')

const semesterStart = computed(() => items.value.find(item => item.semester_start)?.semester_start || fallbackStart)
const semesterName = computed(() => items.value.find(item => item.semester_key)?.semester_key?.replace(/(\d{4}-\d{4})-(\d)/, '$1学年第$2学期') || '当前课表')
const weekCount = computed(() => Math.max(16, ...items.value.flatMap(item => weekNumbers(item.weeks))))
const weekRange = computed(() => `${formatDate(addDays(semesterStart.value, (selectedWeek.value - 1) * 7))} — ${formatDate(addDays(semesterStart.value, (selectedWeek.value - 1) * 7 + 6))}`)
const previewSemesterText = computed(() => previewStart.value ? `${previewSemester.value || '本学期'} · 第 1 周从 ${formatDate(previewStart.value)} 开始` : '未读取到学期起始日期，导入后将按第一周显示')

function parseDate(value) { return new Date(`${value}T12:00:00`) }
function addDays(start, offset) { const date = parseDate(start); date.setDate(date.getDate() + offset); return date }
function formatDate(value) { const date = value instanceof Date ? value : parseDate(value); return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}` }
function dateForDay(index) { return formatDate(addDays(semesterStart.value, (selectedWeek.value - 1) * 7 + index)).slice(5) }
function weekNumbers(value) { return [...String(value || '1-16').matchAll(/(\d+)(?:-(\d+))?/g)].flatMap(match => [Number(match[1]), Number(match[2] || match[1])]).filter(Number.isFinite) }
function matchesWeek(value, week) { const ranges = [...String(value || '1-16').matchAll(/(\d+)(?:-(\d+))?/g)]; return ranges.some(match => week >= Number(match[1]) && week <= Number(match[2] || match[1])) }
function weekText(value) { return String(value || '1-16').split(',').map(part => `第${part}周`).join('、') }
const weekItems = computed(() => items.value.filter(item => matchesWeek(item.weeks, selectedWeek.value)))
function sectionBounds(item) { const match = String(item.start_time || '').match(/第(\d+)节-第(\d+)节/); if (match) return { start: Number(match[1]), end: Number(match[2]) }; const slot = classSlots.find(value => String(item.start_time || '').startsWith(value.time.slice(0, 5))); return { start: slot?.no || 1, end: slot?.no || 1 } }
function slotIsEmpty(day, section) { return !weekItems.value.some(item => { const bounds = sectionBounds(item); return item.weekday === day && bounds.start <= section && section <= bounds.end }) }
function cardStyle(item) { const bounds = sectionBounds(item); return { gridColumn: item.weekday + 1, gridRow: `${bounds.start + 1} / span ${bounds.end - bounds.start + 1}`, borderLeftColor: item.color || '#c96d42' } }
function clockRange(item) { const bounds = sectionBounds(item); const start = classSlots[bounds.start - 1]?.time.split('–')[0]; const end = classSlots[bounds.end - 1]?.time.split('–')[1]; return start && end ? `${start}–${end}` : '' }
function timeLabel(item) { return item.start_time === item.end_time ? item.start_time : `${item.start_time}–${item.end_time}` }
function changeWeek(step) { selectedWeek.value = Math.min(weekCount.value, Math.max(1, selectedWeek.value + step)) }
function pickWeek(week) { selectedWeek.value = week; moreWeeks.value = false }
function openTermDateDialog() { editedTermStart.value = semesterStart.value; termDateDialog.value = true }
async function saveTermStart() { try { const result = await api('/schedules/semester-start', { method: 'PATCH', body: JSON.stringify({ semester_start: editedTermStart.value, semester_key: items.value.find(item => item.semester_key)?.semester_key || '' }) }); ElMessage.success(result.message); termDateDialog.value = false; await load() } catch (error) { ElMessage.error(error.message) } }
function setDefaultWeek() { const today = new Date(); const start = parseDate(semesterStart.value); const diff = Math.floor((today - start) / 86400000); const current = Math.floor(diff / 7) + 1; selectedWeek.value = current >= 1 && current <= weekCount.value ? current : 1 }
async function load() { items.value = await api('/schedules'); plans.value = await api('/plans'); setDefaultWeek() }
async function save() { try { await post('/schedules', form.value); dialog.value = false; form.value = { course_name: '', weekday: 1, start_time: '', end_time: '', location: '' }; await load() } catch (error) { ElMessage.error(error.message) } }
async function remove(id) { await api(`/schedules/${id}`, { method: 'DELETE' }); await load() }
async function activate(id) { await api(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }); await load() }
async function editPlan(plan) { try { const titleResult = await ElMessageBox.prompt('修改计划标题', '编辑学习计划', { inputValue: plan.title, inputPlaceholder: '例如：完成本周复习', inputValidator: value => value.trim() ? true : '标题不能为空' }); const contentResult = await ElMessageBox.prompt('修改计划内容', '编辑学习计划', { inputValue: plan.content, inputType: 'textarea', inputRows: 8, inputPlaceholder: '写下可执行的学习任务', inputValidator: value => value.trim() ? true : '内容不能为空' }); const result = await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ title: titleResult.value, content: contentResult.value }) }); ElMessage.success(result.message); await load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '修改计划失败') } }
async function deletePlan(plan) { try { await ElMessageBox.confirm(`确定删除“${plan.title}”吗？此操作无法恢复。`, '删除学习计划', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }); const result = await api(`/plans/${plan.id}`, { method: 'DELETE' }); ElMessage.success(result.message); await load() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error.message || '删除计划失败') } }
async function uploadFile(file) { if (!file) return; if (!/\.(xlsx|xls|csv|pdf)$/i.test(file.name)) return ElMessage.warning('请选择 Excel、CSV 或 PDF 课表文件'); if (file.size > 5 * 1024 * 1024) return ElMessage.warning('课表文件不能超过 5MB'); selectedFile.value = file; importing.value = true; const data = new FormData(); data.append('file', file); try { const result = await api('/schedules/import-preview', { method: 'POST', body: data }); preview.value = result.entries; warnings.value = result.warnings || []; importToken.value = result.import_token; previewStart.value = result.semester_start || ''; previewSemester.value = result.semester_key?.replace(/(\d{4}-\d{4})-(\d)/, '$1学年第$2学期') || '' } catch (error) { ElMessage.error(error.message) } finally { importing.value = false } }
function chooseFile(event) { uploadFile(event.target.files?.[0]) }
function dropFile(event) { dragging.value = false; importDialog.value = true; uploadFile(event.dataTransfer.files?.[0]) }
async function confirmImport() { importing.value = true; try { const result = await post('/schedules/import-confirm', { import_token: importToken.value, mode: importMode.value }); ElMessage.success(result.message); resetImport(); importDialog.value = false; await load() } catch (error) { ElMessage.error(error.message) } finally { importing.value = false } }
function resetImport() { selectedFile.value = null; preview.value = []; warnings.value = []; importToken.value = ''; importMode.value = 'replace'; dragging.value = false; previewStart.value = ''; previewSemester.value = ''; if (fileInput.value) fileInput.value.value = '' }
onMounted(() => { load().catch(error => ElMessage.error(error.message)); if (route.query.import === '1') importDialog.value = true })
</script>

<style scoped>
.content{max-width:1180px;margin:auto;padding:36px 5vw}.title{display:flex;justify-content:space-between;align-items:end;margin-bottom:19px}.eyebrow{font-size:11px;color:#b26b4a;letter-spacing:1.3px;font-weight:800}.title h1{color:#623a2b;margin:5px 0;font-size:31px}.title p{color:#92776a;margin:0}.header-actions,.week-actions{display:flex;gap:9px;align-items:center}.primary,.secondary,.week-nav{border:0;border-radius:13px;padding:10px 15px;font-weight:700;cursor:pointer}.primary{background:#c96d42;color:#fff}.secondary,.week-nav{background:#fff0e4;color:#ab5735;border:1px solid #efc9b7}.week-nav:disabled{opacity:.45;cursor:not-allowed}.import-tip{display:flex;align-items:center;gap:12px;border:1px solid #f0d7c8;background:#fff5ed;border-radius:19px;padding:13px 16px;margin:0 0 20px;color:#774d3b}.import-tip>span{width:36px;height:36px;display:grid;place-items:center;border-radius:12px;background:#c96d42;color:#fff}.import-tip p{margin:0;flex:1}.import-tip b,.import-tip small{display:block}.import-tip small{font-size:12px;color:#9c7665;margin-top:3px}.import-tip button{border:0;background:transparent;color:#ae5938;font-weight:700;cursor:pointer}.panel,.plan-card,.empty-card{background:#fffdfa;border:1px solid #f1e2d8;border-radius:22px;box-shadow:0 10px 30px #9f4c2b0d}.timetable{padding:19px}.week-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.week-kicker{font-size:12px;color:#b26b4a;font-weight:800}.week-head h2{margin:3px 0;color:#683e2d}.week-head p{margin:0;color:#97796b;font-size:13px}.more-wrap{position:relative}.more{white-space:nowrap}.week-picker{position:absolute;right:0;top:44px;z-index:8;width:275px;background:#fffdf9;border:1px solid #ead5c7;border-radius:18px;box-shadow:0 16px 38px #78422a24;padding:14px}.picker-title{display:flex;justify-content:space-between;color:#704331;margin-bottom:10px}.picker-title button{border:0;background:transparent;color:#a06850;font-size:18px;cursor:pointer}.week-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.week-grid button{border:1px solid #efd8ca;background:#fff7f1;color:#85533d;border-radius:10px;padding:8px 4px;font-size:12px;cursor:pointer}.week-grid button.active{background:#c96d42;color:#fff;border-color:#c96d42}.days{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;min-height:290px}.days>div{background:#fff8f2;border-radius:16px;padding:11px;min-width:0}.days>div>b{display:block;font-size:13px;color:#9c6045}.days>div>small{font-size:11px;color:#bb9783}.days p{color:#d7b9a8;text-align:center;font-size:12px;margin-top:28px}.days article{position:relative;border-left:4px solid #c96d42;border-radius:9px;background:#fff;padding:8px;margin-top:10px;font-size:12px;box-shadow:0 3px 9px #94603a12}.days article>b{display:block;color:#714432;padding-right:12px}.days article small{display:block;color:#9a7b6d;margin-top:4px;line-height:1.45}.days article em{display:inline-block;margin-top:5px;font-size:10px;font-style:normal;color:#b35d3a;background:#fff0e7;border-radius:8px;padding:2px 5px}.days article button{position:absolute;right:5px;top:3px;border:0;background:none;color:#c49b86;cursor:pointer}.plan-section{margin-top:30px;max-width:800px}.plan-section h2{color:#653d2d;margin-bottom:3px}.plan-section>div p{color:#987d70;margin-top:0;font-size:14px}.plan-card{margin-top:12px;padding:17px;display:flex;justify-content:space-between;gap:16px}.plan-card b{display:block;color:#704332;margin:8px 0}.plan-card p{color:#8e7468;margin:0;white-space:pre-wrap}.plan-card span{font-size:11px;padding:4px 7px;border-radius:10px;background:#fff0e4;color:#a85b3a}.plan-card span.active{background:#edf7ed;color:#518752}.empty-card{padding:25px;color:#987c70}.times{display:grid;grid-template-columns:1fr 1fr;gap:10px}.import-steps{display:grid;grid-template-columns:30px 1fr;gap:11px;align-items:center;margin-bottom:22px;color:#85685b}.import-steps span{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:#fff0e4;color:#b65c38;font-weight:800;font-size:12px}.import-steps p{margin:0;font-size:13px;line-height:1.45}.file-input{display:none}.file-name{font-size:13px;color:#795d50;text-align:center;margin:12px}.file-hint{font-size:12px;color:#a48677;line-height:1.55;text-align:center}.preview-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:14px}.preview-head b,.preview-head small{display:block}.preview-head small{font-size:12px;color:#9c8173;margin-top:4px;max-width:340px}.preview-table{margin-top:12px}.replace-note{font-size:12px;color:#b14f35}.cancel{background:none;border:0;color:#a46145;padding:9px;cursor:pointer}@media(max-width:860px){.week-head{align-items:start;flex-direction:column;gap:12px}.week-actions{flex-wrap:wrap}}@media(max-width:760px){.content{padding:20px}.days{display:flex;overflow:auto}.days>div{min-width:140px}.title{align-items:start;flex-direction:column}.header-actions{width:100%}.header-actions button{flex:1}.import-tip{align-items:start}.import-tip button{display:none}.preview-head{flex-direction:column}.title h1{font-size:26px}.week-picker{right:auto;left:0}}
.date-dialog-note{margin:0 0 16px;color:#8e7468;line-height:1.65;font-size:13px}.schedule-grid{display:grid;grid-template-columns:92px repeat(7,minmax(118px,1fr));grid-template-rows:50px repeat(12,72px);gap:5px;min-width:970px}.grid-corner,.day-head,.time-slot,.empty-slot{border-radius:12px}.grid-corner{display:grid;place-items:center;background:#f7e6da;color:#9d6044;font-size:12px;font-weight:800}.day-head{padding:9px 11px;background:#fff4ec;color:#87523b}.day-head b,.day-head small{display:block}.day-head small{font-size:11px;color:#b58b75;margin-top:2px}.time-slot{position:relative;padding:9px 7px;background:#fff6f0;color:#86563f}.time-slot b,.time-slot small{display:block}.time-slot b{font-size:12px}.time-slot small{font-size:11px;color:#aa806a;margin-top:3px}.time-slot em{position:absolute;z-index:2;left:4px;bottom:-17px;width:86px;text-align:center;font-size:9px;line-height:1.1;font-style:normal;color:#bc907b}.empty-slot{background:repeating-linear-gradient(-45deg,#fffaf6,#fffaf6 7px,#fdf3eb 7px,#fdf3eb 14px);border:1px dashed #ecd9cc;color:#d2ae99;display:grid;place-items:center;font-size:11px}.course-block{position:relative;z-index:3;margin:2px;border-left:4px solid #c96d42;border-radius:10px;background:#fff;padding:8px;font-size:12px;box-shadow:0 4px 12px #94603a18;overflow:hidden}.course-block>b{display:block;color:#714432;padding-right:13px}.course-block small{display:block;color:#9a7b6d;margin-top:4px;line-height:1.4}.course-block em{display:inline-block;margin-top:4px;font-size:10px;font-style:normal;color:#b35d3a;background:#fff0e7;border-radius:8px;padding:2px 5px}.course-block button{position:absolute;right:5px;top:3px;border:0;background:none;color:#c49b86;cursor:pointer}.timetable{overflow-x:auto}@media(max-width:760px){.schedule-grid{grid-template-columns:78px repeat(7,minmax(112px,1fr));grid-template-rows:48px repeat(12,72px)}}
.drop-zone{display:none!important}
.import-steps p:nth-of-type(2){font-size:0}.import-steps p:nth-of-type(2)::after{content:'点击下方“选择课表文件”按钮即可，无需拖入。';font-size:13px;line-height:1.45}
.file-select-panel{display:grid;justify-items:center;gap:9px;border:1px dashed #e5bba7;border-radius:18px;background:#fff7f1;padding:25px 18px;text-align:center;color:#7a5140}.file-select-panel>span{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:#ffe7d7;font-size:20px}.file-select-panel b{font-size:15px}.file-select-panel small{color:#9e7d6d;font-size:12px}.file-picker{margin-top:5px;min-width:158px}.file-picker:disabled{opacity:.65;cursor:not-allowed}
</style>
