import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { isEditEnabled } from '../edit/registry'
import type { Vfx } from './Vfx'
import type { SoundManager } from './SoundManager'

interface ButtonCallbacks {
  onDeal: () => void
  onMerge: () => void
}

// The DEAL + MERGE buttons. In #edit mode they are left non-interactive so the
// editor can drag them; otherwise they fire their callbacks with press juice.
export class Buttons {
  readonly deal: Placeable
  readonly merge: Placeable
  private enabled = true
  private scene: Phaser.Scene
  private dealPulse?: Phaser.Tweens.Tween

  constructor(scene: Phaser.Scene, vfx: Vfx, sound: SoundManager, cbs: ButtonCallbacks) {
    this.scene = scene
    this.deal = new Placeable(scene, 'dealBtn', 'dealBtn')
    this.merge = new Placeable(scene, 'mergeBtn', 'mergeBtn')

    if (!isEditEnabled()) {
      this.wire(this.deal.image, () => {
        vfx.press(this.deal.image)
        sound.playClick()
        cbs.onDeal()
      })
      this.wire(this.merge.image, () => {
        vfx.press(this.merge.image)
        sound.playClick()
        cbs.onMerge()
      })
    }
  }

  private wire(img: Phaser.GameObjects.Image, fn: () => void): void {
    img.setInteractive({ useHandCursor: true })
    img.on('pointerdown', () => {
      if (this.enabled) fn()
    })
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  /** Small attention pulse on the DEAL button (e.g. when MERGE was invalid). */
  pulseDeal(): void {
    if (this.dealPulse?.isPlaying()) return
    const img = this.deal.image
    const s = img.scaleX // base scale set by relayout()
    this.dealPulse = this.scene.tweens.add({
      targets: img,
      scaleX: s * 1.12,
      scaleY: s * 1.12,
      duration: 260,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => img.setScale(s),
    })
  }

  relayout(): void {
    this.deal.relayout()
    this.merge.relayout()
  }
}
