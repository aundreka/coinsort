import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene'
import { GameScene } from './scenes/GameScene'
import { initMraid } from './networks'
import { computeMetrics, setSafeInsets } from './utils/responsive'
import { enableEditRegistry } from './edit/registry'

// In-game layout editor: dev-only, opt-in via the URL hash (#edit). Enabling the
// registry BEFORE the scenes build lets every Placeable register itself. The
// heavy editor module is dynamically imported by GameScene, so prod never ships
// it. import.meta.env.DEV is a literal `false` in production -> dead-code-elim.
const EDIT_MODE = import.meta.env.DEV && location.hash.toLowerCase().includes('edit')
if (EDIT_MODE) enableEditRegistry()

// Visible-on-screen error capture for WKWebView debugging (no console there).
// Logs via console.warn (console.error is stripped at build).
window.addEventListener('error', (e) => console.warn('[error]', e.message))
window.addEventListener('unhandledrejection', (e) =>
  console.warn('[rejection]', (e as PromiseRejectionEvent).reason),
)

// Lifecycle stubs detected by network preview tools. Installed only if an SDK
// has not already provided its own.
const W = window as unknown as Record<string, any>
for (const name of ['gameReady', 'gameStart', 'gameEnd', 'gameClose']) {
  if (typeof W[name] !== 'function') W[name] = () => {}
}

// Cap the device-pixel-ratio at 1.5. Fill-rate (the main mobile bottleneck)
// scales with DPR^2, so vs an uncapped DPR-3 phone this renders ~4x fewer pixels
// per frame; vs DPR 2 it's ~0.56x. The design is authored at 1080 wide, so at
// 1.5 the backing store is still >= design resolution on phones — stays sharp.
const DPR = Math.min(window.devicePixelRatio || 1, 1.5)
let game: Phaser.Game | null = null
let parentEl: HTMLDivElement | null = null
let safeProbe: HTMLDivElement | null = null
let lastW = 0
let lastH = 0

function viewportSize(): { w: number; h: number } {
  const el = parentEl
  const vv = window.visualViewport
  const w =
    (el && el.clientWidth) ||
    document.documentElement.clientWidth ||
    vv?.width ||
    window.innerWidth
  const h =
    (el && el.clientHeight) ||
    document.documentElement.clientHeight ||
    vv?.height ||
    window.innerHeight
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

function updateSafeInsets(): void {
  if (!safeProbe) return
  const cs = getComputedStyle(safeProbe)
  setSafeInsets(
    (parseFloat(cs.paddingTop) || 0) * DPR,
    (parseFloat(cs.paddingRight) || 0) * DPR,
    (parseFloat(cs.paddingBottom) || 0) * DPR,
    (parseFloat(cs.paddingLeft) || 0) * DPR,
  )
}

function applySize(): void {
  if (!game || !game.canvas) return
  const { w, h } = viewportSize()
  lastW = w
  lastH = h
  const cw = Math.round(w * DPR)
  const ch = Math.round(h * DPR)
  game.scale.resize(cw, ch)
  game.canvas.style.width = '100%'
  game.canvas.style.height = '100%'
  computeMetrics(cw, ch)
  updateSafeInsets()
  const gs = game.scene.getScene('Game') as GameScene | undefined
  if (gs && gs.scene.isActive()) gs.relayout()
}

// Poll handles rotation/resize uniformly across WebViews (some don't fire
// resize). Throttled to every 8th frame so we don't read layout (clientWidth)
// every frame — explicit resize/orientation events still apply immediately.
let pollFrame = 0
function poll(): void {
  if ((pollFrame++ & 7) === 0) {
    const { w, h } = viewportSize()
    if (Math.abs(w - lastW) > 0.5 || Math.abs(h - lastH) > 0.5) applySize()
  }
  requestAnimationFrame(poll)
}

// Drop a held coin stack + guard input the instant a resize is signalled, before
// the debounced relayout — so an SDK's synthetic resize-tap can't merge it.
function signalResize(): void {
  const gs = game?.scene.getScene('Game') as GameScene | undefined
  if (gs && gs.scene.isActive()) gs.onViewportResizing()
}

function bindResize(): void {
  let raf = 0
  const debounced = (): void => {
    signalResize()
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(applySize)
  }
  window.addEventListener('resize', debounced)
  window.visualViewport?.addEventListener('resize', debounced)
  window.visualViewport?.addEventListener('scroll', debounced)
  window.addEventListener('orientationchange', () => {
    debounced()
    for (const t of [100, 300, 600]) setTimeout(applySize, t)
  })

  // Capture-phase: BEFORE Phaser handles a tap, reconcile a pending size change.
  // Some ad SDKs (AppLovin's device switch) resize the creative and then deliver
  // a tap; applying the resize first drops a held stack + guards input, so the
  // tap can't merge a lifted stack into a column that just shifted. Reads layout
  // only on a press (rare), and only acts when the size actually changed.
  const reconcile = (): void => {
    const { w, h } = viewportSize()
    const changed = Math.abs(w - lastW) > 0.5 || Math.abs(h - lastH) > 0.5
    if (changed) applySize()
  }
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    window.addEventListener(type, reconcile, { capture: true, passive: true })
  }

  requestAnimationFrame(poll)
}

async function boot(): Promise<void> {
  let parent = document.getElementById('game') as HTMLDivElement | null
  if (!parent) {
    parent = document.createElement('div')
    parent.id = 'game'
    document.body.appendChild(parent)
  }
  parentEl = parent

  safeProbe = document.createElement('div')
  safeProbe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);'
  document.body.appendChild(safeProbe)

  // MRAID must be ready (or timed out) before the game is constructed.
  await initMraid()

  const { w, h } = viewportSize()
  computeMetrics(w * DPR, h * DPR)
  updateSafeInsets()

  game = new Phaser.Game({
    type: Phaser.AUTO,
    transparent: true,
    parent,
    scale: { mode: Phaser.Scale.NONE, width: Math.round(w * DPR), height: Math.round(h * DPR) },
    // roundPixels OFF: snapping vertices to integers each frame makes continuous
    // scale tweens (button/CTA/coin pulses) shimmer ("shaky"); LINEAR filtering on
    // the WebP art keeps things crisp without it.
    render: { antialias: true, pixelArt: false, roundPixels: false, powerPreference: 'high-performance' },
    fps: { target: 60, min: 30 },
    scene: [BootScene, GameScene],
  })

  applySize()
  bindResize()
  W.gameReady()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  void boot()
}
