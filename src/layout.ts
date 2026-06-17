// Single source of truth for every placed asset's position/scale/z-index.
// `layout.json` is imported (Vite inlines it at build -> frozen prod snapshot);
// in dev the in-game editor (#edit) POSTs edits back to layout.json via the
// Vite layout-persist middleware and HMR reloads this module, so editing
// repositions the real game live.
import raw from './layout.json'

export type LayoutMode = 'fit' | 'extend'

export interface LayoutEntry {
  key: string
  x: number
  y: number
  scale: number
  zIndex: number
  mode: LayoutMode
}

// Built-in fallbacks so a missing/partial layout.json never blanks the game.
const FALLBACK: Record<string, LayoutEntry> = {
  bg: { key: 'bg', x: 540, y: 470, scale: 1.7, zIndex: 0, mode: 'extend' },
  table: { key: 'table', x: 540, y: 1430, scale: 1.95, zIndex: 4, mode: 'extend' },
  customer: { key: 'customer', x: 600, y: 700, scale: 0.52, zIndex: 3, mode: 'fit' },
  bubble: { key: 'bubble', x: 300, y: 430, scale: 1, zIndex: 5, mode: 'fit' },
  tray: { key: 'tray', x: 540, y: 1330, scale: 1, zIndex: 6, mode: 'fit' },
  dealBtn: { key: 'dealBtn', x: 360, y: 1700, scale: 1, zIndex: 8, mode: 'fit' },
  mergeBtn: { key: 'mergeBtn', x: 720, y: 1700, scale: 1, zIndex: 8, mode: 'fit' },
  heart0: { key: 'heart0', x: 95, y: 110, scale: 1, zIndex: 12, mode: 'fit' },
  heart1: { key: 'heart1', x: 190, y: 110, scale: 1, zIndex: 12, mode: 'fit' },
  heart2: { key: 'heart2', x: 285, y: 110, scale: 1, zIndex: 12, mode: 'fit' },
  patience: { key: 'patience', x: 210, y: 185, scale: 1, zIndex: 12, mode: 'fit' },
  logo: { key: 'logo', x: 935, y: 115, scale: 1, zIndex: 12, mode: 'fit' },
  hint: { key: 'hint', x: 540, y: 1560, scale: 1, zIndex: 14, mode: 'fit' },
  sunrays: { key: 'sunrays', x: 540, y: 820, scale: 1, zIndex: 0, mode: 'fit' },
  ecLogo: { key: 'ecLogo', x: 540, y: 820, scale: 0.95, zIndex: 1, mode: 'fit' },
  ecCta: { key: 'ecCta', x: 540, y: 1360, scale: 1, zIndex: 1, mode: 'fit' },
}

function normalize(input: unknown): LayoutEntry[] {
  if (!Array.isArray(input)) return Object.values(FALLBACK).map((e) => ({ ...e }))
  const out: LayoutEntry[] = []
  for (const item of input as Partial<LayoutEntry>[]) {
    if (!item || typeof item.key !== 'string') continue
    const fb = FALLBACK[item.key]
    out.push({
      key: item.key,
      x: typeof item.x === 'number' ? item.x : fb?.x ?? 540,
      y: typeof item.y === 'number' ? item.y : fb?.y ?? 960,
      scale: typeof item.scale === 'number' ? item.scale : fb?.scale ?? 1,
      zIndex: typeof item.zIndex === 'number' ? item.zIndex : fb?.zIndex ?? 0,
      mode: item.mode === 'extend' ? 'extend' : 'fit',
    })
  }
  return out
}

const entries: LayoutEntry[] = normalize(raw)
const byKey = new Map<string, LayoutEntry>(entries.map((e) => [e.key, e]))
// Keys that were actually present in layout.json (vs. created on demand from a
// fallback). Used so e.g. per-slot coin overrides only apply once saved.
const loadedKeys = new Set<string>(entries.map((e) => e.key))

/** Was this key present in the saved layout.json (not just a fallback)? */
export function wasLoaded(key: string): boolean {
  return loadedKeys.has(key)
}

/** Does an entry for this key exist yet (loaded or already created)? */
export function layoutHas(key: string): boolean {
  return byKey.has(key)
}

/** The live entry object for `key` (created from fallback if absent). Mutating
 *  the returned object is how the editor moves an asset — it is the same object
 *  serialized by allEntries() on save. */
export function layoutOf(key: string): LayoutEntry {
  let e = byKey.get(key)
  if (!e) {
    e = { ...(FALLBACK[key] ?? { key, x: 540, y: 960, scale: 1, zIndex: 0, mode: 'fit' }) }
    entries.push(e)
    byKey.set(key, e)
  }
  return e
}

/** All entries, in stable order — what the editor saves to layout.json. */
export function allEntries(): LayoutEntry[] {
  return entries
}
