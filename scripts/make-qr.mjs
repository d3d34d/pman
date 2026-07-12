#!/usr/bin/env node
// Writes a scannable PNG pointing at this machine's Expo dev server.
// Re-run whenever your LAN IP changes:  npm run qr
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.EXPO_PORT ?? '8081'

/** First non-internal IPv4 address — the one a phone on the same Wi-Fi can reach. */
function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return null
}

const ip = lanIp()
if (!ip) {
  console.error('Could not find a LAN IP. Are you connected to Wi-Fi? Override with LAN_IP=x.x.x.x')
  process.exit(1)
}

const url = `exp://${ip}:${PORT}`
const out = path.join(ROOT, 'expo-qr.png')

await QRCode.toFile(out, url, {
  type: 'png',
  width: 640,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#16212BFF', light: '#FFFFFFFF' },
})

console.log(`QR written to ${path.relative(process.cwd(), out)}`)
console.log(`  URL: ${url}`)
console.log('')
console.log('Scan it with Expo Go on Android (same Wi-Fi). Make sure both are running:')
console.log('  npm run api')
console.log('  npm run mobile')
