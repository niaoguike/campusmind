import { shallowRef } from 'vue'

// Identity is refreshed from the server before protected navigation.
export const sessionUser = shallowRef(null)
export function setSession(user) {
  sessionUser.value = user
  if (user) localStorage.setItem('user', JSON.stringify(user))
  else localStorage.removeItem('user')
}
export function clearSession() {
  localStorage.removeItem('token')
  setSession(null)
}
export const homeForUser = user => user?.role === 'teacher' ? '/teacher' : '/dashboard'

export function destinationForUser(path, user) {
  if (user.role === 'teacher') return ['/teacher', '/setup-key'].includes(path) ? null : '/teacher'
  if (path === '/teacher') return '/dashboard'
  if (path === '/admin' && user.role !== 'admin') return '/dashboard'
  return null
}
