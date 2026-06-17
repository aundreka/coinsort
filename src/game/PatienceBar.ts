import Phaser from 'phaser'
import { Placeable } from './Placeable'
import { ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'

// PATIENCE bar: a frame placeable (key 'patience', editable/draggable) with a
// container + draining fill + label positioned relative to it. The fill drains
// left-to-right over the customer's patience window; on empty it fires onEmpty.
export class PatienceBar {
  private frame: Placeable
  private container: Phaser.GameObjects.Image
  private fill: Phaser.GameObjects.Image
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
    this.fill = scene.add.image(0, 0, 'patienceFill').setOrigin(0, 0.5).setDepth(d + 2)
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
    const fullW = ART.patienceFill[0] * e.scale
    const left = e.x - fullW / 2
    this.fill.setPosition(sx(left), sy(e.y))
    this.fill.setDisplaySize(sd(fullW * this.frac), sd(ART.patienceFill[1] * e.scale))
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
