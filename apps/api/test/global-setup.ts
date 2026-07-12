import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

// The test database is a throwaway artifact owned by this suite: delete it
// and let `db push` recreate the schema fresh on the empty file.
export default function setup() {
  const dbPath = path.resolve('prisma/test.db')
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-journal`, { force: true })
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: 'inherit',
  })
}
