import express from 'express'

export function createAsyncApp () {
  const app = express()
  const wrap = handler => {
    if (Array.isArray(handler)) return handler.map(wrap)
    if (typeof handler !== 'function' || handler.length === 4) return handler
    return function (req, res, next) {
      try { Promise.resolve(handler(req, res, next)).catch(next) } catch (error) { next(error) }
    }
  }
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const register = app[method].bind(app)
    app[method] = (...args) => {
      if (method === 'get' && args.length === 1) return register(...args)
      return register(...args.map(wrap))
    }
  }
  return app
}
