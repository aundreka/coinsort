import Phaser from 'phaser'
import { DEPTH } from '../constants'
import type { CoinBoard } from './CoinBoard'
import type { Coin } from './Coin'
import type { Vfx } from './Vfx'

// Delivers a coin to the customer: it flies up from the tray to the request
// badge, shrinking, then sparkles and is recycled.
export class DeliverFlow {
  constructor(
    private scene: Phaser.Scene,
    private board: CoinBoard,
    private vfx: Vfx,
  ) {}

  deliver(coin: Coin, target: { x: number; y: number }, onDone: () => void): void {
    const img = coin.image
    img.setDepth(DEPTH.DELIVER)
    this.scene.tweens.add({
      targets: img,
      x: target.x,
      y: target.y,
      scaleX: img.scaleX * 0.55,
      scaleY: img.scaleY * 0.55,
      duration: 460,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.vfx.glowBurst(target.x, target.y, 170, 0xfff2a8)
        this.vfx.sparkle(target.x, target.y, 8)
        this.board.release(coin)
        onDone()
      },
    })
  }
}
