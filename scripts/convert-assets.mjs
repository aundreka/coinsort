// PNG -> WebP converter for the playable's sprite assets.
//
// Reads src/assets/Main/*.png and writes WebP into src/assets-webp/Main/**
// (spaces in names -> '-' so they import cleanly, e.g. "endscreen-play now.png"
// -> "endscreen-play-now.webp"). Flat cartoon art compresses very well as WebP;
// this is what keeps the single-file HTML under the 5 MB budget. Run once with
// `npm run assets`.
import sharp from 'sharp'
import { readdir, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

const SRC = path.resolve('src/assets/Main')
const OUT = path.resolve('src/assets-webp/Main')

// Unused / oversized source art we never import — skip to save time + space.
const SKIP = new Set([
  'BG.png',
  'Vignette.png',
  'sunrays1.png',
  'cloud-popup(1).png',
  'coin-tray - Copy(1).png',
  'download-btn.png',
  'Slices - Coin Sort - Change-change(Playable).png',
])

// Per-asset quality. Customers/bg are the heaviest, so keep them efficient;
// small UI/coins stay near-lossless.
function qualityFor(name) {
  const n = name.toLowerCase()
  if (n.includes('person')) return 86
  if (n.includes('bg_extended') || n === 'table.png') return 88
  if (n.includes('coin') || n.includes('popup')) return 92
  return 92
}

const sanitize = (s) => s.replace(/ /g, '-')

const files = await readdir(SRC)
await mkdir(OUT, { recursive: true })
let totalIn = 0
let totalOut = 0
let count = 0

for (const file of files) {
  if (path.extname(file).toLowerCase() !== '.png') continue
  if (SKIP.has(file)) continue
  const outName = sanitize(file).replace(/\.png$/i, '.webp')
  const inFile = path.join(SRC, file)
  const outFile = path.join(OUT, outName)
  const q = qualityFor(file)
  await sharp(inFile).webp({ quality: q, alphaQuality: 100, effort: 6 }).toFile(outFile)
  totalIn += (await stat(inFile)).size
  totalOut += (await stat(outFile)).size
  count++
}

const mb = (b) => (b / 1024 / 1024).toFixed(2)
console.log(`Converted ${count} PNG -> WebP`)
console.log(`  in:  ${mb(totalIn)} MB`)
console.log(`  out: ${mb(totalOut)} MB  (${((1 - totalOut / totalIn) * 100).toFixed(1)}% smaller)`)
