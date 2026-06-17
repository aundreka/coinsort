import Phaser from 'phaser'
import { DEPTH } from '../constants'
import { inverseX, inverseY } from '../utils/responsive'
import { editItems, onEditAdd, type Editable } from './registry'
import { saveLayout } from './layoutClient'

// In-game layout editor (dev + #edit only). Edits are NOT auto-saved — they only
// reposition the live game so you can see them; press S to write layout.json.
//  - Tab / Shift+Tab : cycle-select any asset (reliable even when overlapping)
//  - tap an asset     : select it · drag : move · wheel : scale
//  - arrows           : nudge selected (Shift = x10) · [ ] : z-index
//  - C                : preview the end card · S : SAVE to layout.json
// EXTEND items (bg, table) lock X to center; only Y/scale matter.
export class EditMode {
  private boxes = new Map<Editable, { rect: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>()
  private selected?: Editable
  private hud: Phaser.GameObjects.Text
  private dirty = false
  private saving = false

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
    const ok = await saveLayout()
    this.saving = false
    if (ok) this.dirty = false
    this.updateHud(ok ? 'SAVED ✓' : 'SAVE FAILED')
  }

  /** Apply an edit: re-layout the scene (composite modules follow), refresh
   *  boxes/HUD, mark dirty. NO auto-save — the user presses S. */
  private commit(): void {
    this.dirty = true
    this.onChange()
    for (const it of this.boxes.keys()) this.refreshBox(it)
    this.updateHud()
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
    this.hud.setText(
      `EDIT MODE  [${state}]\n` +
        `selected: ${sel}\n` +
        `Tab=cycle · drag/arrows=move · wheel=scale · [ ]=z · C=end card · S=save`,
    )
  }

  relayout(): void {
    this.hud.setPosition(12, 12)
    for (const it of this.boxes.keys()) this.refreshBox(it)
  }
}
