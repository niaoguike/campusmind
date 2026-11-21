import { createDatabase } from '../db/database.js'

const db = await createDatabase()
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`
try {
  const rows = await db.prepare("SELECT conname, conrelid::regclass::text AS table_name FROM pg_constraint WHERE contype='f' AND NOT convalidated AND connamespace=current_schema() ORDER BY conrelid::regclass::text, conname").all()
  if (!rows.length) {
    console.log('所有外键均已验证')
    process.exit(0)
  }
  let failed = 0
  for (const row of rows) {
    try {
      const table = String(row.table_name).split('.').map(quote).join('.')
      await db.exec(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${quote(row.conname)}`)
      console.log(`OK   ${row.table_name} ${row.conname}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${row.table_name} ${row.conname}: ${error.message}`)
    }
  }
  console.log(`共 ${rows.length} 个未验证外键，失败 ${failed} 个。失败项通常来自孤儿行，清理后可重跑。`)
  process.exit(failed ? 1 : 0)
} finally {
  await db.close()
}
