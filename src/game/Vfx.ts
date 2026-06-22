import Phaser from 'phaser'
import { DEPTH } from '../constants'
import { sd, viewW, viewH } from '../utils/responsive'

// Visual juice. Pure presentation — no SDK, no game state.
export class Vfx {
  constructor(private scene: Phaser.Scene) {}

  /** Full-screen red flash — reserved for the patience-meter failure (paired with
   *  the screen shake). Oversized + screen-pinned so it always covers the canvas. */
  redFlash(): void {
    const big = Math.max(viewW(), viewH()) * 3
    const r = this.scene.add
      .rectangle(viewW() / 2, viewH() / 2, big, big, 0xff2a2a, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.DIM - 1)
    this.scene.tweens.add({
      targets: r,
      alpha: 0.42,
      duration: 110,
      yoyo: true,
      hold: 60,
      ease: 'Quad.easeOut',
      onComplete: () => r.destroy(),
    })
  }

  /** Expanding glow burst at a screen position (merge / deliver accent). */
  glowBurst(screenX: number, screenY: number, designW = 180, tint?: number): void {
    const g = this.scene.add
      .image(screenX, screenY, 'coinGlow')
      .setOrigin(0.5)
      .setDepth(DEPTH.VFX)
      .setAlpha(0.9)
    g.setDisplaySize(sd(designW * 0.4), sd(designW * 0.4))
    if (tint !== undefined) g.setTint(tint)
    this.scene.tweens.add({
      targets: g,
      scaleX: g.scaleX * 2.4,
      scaleY: g.scaleY * 2.4,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    })
  }

  /** Quick squash-and-stretch pop on any image (keeps its current size). */
  pop(image: Phaser.GameObjects.Image, amount = 1.25, duration = 180): void {
    const sxv = image.scaleX
    const syv = image.scaleY
    this.scene.tweens.add({
      targets: image,
      scaleX: sxv * amount,
      scaleY: syv * amount,
      duration: duration / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => image.setScale(sxv, syv),
    })
  }

  /** A short sparkle of small glow flecks. */
  sparkle(screenX: number, screenY: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5
      const dist = sd(40 + Math.random() * 50)
      const fleck = this.scene.add
        .image(screenX, screenY, 'coinGlow')
        .setOrigin(0.5)
        .setDepth(DEPTH.VFX)
        .setAlpha(0.85)
      fleck.setDisplaySize(sd(36), sd(36))
      this.scene.tweens.add({
        targets: fleck,
        x: screenX + Math.cos(a) * dist,
        y: screenY + Math.sin(a) * dist,
        alpha: 0,
        scaleX: fleck.scaleX * 0.3,
        scaleY: fleck.scaleY * 0.3,
        duration: 480,
        ease: 'Cubic.easeOut',
        onComplete: () => fleck.destroy(),
      })
    }
  }

  /** Press feedback for a button image (returns to its base scale). */
  press(image: Phaser.GameObjects.Image): void {
    const sxv = image.scaleX
    const syv = image.scaleY
    this.scene.tweens.add({
      targets: image,
      scaleX: sxv * 0.9,
      scaleY: syv * 0.9,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => image.setScale(sxv, syv),
    })
  }

  /** Soft white cloud poof (merge effect). */
  cloudPuff(screenX: number, screenY: number, designSize = 170): void {
    const r = sd(designSize) * 0.5
    for (let i = 0; i < 9; i++) {
      const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.6
      const dist = r * (0.15 + Math.random() * 0.5)
      const puff = this.scene.add
        .circle(screenX + Math.cos(a) * dist, screenY + Math.sin(a) * dist, r * 0.6, 0xffffff, 1)
        .setDepth(DEPTH.VFX)
      puff.setScale(0.4)
      this.scene.tweens.add({
        targets: puff,
        scale: 2.2,
        alpha: 0,
        duration: 460 + Math.random() * 140,
        ease: 'Cubic.easeOut',
        onComplete: () => puff.destroy(),
      })
    }
  }

  shake(intensity = 0.006, duration = 220): void {
    this.scene.cameras.main.shake(duration, intensity)
  }
}
