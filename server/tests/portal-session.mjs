import assert from 'node:assert/strict'
import { createRouter, createMemoryHistory } from 'vue-router'
import { sessionUser, setSession, clearSession, homeForUser, destinationForUser } from '../../src/utils/session.js'

const storage=new Map()
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}
const router=createRouter({history:createMemoryHistory(),routes:['/login','/teacher','/dashboard','/admin','/setup-key'].map(path=>({path,component:{render(){}}}))})
let serverUser={id:1,role:'teacher'}
router.beforeEach(to=>{
  if(to.path==='/login')return
  if(!localStorage.getItem('token')){clearSession();return '/login'}
  setSession(serverUser)
  return destinationForUser(to.path,serverUser)||true
})
localStorage.setItem('token','teacher-token')
localStorage.setItem('user',JSON.stringify({id:9,role:'student'}))
await router.push(homeForUser(serverUser))
assert.equal(router.currentRoute.value.path,'/teacher')
assert.equal(sessionUser.value.role,'teacher')
await router.push('/dashboard')
assert.equal(router.currentRoute.value.path,'/teacher')
clearSession()
await router.push('/login')
serverUser={id:2,role:'student'}
localStorage.setItem('token','student-token')
await router.push('/teacher')
assert.equal(router.currentRoute.value.path,'/dashboard')
assert.equal(sessionUser.value.role,'student')
await router.push('/admin')
assert.equal(router.currentRoute.value.path,'/dashboard')
clearSession()
await router.push('/teacher')
assert.equal(router.currentRoute.value.path,'/login')
assert.equal(sessionUser.value,null)
console.log('PASS: teacher/student account switching, stale identity, role routing and logout checks')
