import Phaser from 'phaser'
import { DEPTH, TRAY } from '../constants'
import { inverseX, inverseY } from '../utils/responsive'
import { layoutOf } from '../layout'
import { editItems, onEditAdd, type Editable } from './registry'
import { saveLayout, saveCoinStack } from './layoutClient'
import { coinStack, type CoinStackConfig } from '../coinstack'

// The coin scale + perspective knobs the coin tuner cycles through (k), each
// nudged with , / . — written to src/coinstack.json on Save.
const COIN_PARAMS: { key: keyof CoinStackConfig; label: string; step: number; min: number }[] = [
  { key: 'coinScale', label: 'coin scale', step: 0.02, min: 0.2 },
  { key: 'stepFrac', label: 'pile step', step: 0.01, min: 0 },
  { key: 'inwardFrac', label: 'inward lean', step: 0.001, min: 0 },
  { key: 'backRowMult', label: 'back-row lean', step: 0.05, min: 0 },
  { key: 'liftFrac', label: 'lift height', step: 0.05, min: 0 },
  { key: 'backFrac', label: 'back anchor', step: 0.05, min: 0 },
  { key: 'depthScale', label: 'depth shrink', step: 0.01, min: 0.5 },
  { key: 'frontRowScale', label: 'front-row size', step: 0.02, min: 0.5 },
]

// In-game layout editor (dev + #edit only). Edits are NOT auto-saved — they only
// reposition the live game so you can see them; press S to write layout.json +
// coinstack.json.
//  - Tab / Shift+Tab : cycle-select any asset (reliable even when overlapping)
//  - tap an asset     : select it · drag : move · wheel : scale
//  - arrows           : nudge selected (Shift = x10) · [ ] : z-index
//  - k                : cycle coin scale/perspective param · , . : adjust it
//  - m                : toggle slot mirroring (keep the tray symmetric)
//  - C                : preview the end card · S : SAVE
// EXTEND items (bg, table) lock X to center; only Y/scale matter.
export class EditMode {
  private boxes = new Map<Editable, { rect: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>()
  private selected?: Editable
  private hud: Phaser.GameObjects.Text
  private dirty = false
  private saving = false
  private coinParamIdx = 0
  private mirror = true

  constructor(
    private scene: Phaser.Scene,
    private onChange: () => void,
    private onPreviewEndcard: () => void,
  ) {
    this.hud = scene.add
      .text(12, 12, '', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#aef5c8',
        backgroundColor: '#000a',
        padding: { x: 8, y: 6 },
      })
      .setDepth(DEPTH.EDIT + 20)
      .setScrollFactor(0)

    for (const e of editItems()) this.wire(e)
    onEditAdd((e) => this.wire(e))

    scene.input.keyboard?.on('keydown', this.onKey)
    this.updateHud()
  }

  private wire(e: Editable): void {
    const img = e.image
    img.setInteractive({ useHandCursor: true })
    this.scene.input.setDraggable(img, true)

    img.on('pointerdown', () => this.select(e))
    img.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      this.select(e)
      if (e.entry.mode === 'extend') {
        e.entry.y = Math.round(inverseY(dragY))
      } else {
        e.entry.x = Math.round(inverseX(dragX))
        e.entry.y = Math.round(inverseY(dragY))
      }
      this.commit()
    })
    img.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
      this.select(e)
      e.entry.scale = Math.max(0.05, +(e.entry.scale + (dy < 0 ? 0.02 : -0.02)).toFixed(3))
      this.commit()
    })

    const rect = this.scene.add.graphics().setDepth(DEPTH.EDIT)
    const label = this.scene.add
      .text(0, 0, e.key, { fontFamily: 'monospace', fontSize: '16px', color: '#ffcc00' })
      .setDepth(DEPTH.EDIT + 1)
    this.boxes.set(e, { rect, label })
    this.refreshBox(e)
  }

  private select(e: Editable): void {
    this.selected = e
    for (const it of this.boxes.keys()) this.refreshBox(it)
    this.updateHud()
  }

  private cycle(dir: number): void {
    const items = editItems()
    if (items.length === 0) return
    let i = this.selected ? items.indexOf(this.selected) : -1
    i = (i + dir + items.length) % items.length
    this.select(items[i])
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Tab') {
      ev.preventDefault()
      this.cycle(ev.shiftKey ? -1 : 1)
      return
    }
    if (ev.key === 's' || ev.key === 'S') {
      ev.preventDefault()
      void this.save()
      return
    }
    if (ev.key === 'c' || ev.key === 'C') {
      this.onPreviewEndcard()
      return
    }
    // ---- coin scale / perspective tuner (no asset selection needed) --------
    if (ev.key === 'k' || ev.key === 'K') {
      ev.preventDefault()
      this.coinParamIdx = (this.coinParamIdx + 1) % COIN_PARAMS.length
      this.updateHud()
      return
    }
    if (ev.key === 'm' || ev.key === 'M') {
      ev.preventDefault()
      this.mirror = !this.mirror
      this.updateHud()
      return
    }
    if (ev.key === ',' || ev.key === '.') {
      ev.preventDefault()
      const p = COIN_PARAMS[this.coinParamIdx]
      const cfg = coinStack()
      const delta = ev.key === '.' ? p.step : -p.step
      cfg[p.key] = Math.max(p.min, +(cfg[p.key] + delta).toFixed(4))
      this.commit()
      return
    }
    const e = this.selected
    if (!e) return
    const k = ev.key
    if (k === '[') e.entry.zIndex -= 1
    else if (k === ']') e.entry.zIndex += 1
    else if (k === 'ArrowLeft') e.entry.x -= ev.shiftKey ? 10 : 1
    else if (k === 'ArrowRight') e.entry.x += ev.shiftKey ? 10 : 1
    else if (k === 'ArrowUp') e.entry.y -= ev.shiftKey ? 10 : 1
    else if (k === 'ArrowDown') e.entry.y += ev.shiftKey ? 10 : 1
    else return
    ev.preventDefault()
    this.commit()
  }

  private async save(): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.updateHud('saving…')
    const [okLayout, okCoin] = await Promise.all([saveLayout(), saveCoinStack()])
    const ok = okLayout && okCoin
    this.saving = false
    if (ok) this.dirty = false
    this.updateHud(ok ? 'SAVED ✓' : 'SAVE FAILED')
  }

  /** Apply an edit: re-layout the scene (composite modules follow), refresh
   *  boxes/HUD, mark dirty. NO auto-save — the user presses S. */
  private commit(): void {
    this.dirty = true
    if (this.mirror) this.mirrorSelectedSlot()
    this.onChange()
    for (const it of this.boxes.keys()) this.refreshBox(it)
    this.updateHud()
  }

  /** Keep the tray symmetric: when a slotN marker moves, mirror it onto the
   *  matching slot on the other side (x reflected across the tray centre). */
  private mirrorSelectedSlot(): void {
    const e = this.selected
    if (!e) return
    const m = /^slot(\d+)$/.exec(e.key)
    if (!m) return
    const i = +m[1]
    const col = i % TRAY.cols
    const mirrorIdx = i - col + (TRAY.cols - 1 - col) // same row, mirrored column
    if (mirrorIdx === i) return // centre column has no pair
    const other = editItems().find((it) => it.key === `slot${mirrorIdx}`)
    if (!other) return
    const center = layoutOf('tray').x
    other.entry.x = Math.round(2 * center - e.entry.x)
    other.entry.y = e.entry.y
    other.entry.scale = e.entry.scale
  }

  private refreshBox(e: Editable): void {
    const box = this.boxes.get(e)
    if (!box) return
    const b = e.image.getBounds()
    const on = e === this.selected
    box.rect
      .clear()
      .lineStyle(on ? 3 : 1.5, on ? 0x33ff99 : 0xffcc00, on ? 1 : 0.55)
      .strokeRect(b.x, b.y, b.width, b.height)
    box.label.setPosition(b.x + 2, b.y - 20).setColor(on ? '#33ff99' : '#ffcc00')
  }

  private updateHud(status?: string): void {
    const items = editItems()
    const e = this.selected
    const idx = e ? items.indexOf(e) + 1 : 0
    const sel = e
      ? `(${idx}/${items.length}) ${e.key}  x:${e.entry.x} y:${e.entry.y} s:${e.entry.scale.toFixed(2)} z:${e.entry.zIndex} ${e.entry.mode}`
      : 'none — tap an asset or press Tab'
    const state = status ?? (this.dirty ? '● UNSAVED — press S' : 'saved')
    const cfg = coinStack()
    const cp = COIN_PARAMS[this.coinParamIdx]
    this.hud.setText(
      `EDIT MODE  [${state}]\n` +
        `selected: ${sel}\n` +
        `coins — editing ${cp.label}=${cfg[cp.key]}  (k=cycle · , .=adjust · mirror ${this.mirror ? 'ON' : 'off'}=m)\n` +
        `  scale ${cfg.coinScale} · step ${cfg.stepFrac} · inward ${cfg.inwardFrac} · backRow ${cfg.backRowMult} · lift ${cfg.liftFrac} · backAnchor ${cfg.backFrac} · depthShrink ${cfg.depthScale} · frontRow ${cfg.frontRowScale}\n` +
        `per-column size: select a slot dot · wheel (mirrors L/R — shrink the back row)\n` +
        `Tab=cycle · drag/arrows=move · wheel=scale · [ ]=z · C=end card · S=save`,
    )
  }

  relayout(): void {
    this.hud.setPosition(12, 12)
    for (const it of this.boxes.keys()) this.refreshBox(it)
  }
}
