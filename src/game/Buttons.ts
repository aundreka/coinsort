import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { isEditEnabled } from '../edit/registry'
import { sd } from '../utils/responsive'
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
  private dealEnabled = true
  private scene: Phaser.Scene
  private mergePulse?: Phaser.Tweens.Tween
  private dealPulse?: Phaser.Tweens.Tween
  private block!: Phaser.GameObjects.Graphics // "no" icon shown on a blocked DEAL

  constructor(scene: Phaser.Scene, sound: SoundManager, cbs: ButtonCallbacks) {
    this.scene = scene
    this.deal = new Placeable(scene, 'dealBtn', 'dealBtn')
    this.merge = new Placeable(scene, 'mergeBtn', 'mergeBtn')
    this.block = scene.add.graphics().setDepth(this.deal.image.depth + 5).setAlpha(0)

    if (!isEditEnabled()) {
      // DEAL stays at full strength even when it can't be used; pressing it while
      // there's no empty column flashes a "blocked" icon + buzz instead of dealing.
      this.wire(
        this.deal,
        () => {
          sound.playClick()
          cbs.onDeal()
        },
        () => this.dealEnabled,
        () => {
          sound.playWrong()
          this.showBlocked()
        },
      )
      this.wire(this.merge, () => {
        sound.playClick()
        cbs.onMerge()
      })
    }
  }

  private wire(p: Placeable, fn: () => void, guard?: () => boolean, onBlocked?: () => void): void {
    p.image.setInteractive({ useHandCursor: true })
    p.image.on('pointerdown', () => {
      if (!this.enabled) return
      if (guard && !guard()) {
        onBlocked?.()
        return
      }
      this.press(p)
      fn()
    })
  }

  /** Flash the universal "no" symbol (red circle + slash) over DEAL, popping in and
   *  fading out — the cue that DEAL can't be used right now (no empty column). */
  private showBlocked(): void {
    const r = sd(42)
    const d = r * Math.SQRT1_2
    this.block.clear()
    this.block.lineStyle(sd(9), 0xff2e2e, 1)
    this.block.strokeCircle(0, 0, r)
    this.block.beginPath()
    this.block.moveTo(-d, -d)
    this.block.lineTo(d, d)
    this.block.strokePath()
    this.block.setPosition(this.deal.image.x, this.deal.image.y).setAlpha(1).setScale(0.5)
    this.scene.tweens.killTweensOf(this.block)
    this.scene.tweens.add({ targets: this.block, scale: 1, duration: 170, ease: 'Back.easeOut' })
    this.scene.tweens.add({
      targets: this.block,
      alpha: 0,
      delay: 480,
      duration: 240,
      ease: 'Quad.easeIn',
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

  /** Track whether DEAL can be used (an empty column exists). The button keeps its
   *  full look either way — pressing it while disabled flashes the block icon
   *  (showBlocked) rather than dealing, via the wired guard. */
  setDealEnabled(on: boolean): void {
    this.dealEnabled = on
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
    this.scene.tweens.killTweensOf(this.block)
    this.block.setAlpha(0) // drop the transient block icon on resize
  }
}
