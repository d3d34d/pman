// Regenerates every Play Store graphic: the 1024x500 feature graphic, the
// 512x512 icon, and 6 phone screenshots taken from a real build of the app.
//
//   npm run store:assets
//
// Requires Google Chrome (macOS path below) and nothing else.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DIST = 'apps/mobile/dist'
const PORT = 8099

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}

function step(msg) {
  console.log(`\n▶ ${msg}`)
}

if (!existsSync(CHROME)) {
  console.error(`Google Chrome not found at:\n  ${CHROME}\nInstall it, or edit CHROME in this script.`)
  process.exit(1)
}

mkdirSync('store/assets', { recursive: true })

step('Feature graphic (1024×500)')
run(CHROME, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1024,500',
  '--screenshot=store/assets/feature-graphic.png',
  `file://${process.cwd()}/store/src/feature-graphic.html`,
])

step('Play icon (512×512)')
run('sips', [
  '-z', '512', '512',
  'apps/mobile/assets/images/icon.png',
  '--out', 'store/assets/play-icon-512.png',
], { stdio: 'ignore' })

step('Web build for screenshots')
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'], {
  cwd: 'apps/mobile',
  env: { ...process.env, EXPO_PUBLIC_DEMO: '1' },
})

step(`Serving ${DIST} on :${PORT}`)
const server = spawn('node', ['store/src/serve.mjs', DIST, String(PORT)], { stdio: 'ignore' })
await sleep(1500)

try {
  // Play asks for phone AND both tablet sizes separately; each has its own
  // side limits, so they cannot be one image resized.
  step('Phone screenshots (1080×1920)')
  run('node', ['store/src/shoot.mjs', '--device=phone'])

  step('7-inch tablet screenshots (1206×2144)')
  run('node', ['store/src/shoot.mjs', '--device=tablet7'])

  step('10-inch tablet screenshots (1440×2560)')
  run('node', ['store/src/shoot.mjs', '--device=tablet10'])
} finally {
  server.kill()
}

console.log('\n✅ store/assets is up to date.')
