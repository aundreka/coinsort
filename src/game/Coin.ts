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
  private tween?: Phaser.Tweens.Tween

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

  /** Place at a design-space center with a design-space width (instant). This is
   *  authoritative: it cancels any in-flight moveTo/arcTo first, so a tween whose
   *  screen target was computed at the OLD viewport scale can't keep running after
   *  a resize and drag the coin off the spot relayout just placed it. */
  place(dx: number, dy: number, dw: number): void {
    this.dx = dx
    this.dy = dy
    this.dw = dw
    this.tween?.remove()
    this.tween = undefined
    this.image.setVisible(true)
    this.image.setAngle(0)
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
    this.tween?.remove()
    this.tween = scene.tweens.add({
      targets: this.image,
      x: sx(dx),
      y: sy(dy),
      duration,
      ease,
      delay,
      onComplete: () => {
        this.tween = undefined
        onComplete?.()
      },
    })
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
    this.tween?.remove()
    this.tween = scene.tweens.add({
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
        this.tween = undefined
        this.image.setPosition(toX, toY)
        this.image.setAngle(0)
        onComplete?.()
      },
    })
  }

  /** Halt any in-flight moveTo/arcTo tween (e.g. to undo a transfer mid-flight).
   *  Resets angle: a thrown coin spins (arcTo) and only un-rotates in its
   *  onComplete, so halting it mid-flight would otherwise freeze it tilted. */
  stopTween(): void {
    this.tween?.remove()
    this.tween = undefined
    this.image.setAngle(0)
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
    this.image.setAlpha(1) // reset (collapse fades coins out before release)
    this.image.clearTint() // drop any error-flash / merge-highlight tint
    const fx = (this.image as unknown as { postFX?: { clear?: () => void } }).postFX
    if (fx && typeof fx.clear === 'function') fx.clear() // drop any merge-highlight glow
  }
}
