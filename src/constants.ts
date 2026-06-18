// Design reference space — the mockup is authored at 1080x1920. All gameplay
// coordinates live here and go through sx()/sy()/sd() (fit column) or
// centerX()/coverScale() (extend layers) in utils/responsive.ts.
export const DESIGN_W = 1080
export const DESIGN_H = 1920

// Store pages. NOTE: the assessment PDF's store links were not resolvable here —
// replace with the real Coin Sort store URLs before launch.
export const STORE_URL = {
  ios: 'https://apps.apple.com/app/id0000000000',
  android: 'https://play.google.com/store/apps/details?id=com.coinsort.changechange',
}

// Depth map.
//  - Layout placeables compute depth as `zIndex * LAYER` (zIndex from
//    layout.json / the in-game editor). Keep gameplay zIndex values small
//    (0..30) so they interleave cleanly with the dynamic-object depths below.
//  - Dynamic objects (coins, delivered coin, VFX) and the full-screen overlays
//    use explicit depths so they always sit at the right band regardless of the
//    editor.
export const DEPTH = {
  LAYER: 1_000, // placeable depth = zIndex * LAYER

  COIN: 6_500, // coins resting in the tray (tray placeable is zIndex 6 -> 6000)
  COIN_POP: 6_700, // a coin being merged / emphasised
  COIN_DRAG: 6_800,
  DELIVER: 9_000, // coin flying up to the customer (above customer + bubble)
  VFX: 9_500,

  DIM: 110_000,
  HAND: 111_000,
  ENDCARD: 120_000,
  ENDCARD_INPUT: 120_010,
  EDIT: 200_000, // in-game editor handles/labels, above everything
}

// Native art dimensions (px) used to size placeables. Read from the source PNGs.
export const ART = {
  bg: [2804, 561],
  table: [2804, 561],
  tray: [835, 670],
  coin: [115, 100],
  popup: [112, 113],
  bubble: [334, 260],
  person1: [653, 2063],
  person2: [531, 1964],
  person3: [521, 1933],
  deal: [332, 171],
  merge: [331, 171],
  heart: [88, 74],
  logo: [255, 115],
  patienceFrame: [300, 50],
  patienceContainer: [285, 35],
  patienceFill: [286, 36],
  patienceLabel: [162, 32],
  hand: [322, 289],
  tapHint: [978, 388],
  coinGlow: [197, 181],
  sunrays: [1080, 1298],
  ecLogo: [1078, 522],
  ecCta: [629, 215],
} as const

// Tray slot grid (2 rows x 5 cols) expressed as fractions of the tray's display
// rect, so coins follow the tray when it is moved/scaled in the editor. The
// isometric art is approximated with a small per-row vertical offset.
export const TRAY = {
  cols: 5,
  rows: 2,
  // inset of the slot grid inside the tray bounding box (fraction of w/h)
  insetX: 0.12,
  insetTop: 0.18,
  insetBottom: 0.16,
  // coin display width as a fraction of one cell width
  coinCellW: 0.84,
} as const

// Coin values run 1..6 (matching 1-coin.png .. 6-coin.png).
export const COIN_MAX = 6

// Interaction timings (ms).
export const IDLE_HINT_MS = 4000 // PDF: 4s inactivity -> hand + "tap to merge"
export const PATIENCE_MS = 14_000 // per-customer patience duration
export const TUTORIAL_DIM_ALPHA = 0.75 // PDF: 0.75 opaque tutorial overlay
