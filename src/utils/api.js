import { clearSession } from './session'

export async function api(path, options = {}) {
  const { redirectOnUnauthorized = true, ...fetchOptions } = options
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers = { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  const token = localStorage.getItem('token')
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(fileUrl(path), { ...fetchOptions, headers })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearSession()
    if (redirectOnUnauthorized) window.location.href = '/login?reason=session_expired'
  }
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试')
  return data
}

export const post = (path, payload) => api(path, { method: 'POST', body: JSON.stringify(payload) })

// Stored file paths already start with /api, while route names passed by callers do not.
const fileUrl = (path) => `/api${String(path).replace(/^\/api(?=\/)/, '')}`

// Authenticated files cannot be opened by a plain href; fetch a blob first.
export async function openFile (path) {
  const token = localStorage.getItem('token')
  const response = await fetch(fileUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (response.status === 401) { clearSession(); window.location.href = '/login?reason=session_expired'; return }
  if (!response.ok) throw new Error('文件不存在或无权访问')
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadFile (path, fileName) {
  const token = localStorage.getItem('token')
  const response = await fetch(fileUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (response.status === 401) { clearSession(); window.location.href = '/login?reason=session_expired'; return }
  if (!response.ok) throw new Error('文件不存在或无权访问')
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
