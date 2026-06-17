import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { texKey } from '../assets'

// The customer's request: the cloud-popup bubble (key 'bubble', draggable) with
// the requested coin's N-popup badge nested inside it.
export class SpeechBubble {
  private bubble: Placeable
  private badge: Phaser.GameObjects.Image
  private value = 2

  constructor(private scene: Phaser.Scene) {
    this.bubble = new Placeable(scene, 'bubble', 'bubble')
    this.badge = scene.add
      .image(0, 0, texKey.popup(2))
      .setOrigin(0.5)
      .setDepth(this.bubble.image.depth + 1)
    this.relayout()
  }

  setValue(v: number): void {
    this.value = v
    this.badge.setTexture(texKey.popup(v))
    this.relayout()
  }

  show(): void {
    this.bubble.image.setVisible(true)
    this.badge.setVisible(true)
  }
  hide(): void {
    this.bubble.image.setVisible(false)
    this.badge.setVisible(false)
  }

  pop(): void {
    const img = this.badge
    const s = img.scaleX
    this.scene.tweens.add({
      targets: img,
      scaleX: s * 1.3,
      scaleY: s * 1.3,
      duration: 160,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => img.setScale(s),
    })
  }

  /** Screen position of the badge (delivery target). */
  get badgeScreen(): { x: number; y: number } {
    return { x: this.badge.x, y: this.badge.y }
  }

  relayout(): void {
    this.bubble.relayout()
    const e = this.bubble.entry
    // badge sits in the upper part of the cloud (the tail points down).
    const by = e.y - ART.bubble[1] * e.scale * 0.08
    this.badge
      .setPosition(sx(e.x), sy(by))
      .setDisplaySize(sd(ART.popup[0] * e.scale * 1.15), sd(ART.popup[1] * e.scale * 1.15))
    void this.value
  }
}
