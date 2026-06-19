import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { TRAY, DEPTH } from '../constants'
import { layoutOf, wasLoaded } from '../layout'
import { isEditEnabled } from '../edit/registry'
import { coinStack } from '../coinstack'

// The coin tray sprite + the geometry of its 2x5 slot grid. Slot centers come
// from the computed grid by default, but each slot can be individually placed
// (per column/row) via a draggable marker in #edit, saved to layout.json as
// slot0..slot9. So coins follow the tray, or snap to hand-placed positions.
export class CoinTray {
  readonly placeable: Placeable
  private markers: Placeable[] = []

  constructor(scene: Phaser.Scene) {
    this.placeable = new Placeable(scene, 'tray', 'tray')
    if (isEditEnabled()) this.makeMarkers(scene)
  }

  get slotCount(): number {
    return TRAY.cols * TRAY.rows
  }

  /** Computed (default) center of slot i from the tray's grid. */
  private gridCenter(i: number): { x: number; y: number } {
    const e = this.placeable.entry
    const w = this.placeable.nativeW * e.scale
    const h = this.placeable.nativeH * e.scale
    const left = e.x - w / 2
    const top = e.y - h / 2
    const gridLeft = left + w * TRAY.insetX
    const cellW = (w * (1 - 2 * TRAY.insetX)) / TRAY.cols
    const gridTop = top + h * TRAY.insetTop
    const cellH = (h * (1 - TRAY.insetTop - TRAY.insetBottom)) / TRAY.rows
    const col = i % TRAY.cols
    const row = Math.floor(i / TRAY.cols)
    return { x: gridLeft + cellW * (col + 0.5), y: gridTop + cellH * (row + 0.5) }
  }

  /** Design-space center of slot i: hand-placed override if any, else grid. */
  slotCenter(i: number): { x: number; y: number } {
    const key = `slot${i}`
    // In #edit the markers exist and own the live positions (coins follow them);
    // in normal play, only use an override that was actually saved to disk.
    if ((isEditEnabled() && this.markers.length) || wasLoaded(key)) {
      const e = layoutOf(key)
      return { x: e.x, y: e.y }
    }
    return this.gridCenter(i)
  }

  /** Design-space coin width (slightly smaller than a cell), times the live
   *  coinScale tuning factor. When a slot index is given, also applies that
   *  slot's own size multiplier — so back-row columns can be shrunk for
   *  perspective by scaling their slot markers in #edit. */
  coinWidth(col?: number): number {
    const e = this.placeable.entry
    const w = this.placeable.nativeW * e.scale
    const cellW = (w * (1 - 2 * TRAY.insetX)) / TRAY.cols
    const base = cellW * TRAY.coinCellW * coinStack().coinScale
    if (col === undefined) return base
    // The near (last) row reads as closer, so its coins get a size bump.
    const frontRow = Math.floor(col / TRAY.cols) === TRAY.rows - 1
    const rowMul = frontRow ? coinStack().frontRowScale : 1
    return base * this.slotScale(col) * rowMul
  }

  /** Per-slot coin-size multiplier. Mirrors slotCenter()'s rule: a slot override
   *  only applies once it's live in #edit or actually saved to disk; otherwise 1.
   *  Editing a slot marker's scale (wheel) in #edit feeds straight into this. */
  slotScale(i: number): number {
    const key = `slot${i}`
    if ((isEditEnabled() && this.markers.length) || wasLoaded(key)) {
      return layoutOf(key).scale
    }
    return 1
  }

  // ---- edit-mode slot markers --------------------------------------------
  private makeMarkers(scene: Phaser.Scene): void {
    if (!scene.textures.exists('slotDot')) {
      const g = scene.add.graphics()
      g.fillStyle(0x33ff99, 0.45).fillCircle(22, 22, 20)
      g.lineStyle(4, 0x0a5a33, 1).strokeCircle(22, 22, 20)
      g.generateTexture('slotDot', 44, 44)
      g.destroy()
    }
    for (let i = 0; i < this.slotCount; i++) {
      const key = `slot${i}`
      const e = layoutOf(key)
      if (!wasLoaded(key)) {
        const g = this.gridCenter(i)
        e.x = Math.round(g.x)
        e.y = Math.round(g.y)
        e.mode = 'fit'
      }
      this.markers.push(new Placeable(scene, key, 'slotDot', { depthBase: DEPTH.EDIT - 50 }))
    }
  }

  relayout(): void {
    this.placeable.relayout()
    for (const m of this.markers) m.relayout()
  }
}
