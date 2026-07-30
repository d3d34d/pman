// Tiny static server that mimics GitHub Pages for the exported web build:
// unknown paths fall back to index.html so client-side routes like /rent-roll
// resolve. Used by shoot.mjs; also handy for eyeballing a build locally.
//
//   node store/src/serve.mjs [dir] [port]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] ?? 'apps/mobile/dist')
const PORT = Number(process.argv[3] ?? 8099)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

async function tryFiles(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  // Reject traversal before touching the filesystem.
  const resolved = path.resolve(ROOT, '.' + clean)
  if (!resolved.startsWith(ROOT)) return null

  const candidates = [
    resolved,
    resolved + '.html',
    path.join(resolved, 'index.html'),
    path.join(ROOT, 'index.html'), // SPA fallback, same as Pages' 404.html
  ]
  for (const file of candidates) {
    try {
      const body = await readFile(file)
      return { body, type: TYPES[path.extname(file)] ?? 'application/octet-stream' }
    } catch {}
  }
  return null
}

createServer(async (req, res) => {
  const hit = await tryFiles(req.url ?? '/')
  if (!hit) {
    res.writeHead(404).end('Not found')
    return
  }
  res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'no-store' })
  res.end(hit.body)
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`))
