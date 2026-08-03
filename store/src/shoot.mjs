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
const PROFILE = '/tmp/pman-shoot-profile'
const PORT = 9333

// Play requires phone AND tablet screenshots, each 16:9 or 9:16 with side
// limits (phone/7-inch 320-3840px, 10-inch 1080-7680px). Every profile below
// renders an EXACT 9:16 by choosing a CSS width divisible by 9 and doubling:
// off-by-one rounding would break the ratio Play checks.
const DEVICES = {
  phone:    { dir: 'screenshots',          width: 360, height: 640,  deviceScaleFactor: 3, mobile: true },
  tablet7:  { dir: 'screenshots-tablet7',  width: 603, height: 1072, deviceScaleFactor: 2, mobile: true },
  tablet10: { dir: 'screenshots-tablet10', width: 720, height: 1280, deviceScaleFactor: 2, mobile: true },
}

const which = (process.argv.find((a) => a.startsWith('--device=')) ?? '--device=phone').split('=')[1]
const device = DEVICES[which]
if (!device) {
  console.error(`Unknown --device=${which}. Options: ${Object.keys(DEVICES).join(', ')}`)
  process.exit(1)
}
const OUT = `store/assets/${device.dir}`
const VIEWPORT = { width: device.width, height: device.height, deviceScaleFactor: device.deviceScaleFactor, mobile: true }

// Navigation is done by tapping the tab bar, not by loading URLs: the demo
// backend lives in page memory, so a full page load reseeds it and invalidates
// the session — exactly what a real user never does mid-session.
// Tab geometry is derived from the viewport so it holds on every device.
const TAB_Y = device.height - 28
const tab = (n) => ({ x: (device.width / 5) * (n - 0.5), y: TAB_Y })

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
  console.log(`\nWrote ${SHOTS.length} ${which} screenshots (${device.width*device.deviceScaleFactor}x${device.height*device.deviceScaleFactor}) to ${OUT}/`)
}

main().catch((e) => {
  console.error('Failed:', e.message)
  process.exit(1)
})
