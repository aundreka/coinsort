// Single build -> per-iteration x per-network HTML/ZIP variants.
//
// For each iteration length, runs one Vite build (which produces a clean,
// single self-contained dist/index.html — console.error neutralized, no
// type=module/crossorigin), then fans that HTML out to every included network:
// prepends the line-1 ad-network comment, injects the network's required
// script/flag, zips where required, and writes to dist/<length>/<Network>/.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ROOT = process.cwd()
const DIST = path.join(ROOT, 'dist')

// Clean slate once. Subsequent Vite builds run with emptyOutDir:false so they
// preserve the per-network variant folders written between builds.
rmSync(DIST, { recursive: true, force: true })

// --- naming (AGENTS.md convention) ---------------------------------------
const NAMING = {
  lc3: 'cs', // Coin Sort
  creativeType: 'mip',
  vendor: 'hpl',
  concept: 'coinsortvar1',
  conceptNum: '01',
  gameplay: 'cartoon',
  ugc: 'na',
  seasonal: 'noseason',
  lang: 'en',
  size: 'na',
}

const ITERATIONS = ['2cust', '2clk', 'full']

const NETWORKS = [
  { name: 'Applovin', tag: 'al', included: true, injectMraid: true },
  { name: 'Google', tag: 'gg', included: true, injectExitApi: true, zip: true },
  { name: 'Ironsource', tag: 'is', included: true, injectMraid: true },
  { name: 'Mintegral', tag: 'mtg', included: true, onloadGameReady: true, zip: true },
  { name: 'Facebook', tag: 'fb', included: true },
  { name: 'Unity', tag: 'un', included: true, injectMraid: true, rewriteWindowTop: true },
  { name: 'Vungle', tag: 'vu', included: true, vungleFlag: true, zip: true },
  { name: 'Moloco', tag: 'mo', included: true },
  { name: 'TikTok', tag: 'tt', included: false, tiktokFlag: true }, // prepared, not built
]

function fileName(length, tag) {
  const n = NAMING
  return `${n.lc3}_${n.creativeType}_${n.vendor}_${n.concept}_${n.conceptNum}_${n.gameplay}_${n.ugc}_${n.seasonal}_${n.lang}_${length}_${n.size}_${tag}`
}

function injectHead(html, snippet) {
  return html.replace('<head>', `<head>${snippet}`)
}

function transformForNetwork(baseHtml, net) {
  let html = baseHtml
  if (net.injectMraid) html = injectHead(html, '<script src="mraid.js"></script>')
  if (net.injectExitApi) html = injectHead(html, '<script src="exitapi.js"></script>')
  if (net.vungleFlag) html = injectHead(html, '<script>window.__VUNGLE__=true;</script>')
  if (net.tiktokFlag) html = injectHead(html, '<script>window.__TIKTOK__=true;</script>')
  if (net.onloadGameReady) html = html.replace('<body>', '<body onload="gameReady()">')
  // Luna's static scan rejects the literal window.top (Phaser ships it). The
  // iframe-vs-top check collapses to always-top inside the playable's own frame.
  if (net.rewriteWindowTop) html = html.split('window.top').join('window.self')
  // Network tag comment MUST be line 1, before <!doctype html>.
  return `<!-- ad-network: ${net.name} | ${net.tag} -->\n${html}`
}

async function writeZip(outPath, html) {
  const zip = new JSZip()
  zip.file('index.html', html)
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
  writeFileSync(outPath, buf)
  return buf.length
}

const MAX_BYTES = 5 * 1024 * 1024
const report = []
let warned = false

for (const length of ITERATIONS) {
  console.log(`\n=== Building iteration: ${length} ===`)
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_ITERATION: length } })
  const baseHtml = readFileSync(path.join(DIST, 'index.html'), 'utf8')
  // Convenience single-file per version for quick file:// testing.
  writeFileSync(path.join(DIST, `${length}.html`), baseHtml)

  for (const net of NETWORKS) {
    if (!net.included) continue
    const dir = path.join(DIST, length, net.name)
    mkdirSync(dir, { recursive: true })
    const html = transformForNetwork(baseHtml, net)
    const base = fileName(length, net.tag)
    let bytes
    let outName
    if (net.zip) {
      outName = `${base}.zip`
      bytes = await writeZip(path.join(dir, outName), html)
    } else {
      outName = `${base}.html`
      writeFileSync(path.join(dir, outName), html)
      bytes = Buffer.byteLength(html)
    }
    const over = bytes > MAX_BYTES
    if (over) warned = true
    report.push({ length, net: net.name, outName, kb: Math.round(bytes / 1024), over })
  }
}

console.log('\n=== Output summary ===')
for (const r of report) {
  console.log(`${r.over ? '!! OVER 5MB ' : '   '}${r.length}/${r.net}/${r.outName}  ${r.kb} KB`)
}
console.log(`\n${report.length} files written under dist/<length>/<Network>/`)
if (warned) {
  console.warn('One or more outputs exceed 5 MB!')
  process.exit(1)
}
console.log('Done. dist/index.html is the full single-file build.')
