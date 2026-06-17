import Phaser from 'phaser'
import { DEPTH } from '../constants'
import { sx, sy, sd, centerX, coverScale } from '../utils/responsive'
import { layoutOf, type LayoutEntry } from '../layout'
import { registerEditable, isEditEnabled, type Editable } from '../edit/registry'

// The atom every laid-out asset is built on. Holds a single Image plus its
// design-space entry (from layout.json). relayout() applies the entry on every
// resize: FIT items use sx/sy/sd (centered 1080-wide column); EXTEND items
// (bg, table) cover the full viewport width via centerX/coverScale while their
// height tracks the gameplay scale. Depth derives from the entry's zIndex.
//
// In dev #edit it registers itself so EditMode can drag/scale/restack it; the
// editor mutates `entry` (the live layout.json object) and calls relayout().
export interface PlaceableOpts {
  origin?: number
  /** When set, depth = depthBase + zIndex (keeps an element in a fixed band,
   *  e.g. the end card, while the editor's zIndex still nudges within it). */
  depthBase?: number
}

export class Placeable implements Editable {
  readonly key: string
  readonly image: Phaser.GameObjects.Image
  readonly entry: LayoutEntry
  readonly nativeW: number
  readonly nativeH: number
  private depthBase?: number

  constructor(scene: Phaser.Scene, key: string, textureKey: string, opts: PlaceableOpts = {}) {
    this.key = key
    this.depthBase = opts.depthBase
    this.entry = layoutOf(key)
    this.image = scene.add.image(0, 0, textureKey).setOrigin(opts.origin ?? 0.5)
    const src = scene.textures.get(textureKey).getSourceImage() as { width: number; height: number }
    this.nativeW = src.width || 100
    this.nativeH = src.height || 100
    this.relayout()
    if (isEditEnabled()) registerEditable(this)
  }

  relayout(): void {
    const e = this.entry
    if (e.mode === 'extend') {
      const s = coverScale(this.nativeW, e.scale)
      this.image.setPosition(centerX(), sy(e.y)).setDisplaySize(this.nativeW * s, this.nativeH * s)
    } else {
      this.image
        .setPosition(sx(e.x), sy(e.y))
        .setDisplaySize(sd(this.nativeW * e.scale), sd(this.nativeH * e.scale))
    }
    this.image.setDepth(this.depthBase != null ? this.depthBase + e.zIndex : e.zIndex * DEPTH.LAYER)
  }

  /** Design-space center (for code that positions other objects relative to this). */
  get cx(): number {
    return this.entry.x
  }
  get cy(): number {
    return this.entry.y
  }

  setVisible(v: boolean): this {
    this.image.setVisible(v)
    return this
  }

  destroy(): void {
    this.image.destroy()
  }
}
