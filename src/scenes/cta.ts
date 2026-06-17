import Phaser from 'phaser'
import { DEPTH } from '../constants'
import { viewW, viewH } from '../utils/responsive'
import { triggerCTA, notifyGameClose } from '../networks'
import { trackEvent } from '../analytics'
import { Placeable } from '../game/Placeable'

// End card + store-redirect sequence. Owns the end-card presentation and is the
// (only) place besides networks.ts that issues the CTA. redirectToStore() fires
// notifyGameClose() before triggerCTA() per AGENTS.md. Elements are Placeables
// (sunrays / ecLogo / ecCta) so they're laid out from layout.json and editable
// in #edit; depthBase keeps them in the end-card band regardless of zIndex.
export class EndCard {
  private dim?: Phaser.GameObjects.Rectangle
  private sunrays?: Placeable
  private logo?: Placeable
  private cta?: Placeable
  private input?: Phaser.GameObjects.Rectangle
  private shown = false

  constructor(private scene: Phaser.Scene) {}

  get isShown(): boolean {
    return this.shown
  }

  redirectToStore(): void {
    trackEvent('CTA_CLICKED')
    notifyGameClose()
    triggerCTA()
  }

  /** `interactive=false` (edit preview) skips the tap-to-redirect catcher. */
  show(interactive = true): void {
    if (this.shown) return
    this.shown = true
    trackEvent('ENDCARD_SHOWN')

    this.dim = this.scene.add
      .rectangle(viewW() / 2, viewH() / 2, viewW(), viewH(), 0x10182e, 0.92)
      .setDepth(DEPTH.ENDCARD)
    this.sunrays = new Placeable(this.scene, 'sunrays', 'sunrays', { depthBase: DEPTH.ENDCARD + 1 })
    this.sunrays.image.setAlpha(0.85)
    this.logo = new Placeable(this.scene, 'ecLogo', 'ecLogo', { depthBase: DEPTH.ENDCARD + 3 })
    this.cta = new Placeable(this.scene, 'ecCta', 'ecCta', { depthBase: DEPTH.ENDCARD + 3 })

    if (interactive) {
      // Full-screen catcher so a tap ANYWHERE redirects (PDF requirement).
      this.input = this.scene.add
        .rectangle(viewW() / 2, viewH() / 2, viewW(), viewH(), 0x000000, 0.001)
        .setDepth(DEPTH.ENDCARD_INPUT)
        .setInteractive({ useHandCursor: true })
      this.input.on('pointerdown', () => this.redirectToStore())
    }

    // juice
    this.scene.tweens.add({ targets: this.sunrays.image, angle: 360, duration: 24000, repeat: -1, ease: 'Linear' })
    for (const p of [this.logo, this.cta]) {
      p.image.setScale(p.image.scaleX * 0.7).setAlpha(0)
    }
    this.scene.tweens.add({ targets: [this.logo.image, this.cta.image], alpha: 1, duration: 280 })
    this.scene.tweens.add({
      targets: this.logo.image,
      scaleX: this.logo.image.scaleX / 0.7,
      scaleY: this.logo.image.scaleY / 0.7,
      duration: 460,
      ease: 'Back.easeOut',
    })
    const ctaImg = this.cta.image
    const ctaBase = ctaImg.scaleX / 0.7
    this.scene.tweens.add({
      targets: ctaImg,
      scaleX: ctaBase,
      scaleY: ctaBase,
      duration: 460,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: ctaImg,
          scaleX: ctaBase * 1.06,
          scaleY: ctaBase * 1.06,
          duration: 620,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      },
    })
  }

  relayout(): void {
    if (!this.shown) return
    this.dim?.setPosition(viewW() / 2, viewH() / 2).setSize(viewW(), viewH())
    this.input?.setPosition(viewW() / 2, viewH() / 2).setSize(viewW(), viewH())
    this.sunrays?.relayout()
    this.logo?.relayout()
    this.cta?.relayout()
  }
}
