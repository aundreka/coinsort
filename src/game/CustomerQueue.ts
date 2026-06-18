import Phaser from 'phaser'
import { Customer } from './Customer'
import { SpeechBubble } from './SpeechBubble'
import { DEPTH, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { texKey } from '../assets'

// The scripted line of customers. The front customer (interactive) wants a coin;
// the next ones are shown queued behind it (smaller, receding) so it reads as a
// line. Each wants a higher coin than the last.
const REQUESTS = [2, 3, 4]
const REF_H = ART.person1[1]

export class CustomerQueue {
  readonly customer: Customer
  readonly bubble: SpeechBubble
  private line: Phaser.GameObjects.Image[] = []
  private seq = 0
  private served = 0

  constructor(private scene: Phaser.Scene) {
    this.customer = new Customer(scene)
    this.bubble = new SpeechBubble(scene)
    // Up to 2 queued customers behind the front one.
    for (let k = 0; k < 2; k++) {
      this.line.push(scene.add.image(0, 0, texKey.customer(0)).setOrigin(0.5, 0.5).setVisible(false))
    }
  }

  get requestValue(): number {
    return REQUESTS[Math.min(this.seq, REQUESTS.length - 1)]
  }
  get servedCount(): number {
    return this.served
  }
  get total(): number {
    return REQUESTS.length
  }
  get currentIndex(): number {
    return this.seq % 3
  }
  get isFemale(): boolean {
    return this.currentIndex !== 0
  }

  /** Design-space point a delivered coin should fly to (the current customer). */
  get customerDesign(): { x: number; y: number } {
    const e = this.customer.entry
    return { x: e.x, y: e.y }
  }

  begin(): void {
    this.seq = 0
    this.served = 0
    this.customer.setCustomer(0)
    this.bubble.setValue(this.requestValue)
    this.bubble.show()
    this.customer.enter()
    this.bubble.pop()
    this.layoutLine()
  }

  markServed(): void {
    this.served++
  }

  next(): boolean {
    this.seq++
    if (this.seq >= REQUESTS.length) {
      this.layoutLine()
      return false
    }
    this.customer.setCustomer(this.seq % 3)
    this.bubble.setValue(this.requestValue)
    this.bubble.show()
    this.customer.enter()
    this.bubble.pop()
    this.layoutLine()
    return true
  }

  showAngry(a: boolean): void {
    this.customer.setAngry(a)
  }

  leaveCurrent(onDone: () => void): void {
    this.bubble.hide()
    this.customer.leave(onDone)
  }

  // ---- the queue behind the front customer --------------------------------
  private layoutLine(): void {
    const fe = this.customer.entry
    for (let k = 0; k < this.line.length; k++) {
      const s = this.seq + 1 + k
      const img = this.line[k]
      if (s >= REQUESTS.length) {
        img.setVisible(false)
        continue
      }
      const tex = texKey.customer(s % 3)
      img.setTexture(tex)
      const src = this.scene.textures.get(tex).getSourceImage() as { width: number; height: number }
      const scale = fe.scale * Math.pow(0.78, k + 1)
      const h = REF_H * scale
      const w = h * ((src.width || REF_H) / (src.height || REF_H))
      img
        .setVisible(true)
        .setAlpha(0.94)
        .setPosition(sx(fe.x + 130 * (k + 1)), sy(fe.y - 50 * (k + 1)))
        .setDisplaySize(sd(w), sd(h))
        .setDepth(fe.zIndex * DEPTH.LAYER - 200 * (k + 1))
    }
  }

  relayout(): void {
    this.customer.relayout()
    this.bubble.relayout()
    this.layoutLine()
  }
}
