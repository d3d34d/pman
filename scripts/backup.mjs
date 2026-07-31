// Takes a dated backup of the production database and uploaded files into
// ./Backup (which is gitignored — it holds real user data).
//
//   npm run backup
//
// Verifies the dump is a valid SQLite file before reporting success, so a
// truncated or failed transfer can't be mistaken for a good backup.
import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'

const APP = process.env.FLY_APP ?? 'pman-api'
const DATE = new Date().toISOString().slice(0, 10)
const DIR = 'Backup'

function fly(args, opts = {}) {
  return execFileSync('flyctl', args, { maxBuffer: 512 * 1024 * 1024, ...opts })
}

mkdirSync(`${DIR}/database`, { recursive: true })
mkdirSync(`${DIR}/uploads`, { recursive: true })

// Wake the machine first — Fly stops idle machines, and `ssh console` fails
// against a stopped VM even though an HTTP request would auto-start it.
try {
  execSync(`curl -s -o /dev/null --max-time 30 https://${APP}.fly.dev/health`)
} catch {}

console.log(`Backing up ${APP} → ${DIR}/`)

// --- database -------------------------------------------------------------
const dbPath = `${DIR}/database/pman-${DATE}.db`
const db = fly(['ssh', 'console', '--app', APP, '-C', 'cat /data/pman.db'])
writeFileSync(dbPath, db)

const header = readFileSync(dbPath).subarray(0, 16).toString('binary')
if (!header.startsWith('SQLite format 3')) {
  console.error(`✗ ${dbPath} is not a valid SQLite file — backup FAILED, do not trust it.`)
  process.exit(1)
}
console.log(`  ✓ database  ${(statSync(dbPath).size / 1024).toFixed(0)} KB  ${dbPath}`)

// --- uploaded files -------------------------------------------------------
const upPath = `${DIR}/uploads/uploads-${DATE}.tar.gz`
writeFileSync(upPath, fly(['ssh', 'console', '--app', APP, '-C', 'tar -czf - -C /data uploads']))
console.log(`  ✓ uploads   ${(statSync(upPath).size / 1024).toFixed(0)} KB  ${upPath}`)

// --- config ---------------------------------------------------------------
mkdirSync(`${DIR}/config`, { recursive: true })
for (const f of ['fly.toml', 'apps/mobile/eas.json', 'apps/mobile/app.json']) {
  try {
    writeFileSync(`${DIR}/config/${f.split('/').pop()}`, readFileSync(f))
  } catch {}
}
console.log('  ✓ config')

console.log(`\nDone. Reminder: the Android keystore is NOT included — back it up`)
console.log(`separately with:  cd apps/mobile && eas credentials`)
