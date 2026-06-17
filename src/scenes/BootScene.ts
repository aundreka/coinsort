import Phaser from 'phaser'
import { IMAGES, AUDIO, COIN, POPUP, CUSTOMERS, texKey } from '../assets'
import { COIN_MAX } from '../constants'

// Loads every texture/sound from the inlined base64 data URIs, then starts the
// game. Assets are embedded (no network), so a single load phase is fast; a
// lightweight progress label covers the brief decode.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload(): void {
    const label = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'Loading…', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '44px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
    this.load.on('progress', (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`))

    for (const [key, url] of Object.entries(IMAGES)) this.load.image(key, url)

    for (let v = 1; v <= COIN_MAX; v++) {
      this.load.image(texKey.coin(v), COIN[v])
      this.load.image(texKey.popup(v), POPUP[v])
    }
    for (let i = 0; i < CUSTOMERS.length; i++) {
      this.load.image(texKey.customer(i), CUSTOMERS[i].normal)
      this.load.image(texKey.customerAngry(i), CUSTOMERS[i].angry)
    }

    for (const [key, url] of Object.entries(AUDIO)) this.load.audio(key, url)
  }

  create(): void {
    this.scene.start('Game')
  }
}
