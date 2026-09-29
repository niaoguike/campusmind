// Use the same authenticated, audited API as AdminConsole; never edit SQLite directly.
const [account,...rawCourses]=process.argv.slice(2)
const token=process.env.ADMIN_TOKEN
const courseIds=rawCourses.map(Number)
if(!account||!token||courseIds.some(id=>!Number.isSafeInteger(id)||id<1)){
  console.error('Usage: ADMIN_TOKEN=<admin bearer token> node scripts/assign-teacher.mjs <account> [courseId ...]');process.exit(1)
}
const base=process.env.CAMPUSMIND_API_URL||'http://127.0.0.1:3001/api'
async function request(route,options={}){
  const response=await fetch(base+route,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}})
  const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);return result
}
try{
  const overview=await request('/admin/overview')
  const user=overview.users.find(u=>u.student_id===account)
  if(!user)throw new Error('Account not found')
  const result=await request(`/admin/users/${user.id}/teacher`,{method:'POST',body:JSON.stringify({course_ids:courseIds})})
  console.log(result.message)
  console.log(await request(`/admin/users/${user.id}/teacher`))
}catch(error){console.error(error.message);process.exitCode=1}
