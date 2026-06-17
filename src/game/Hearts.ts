import Phaser from 'phaser'
import { Placeable } from './Placeable'

// The 3 hearts (each independently laid out as heart0/1/2). lose() removes the
// rightmost remaining heart with a little juice; isDead() when none remain.
export class Hearts {
  private hearts: { p: Placeable; alive: boolean }[] = []

  constructor(
    private scene: Phaser.Scene,
    count = 3,
  ) {
    for (let i = 0; i < count; i++) {
      this.hearts.push({ p: new Placeable(scene, `heart${i}`, 'heart'), alive: true })
    }
  }

  get remaining(): number {
    return this.hearts.filter((h) => h.alive).length
  }

  isDead(): boolean {
    return this.remaining <= 0
  }

  lose(): void {
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i]
      if (h.alive) {
        h.alive = false
        const img = h.p.image
        this.scene.tweens.add({
          targets: img,
          scaleX: img.scaleX * 1.4,
          scaleY: img.scaleY * 1.4,
          alpha: 0,
          duration: 280,
          ease: 'Back.easeIn',
          onComplete: () => img.setVisible(false),
        })
        return
      }
    }
  }

  relayout(): void {
    for (const h of this.hearts) {
      h.p.relayout()
      h.p.image.setVisible(h.alive)
      if (h.alive) h.p.image.setAlpha(1)
    }
  }
}
