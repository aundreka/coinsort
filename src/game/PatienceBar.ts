import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { ART } from '../constants'
import { sx, sy, sd, scale } from '../utils/responsive'

// Source-art slice for the rounded end-caps of the fill bar (design px). Keeping
// these fixed while only the middle stretches is what stops the bar from losing
// its roundness as it drains.
const FILL_CAP = 22

// PATIENCE bar: a frame placeable (key 'patience', editable/draggable) with a
// container + draining fill + label positioned relative to it. The fill is a
// NINE-SLICE so its rounded caps stay rounded as it shrinks left-to-right over
// the customer's patience window; on empty it fires onEmpty.
export class PatienceBar {
  private frame: Placeable
  private container: Phaser.GameObjects.Image
  private fill: Phaser.GameObjects.NineSlice
  private label: Phaser.GameObjects.Image
  private frac = 1
  private tween?: Phaser.Tweens.Tween

  constructor(
    private scene: Phaser.Scene,
    private onEmpty: () => void,
  ) {
    this.frame = new Placeable(scene, 'patience', 'patienceFrame')
    const d = this.frame.image.depth
    this.container = scene.add.image(0, 0, 'patienceContainer').setOrigin(0.5).setDepth(d + 1)
    // 3-slice horizontally (caps fixed, middle stretches). Sized/scaled in
    // layoutFill; only the middle stretches as the bar drains, so the caps stay
    // round instead of squashing.
    this.fill = scene.add
      .nineslice(0, 0, 'patienceFill', undefined, ART.patienceFill[0], ART.patienceFill[1], FILL_CAP, FILL_CAP, 0, 0)
      .setOrigin(0, 0.5)
      .setDepth(d + 2)
    this.label = scene.add.image(0, 0, 'patienceLabel').setOrigin(0.5).setDepth(d + 3)
    this.relayout()
  }

  setVisible(v: boolean): void {
    this.frame.image.setVisible(v)
    this.container.setVisible(v)
    this.fill.setVisible(v)
    this.label.setVisible(v)
  }
  show(): void {
    this.setVisible(true)
  }
  hide(): void {
    this.setVisible(false)
  }

  start(durationMs: number): void {
    this.stop()
    this.show()
    this.frac = 1
    this.relayout()
    this.tween = this.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: durationMs,
      onUpdate: (tw) => {
        this.frac = tw.getValue() as number
        this.layoutFill()
      },
      onComplete: () => this.onEmpty(),
    })
  }

  stop(): void {
    this.tween?.remove()
    this.tween = undefined
  }

  pause(): void {
    this.tween?.pause()
  }
  resume(): void {
    this.tween?.resume()
  }

  private layoutFill(): void {
    const e = this.frame.entry
    const fullW = ART.patienceFill[0] * e.scale // design-px width at 100%
    const left = e.x - fullW / 2
    // Resize in DESIGN space (only the middle slice stretches) and scale the whole
    // nine-slice by the canvas factor, so the rounded caps scale uniformly with
    // the rest of the UI and never squash. Below ~2 caps wide they simply shrink.
    this.fill.setSize(Math.max(1, fullW * this.frac), ART.patienceFill[1] * e.scale)
    this.fill.setScale(scale())
    this.fill.setPosition(sx(left), sy(e.y))
    // turn the fill red as it runs low
    this.fill.setTint(this.frac < 0.3 ? 0xff5a5a : 0xffffff)
  }

  relayout(): void {
    this.frame.relayout()
    const e = this.frame.entry
    this.container
      .setPosition(sx(e.x), sy(e.y))
      .setDisplaySize(sd(ART.patienceContainer[0] * e.scale), sd(ART.patienceContainer[1] * e.scale))
    // "PATIENCE" label sits UNDER the bar.
    this.label
      .setPosition(
        sx(e.x),
        sy(e.y + (ART.patienceFrame[1] / 2 + ART.patienceLabel[1] / 2 + 6) * e.scale),
      )
      .setDisplaySize(sd(ART.patienceLabel[0] * e.scale), sd(ART.patienceLabel[1] * e.scale))
    this.layoutFill()
  }
}
