import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFile } from 'node:fs/promises'
import dotenv from 'dotenv'

// Preserve the existing JSON API's numeric IDs, counts and timestamps.
pg.types.setTypeParser(20, value => {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('DATABASE_INTEGER_OUT_OF_RANGE')
  return result
})
pg.types.setTypeParser(1700, value => Number(value))

export async function databaseConfig (env = process.env) {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL }
  if (env.NODE_ENV !== 'production') {
    try {
      const local = dotenv.parse(await readFile(new URL('../../deploy/postgres/.env', import.meta.url), 'utf8'))
      if (local.POSTGRES_PASSWORD) return { host: '127.0.0.1', port: Number(local.POSTGRES_PORT || 5432), database: 'campusmind', user: 'campusmind', password: local.POSTGRES_PASSWORD }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  throw new Error('必须配置 DATABASE_URL；开发环境也可使用 deploy/postgres/.env 中的本地数据库')
}

// Replace builder placeholders, without changing quoted '?' or PostgreSQL dollar strings.
export function bindParameters (sql) {
  let result = '', index = 0, quote = '', dollar = ''
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    if (dollar) {
      if (sql.startsWith(dollar, i)) { result += dollar; i += dollar.length - 1; dollar = '' } else result += char
    } else if (quote) {
      result += char
      if (char === quote) { if (sql[i + 1] === quote) result += sql[++i]; else quote = '' }
    } else if (char === "'" || char === '"') { quote = char; result += char }
    else if (char === '$' && /^\$[A-Za-z_0-9]*\$/.test(sql.slice(i))) { dollar = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/)[0]; result += dollar; i += dollar.length - 1 }
    else if (char === '?') result += `$${++index}`
    else result += char
  }
  return result
}

export async function createDatabase ({ env = process.env, pool: injectedPool } = {}) {
  const config = injectedPool ? null : await databaseConfig(env)
  const pool = injectedPool || new pg.Pool({ ...config, max: 12, connectionTimeoutMillis: 5000, statement_timeout: 30000 })
  if (!injectedPool) pool.on('error', () => console.error('PostgreSQL pool: connection unavailable'))
  const context = new AsyncLocalStorage(), idColumns = new Map()
  let savepoint = 0
  const query = (sql, values) => (context.getStore() || pool).query(sql, values)
  async function hasId (table) {
    if (!idColumns.has(table)) {
      const { rows } = await query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name='id'", [table])
      idColumns.set(table, Boolean(rows.length))
    }
    return idColumns.get(table)
  }
  function prepare (source) {
    const sql = bindParameters(source)
    return {
      async all (...values) { return (await query(sql, values)).rows },
      async get (...values) { return (await query(sql, values)).rows[0] },
      async run (...values) {
        let statement = sql
        const table = /^\s*INSERT\s+INTO\s+([a-z_][a-z_0-9]*)\b/i.exec(sql)?.[1]
        if (table && !/\bRETURNING\b/i.test(sql) && await hasId(table)) statement = sql.replace(/;\s*$/, '') + ' RETURNING id'
        const result = await query(statement, values)
        return { changes: result.rowCount, insertId: result.rows[0]?.id }
      }
    }
  }
  function transaction (callback) {
    return async (...args) => {
      const parent = context.getStore()
      if (parent) {
        const name = `nested_${++savepoint}`
        await parent.query(`SAVEPOINT ${name}`)
        try { const result = await callback(...args); await parent.query(`RELEASE SAVEPOINT ${name}`); return result }
        catch (error) { await parent.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error }
      }
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await context.run(client, () => callback(...args))
        await client.query('COMMIT')
        return result
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
  }
  return { pool, config, prepare, query, transaction, exec: sql => query(sql), close: () => pool.end(), dialect: 'postgresql' }
}
