// Renders every app-icon asset from store/src/app-icon.html.
//
//   npm run icon
//
// Outputs (all 1024x1024 unless noted):
//   apps/mobile/assets/images/icon.png                    launcher / Expo icon
//   apps/mobile/assets/images/android-icon-foreground.png adaptive foreground
//   apps/mobile/assets/images/android-icon-background.png adaptive background
//   apps/mobile/assets/images/android-icon-monochrome.png themed-icon silhouette
//   store/assets/play-icon-512.png                        512x512 Play listing
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SRC = `file://${process.cwd()}/store/src/app-icon.html`
const IMG = 'apps/mobile/assets/images'

if (!existsSync(CHROME)) {
  console.error(`Google Chrome not found at:\n  ${CHROME}`)
  process.exit(1)
}
mkdirSync(IMG, { recursive: true })
mkdirSync('store/assets', { recursive: true })

// Transparency matters: the adaptive foreground and monochrome layers are
// composited by Android, so a solid backdrop would show as a square.
function shot(variant, out) {
  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    '--force-device-scale-factor=1',
    '--window-size=1024,1024',
    `--screenshot=${out}`,
    `${SRC}?v=${variant}`,
  ], { stdio: 'ignore' })
  console.log(`  ✓ ${out}`)
}

shot('full',       `${IMG}/icon.png`)
shot('foreground', `${IMG}/android-icon-foreground.png`)
shot('background', `${IMG}/android-icon-background.png`)
shot('monochrome', `${IMG}/android-icon-monochrome.png`)

// Play wants exactly 512x512 for the store listing.
execFileSync('sips', ['-z', '512', '512', `${IMG}/icon.png`, '--out', 'store/assets/play-icon-512.png'], {
  stdio: 'ignore',
})
console.log('  ✓ store/assets/play-icon-512.png (512x512)')

console.log('\nIcon assets rebuilt.')
