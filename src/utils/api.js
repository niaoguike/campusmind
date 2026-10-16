import { clearSession } from './session'

export async function api(path, options = {}) {
  const { redirectOnUnauthorized = true, ...fetchOptions } = options
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers = { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  const token = localStorage.getItem('token')
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`/api${path}`, { ...fetchOptions, headers })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearSession()
    if (redirectOnUnauthorized) window.location.href = '/login?reason=session_expired'
  }
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试')
  return data
}

export const post = (path, payload) => api(path, { method: 'POST', body: JSON.stringify(payload) })
