import Phaser from 'phaser'
import { DEPTH, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { texKey } from '../assets'
import { layoutOf, type LayoutEntry } from '../layout'
import { registerEditable, isEditEnabled, type Editable } from '../edit/registry'

// The current customer sprite. All customers share one design height (so heads
// stay aligned regardless of art size); width follows each art's aspect. Swaps
// to the *-angry variant when patience runs low. Draggable in #edit via the
// 'customer' entry.
const REF_H = ART.person1[1]

export class Customer implements Editable {
  readonly key = 'customer'
  readonly image: Phaser.GameObjects.Image
  readonly entry: LayoutEntry
  private index = 0
  private angry = false
  private natW: number = ART.person1[0]
  private natH: number = ART.person1[1]

  constructor(private scene: Phaser.Scene) {
    this.entry = layoutOf('customer')
    this.image = scene.add.image(0, 0, texKey.customer(0)).setOrigin(0.5, 0.5)
    this.captureNative()
    this.relayout()
    if (isEditEnabled()) registerEditable(this)
  }

  private captureNative(): void {
    const src = this.scene.textures.get(this.image.texture.key).getSourceImage() as {
      width: number
      height: number
    }
    this.natW = src.width || REF_H
    this.natH = src.height || REF_H
  }

  setCustomer(i: number): void {
    this.index = i
    this.angry = false
    this.image.setTexture(texKey.customer(i))
    this.captureNative()
    this.relayout()
  }

  setAngry(a: boolean): void {
    if (this.angry === a) return
    this.angry = a
    this.image.setTexture(a ? texKey.customerAngry(this.index) : texKey.customer(this.index))
    this.captureNative()
    this.relayout()
  }

  enter(): void {
    const baseX = sx(this.entry.x)
    this.image.setAlpha(0).setX(baseX + sd(260))
    this.scene.tweens.add({
      targets: this.image,
      x: baseX,
      alpha: 1,
      duration: 420,
      ease: 'Back.easeOut',
    })
  }

  leave(onDone?: () => void): void {
    this.scene.tweens.add({
      targets: this.image,
      x: this.image.x - sd(300),
      alpha: 0,
      duration: 360,
      ease: 'Quad.easeIn',
      onComplete: () => onDone?.(),
    })
  }

  relayout(): void {
    const e = this.entry
    const h = REF_H * e.scale
    const w = h * (this.natW / this.natH)
    this.image
      .setPosition(sx(e.x), sy(e.y))
      .setDisplaySize(sd(w), sd(h))
      .setDepth(e.zIndex * DEPTH.LAYER)
  }
}
