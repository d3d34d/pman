// Measures keyword counts and density in the Play Store full description, and
// checks every field against Play's character limits.
//
//   node store/src/keyword-density.mjs
//
// Healthy density is roughly 0.5–3% per term. Much above that reads as keyword
// stuffing to both Google and users; much below and you're not competing for it.
import { readFileSync } from 'node:fs'

const LISTING = 'store/play-listing.md'
const LIMITS = { title: 30, short: 80, full: 4000 }

const TERMS = [
  'rent tracker', 'track rent', 'rent collection', 'rent roll', 'rent ledger',
  'landlord', 'tenant portal', 'property management', 'property manager',
  'lease', 'rental propert', 'rental income', 'late fee', 'maintenance',
  'rent', 'tenant',
]

const src = readFileSync(LISTING, 'utf8')

/** First fenced block after a given heading. */
function blockAfter(heading) {
  const start = src.indexOf(heading)
  if (start === -1) return null
  const open = src.indexOf('```', start)
  if (open === -1) return null
  const from = src.indexOf('\n', open) + 1
  const close = src.indexOf('```', from)
  return close === -1 ? null : src.slice(from, close).trimEnd()
}

const title = blockAfter('## App name')
const short = blockAfter('## Short description')
const full = blockAfter('## Full description')

if (!full) {
  console.error(`Could not find the full description in ${LISTING}`)
  process.exit(1)
}

let failed = false
console.log('CHARACTER LIMITS')
for (const [name, text, limit] of [
  ['App name', title, LIMITS.title],
  ['Short description', short, LIMITS.short],
  ['Full description', full, LIMITS.full],
]) {
  const n = text?.length ?? 0
  const ok = n > 0 && n <= limit
  if (!ok) failed = true
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(19)} ${String(n).padStart(4)} / ${limit}`)
}

const words = full.split(/\s+/).filter(Boolean).length
const low = full.toLowerCase()

console.log(`\nKEYWORD DENSITY  (${words} words)`)
const rows = TERMS.map((t) => {
  const n = low.split(t).length - 1
  return { t, n, d: (n / words) * 100 }
}).sort((a, b) => b.n - a.n)

for (const { t, n, d } of rows) {
  const flag = n === 0 ? '·' : d > 4 ? '!' : ' '
  console.log(`  ${flag} ${t.padEnd(21)} ${String(n).padStart(3)}   ${d.toFixed(1)}%`)
}

const missing = rows.filter((r) => r.n === 0)
const stuffed = rows.filter((r) => r.d > 4)
if (missing.length) console.log(`\n  · not mentioned: ${missing.map((r) => r.t).join(', ')}`)
if (stuffed.length) console.log(`  ! possibly stuffed: ${stuffed.map((r) => r.t).join(', ')}`)

process.exit(failed ? 1 : 0)
