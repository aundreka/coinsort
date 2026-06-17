import Phaser from 'phaser'
import { DEPTH, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { layoutOf } from '../layout'

type Pt = { x: number; y: number }
const near = (a: Pt | undefined, b: Pt) => !!a && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2

// Pointing-hand guide. Three behaviors:
//  - slide(from,to): demonstrate the move-merge gesture — hand starts on a
//    mergeable stack and slides to the column it should merge into, looping.
//  - pointAt('mergeBtn'|'dealBtn'): tap over a button.
// The "tap to merge coins" label is a SEPARATE element pinned to screen center
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
    this.hand = scene.add.image(0, 0, 'hand').setOrigin(0.3, 0.15).setDepth(DEPTH.HAND).setVisible(false)
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
    this.hand.setVisible(false)
    this.label.setVisible(false)
  }

  private startSlide(): void {
    if (!this.from || !this.to) return
    this.tween?.remove()
    this.hand.setPosition(this.from.x, this.from.y).setAlpha(1)
    this.tween = this.scene.tweens.add({
      targets: this.hand,
      x: this.to.x,
      y: this.to.y,
      duration: 850,
      ease: 'Sine.easeInOut',
      repeat: -1,
      repeatDelay: 450,
      onRepeat: () => this.from && this.hand.setPosition(this.from.x, this.from.y),
    })
  }

  private startTap(): void {
    const btn = layoutOf(this.curKey ?? 'mergeBtn')
    const bx = sx(btn.x + 30)
    const by = sy(btn.y + 10)
    this.hand.setPosition(bx, by).setDisplaySize(sd(ART.hand[0] * 0.7), sd(ART.hand[1] * 0.7))
    this.tween?.remove()
    this.tween = this.scene.tweens.add({
      targets: this.hand,
      y: by + sd(34),
      scaleX: this.hand.scaleX * 0.92,
      scaleY: this.hand.scaleY * 0.92,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })
  }

  /** "tap to merge coins" — pinned to the center of the tray. */
  private layoutLabel(show: boolean): void {
    if (!show) {
      this.label.setVisible(false)
      return
    }
    const tray = layoutOf('tray')
    this.label
      .setVisible(true)
      .setPosition(sx(tray.x), sy(tray.y))
      .setDisplaySize(sd(ART.tapHint[0] * 0.7), sd(ART.tapHint[1] * 0.7))
  }

  relayout(): void {
    // Label always re-pins to screen center.
    if (this.mode !== 'none') this.layoutLabel(this.label.visible)
    // Re-aim a button tap; slide coords are refreshed by GameScene each frame.
    if (this.mode === 'point') this.startTap()
  }
}
