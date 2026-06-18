import Phaser from 'phaser'
import { Coin } from './Coin'

// Fixed pool of Coin objects — preallocated once so merging/dealing never
// allocates (no GC hitches during play, per AGENTS rule).
export class CoinPool {
  private free: Coin[] = []
  readonly all: Coin[] = []

  // Sized to the whole tray (10 columns x 10 capacity) so DEAL is only ever
  // blocked by a genuinely full tray, never by an empty pool.
  constructor(scene: Phaser.Scene, size = 100) {
    for (let i = 0; i < size; i++) {
      const c = new Coin(scene)
      this.all.push(c)
      this.free.push(c)
    }
  }

  obtain(value: number): Coin | null {
    const c = this.free.pop()
    if (!c) return null
    c.setValue(value)
    return c
  }

  release(c: Coin): void {
    c.hide()
    c.slot = -1
    if (!this.free.includes(c)) this.free.push(c)
  }
}
