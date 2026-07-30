// Captures Play Store phone screenshots from the running web demo.
//
// Drives headless Chrome over the DevTools Protocol so we get true mobile
// device emulation (Chrome's --window-size alone lays the page out at the
// desktop fallback width and clips it). Node 22+ supplies a global WebSocket,
// so this needs no dependencies.
//
//   node store/src/shoot.mjs            # expects the demo on :8099
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.env.DEMO_URL ?? 'http://localhost:8099'
const OUT = 'store/assets/screenshots'
const PROFILE = '/tmp/pman-shoot-profile'
const PORT = 9333

// 1080x1920 output: a 360x640 CSS viewport at 3x. Play wants phone shots
// between 320px and 3840px on a side, 9:16 here.
const VIEWPORT = { width: 360, height: 640, deviceScaleFactor: 3, mobile: true }

// Navigation is done by tapping the tab bar, not by loading URLs: the demo
// backend lives in page memory, so a full page load reseeds it and invalidates
// the session — exactly what a real user never does mid-session.
const TAB_Y = 612 // tab bar centre in the 360x640 viewport
const tab = (n) => ({ x: 36 + (n - 1) * 72, y: TAB_Y }) // 5 tabs across 360px

const SHOTS = [
  { file: '01-dashboard.png', goto: '/?as=manager', wait: 5000 },
  { file: '02-rent-roll.png', tap: tab(2), wait: 2500 },
  { file: '03-properties.png', tap: tab(3), wait: 2500 },
  { file: '04-tenants.png', tap: tab(4), wait: 2500 },
  { file: '05-tenant-home.png', goto: '/?as=tenant', wait: 5000, reset: true },
  { file: '06-tenant-pay.png', tap: tab(2), wait: 2500 },
]

let nextId = 1
function rpc(ws, method, params = {}, sessionId) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function main() {
  rmSync(PROFILE, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // Wait for the debugging endpoint to come up.
  let wsUrl
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      wsUrl = (await res.json()).webSocketDebuggerUrl
      if (wsUrl) break
    } catch {}
    await sleep(250)
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint never became reachable')

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true })
  })

  const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true })

  await rpc(ws, 'Page.enable', {}, sessionId)
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', VIEWPORT, sessionId)

  for (const shot of SHOTS) {
    // Switching roles needs a clean session, or the manager token wins.
    if (shot.reset) {
      await rpc(ws, 'Runtime.evaluate', { expression: 'localStorage.clear()' }, sessionId)
    }
    if (shot.goto) {
      await rpc(ws, 'Page.navigate', { url: BASE + shot.goto }, sessionId)
    } else if (shot.tap) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await rpc(
          ws,
          'Input.dispatchMouseEvent',
          { type, x: shot.tap.x, y: shot.tap.y, button: 'left', clickCount: 1 },
          sessionId,
        )
      }
    }
    await sleep(shot.wait)
    const { data } = await rpc(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(`${OUT}/${shot.file}`, Buffer.from(data, 'base64'))
    console.log(`  ✓ ${shot.file}`)
  }

  ws.close()
  chrome.kill()
  console.log(`\nWrote ${SHOTS.length} screenshots to ${OUT}/`)
}

main().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
