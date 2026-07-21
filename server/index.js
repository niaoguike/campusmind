import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { ChatOpenAI } from '@langchain/openai'
import { createAgent, tool } from 'langchain'
import { z } from 'zod'
import multer from 'multer'
import XLSX from 'xlsx'

dotenv.config()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production'
const KEY_SECRET = process.env.LLM_CONFIG_ENCRYPTION_KEY || JWT_SECRET
const SUPPORTED_DEEPSEEK_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro'])
const db = new Database(path.join(__dirname, 'data.db'))
db.pragma('journal_mode = WAL')
const now = () => new Date().toISOString()
const execFileAsync = promisify(execFile)
// Official JLU calendar: the first teaching week of 2025-2026 semester 2
// starts on Monday, 2026-03-09. Future semesters can be added here.
const SEMESTER_STARTS = { '2025-2026-2': '2026-03-09' }
const scheduleImportCache = new Map()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(xlsx|xls|csv|pdf)$/i.test(file.originalname || '')
    cb(allowed ? null : new Error('仅支持 Excel、CSV 或 PDF 课表文件'), allowed)
  }
})

const DAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 }
const HEADER_ALIASES = {
  course: ['课程名称', '课程', '课程名', '教学班名称', '课程名称(中文)'],
  time: ['上课时间', '时间', '上课节次', '节次', '起止时间', '授课时间'],
  weekday: ['星期', '星期几', '上课星期', '周次'],
  location: ['上课地点', '上课教室', '地点', '教室', '教学地点']
}
function headerIndex (headers, names) { return headers.findIndex(value => names.some(name => String(value).replace(/\s/g, '').includes(name))) }
function parseWeekday (value) {
  const text = String(value || '')
  const match = text.match(/(?:星期|周)\s*([一二三四五六日天1-7])/) || text.match(/^\s*([一二三四五六日天])\s*$/)
  return match ? DAY_MAP[match[1]] : null
}
function normalizeTime (value) {
  const text = String(value || '').replace(/\s/g, '')
  const clock = text.match(/(\d{1,2}:\d{2})\s*(?:-|—|至|~)\s*(\d{1,2}:\d{2})/)
  if (clock) return { start_time: clock[1].padStart(5, '0'), end_time: clock[2].padStart(5, '0') }
  const section = text.match(/(?:第)?\d+(?:-\d+)?节/)
  if (section) return { start_time: section[0], end_time: section[0] }
  return text ? { start_time: text.slice(0, 30), end_time: text.slice(0, 30) } : null
}
function cleanCell (value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
function normalizeScheduleRow (course, dayText, timeText, location) {
  const weekday = parseWeekday(dayText) || parseWeekday(timeText)
  const time = normalizeTime(timeText || dayText)
  if (!course || !weekday || !time) return null
  return { course_name: cleanCell(course).slice(0, 100), weekday, ...time, location: cleanCell(location).slice(0, 100), color: '#c96d42' }
}
function parseGridSchedule (rows) {
  const warnings = []; const entries = []; const dayColumns = []
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex++) {
    rows[rowIndex].forEach((cell, columnIndex) => {
      const weekday = parseWeekday(cell)
      if (weekday && !dayColumns.some(item => item.columnIndex === columnIndex)) dayColumns.push({ columnIndex, weekday, headerRow: rowIndex })
    })
    if (dayColumns.length >= 3) break
  }
  if (dayColumns.length < 3) return { entries: [], warnings: ['未识别到课表的星期列。请上传教务系统导出的 Excel/CSV，或使用包含文字的 PDF。'] }
  const startRow = Math.max(...dayColumns.map(item => item.headerRow)) + 1
  for (const row of rows.slice(startRow)) {
    const timeText = row.slice(0, Math.min(3, row.length)).map(cleanCell).join(' ')
    const time = normalizeTime(timeText)
    if (!time) continue
    for (const dayColumn of dayColumns) {
      const raw = cleanCell(row[dayColumn.columnIndex])
      if (!raw || /^(无|—|-|\/)$/i.test(raw)) continue
      const parts = raw.split(/\n|;|；/).map(cleanCell).filter(Boolean)
      const course = parts.find(part => !/(星期|周[一二三四五六日天]|第?\d+(?:-\d+)?节|\d{1,2}:\d{2})/.test(part)) || parts[0]
      if (!course || course.length < 2) continue
      const location = parts.find(part => /(教|楼|馆|室|区|校)/.test(part) && part !== course) || ''
      entries.push({ course_name: course.slice(0, 100), weekday: dayColumn.weekday, ...time, location: location.slice(0, 100), color: '#c96d42' })
    }
  }
  if (entries.length) warnings.push('已按网格课表识别；请在预览中确认课程和地点是否正确。')
  return { entries: entries.slice(0, 100), warnings }
}
function parseSheetRows (rows) {
  const warnings = []; const parsed = []; let headerRow = -1
  for (let index = 0; index < Math.min(rows.length, 12); index++) {
    const joined = rows[index].map(cleanCell).join('|')
    if (/课程/.test(joined) && /(?:时间|节次|星期|周)/.test(joined)) { headerRow = index; break }
  }
  if (headerRow < 0) return parseGridSchedule(rows)
  const headers = rows[headerRow].map(cleanCell)
  const courseCol = headerIndex(headers, HEADER_ALIASES.course)
  const timeCol = headerIndex(headers, HEADER_ALIASES.time)
  const dayCol = headerIndex(headers, HEADER_ALIASES.weekday)
  const locationCol = headerIndex(headers, HEADER_ALIASES.location)
  if (courseCol < 0 || (timeCol < 0 && dayCol < 0)) return { entries: [], warnings: ['导出的表格缺少可识别的课程或时间列。'] }
  for (const row of rows.slice(headerRow + 1)) {
    const entry = normalizeScheduleRow(row[courseCol], dayCol >= 0 ? row[dayCol] : '', timeCol >= 0 ? row[timeCol] : '', locationCol >= 0 ? row[locationCol] : '')
    if (entry) parsed.push(entry)
  }
  if (!parsed.length) warnings.push('已找到表头，但未识别出可导入课程。请检查“星期”和“上课时间”是否在导出文件中。')
  return { entries: parsed.slice(0, 100), warnings }
}
async function parsePdfSchedule (buffer) {
  try {
    const module = await import('pdf-parse')
    const PDFParse = module.PDFParse
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    const lines = String(result.text || '').split(/\r?\n/).map(cleanCell).filter(Boolean)
    const entries = []
    for (const line of lines) {
      const day = parseWeekday(line); const time = normalizeTime(line)
      if (!day || !time) continue
      const course = cleanCell(line.replace(/(?:星期|周)\s*[一二三四五六日天1-7].*$/, '')).replace(/\d{1,2}:\d{2}.*/, '')
      if (course.length >= 2) entries.push({ course_name: course.slice(0, 100), weekday: day, ...time, location: '', color: '#c96d42' })
    }
    return { entries: entries.slice(0, 100), warnings: entries.length ? ['PDF 识别结果请逐项确认，复杂表格建议改用 Excel 导入。'] : ['该 PDF 未提取到可识别文本，可能为图片或复杂表格；请改用教务系统导出的 Excel。'] }
  } catch {
    return { entries: [], warnings: ['当前 PDF 无法稳定解析。请优先从教务系统导出 Excel 或 CSV 文件后上传。'] }
  }
}

async function parseJluPdfSchedule (buffer) {
  let tempDir = ''
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'campusmind-schedule-'))
    const pdfPath = path.join(tempDir, 'schedule.pdf')
    await fs.writeFile(pdfPath, buffer)
    const script = path.join(__dirname, 'pdf_schedule_extract.py')
    const { stdout } = await execFileAsync(process.env.PYTHON || 'python', [script, pdfPath], {
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    const parsed = JSON.parse(stdout)
    const entries = Array.isArray(parsed.entries) ? parsed.entries.slice(0, 100) : []
    const semesterStart = SEMESTER_STARTS[parsed.semester_key] || ''
    return { entries, semester_key: parsed.semester_key || '', semester_start: semesterStart, warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [] }
  } catch (error) {
    console.error('PDF schedule parse error:', error.message)
    return { entries: [], warnings: ['未能读取这个 PDF 课表。请确认文件来自吉林大学教务系统；若仍失败，可改用 Excel 或 CSV 文件。'] }
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, college TEXT NOT NULL, class TEXT NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'student', avatar TEXT DEFAULT '🌿', bio TEXT DEFAULT '', agent_name TEXT DEFAULT '知行', agent_avatar TEXT DEFAULT '✦', model_type TEXT DEFAULT 'deepseek', api_key TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, teacher TEXT, color TEXT DEFAULT '#d97745');
  CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, title TEXT NOT NULL, description TEXT DEFAULT '', type TEXT DEFAULT 'note', tags TEXT DEFAULT '', url TEXT DEFAULT '', uploader_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS schedules (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_name TEXT NOT NULL, weekday INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, location TEXT DEFAULT '', color TEXT DEFAULT '#d97745');
  CREATE TABLE IF NOT EXISTS study_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT DEFAULT 'draft', due_date TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS agent_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT DEFAULT '新的学习对话', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS agent_memories (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, memory_key TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, memory_key));
  CREATE TABLE IF NOT EXISTS friend_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, from_user_id INTEGER NOT NULL, to_user_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), UNIQUE(from_user_id, to_user_id));
  CREATE TABLE IF NOT EXISTS friendships (user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(user_id, friend_id));
  CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT DEFAULT 'group', owner_id INTEGER, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS conversation_members (conversation_id INTEGER, user_id INTEGER, PRIMARY KEY(conversation_id, user_id));
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, sender_id INTEGER NOT NULL, sender_type TEXT DEFAULT 'user', agent_owner_id INTEGER, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS agent_group_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, agent_owner_id INTEGER NOT NULL, requested_by_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS group_agents (conversation_id INTEGER NOT NULL, user_id INTEGER NOT NULL, auto_reply INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(conversation_id, user_id));
  CREATE TABLE IF NOT EXISTS friend_agent_access (id INTEGER PRIMARY KEY AUTOINCREMENT, requester_id INTEGER NOT NULL, agent_owner_id INTEGER NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS friend_agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, requester_id INTEGER NOT NULL, agent_owner_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS forum_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL, category TEXT DEFAULT '学习交流', title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS forum_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, author_id INTEGER NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
`)
for (const column of [
  "ALTER TABLE schedules ADD COLUMN weeks TEXT DEFAULT '1-16'",
  "ALTER TABLE schedules ADD COLUMN semester_start TEXT DEFAULT ''",
  "ALTER TABLE schedules ADD COLUMN semester_key TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'student'",
  "ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '🌿'",
  "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN agent_name TEXT DEFAULT '知行'",
  "ALTER TABLE users ADD COLUMN agent_avatar TEXT DEFAULT '✦'",
  "ALTER TABLE messages ADD COLUMN sender_type TEXT DEFAULT 'user'",
  "ALTER TABLE messages ADD COLUMN agent_owner_id INTEGER"
]) {
  try { db.exec(column) } catch { /* Existing databases already have this column. */ }
}
if (!db.prepare('SELECT COUNT(*) count FROM courses').get().count) {
  const add = db.prepare('INSERT INTO courses (name,teacher,color) VALUES (?,?,?)')
  add.run('数据结构', '课程教师', '#c96d42'); add.run('高等数学', '课程教师', '#b05f72'); add.run('Python 程序设计', '课程教师', '#c69232')
}

function hashPassword(value) { const salt=crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(value,salt,64).toString('hex')}` }
function passwordMatches(value, stored) { if (!stored.startsWith('scrypt$')) return value===stored; const [,salt,hash]=stored.split('$'); return crypto.timingSafeEqual(Buffer.from(hash,'hex'),crypto.scryptSync(value,salt,64)) }
function keyMaterial() { return crypto.createHash('sha256').update(KEY_SECRET).digest() }
function encryptSecret(value) { const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',keyMaterial(),iv), data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]), tag=cipher.getAuthTag(); return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}` }
function decryptSecret(value) { if (!value || !value.startsWith('v1:')) return value||''; const [,iv,tag,data]=value.split(':'), decipher=crypto.createDecipheriv('aes-256-gcm',keyMaterial(),Buffer.from(iv,'base64')); decipher.setAuthTag(Buffer.from(tag,'base64')); return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8') }
function auth(req,res,next) { const header=req.headers.authorization||''; if(!header.startsWith('Bearer ')) return res.status(401).json({error:'请先登录'}); try{req.user=jwt.verify(header.slice(7),JWT_SECRET);next()}catch{return res.status(401).json({error:'登录已过期，请重新登录'})} }
const userOf=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id)
const publicUser=row=>row&&({id:row.id,student_id:row.student_id,name:row.name,college:row.college,class:row.class,avatar:row.avatar||'🌿',bio:row.bio||'',agent_name:row.agent_name||'知行',agent_avatar:row.agent_avatar||'✦',model_type:row.model_type,hasApiKey:!!row.api_key,is_admin:row.role==='admin'})
const member=(id,userId)=>!!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(id,userId)
const conversationOf=id=>db.prepare('SELECT * FROM conversations WHERE id=?').get(id)
const ownerOf=(id,userId)=>!!db.prepare('SELECT 1 FROM conversations WHERE id=? AND owner_id=?').get(id,userId)
const friends=(left,right)=>!!db.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?').get(left,right)
const isAdmin=userId=>userOf(userId)?.role==='admin'
function bootstrapAdmin () { const studentId=(process.env.ADMIN_STUDENT_ID||'').trim(),password=process.env.ADMIN_PASSWORD||''; if(!studentId)return; const existing=db.prepare('SELECT id FROM users WHERE student_id=?').get(studentId); if(existing){db.prepare("UPDATE users SET role='admin' WHERE id=?").run(existing.id);return} if(!password)return; db.prepare("INSERT INTO users (student_id,name,phone,college,class,password,role) VALUES (?,?,?,?,?,?, 'admin')").run(studentId,(process.env.ADMIN_NAME||'CampusMind 管理员').slice(0,40),'管理员',(process.env.ADMIN_COLLEGE||'CampusMind 平台').slice(0,60),'系统管理员',hashPassword(password)) }
bootstrapAdmin()

const app=express(); app.use(cors()); app.use(express.json({limit:'1mb'}))
app.post('/api/register',(req,res)=>{const {student_id,name,phone,college,class:className,password}=req.body;if(![student_id,name,phone,college,className,password].every(Boolean))return res.status(400).json({error:'请填写所有必填信息'});if(!/^\d{8}$/.test(student_id))return res.status(400).json({error:'学号必须为 8 位数字'});try{db.prepare('INSERT INTO users (student_id,name,phone,college,class,password) VALUES (?,?,?,?,?,?)').run(student_id.trim(),name.trim(),phone.trim(),college.trim(),className.trim(),hashPassword(password));res.json({message:'注册成功，请登录'})}catch(e){res.status(e.message.includes('UNIQUE')?409:500).json({error:e.message.includes('UNIQUE')?'该学号已注册':'注册失败'})}})
app.post('/api/login',(req,res)=>{const row=db.prepare('SELECT * FROM users WHERE student_id=?').get(req.body.student_id||'');if(!row||!passwordMatches(req.body.password||'',row.password))return res.status(401).json({error:'学号或密码错误'});if(!row.password.startsWith('scrypt$'))db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(req.body.password),row.id);if(row.api_key&&!row.api_key.startsWith('v1:')){row.api_key=encryptSecret(row.api_key);db.prepare('UPDATE users SET api_key=? WHERE id=?').run(row.api_key,row.id)}res.json({token:jwt.sign({id:row.id,student_id:row.student_id,name:row.name},JWT_SECRET,{expiresIn:'7d'}),user:publicUser(row)})})
app.get('/api/user/profile',auth,(req,res)=>res.json(publicUser(userOf(req.user.id))))
app.patch('/api/user/profile',auth,(req,res)=>{const avatar=String(req.body.avatar||'🌿').trim().slice(0,12)||'🌿',bio=String(req.body.bio||'').trim().slice(0,280),agentName=String(req.body.agent_name||'知行').trim().slice(0,24)||'知行',agentAvatar=String(req.body.agent_avatar||'✦').trim().slice(0,12)||'✦';db.prepare('UPDATE users SET avatar=?,bio=?,agent_name=?,agent_avatar=? WHERE id=?').run(avatar,bio,agentName,agentAvatar,req.user.id);res.json({message:'个人与 Agent 资料已保存',user:publicUser(userOf(req.user.id))})})
app.get('/api/users/:id/profile',auth,(req,res)=>{const user=userOf(Number(req.params.id));if(!user)return res.status(404).json({error:'用户不存在'});res.json({user:publicUser(user),is_friend:friends(req.user.id,user.id),is_me:req.user.id===user.id})})
app.post('/api/user/apikey',auth,(req,res)=>{const apiKey=(req.body.api_key||'').trim(),modelType=req.body.model_type||'deepseek-v4-flash';if(!apiKey)return res.status(400).json({error:'API Key 不能为空'});if(!SUPPORTED_DEEPSEEK_MODELS.has(modelType))return res.status(400).json({error:'暂不支持该 DeepSeek 模型'});db.prepare('UPDATE users SET model_type=?,api_key=? WHERE id=?').run(modelType,encryptSecret(apiKey),req.user.id);res.json({message:'已安全保存模型配置'})})
app.delete('/api/user/apikey',auth,(req,res)=>{db.prepare("UPDATE users SET api_key='' WHERE id=?").run(req.user.id);res.json({message:'模型配置已删除'})})

app.get('/api/dashboard',auth,(req,res)=>{const id=req.user.id;res.json({user:publicUser(userOf(id)),today:db.prepare('SELECT * FROM schedules WHERE user_id=? ORDER BY start_time').all(id),plans:db.prepare("SELECT * FROM study_plans WHERE user_id=? AND status!='done' ORDER BY id DESC LIMIT 4").all(id),resourceCount:db.prepare('SELECT COUNT(*) count FROM resources').get().count,friendCount:db.prepare('SELECT COUNT(*) count FROM friendships WHERE user_id=?').get(id).count,agentMemory:db.prepare('SELECT content FROM agent_memories WHERE user_id=? AND memory_key=?').get(id,'learning_profile')?.content||''})})
app.get('/api/courses',auth,(req,res)=>res.json(db.prepare('SELECT c.*, (SELECT COUNT(*) FROM resources r WHERE r.course_id=c.id) resource_count FROM courses c ORDER BY c.id').all()))
app.get('/api/resources',auth,(req,res)=>{const query=(req.query.query||'').trim(),courseId=Number(req.query.course_id||0);let sql='SELECT r.*,c.name course_name,u.name uploader_name FROM resources r JOIN courses c ON c.id=r.course_id LEFT JOIN users u ON u.id=r.uploader_id WHERE 1=1',values=[];if(courseId){sql+=' AND r.course_id=?';values.push(courseId)}if(query){sql+=' AND (r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ?)';values.push(`%${query}%`,`%${query}%`,`%${query}%`)}res.json(db.prepare(`${sql} ORDER BY r.id DESC`).all(...values))})
app.post('/api/resources',auth,(req,res)=>{const {course_id,title,description='',type='note',tags='',url=''}=req.body;if(!course_id||!title)return res.status(400).json({error:'请选择课程并填写资料标题'});const result=db.prepare('INSERT INTO resources (course_id,title,description,type,tags,url,uploader_id) VALUES (?,?,?,?,?,?,?)').run(course_id,title.trim(),description.trim(),type,tags.trim(),url.trim(),req.user.id);res.status(201).json({id:result.lastInsertRowid,message:'资料已发布'})})
app.post('/api/schedules/import-preview', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择课表文件' })
  try {
    const isPdf = /\.pdf$/i.test(req.file.originalname)
    let parsed
    if (isPdf) {
      parsed = await parseJluPdfSchedule(req.file.buffer)
    } else {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      parsed = parseSheetRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }))
    }
    if (!parsed.entries.length) return res.status(422).json({ error: '未能识别课表', warnings: parsed.warnings })
    const token = crypto.randomUUID()
    scheduleImportCache.set(token, { userId: req.user.id, entries: parsed.entries, semester_key: parsed.semester_key || '', semester_start: parsed.semester_start || '', expiresAt: Date.now() + 10 * 60 * 1000 })
    res.json({ import_token: token, entries: parsed.entries, semester_key: parsed.semester_key || '', semester_start: parsed.semester_start || '', warnings: parsed.warnings, file_name: req.file.originalname })
  } catch (error) {
    console.error('Schedule import preview error:', error)
    res.status(422).json({ error: '课表文件解析失败，请使用教务系统导出的 Excel、CSV 或包含可复制文字的 PDF。' })
  }
})
app.post('/api/schedules/import-confirm', auth, (req, res) => {
  const cached = scheduleImportCache.get(req.body.import_token)
  if (!cached || cached.userId !== req.user.id || cached.expiresAt < Date.now()) return res.status(400).json({ error: '导入预览已失效，请重新上传文件' })
  const mode = req.body.mode === 'replace' ? 'replace' : 'append'
  const insert = db.prepare('INSERT INTO schedules (user_id,course_name,weekday,start_time,end_time,location,color,weeks,semester_start,semester_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
  const transaction = db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM schedules WHERE user_id=?').run(req.user.id)
    for (const entry of cached.entries) insert.run(req.user.id, entry.course_name, entry.weekday, entry.start_time, entry.end_time, entry.location || '', entry.color || '#c96d42', entry.weeks || '1-16', cached.semester_start || '', cached.semester_key || '')
  })
  transaction(); scheduleImportCache.delete(req.body.import_token)
  res.json({ message: `已${mode === 'replace' ? '替换' : '导入'} ${cached.entries.length} 节课程`, count: cached.entries.length })
})
app.get('/api/schedules',auth,(req,res)=>res.json(db.prepare('SELECT * FROM schedules WHERE user_id=? ORDER BY weekday,start_time').all(req.user.id)))
app.patch('/api/schedules/semester-start', auth, (req, res) => {
  const semesterStart = String(req.body.semester_start || '')
  const semesterKey = String(req.body.semester_key || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) return res.status(400).json({ error: '请填写 YYYY-MM-DD 格式的日期' })
  const date = new Date(`${semesterStart}T12:00:00`)
  if (Number.isNaN(date.getTime()) || date.getDay() !== 1) return res.status(400).json({ error: '第一周第一天应选择周一' })
  const statement = semesterKey
    ? db.prepare("UPDATE schedules SET semester_start=? WHERE user_id=? AND (semester_key=? OR semester_key='' OR semester_key IS NULL)")
    : db.prepare('UPDATE schedules SET semester_start=? WHERE user_id=?')
  const result = semesterKey ? statement.run(semesterStart, req.user.id, semesterKey) : statement.run(semesterStart, req.user.id)
  res.json({ message: '第一周日期已更新，课表日期已重新对应', count: result.changes })
})
app.post('/api/schedules',auth,(req,res)=>{const {course_name,weekday,start_time,end_time,location='',color='#c96d42'}=req.body;if(!course_name||weekday===undefined||!start_time||!end_time)return res.status(400).json({error:'请完整填写课程时间'});const result=db.prepare('INSERT INTO schedules (user_id,course_name,weekday,start_time,end_time,location,color) VALUES (?,?,?,?,?,?,?)').run(req.user.id,course_name,weekday,start_time,end_time,location,color);res.status(201).json({id:result.lastInsertRowid})})
app.delete('/api/schedules/:id',auth,(req,res)=>{db.prepare('DELETE FROM schedules WHERE id=? AND user_id=?').run(req.params.id,req.user.id);res.json({message:'已删除'})})
app.get('/api/plans',auth,(req,res)=>res.json(db.prepare('SELECT * FROM study_plans WHERE user_id=? ORDER BY id DESC').all(req.user.id)))
app.post('/api/plans',auth,(req,res)=>{const {title,content,due_date=null,status='draft'}=req.body;if(!title||!content)return res.status(400).json({error:'计划标题和内容不能为空'});const result=db.prepare('INSERT INTO study_plans (user_id,title,content,status,due_date) VALUES (?,?,?,?,?)').run(req.user.id,title,content,status,due_date);res.status(201).json({id:result.lastInsertRowid})})
app.patch('/api/plans/:id',auth,(req,res)=>{db.prepare('UPDATE study_plans SET status=? WHERE id=? AND user_id=?').run(req.body.status,req.params.id,req.user.id);res.json({message:'计划已更新'})})

app.get('/api/users/search',auth,(req,res)=>{const q=(req.query.q||'').trim();if(!q)return res.json([]);res.json(db.prepare('SELECT id,student_id,name,college,class,avatar,agent_name,agent_avatar FROM users WHERE id!=? AND (name LIKE ? OR student_id LIKE ?) LIMIT 20').all(req.user.id,`%${q}%`,`%${q}%`))})
app.get('/api/friends',auth,(req,res)=>res.json(db.prepare('SELECT u.id,u.name,u.student_id,u.college,u.class,u.avatar,u.agent_name,u.agent_avatar FROM friendships f JOIN users u ON u.id=f.friend_id WHERE f.user_id=? ORDER BY u.name').all(req.user.id)))
app.post('/api/friend-requests',auth,(req,res)=>{const target=Number(req.body.user_id);if(!target||target===req.user.id)return res.status(400).json({error:'请选择其他用户'});if(!userOf(target))return res.status(404).json({error:'用户不存在'});if(friends(req.user.id,target))return res.status(409).json({error:'你们已经是好友'});try{db.prepare('INSERT INTO friend_requests (from_user_id,to_user_id) VALUES (?,?)').run(req.user.id,target);res.status(201).json({message:'好友申请已发送'})}catch{res.status(409).json({error:'已发送过申请'})}})
app.get('/api/friend-requests',auth,(req,res)=>res.json(db.prepare("SELECT fr.*,u.name,u.student_id,u.college,u.avatar FROM friend_requests fr JOIN users u ON u.id=fr.from_user_id WHERE fr.to_user_id=? AND fr.status='pending'").all(req.user.id)))
app.post('/api/friend-requests/:id/accept',auth,(req,res)=>{const request=db.prepare("SELECT * FROM friend_requests WHERE id=? AND to_user_id=? AND status='pending'").get(req.params.id,req.user.id);if(!request)return res.status(404).json({error:'申请不存在'});const add=db.prepare('INSERT OR IGNORE INTO friendships (user_id,friend_id) VALUES (?,?)'),tx=db.transaction(()=>{add.run(request.from_user_id,request.to_user_id);add.run(request.to_user_id,request.from_user_id);db.prepare("UPDATE friend_requests SET status='accepted' WHERE id=?").run(request.id)});tx();res.json({message:'已成为好友'})})
app.get('/api/conversations',auth,(req,res)=>res.json(db.prepare("SELECT c.*, (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id=c.id) member_count, (SELECT COUNT(*) FROM group_agents ga WHERE ga.conversation_id=c.id) agent_count, (SELECT content FROM messages m WHERE m.conversation_id=c.id ORDER BY id DESC LIMIT 1) last_message FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id WHERE cm.user_id=? ORDER BY COALESCE((SELECT MAX(id) FROM messages m WHERE m.conversation_id=c.id),c.id) DESC").all(req.user.id)))
app.post('/api/conversations/private',auth,(req,res)=>{const friendId=Number(req.body.friend_id);if(!friendId||!friends(req.user.id,friendId))return res.status(403).json({error:'只能与自己的好友发起私聊'});const existing=db.prepare("SELECT c.id FROM conversations c WHERE c.type='private' AND EXISTS(SELECT 1 FROM conversation_members a WHERE a.conversation_id=c.id AND a.user_id=?) AND EXISTS(SELECT 1 FROM conversation_members b WHERE b.conversation_id=c.id AND b.user_id=?) LIMIT 1").get(req.user.id,friendId);if(existing)return res.json({id:existing.id});const friend=userOf(friendId),result=db.prepare("INSERT INTO conversations (title,type,owner_id) VALUES (?, 'private', ?)").run(friend.name,req.user.id),add=db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)');add.run(result.lastInsertRowid,req.user.id);add.run(result.lastInsertRowid,friendId);res.status(201).json({id:result.lastInsertRowid})})
app.post('/api/conversations',auth,(req,res)=>{const title=String(req.body.title||'').trim().slice(0,60),memberIds=[...new Set((req.body.member_ids||[]).map(Number).filter(Boolean))];if(!title)return res.status(400).json({error:'请填写群聊名称'});for(const id of memberIds)if(id!==req.user.id&&!friends(req.user.id,id))return res.status(403).json({error:'只能邀请自己的好友加入群聊'});const result=db.prepare("INSERT INTO conversations (title,type,owner_id) VALUES (?, 'group', ?)").run(title,req.user.id),add=db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id) VALUES (?,?)'),tx=db.transaction(()=>{add.run(result.lastInsertRowid,req.user.id);for(const id of memberIds)add.run(result.lastInsertRowid,id)});tx();res.status(201).json({id:result.lastInsertRowid})})
app.get('/api/conversations/:id/members',auth,(req,res)=>{const conversation=conversationOf(req.params.id);if(!conversation||!member(conversation.id,req.user.id))return res.status(403).json({error:'无权查看成员'});res.json(db.prepare("SELECT u.id,u.name,u.student_id,u.college,u.class,u.avatar,u.bio,u.agent_name,u.agent_avatar,COALESCE(ga.auto_reply,0) agent_auto_reply,CASE WHEN ga.user_id IS NULL THEN 0 ELSE 1 END agent_in_group FROM conversation_members cm JOIN users u ON u.id=cm.user_id LEFT JOIN group_agents ga ON ga.conversation_id=cm.conversation_id AND ga.user_id=u.id WHERE cm.conversation_id=? ORDER BY u.id=? DESC,u.name").all(conversation.id,conversation.owner_id))})
app.post('/api/conversations/:id/members',auth,(req,res)=>{const conversation=conversationOf(req.params.id),target=Number(req.body.user_id);if(!conversation||conversation.type!=='group'||!ownerOf(conversation.id,req.user.id))return res.status(403).json({error:'只有群主可以邀请成员'});if(!target||!friends(req.user.id,target))return res.status(403).json({error:'只能邀请自己的好友'});db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(conversation.id,target);res.json({message:'已邀请学习伙伴'})})
app.get('/api/conversations/:id/agent-requests',auth,(req,res)=>{const conversation=conversationOf(req.params.id);if(!conversation||!ownerOf(conversation.id,req.user.id))return res.status(403).json({error:'只有群主可以查看 Agent 申请'});res.json(db.prepare("SELECT r.*,u.name owner_name,u.avatar,u.agent_name,u.agent_avatar FROM agent_group_requests r JOIN users u ON u.id=r.agent_owner_id WHERE r.conversation_id=? AND r.status='pending' ORDER BY r.id DESC").all(conversation.id))})
app.post('/api/conversations/:id/agent-requests',auth,(req,res)=>{const conversation=conversationOf(req.params.id);if(!conversation||conversation.type!=='group'||!member(conversation.id,req.user.id))return res.status(403).json({error:'只有群成员可以申请邀请自己的 Agent'});if(db.prepare('SELECT 1 FROM group_agents WHERE conversation_id=? AND user_id=?').get(conversation.id,req.user.id))return res.status(409).json({error:'你的 Agent 已在群内'});if(db.prepare("SELECT 1 FROM agent_group_requests WHERE conversation_id=? AND agent_owner_id=? AND status='pending'").get(conversation.id,req.user.id))return res.status(409).json({error:'已提交申请，等待群主审批'});db.prepare('INSERT INTO agent_group_requests (conversation_id,agent_owner_id,requested_by_id) VALUES (?,?,?)').run(conversation.id,req.user.id,req.user.id);res.status(201).json({message:'已申请邀请你的 Agent，等待群主同意'})})
app.patch('/api/conversations/:id/agent-requests/:requestId',auth,(req,res)=>{const conversation=conversationOf(req.params.id),action=req.body.action;if(!conversation||!ownerOf(conversation.id,req.user.id))return res.status(403).json({error:'只有群主可以审批'});const request=db.prepare("SELECT * FROM agent_group_requests WHERE id=? AND conversation_id=? AND status='pending'").get(req.params.requestId,conversation.id);if(!request)return res.status(404).json({error:'申请不存在或已处理'});if(action==='approve')db.prepare('INSERT OR IGNORE INTO group_agents (conversation_id,user_id) VALUES (?,?)').run(conversation.id,request.agent_owner_id);db.prepare("UPDATE agent_group_requests SET status=? WHERE id=?").run(action==='approve'?'approved':'rejected',request.id);res.json({message:action==='approve'?'已同意 Agent 入群':'已拒绝申请'})})
app.patch('/api/conversations/:id/my-agent',auth,(req,res)=>{const conversation=conversationOf(req.params.id),enabled=!!req.body.auto_reply;if(!conversation||conversation.type!=='group'||!member(conversation.id,req.user.id))return res.status(403).json({error:'无权设置该群'});if(!db.prepare('SELECT 1 FROM group_agents WHERE conversation_id=? AND user_id=?').get(conversation.id,req.user.id))return res.status(400).json({error:'请先申请并等待群主同意你的 Agent 入群'});if(enabled&&!userOf(req.user.id)?.api_key)return res.status(400).json({error:'请先在模型设置中绑定 API Key，才能开启实时参与'});db.prepare('UPDATE group_agents SET auto_reply=? WHERE conversation_id=? AND user_id=?').run(enabled?1:0,conversation.id,req.user.id);res.json({message:enabled?'已开启实时参与：群内新消息会发送给你的 Agent，并由它在需要时回复':'已关闭实时参与；你的 Agent 仍可在被 @ 时回答'})})
app.get('/api/conversations/:id/messages',auth,(req,res)=>{const conversation=conversationOf(req.params.id);if(!conversation||!member(conversation.id,req.user.id))return res.status(403).json({error:'无权查看此会话'});res.json(db.prepare("SELECT m.*,u.name owner_name,u.avatar owner_avatar,u.agent_name,u.agent_avatar,CASE WHEN m.sender_type='agent' THEN u.agent_name ELSE u.name END sender_name,CASE WHEN m.sender_type='agent' THEN u.agent_avatar ELSE u.avatar END sender_avatar,CASE WHEN m.sender_type='agent' THEN m.agent_owner_id ELSE m.sender_id END profile_user_id FROM messages m JOIN users u ON u.id=CASE WHEN m.sender_type='agent' THEN m.agent_owner_id ELSE m.sender_id END WHERE m.conversation_id=? ORDER BY m.id").all(conversation.id))})
app.post('/api/conversations/:id/messages',auth,(req,res)=>{const conversation=conversationOf(req.params.id),content=String(req.body.content||'').trim().slice(0,2000);if(!conversation||!member(conversation.id,req.user.id))return res.status(403).json({error:'无权发送此会话'});if(!content)return res.status(400).json({error:'消息不能为空'});const result=db.prepare("INSERT INTO messages (conversation_id,sender_id,sender_type,content) VALUES (?,?,'user',?)").run(conversation.id,req.user.id,content);res.status(201).json({id:result.lastInsertRowid,created_at:now()});if(conversation.type==='group')setTimeout(()=>{const enabled=db.prepare('SELECT ga.user_id,u.agent_name FROM group_agents ga JOIN users u ON u.id=ga.user_id WHERE ga.conversation_id=? AND ga.auto_reply=1 AND u.api_key!=\'\'').all(conversation.id);for(const agent of enabled)if(!content.includes(`@${agent.agent_name}`))replyFromGroupAgent(conversation,agent.user_id,content,false).catch(error=>console.error('Group agent error:',error.message))},0)})
app.post('/api/conversations/:id/agent-ask',auth,async(req,res)=>{const conversation=conversationOf(req.params.id),ownerId=Number(req.body.agent_owner_id),question=String(req.body.question||'').trim().slice(0,2000);if(!conversation||conversation.type!=='group'||!member(conversation.id,req.user.id))return res.status(403).json({error:'无权向该 Agent 提问'});if(!question)return res.status(400).json({error:'请输入问题'});if(!db.prepare('SELECT 1 FROM group_agents WHERE conversation_id=? AND user_id=?').get(conversation.id,ownerId))return res.status(404).json({error:'该 Agent 尚未获准进入本群'});try{const answer=await replyFromGroupAgent(conversation,ownerId,question,true);res.json({answer:answer||'该 Agent 暂时没有补充'})}catch(error){res.status(502).json({error:'Agent 调用失败，请检查该 Agent 主人的模型配置'})}})
app.get('/api/friend-agent/requests',auth,(req,res)=>res.json(db.prepare("SELECT r.*,u.name,u.avatar,u.agent_name,u.agent_avatar FROM friend_agent_access r JOIN users u ON u.id=r.requester_id WHERE r.agent_owner_id=? AND r.status='pending' ORDER BY r.id DESC").all(req.user.id)))
app.get('/api/friend-agents/:ownerId/access',auth,(req,res)=>{const ownerId=Number(req.params.ownerId);if(!friends(req.user.id,ownerId))return res.status(403).json({error:'只能访问好友的 Agent'});res.json(db.prepare('SELECT status FROM friend_agent_access WHERE requester_id=? AND agent_owner_id=? ORDER BY id DESC LIMIT 1').get(req.user.id,ownerId)||{status:'none'})})
app.post('/api/friend-agents/:ownerId/access',auth,(req,res)=>{const ownerId=Number(req.params.ownerId);if(!ownerId||!friends(req.user.id,ownerId))return res.status(403).json({error:'只能申请访问好友的 Agent'});if(!userOf(ownerId)?.api_key)return res.status(400).json({error:'好友尚未配置可用的模型'});const last=db.prepare('SELECT * FROM friend_agent_access WHERE requester_id=? AND agent_owner_id=? ORDER BY id DESC LIMIT 1').get(req.user.id,ownerId);if(last?.status==='approved')return res.json({status:'approved'});if(last?.status==='pending')return res.json({status:'pending'});db.prepare('INSERT INTO friend_agent_access (requester_id,agent_owner_id) VALUES (?,?)').run(req.user.id,ownerId);res.status(201).json({status:'pending',message:'已申请访问，等待好友同意'})})
app.patch('/api/friend-agent/requests/:id',auth,(req,res)=>{const action=req.body.action,request=db.prepare("SELECT * FROM friend_agent_access WHERE id=? AND agent_owner_id=? AND status='pending'").get(req.params.id,req.user.id);if(!request)return res.status(404).json({error:'申请不存在或已处理'});if(!['approve','reject'].includes(action))return res.status(400).json({error:'无效操作'});db.prepare('UPDATE friend_agent_access SET status=?,updated_at=? WHERE id=?').run(action==='approve'?'approved':'rejected',now(),request.id);res.json({message:action==='approve'?'已同意对方与您的 Agent 对话':'已拒绝申请'})})
app.get('/api/friend-agents/:ownerId/messages',auth,(req,res)=>{const ownerId=Number(req.params.ownerId);if(!db.prepare("SELECT 1 FROM friend_agent_access WHERE requester_id=? AND agent_owner_id=? AND status='approved'").get(req.user.id,ownerId))return res.status(403).json({error:'尚未获得好友授权'});res.json(db.prepare('SELECT role,content,created_at FROM friend_agent_messages WHERE requester_id=? AND agent_owner_id=? ORDER BY id').all(req.user.id,ownerId))})
app.post('/api/friend-agents/:ownerId/messages',auth,async(req,res)=>{const ownerId=Number(req.params.ownerId),content=String(req.body.content||'').trim().slice(0,2000);if(!content)return res.status(400).json({error:'请输入内容'});if(!db.prepare("SELECT 1 FROM friend_agent_access WHERE requester_id=? AND agent_owner_id=? AND status='approved'").get(req.user.id,ownerId))return res.status(403).json({error:'尚未获得好友授权'});const owner=userOf(ownerId),requester=userOf(req.user.id);if(!owner?.api_key)return res.status(400).json({error:'好友的模型配置已不可用'});db.prepare("INSERT INTO friend_agent_messages (requester_id,agent_owner_id,role,content) VALUES (?,?, 'user', ?)").run(req.user.id,ownerId,content);try{const answer=await replyFromFriendAgent(owner,requester);db.prepare("INSERT INTO friend_agent_messages (requester_id,agent_owner_id,role,content) VALUES (?,?, 'assistant', ?)").run(req.user.id,ownerId,answer);res.json({answer})}catch(error){res.status(502).json({error:'好友 Agent 调用失败，请稍后重试'})}})
app.get('/api/forum/posts',auth,(req,res)=>res.json(db.prepare('SELECT p.*,u.name author_name,(SELECT COUNT(*) FROM forum_comments c WHERE c.post_id=p.id) comment_count FROM forum_posts p JOIN users u ON u.id=p.author_id ORDER BY p.id DESC').all()))
app.post('/api/forum/posts',auth,(req,res)=>{const {title,content,category='学习交流'}=req.body;if(!title||!content)return res.status(400).json({error:'请填写标题和正文'});const result=db.prepare('INSERT INTO forum_posts (author_id,category,title,content) VALUES (?,?,?,?)').run(req.user.id,category,title,content);res.status(201).json({id:result.lastInsertRowid})})
app.get('/api/forum/posts/:id/comments',auth,(req,res)=>res.json(db.prepare('SELECT c.*,u.name author_name FROM forum_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.id').all(req.params.id)))
app.post('/api/forum/posts/:id/comments',auth,(req,res)=>{const content=(req.body.content||'').trim();if(!content)return res.status(400).json({error:'评论不能为空'});const result=db.prepare('INSERT INTO forum_comments (post_id,author_id,content) VALUES (?,?,?)').run(req.params.id,req.user.id,content);res.status(201).json({id:result.lastInsertRowid})})
app.delete('/api/forum/posts/:id',auth,(req,res)=>{const post=db.prepare('SELECT * FROM forum_posts WHERE id=?').get(req.params.id);if(!post)return res.status(404).json({error:'帖子不存在'});if(post.author_id!==req.user.id&&!isAdmin(req.user.id))return res.status(403).json({error:'只能删除自己的帖子'});const remove=db.transaction(()=>{db.prepare('DELETE FROM forum_comments WHERE post_id=?').run(post.id);db.prepare('DELETE FROM forum_posts WHERE id=?').run(post.id)});remove();res.json({message:'帖子及其评论已删除'})})
app.delete('/api/forum/comments/:id',auth,(req,res)=>{const comment=db.prepare('SELECT * FROM forum_comments WHERE id=?').get(req.params.id);if(!comment)return res.status(404).json({error:'评论不存在'});if(comment.author_id!==req.user.id&&!isAdmin(req.user.id))return res.status(403).json({error:'只能删除自己的评论'});db.prepare('DELETE FROM forum_comments WHERE id=?').run(comment.id);res.json({message:'评论已删除'})})

function makeAgent(user) {
  const userId=user.id
  const search=tool(({query})=>{const rows=db.prepare('SELECT r.title,r.description,r.tags,c.name course_name,r.url FROM resources r JOIN courses c ON c.id=r.course_id WHERE r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ? LIMIT 6').all(`%${query}%`,`%${query}%`,`%${query}%`);return rows.length?JSON.stringify(rows):'资源库没有找到相关资料；请明确告知学生，不要编造引用。'},{name:'search_course_resources',description:'搜索平台课程资料；课程知识问答前必须优先使用。',schema:z.object({query:z.string().min(1)})})
  const snapshot=tool(()=>JSON.stringify({schedule:db.prepare('SELECT course_name,weekday,start_time,end_time,location FROM schedules WHERE user_id=? ORDER BY weekday,start_time').all(userId),plans:db.prepare("SELECT title,content,status,due_date FROM study_plans WHERE user_id=? AND status!='done' ORDER BY id DESC LIMIT 5").all(userId),profile:db.prepare('SELECT content FROM agent_memories WHERE user_id=? AND memory_key=?').get(userId,'learning_profile')?.content||'尚未建立学习画像'}),{name:'get_my_learning_snapshot',description:'读取当前学生自己的课表、未完成计划和学习画像；制定安排前调用。',schema:z.object({})})
  const draft=tool(({title,content,due_date})=>{const result=db.prepare('INSERT INTO study_plans (user_id,title,content,status,due_date) VALUES (?,?,?,?,?)').run(userId,title,content,'draft',due_date||null);return `已创建待确认计划草稿 #${result.lastInsertRowid}，请提醒学生到学习计划区确认后执行。`},{name:'create_plan_draft',description:'学生明确要求时创建可编辑学习计划草稿，绝不直接执行。',schema:z.object({title:z.string().min(2),content:z.string().min(10),due_date:z.string().optional()})})
  const remember=tool(({summary})=>{db.prepare("INSERT INTO agent_memories (user_id,memory_key,content,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,memory_key) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at").run(userId,'learning_profile',summary,now());return '已更新学习画像，只记录学习偏好、目标和薄弱点。'},{name:'save_learning_profile',description:'学生明确要求记住目标、偏好或薄弱点时使用。',schema:z.object({summary:z.string().min(5).max(600)})})
  const modelName=SUPPORTED_DEEPSEEK_MODELS.has(user.model_type)?user.model_type:'deepseek-v4-flash'
  const model=new ChatOpenAI({model:modelName,apiKey:decryptSecret(user.api_key),temperature:0.4,configuration:{baseURL:'https://api.deepseek.com'}})
  return createAgent({model,tools:[search,snapshot,draft,remember],systemPrompt:`你是 CampusMind 的专属学习智能体，服务对象为 ${user.name}。你用中文以教练方式帮助理解、规划、复盘。规则：资料问答先调用 search_course_resources 并列出来源，找不到就说明不确定；制定计划先调用 get_my_learning_snapshot，且只创建待确认草稿；只能读取当前学生数据；作业先给思路而非代写答案；回复结构清晰、简洁。`})
}
app.get('/api/agent/threads',auth,(req,res)=>res.json(db.prepare('SELECT * FROM agent_threads WHERE user_id=? ORDER BY updated_at DESC').all(req.user.id)))
app.post('/api/agent/threads',auth,(req,res)=>{const result=db.prepare('INSERT INTO agent_threads (user_id,title) VALUES (?,?)').run(req.user.id,(req.body.title||'新的学习对话').slice(0,50));res.status(201).json({id:result.lastInsertRowid})})
app.get('/api/agent/threads/:id/messages',auth,(req,res)=>{if(!db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND user_id=?').get(req.params.id,req.user.id))return res.status(404).json({error:'对话不存在'});res.json(db.prepare('SELECT role,content,created_at FROM agent_messages WHERE thread_id=? ORDER BY id').all(req.params.id))})
app.post('/api/agent/chat',auth,async(req,res)=>{const content=(req.body.content||'').trim();let threadId=Number(req.body.thread_id||0);if(!content||content.length>4000)return res.status(400).json({error:'请输入 1-4000 字的学习问题'});const user=userOf(req.user.id);if(!user?.api_key)return res.status(400).json({error:'NO_API_KEY',message:'请先在模型设置中绑定 DeepSeek API Key'});if(!threadId)threadId=Number(db.prepare('INSERT INTO agent_threads (user_id,title) VALUES (?,?)').run(user.id,content.slice(0,24)).lastInsertRowid);if(!db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND user_id=?').get(threadId,user.id))return res.status(403).json({error:'无权使用该对话'});db.prepare('INSERT INTO agent_messages (thread_id,role,content) VALUES (?,?,?)').run(threadId,'user',content);const history=db.prepare('SELECT role,content FROM agent_messages WHERE thread_id=? ORDER BY id DESC LIMIT 12').all(threadId).reverse();try{const result=await makeAgent(user).invoke({messages:history.map(m=>({role:m.role,content:m.content}))}),last=result.messages.at(-1),answer=typeof last?.content==='string'?last.content:JSON.stringify(last?.content||'暂时没有生成回复');db.prepare('INSERT INTO agent_messages (thread_id,role,content) VALUES (?,?,?)').run(threadId,'assistant',answer);db.prepare('UPDATE agent_threads SET updated_at=? WHERE id=?').run(now(),threadId);res.json({thread_id:threadId,answer})}catch(error){console.error('Agent error:',error);res.status(502).json({error:'智能体调用失败，请检查 DeepSeek Key、额度或网络后重试'})}})
function plainAnswer (message) { return typeof message?.content==='string' ? message.content.trim() : String(message?.content||'').trim() }
async function callExternalAgent (owner, systemPrompt, history) { const modelName=SUPPORTED_DEEPSEEK_MODELS.has(owner.model_type)?owner.model_type:'deepseek-v4-flash';const model=new ChatOpenAI({model:modelName,apiKey:decryptSecret(owner.api_key),temperature:0.35,configuration:{baseURL:'https://api.deepseek.com'}});const result=await model.invoke([{role:'system',content:systemPrompt},...history]);return plainAnswer(result) }
async function replyFromGroupAgent (conversation, ownerId, question, explicit) { const owner=userOf(ownerId);if(!owner?.api_key)throw new Error('NO_API_KEY');const history=db.prepare("SELECT m.content,m.sender_type,CASE WHEN m.sender_type='agent' THEN ao.agent_name ELSE su.name END sender_name FROM messages m LEFT JOIN users su ON su.id=m.sender_id LEFT JOIN users ao ON ao.id=m.agent_owner_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 10").all(conversation.id).reverse().map(m=>({role:m.sender_type==='agent'?'assistant':'user',content:`[${m.sender_name||'群成员'}] ${m.content}`}));const prompt=`你是 ${owner.name} 的学习 Agent「${owner.agent_name||'知行'}」，已获群主批准进入学习群“${conversation.title}”。只能基于群内学习讨论回答，不可泄露主人课表、计划、学习画像、私聊、API Key 或任何私人信息。用中文简洁回答，优先给学习思路与可执行建议。${explicit?'这是一次明确 @ 提问，必须回答。':'这是实时参与；若此刻没有有价值的学习补充，严格只输出 NO_REPLY。'} `;const answer=await callExternalAgent(owner,prompt,[...history,{role:'user',content:`当前触发内容：${question}`}]);if(!answer||(!explicit&&answer.toUpperCase().startsWith('NO_REPLY')))return '';db.prepare("INSERT INTO messages (conversation_id,sender_id,sender_type,agent_owner_id,content) VALUES (?,?,'agent',?,?)").run(conversation.id,ownerId,ownerId,answer.slice(0,4000));return answer }
async function replyFromFriendAgent (owner, requester) { const history=db.prepare('SELECT role,content FROM friend_agent_messages WHERE requester_id=? AND agent_owner_id=? ORDER BY id DESC LIMIT 12').all(requester.id,owner.id).reverse();const prompt=`你是 ${owner.name} 的 Agent「${owner.agent_name||'知行'}」，主人已授权 ${requester.name} 与你进行学习交流。仅回答课程学习、学习方法与公开资料相关问题；不得披露主人课表、计划、学习画像、记忆、聊天记录、身份信息或 API Key。用中文简洁、友善地回答，作业问题优先引导思路。`;return callExternalAgent(owner,prompt,history) }
app.get('/api/health',(req,res)=>res.json({status:'ok',agent:'langchain',database:'sqlite'}))
const PORT=process.env.PORT||3001
app.listen(PORT,()=>console.log(`CampusMind server: http://localhost:${PORT}`))
