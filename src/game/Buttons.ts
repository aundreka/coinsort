import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { isEditEnabled } from '../edit/registry'
import type { SoundManager } from './SoundManager'

interface ButtonCallbacks {
  onDeal: () => void
  onMerge: () => void
}

// The DEAL + MERGE buttons. In #edit mode they are left non-interactive so the
// editor can drag them; otherwise they fire their callbacks with press juice.
// All scale tweens reset to the placeable's true base scale first (via
// relayout) and kill any in-flight tween, so spamming the buttons can't compound
// the shrink and leave them tiny.
export class Buttons {
  readonly deal: Placeable
  readonly merge: Placeable
  private enabled = true
  private scene: Phaser.Scene
  private mergePulse?: Phaser.Tweens.Tween
  private dealPulse?: Phaser.Tweens.Tween

  constructor(scene: Phaser.Scene, sound: SoundManager, cbs: ButtonCallbacks) {
    this.scene = scene
    this.deal = new Placeable(scene, 'dealBtn', 'dealBtn')
    this.merge = new Placeable(scene, 'mergeBtn', 'mergeBtn')

    if (!isEditEnabled()) {
      this.wire(this.deal, () => {
        sound.playClick()
        cbs.onDeal()
      })
      this.wire(this.merge, () => {
        sound.playClick()
        cbs.onMerge()
      })
    }
  }

  private wire(p: Placeable, fn: () => void): void {
    p.image.setInteractive({ useHandCursor: true })
    p.image.on('pointerdown', () => {
      if (!this.enabled) return
      this.press(p)
      fn()
    })
  }

  /** Press juice — always relative to the true base scale (no compounding). */
  private press(p: Placeable): void {
    this.scene.tweens.killTweensOf(p.image)
    p.relayout() // reset to true base scale + position
    const s = p.image.scaleX
    this.scene.tweens.add({
      targets: p.image,
      scaleX: s * 0.9,
      scaleY: s * 0.9,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => p.relayout(),
    })
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  /** Continuously pulse MERGE while a column is ready to merge. */
  setMergeReady(on: boolean): void {
    this.mergePulse = this.togglePulse(this.merge, on, this.mergePulse)
  }

  /** Continuously pulse DEAL while the player can't yet form a full column. Uses
   *  the SAME pulse as MERGE so the two read consistently. */
  setDealReady(on: boolean): void {
    this.dealPulse = this.togglePulse(this.deal, on, this.dealPulse)
  }

  /** Start/stop a looping attention pulse on a button (idempotent). */
  private togglePulse(
    p: Placeable,
    on: boolean,
    cur: Phaser.Tweens.Tween | undefined,
  ): Phaser.Tweens.Tween | undefined {
    if (on) {
      if (cur && cur.isPlaying()) return cur
      this.scene.tweens.killTweensOf(p.image)
      p.relayout()
      const s = p.image.scaleX
      return this.scene.tweens.add({
        targets: p.image,
        scaleX: s * 1.1,
        scaleY: s * 1.1,
        duration: 340, // slightly faster, identical for both buttons
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }
    if (cur) {
      cur.remove()
      p.relayout()
    }
    return undefined
  }

  relayout(): void {
    this.deal.relayout()
    this.merge.relayout()
  }
}
