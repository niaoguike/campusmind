import axios from 'axios'
const service = axios.create({
  baseURL: 'http://127.0.0.1:8000', // FastAPI后端地址
  timeout: 10000
})
// 请求拦截携带token
service.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
export default service