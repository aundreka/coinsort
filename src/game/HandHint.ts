import Phaser from 'phaser'
import { DEPTH, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { layoutOf } from '../layout'

type Pt = { x: number; y: number }
const near = (a: Pt | undefined, b: Pt) => !!a && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2

// Design-space Y for the "tap to merge coins" banner: parked in the gap ABOVE the
// tray (top coin row is ~1010) so it never sits under the hand guide that slides
// across the coins. Design-pinned (not viewport-centred) so it tracks the tray.
const LABEL_Y = 780

// Pointing-hand guide. Three behaviors:
//  - slide(from,to): demonstrate the move-merge gesture — hand starts on a
//    mergeable stack and slides to the column it should merge into, looping.
//  - pointAt('mergeBtn'|'dealBtn'): tap over a button.
// The "tap to merge coins" label is a SEPARATE element pinned just above the tray
// (not attached to the hand); shown only while merging is the suggested action.
export class HandHint {
  private hand: Phaser.GameObjects.Image
  private label: Phaser.GameObjects.Image
  private tween?: Phaser.Tweens.Tween
  private mode: 'none' | 'point' | 'slide' = 'none'
  private curKey?: 'mergeBtn' | 'dealBtn'
  private from?: Pt
  private to?: Pt

  constructor(private scene: Phaser.Scene) {
    // Pivot on the actual FINGERTIP. The index finger points up-and-left, so the
    // tip sits at ~x0.20 / y0.10 of the art (measured from the alpha) — anchoring
    // there lands the fingertip exactly on the coin instead of the hand's middle.
    this.hand = scene.add.image(0, 0, 'hand').setOrigin(0.2, 0.1).setDepth(DEPTH.HAND).setVisible(false)
    this.label = scene.add.image(0, 0, 'tapHint').setOrigin(0.5).setDepth(DEPTH.HAND).setVisible(false)
  }

  get isVisible(): boolean {
    return this.mode !== 'none'
  }

  /** Demonstrate dragging a stack from `from` onto `to` (screen px). */
  slide(from: Pt, to: Pt): void {
    if (this.mode === 'slide' && near(this.from, from) && near(this.to, to)) return
    this.mode = 'slide'
    this.curKey = undefined
    this.from = from
    this.to = to
    this.hand.setVisible(true).setDisplaySize(sd(ART.hand[0] * 0.7), sd(ART.hand[1] * 0.7))
    this.startSlide()
    this.layoutLabel(true)
  }

  /** Tap over a button. Shows the centered text only for the MERGE button. */
  pointAt(key: 'mergeBtn' | 'dealBtn'): void {
    if (this.mode === 'point' && this.curKey === key) return
    this.mode = 'point'
    this.curKey = key
    this.from = this.to = undefined
    this.hand.setVisible(true)
    this.startTap()
    this.layoutLabel(key === 'mergeBtn')
  }

  hide(): void {
    if (this.mode === 'none') return
    this.mode = 'none'
    this.curKey = undefined
    this.from = this.to = undefined
    this.tween?.remove()
    this.tween = undefined
    // Always ease — fade out, never pop off-screen.
    this.scene.tweens.killTweensOf(this.hand)
    this.scene.tweens.add({
      targets: this.hand,
      alpha: 0,
      duration: 200,
      ease: 'Quad.easeIn',
      onComplete: () => this.hand.setVisible(false),
    })
    this.label.setVisible(false)
  }

  /** The full move-merge gesture, looped: TAP on the source stack, SLIDE across to
   *  the target column, then TAP again on the target (pick up → carry → drop). One
   *  looping counter tween drives every phase, so it's a plain Tween (safe to
   *  remove) and the only jump — the reset to the source for the next loop —
   *  happens during the fade-out, so nothing ever visibly teleports. */
  private startSlide(): void {
    if (!this.from || !this.to) return
    this.tween?.remove()
    this.scene.tweens.killTweensOf(this.hand)
    const { x: fx, y: fy } = this.from
    const { x: tx, y: ty } = this.to
    const baseScale = this.hand.scaleX // base set by slide()'s setDisplaySize
    const dip = 0.2 // tap = shrink to 80% and scale back up (not a vertical bob)
    const smooth = (t: number) => t * t * (3 - 2 * t) // ease the slide
    // Phase boundaries on the 0..1 loop: fade-in, tap source, slide, tap target,
    // hold, fade-out (the remainder).
    const P = { in: 0.1, tapA: 0.3, slide: 0.6, tapB: 0.8, hold: 0.9 }
    this.hand.setPosition(fx, fy).setAlpha(0)
    this.tween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 2200,
      repeat: -1,
      onUpdate: (tw) => {
        const t = tw.getValue() as number
        let x = fx
        let y = fy
        let a = 1
        let sc = 1
        if (t < P.in) {
          a = t / P.in // fade in at the source
        } else if (t < P.tapA) {
          const u = (t - P.in) / (P.tapA - P.in)
          sc = 1 - dip * Math.sin(u * Math.PI) // a single tap (shrink) at source
        } else if (t < P.slide) {
          const u = smooth((t - P.tapA) / (P.slide - P.tapA))
          x = fx + (tx - fx) * u
          y = fy + (ty - fy) * u // glide to the target
        } else if (t < P.tapB) {
          x = tx
          y = ty
          const u = (t - P.slide) / (P.tapB - P.slide)
          sc = 1 - dip * Math.sin(u * Math.PI) // a single tap (shrink) at target
        } else if (t < P.hold) {
          x = tx
          y = ty // brief hold
        } else {
          x = tx
          y = ty
          a = 1 - (t - P.hold) / (1 - P.hold) // fade out before the loop resets
        }
        this.hand.setPosition(x, y).setAlpha(a).setScale(baseScale * sc)
      },
    })
  }

  /** Tap loop: the finger presses by SHRINKING and scaling back up (a tap-down
   *  pulse, not a vertical bob), with the alpha folded in so it eases in/out. */
  private startTap(): void {
    const btn = layoutOf(this.curKey ?? 'mergeBtn')
    const bx = sx(btn.x + 30)
    const by = sy(btn.y + 10)
    this.scene.tweens.killTweensOf(this.hand)
    this.hand
      .setPosition(bx, by)
      .setDisplaySize(sd(ART.hand[0] * 0.7), sd(ART.hand[1] * 0.7))
      .setAlpha(0.45)
    const s = this.hand.scaleX
    this.tween = this.scene.tweens.add({
      targets: this.hand,
      scaleX: s * 0.8, // shrink (tap down) then scale back up on the yoyo
      scaleY: s * 0.8,
      alpha: 1, // pulse 0.45 -> 1 -> 0.45 with the press (fades in/out, never vanishes)
      duration: 460,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  /** "tap to merge coins" — pinned in the gap just ABOVE the tray (so it clears
   *  the hand guide), horizontally centred on the gameplay column. */
  private layoutLabel(show: boolean): void {
    if (!show) {
      this.label.setVisible(false)
      return
    }
    this.label
      .setVisible(true)
      .setPosition(sx(540), sy(LABEL_Y))
      .setDisplaySize(sd(ART.tapHint[0] * 0.7), sd(ART.tapHint[1] * 0.7))
  }

  relayout(): void {
    // Label re-pins above the tray.
    if (this.mode !== 'none') this.layoutLabel(this.label.visible)
    // Re-aim a button tap; slide coords are refreshed by GameScene each frame.
    if (this.mode === 'point') this.startTap()
  }
}
