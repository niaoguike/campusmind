import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'

const dir=await mkdtemp(path.join(tmpdir(),'campusmind-teacher-'))
const database=path.join(dir,'test.db'),port=19371,secret='isolated-teacher-test'
const child=spawn(process.execPath,['server/index.js'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,CAMPUSMIND_DB_PATH:database,PORT:String(port),JWT_SECRET:secret,ADMIN_STUDENT_ID:'',ADMIN_PASSWORD:''},stdio:['ignore','pipe','pipe']})
let output='',db,checks=0
child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v)
async function call(user,url,method='GET',body,status=200){
  const r=await fetch(`http://127.0.0.1:${port}/api${url}`,{method,headers:{Authorization:`Bearer ${jwt.sign({id:user},secret)}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await r.json();assert.equal(r.status,status,`${method} ${url}: ${JSON.stringify(data)}`);checks++;return data
}
try {
  for(let i=0;i<600;i++){if(output.includes('CampusMind server:'))break;if(child.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100))}
  assert.match(output,/CampusMind server:/)
  db=new Database(database)
  const insert=db.prepare('INSERT INTO users (student_id,name,phone,college,class,password,role) VALUES (?,?,?,?,?,?,?)')
  const ids=['admin','teacher','teacher','student','student'].map((role,i)=>Number(insert.run(`9000000${i}`,`test-${i}`,`1390000000${i}`,'test','test','unused',role).lastInsertRowid))
  const [admin,teacher,other,student,outsider]=ids
  const courses=db.prepare('SELECT id FROM courses ORDER BY id LIMIT 2').all().map(x=>x.id),[a,b]=courses
  await call(admin,`/admin/users/${teacher}/teacher`,'POST',{course_ids:[a]})
  await call(admin,`/admin/users/${other}/teacher`,'POST',{course_ids:[b]})
  await call(admin,`/admin/users/${admin}/teacher`,'POST',{course_ids:[a]},400)
  await call(admin,`/admin/users/${teacher}/teacher`,'POST',{course_ids:[999999]},400)
  assert.deepEqual((await call(teacher,'/courses')).map(c=>c.id),[a])
  await call(student,'/teacher/dashboard','GET',undefined,403)
  for(const route of [`/teacher/courses/${b}/analytics`,`/teacher/courses/${b}/resources`,`/teacher/courses/${b}/notes`,`/courses/${b}/announcements`,'/users/search?q=test','/conversations','/agent/threads'])await call(teacher,route,'GET',undefined,403)
  const task=await call(teacher,`/teacher/courses/${a}/tasks`,'POST',{title:'Assignment',task_type:'assignment'},201)
  assert.equal((await call(student,`/courses/${a}/teacher-tasks`)).length,0)
  await call(other,`/teacher/tasks/${task.id}/publish`,'PATCH',{},403)
  await call(teacher,`/teacher/tasks/${task.id}/publish`,'PATCH',{})
  assert.equal((await call(teacher,`/teacher/courses/${a}/tasks`))[0].pending_count,0)
  await call(student,`/teacher-tasks/${task.id}/submit`,'POST',{content:'work'},403)
  await call(student,`/courses/${a}/join`,'POST',{})
  await call(outsider,`/courses/${b}/join`,'POST',{})
  await call(student,`/teacher-tasks/${task.id}/submit`,'POST',{content:'work'},201)
  const [submission]=await call(teacher,`/teacher/tasks/${task.id}/submissions`)
  await call(other,`/teacher/submissions/${submission.id}/grade`,'PATCH',{score:90},403)
  await call(teacher,`/teacher/submissions/${submission.id}/grade`,'PATCH',{score:null},400)
  await call(teacher,`/teacher/submissions/${submission.id}/grade`,'PATCH',{score:88,feedback:'Good'})
  assert.equal((await call(student,`/courses/${a}/teacher-tasks`))[0].submission.feedback,'Good')
  assert.equal((await call(outsider,`/courses/${a}/teacher-tasks`))[0].submission,null)
  await call(student,`/teacher-tasks/${task.id}/submit`,'POST',{content:'revised'},201)
  assert.equal((await call(student,`/courses/${a}/teacher-tasks`))[0].submission.score,null)
  const stats=await call(teacher,`/teacher/courses/${a}/analytics`)
  assert.deepEqual(stats.students.map(s=>s.student_id),[student])
  await call(teacher,`/teacher/courses/${a}/notes`,'POST',{student_id:outsider,content:'private'},400)
  await call(teacher,`/teacher/courses/${a}/notes`,'POST',{student_id:student,content:'private'},201)
  await call(admin,`/admin/users/${other}/teacher`,'POST',{course_ids:[a,b]})
  assert.equal((await call(other,`/teacher/courses/${a}/notes`)).length,0)
  await call(teacher,`/teacher/courses/${a}/announcements`,'POST',{title:'Notice',content:'Read',is_pinned:true},201)
  assert.equal((await call(student,`/courses/${a}/announcements`))[0].content,'Read')
  const resource=Number(db.prepare('INSERT INTO resources (course_id,title) VALUES (?,?)').run(a,'Resource').lastInsertRowid)
  await call(teacher,`/teacher/resources/${resource}/review`,'PATCH',{status:'invalid'},400)
  await call(teacher,`/teacher/resources/${resource}/review`,'PATCH',{status:'rejected'})
  const post=await call(student,'/forum/posts','POST',{title:'Question',content:'Help',course_id:a},201)
  const otherPost=await call(outsider,'/forum/posts','POST',{title:'Other',content:'Help',course_id:b},201)
  assert.equal((await call(teacher,'/teacher/forum/posts')).length,1)
  await call(teacher,`/teacher/forum/posts/${otherPost.id}`,'PATCH',{status:'closed'},403)
  await call(teacher,`/teacher/forum/posts/${post.id}`,'PATCH',{status:'closed',reply:'Answer',is_pinned:true})
  assert.equal((await call(student,`/forum/posts/${post.id}`)).post.teacher_reply,'Answer')
  await call(student,`/forum/posts/${post.id}/comments`,'POST',{content:'new'},403)
  await call(teacher,`/teacher/forum/posts/${post.id}`,'PATCH',{status:'hidden'})
  await call(student,`/forum/posts/${post.id}/comments`,'GET',undefined,404)
  assert(!(await call(student,'/forum/posts')).some(p=>p.id===post.id))
  await call(teacher,`/teacher/courses/${b}/ai-advice`,'POST',{},403)
  await call(teacher,`/teacher/courses/${a}/ai-advice`,'POST',{},400)
  await call(admin,`/admin/users/${teacher}/teacher`,'POST',{course_ids:[]})
  await call(teacher,`/teacher/tasks/${task.id}/submissions`,'GET',undefined,403)
  await call(student,'/dashboard')
  const registration={role:'teacher',teacher_id:'T-2026001',name:'Teacher registration',phone:'13812340001',college:'Engineering',password:'secure-test-password'}
  const registered=await call(student,'/register','POST',registration,201)
  assert.equal(registered.user.role,'teacher')
  assert.equal(registered.user.teacher_id,registration.teacher_id)
  assert.equal(jwt.verify(registered.token,secret).id,registered.user.id)
  assert.equal((await call(registered.user.id,'/teacher/dashboard')).courses.length,0)
  await call(registered.user.id,`/teacher/courses/${a}/analytics`,'GET',undefined,403)
  await call(student,'/register','POST',{...registration,role:'admin'},400)
  await call(student,'/register','POST',{...registration,teacher_id:''},400)
  await call(student,'/register','POST',registration,409)
  const logged=await call(student,'/login','POST',{student_id:registration.teacher_id,password:registration.password})
  assert.equal(logged.user.role,'teacher')
  const created=await call(registered.user.id,'/teacher/courses','POST',{name:'New teaching class'},201)
  assert.equal((await call(registered.user.id,'/teacher/dashboard')).courses[0].id,created.id)
  await call(teacher,`/teacher/courses/${created.id}/analytics`,'GET',undefined,403)
  await call(student,'/teacher/courses','POST',{name:'Unauthorized'},403)
  await call(registered.user.id,'/teacher/courses','POST',{name:' '},400)
  const studentRegistration=await call(student,'/register','POST',{student_id:'88000001',name:'New student',phone:'13812340002',college:'Engineering',class:'1',password:'secure-test-password'},201)
  assert.equal(studentRegistration.user.role,'student')
  await call(studentRegistration.user.id,'/teacher/dashboard','GET',undefined,403)
  await call(studentRegistration.user.id,'/dashboard')
  console.log(`PASS: ${checks} API checks; isolated database only.`)
} finally {
  db?.close();child.kill();if(child.exitCode===null)await once(child,'exit');await rm(dir,{recursive:true,force:true})
}
