import Phaser from 'phaser'
import { DEPTH, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { texKey } from '../assets'

// A single pooled coin token. Stores its design-space center + width so it can
// be re-placed on resize. value is 1..6 and swaps the texture.
export class Coin {
  readonly image: Phaser.GameObjects.Image
  value = 1
  slot = -1
  private dx = 0
  private dy = 0
  private dw = 0

  constructor(scene: Phaser.Scene) {
    this.image = scene.add
      .image(0, 0, texKey.coin(1))
      .setOrigin(0.5)
      .setDepth(DEPTH.COIN)
      .setVisible(false)
  }

  setValue(v: number): void {
    this.value = v
    this.image.setTexture(texKey.coin(v))
    this.applySize()
  }

  /** Place at a design-space center with a design-space width (instant). */
  place(dx: number, dy: number, dw: number): void {
    this.dx = dx
    this.dy = dy
    this.dw = dw
    this.image.setVisible(true)
    this.image.setPosition(sx(dx), sy(dy))
    this.applySize()
  }

  /** Smoothly tween to a new design-space center (keeps stored coords in sync). */
  moveTo(
    scene: Phaser.Scene,
    dx: number,
    dy: number,
    duration: number,
    ease = 'Quad.easeOut',
    onComplete?: () => void,
    delay = 0,
  ): void {
    this.dx = dx
    this.dy = dy
    this.image.setVisible(true)
    scene.tweens.add({ targets: this.image, x: sx(dx), y: sy(dy), duration, ease, delay, onComplete })
  }

  /** Throw to a new design-space center along an arc (parabolic hop), keeping
   *  stored coords in sync. arcDesignH is the peak height above the straight
   *  line, in design px. */
  arcTo(
    scene: Phaser.Scene,
    dx: number,
    dy: number,
    duration: number,
    arcDesignH: number,
    ease = 'Cubic.easeInOut',
    onComplete?: () => void,
    delay = 0,
    spinDeg = 0,
  ): void {
    this.dx = dx
    this.dy = dy
    this.image.setVisible(true)
    const fromX = this.image.x
    const fromY = this.image.y
    const toX = sx(dx)
    const toY = sy(dy)
    const arc = sd(arcDesignH)
    const spin = (toX >= fromX ? 1 : -1) * spinDeg // roll in the travel direction
    const o = { t: 0 }
    scene.tweens.add({
      targets: o,
      t: 1,
      duration,
      ease,
      delay,
      onUpdate: () => {
        this.image.x = fromX + (toX - fromX) * o.t
        this.image.y = fromY + (toY - fromY) * o.t - arc * Math.sin(o.t * Math.PI)
        this.image.angle = spin * o.t // rotate sideways as it flies
      },
      onComplete: () => {
        this.image.setPosition(toX, toY)
        this.image.setAngle(0)
        onComplete?.()
      },
    })
  }

  /** Raise above the stack (selected/lifted) or return to the resting band. */
  setLifted(on: boolean): void {
    this.image.setDepth(on ? DEPTH.COIN_POP : DEPTH.COIN)
  }

  /** Update the design-space width (keeps aspect) without moving. */
  setWidth(dw: number): void {
    this.dw = dw
    this.applySize()
  }

  private applySize(): void {
    if (this.dw <= 0) return
    const ar = ART.coin[1] / ART.coin[0]
    this.image.setDisplaySize(sd(this.dw), sd(this.dw * ar))
  }

  /** Re-apply stored design coords after a resize. */
  relayout(): void {
    if (!this.image.visible) return
    this.image.setPosition(sx(this.dx), sy(this.dy))
    this.applySize()
  }

  get designPos(): { x: number; y: number; w: number } {
    return { x: this.dx, y: this.dy, w: this.dw }
  }

  hide(): void {
    this.image.setVisible(false)
    this.image.setDepth(DEPTH.COIN)
    this.image.setAngle(0)
  }
}
