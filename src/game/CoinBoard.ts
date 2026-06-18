import Phaser from 'phaser'
import type { CoinTray } from './CoinTray'
import type { CoinPool } from './CoinPool'
import type { Coin } from './Coin'
import type { Vfx } from './Vfx'
import type { SoundManager } from './SoundManager'
import { DEPTH, COIN_MAX, ART, TRAY } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { isEditEnabled } from '../edit/registry'

// Column-stack coin model. Each tray cell is a column holding a stack of coins
// (bottom->top, where bottom = the FRONT/near coin). Tap a column to LIFT its
// FRONT run of equal coins; tap another column to MOVE them onto the BACK (top)
// of that pile. MERGE turns any FULL single-value column into one higher coin.
const MAX_H = 10 // coins per column (capacity)
const STEP_FRAC = 0.21 // vertical pile step, fraction of coin height (fills the column without over-spreading)
const LIFT_FRAC = 0.9 // lift height, fraction of coin width
const INWARD_FRAC = 0.008 // horizontal lean per stack level, toward the tray center (subtle 3D)
const ROW_BAND = 20 // depth gap so the FRONT tray row always draws over the back row

export class CoinBoard {
  private cols: Coin[][]
  private zones: Phaser.GameObjects.Rectangle[] = []
  private selected = -1
  private liftN = 0
  private busy = false
  private locked = false

  constructor(
    private scene: Phaser.Scene,
    private tray: CoinTray,
    private pool: CoinPool,
    private vfx: Vfx,
    private sound: SoundManager,
    private onChange: () => void,
    private onInteract: () => void = () => {},
    // Design-space point the merged change-coin flies to when it's delivered.
    private deliverTarget: () => { x: number; y: number } = () => ({ x: 540, y: 700 }),
  ) {
    this.cols = Array.from({ length: tray.slotCount }, () => [] as Coin[])
    if (!isEditEnabled()) this.createZones()
  }

  isBusy(): boolean {
    return this.busy
  }

  isEmpty(): boolean {
    return this.cols.every((c) => c.length === 0)
  }

  /** Every column is at capacity — no room to deal (the only DEAL fail state). */
  isFull(): boolean {
    return this.cols.every((c) => c.length >= MAX_H)
  }

  /** Lock all interaction (during delivery / end). Lowers any lifted run. */
  setLocked(b: boolean): void {
    this.locked = b
    if (b && this.selected >= 0) this.deselect()
  }

  // ---- geometry -----------------------------------------------------------
  private step(): number {
    return this.tray.coinWidth() * (ART.coin[1] / ART.coin[0]) * STEP_FRAC
  }

  private coinY(col: number, k: number, lifted: boolean): number {
    return this.tray.slotCenter(col).y - k * this.step() - (lifted ? this.tray.coinWidth() * LIFT_FRAC : 0)
  }

  // Each coin higher in the stack leans slightly toward the tray center, so the
  // pile reads as receding inward (3D) instead of a flat vertical column.
  private coinX(col: number, k: number): number {
    const slot = this.tray.slotCenter(col)
    return slot.x + (this.tray.placeable.entry.x - slot.x) * INWARD_FRAC * k
  }

  // Depth so coins layer naturally. Two independent axes:
  //  - The FRONT tray row (cols 5..9) always draws over the back row (cols 0..4)
  //    via ROW_BAND — this is what was missing before and made transferred coins
  //    look like they "teleported to the back" on landing.
  //  - Within a column the stack RECEDES up-and-back: the TOP coin sits BEHIND
  //    the ones below it (depth DECREASES with k), so the pile reads as a 3D
  //    tower. (lifted band stays above all resting coins.)
  private coinDepth(col: number, k: number, lifted: boolean): number {
    const row = Math.floor(col / TRAY.cols)
    return (lifted ? DEPTH.COIN_POP : DEPTH.COIN) + row * ROW_BAND + (MAX_H - k)
  }

  private placeColumn(col: number, animate: boolean): void {
    const stack = this.cols[col]
    const w = this.tray.coinWidth()
    // The lifted group is the FRONT run (the bottom k=0..liftN-1 coins) — the
    // near, fully-visible coins, so lifting reads as pulling off the front.
    const liftCount = col === this.selected ? this.liftN : 0
    for (let k = 0; k < stack.length; k++) {
      const coin = stack[k]
      const lifted = k < liftCount
      coin.image.setDepth(this.coinDepth(col, k, lifted))
      const x = this.coinX(col, k)
      const y = this.coinY(col, k, lifted)
      if (animate) {
        coin.moveTo(this.scene, x, y, 150, 'Quad.easeOut')
        coin.setWidth(w)
      } else {
        coin.place(x, y, w)
      }
    }
  }

  // ---- seeding / dealing --------------------------------------------------
  addCoin(col: number, value: number, drop = false): Coin | null {
    if (this.cols[col].length >= MAX_H) return null
    const coin = this.pool.obtain(value)
    if (!coin) return null
    coin.slot = col
    this.cols[col].push(coin)
    const w = this.tray.coinWidth()
    const k = this.cols[col].length - 1
    const x = this.coinX(col, k)
    const y = this.coinY(col, k, false)
    coin.image.setDepth(this.coinDepth(col, k, false))
    if (drop) {
      coin.place(x, y - this.tray.coinWidth() * 0.6, w)
      coin.moveTo(this.scene, x, y, 240, 'Bounce.easeOut')
    } else {
      coin.place(x, y, w)
    }
    return coin
  }

  /** Edit-mode only: one coin in every slot to visualize per-column/row placement. */
  fillForEdit(): void {
    for (let i = 0; i < this.tray.slotCount; i++) this.addCoin(i, (i % COIN_MAX) + 1)
  }

  /** Pick a coin value to supply. The deal NEVER gives a value >= the customer's
   *  request (you must MERGE up to the requested value), and never a 4. Lower
   *  values are rarer to find the higher you go — 1s most common, then 2s, then
   *  3s (weight halves each step). So the first customer (wants 2) only ever
   *  gets 1s. */
  private dealValue(reqValue: number): number {
    const maxV = Math.min(reqValue - 1, COIN_MAX - 1, 3) // < request, never a 4
    if (maxV <= 1) return 1
    let total = 0
    const weights: number[] = []
    for (let v = 1; v <= maxV; v++) {
      const w = 1 / Math.pow(2, v - 1) // 1, 0.5, 0.25...
      weights.push(w)
      total += w
    }
    let r = Math.random() * total
    for (let v = 1; v <= maxV; v++) {
      r -= weights[v - 1]
      if (r <= 0) return v
    }
    return 1
  }

  /** Start state: a spread of (sub-request) coins to sort, with one column given
   *  a head start so the first merge is quickly reachable in the demo. */
  seedSpread(reqValue: number): void {
    const head = Math.floor(Math.random() * this.cols.length)
    for (let j = 0; j < 6; j++) this.addCoin(head, this.dealValue(reqValue), false)
    for (let i = 0; i < this.cols.length; i++) {
      if (i === head) continue
      const count = 1 + Math.floor(Math.random() * 2)
      for (let j = 0; j < count; j++) this.addCoin(i, this.dealValue(reqValue), false)
    }
  }

  /** DEAL: drop a few coins (always below the request value, see dealValue) into
   *  random columns. Coins do NOT merge on placement — the player sorts them,
   *  then MERGE turns a full same-value column into one higher coin. */
  dealCoins(reqValue: number): number {
    let added = 0
    for (let t = 0; t < 4; t++) {
      const avail: number[] = []
      // Never deal into the lifted column (the new coin would hide behind it).
      for (let i = 0; i < this.cols.length; i++) {
        if (i !== this.selected && this.cols[i].length < MAX_H) avail.push(i)
      }
      if (avail.length === 0) break
      const col = avail[Math.floor(Math.random() * avail.length)]
      if (this.addCoin(col, this.dealValue(reqValue), true)) added++
    }
    if (added) this.onChange()
    return added
  }

  // ---- selection / movement ----------------------------------------------
  handleClick(i: number): void {
    if (this.busy || this.locked) return
    if (this.selected === -1) {
      if (this.cols[i].length === 0) return // tapping an empty column does nothing
      this.select(i)
      this.onInteract() // picking up a coin = a coin interaction
    } else if (this.selected === i) {
      this.deselect() // putting it back down — not counted
    } else {
      // Count only a real move (a coin actually changed columns); a blocked
      // move onto a full column just puts the stack back down.
      if (this.moveSelectedTo(i)) this.onInteract()
    }
  }

  private select(i: number): void {
    const stack = this.cols[i]
    if (stack.length === 0) return
    // Lift the FRONT RUN of same-value coins (from the bottom up). These are the
    // near, visible coins, so the group lifts cleanly off the front instead of
    // phasing up from behind — and it lets you pull a value out from under
    // others, which keeps tricky boards solvable.
    const frontV = stack[0].value
    let n = 0
    for (let k = 0; k < stack.length && stack[k].value === frontV; k++) n++
    this.selected = i
    this.liftN = n
    this.placeColumn(i, true)
    this.sound.playPickup()
  }

  private deselect(): void {
    const i = this.selected
    this.selected = -1
    this.liftN = 0
    if (i >= 0) this.placeColumn(i, true)
  }

  /** Returns true if coins actually moved (false if the destination was full). */
  private moveSelectedTo(dest: number): boolean {
    const src = this.selected
    const n = this.liftN
    // Move as many as the destination can take (capacity MAX_H); any extra stay.
    // No value restriction — a lower coin can sit on a higher one.
    const cap = MAX_H - this.cols[dest].length
    const moveN = Math.min(n, cap)
    if (moveN <= 0) {
      this.deselect() // destination full
      return false
    }
    this.busy = true
    // Take the FRONT coins (the lifted run) off the bottom; the coins behind them
    // settle forward to fill. They get appended to the BACK (top) of the dest.
    const moving = this.cols[src].splice(0, moveN)
    this.selected = -1
    this.liftN = 0
    this.placeColumn(src, true) // settle the coins that were behind / didn't fit

    // Transfer one coin at a time (staggered): each is THROWN along an arc with a
    // heavy ease and a sparkle on landing. The coin flies at its FINAL stack
    // depth the whole way (the new top coin = behind), so it tucks correctly
    // behind the coins below it instead of flashing in front during the throw.
    const baseLen = this.cols[dest].length
    const N = moving.length
    const STAGGER = 60
    const DUR = 260
    const ARC = 120 // design-px peak of the throw arc
    let pending = N
    for (let j = 0; j < N; j++) {
      const coin = moving[j]
      coin.slot = dest
      this.cols[dest].push(coin)
      const k = baseLen + j
      coin.image.setDepth(this.coinDepth(dest, k, false)) // settle into the pile in z from the start
      coin.setWidth(this.tray.coinWidth())
      const x = this.coinX(dest, k)
      const y = this.coinY(dest, k, false)
      coin.arcTo(
        this.scene,
        x,
        y,
        DUR,
        ARC,
        'Cubic.easeInOut',
        () => {
          this.vfx.sparkle(sx(x), sy(y), 5)
          this.sound.playCoin()
          if (--pending === 0) {
            // No merge on move — coins just stack (sort). MERGE collapses a full
            // uniform column.
            this.placeColumn(dest, false)
            this.busy = false
            this.onChange()
          }
        },
        j * STAGGER,
        360, // rotate sideways as it flies
      )
    }
    return true
  }

  private isFullUniform(col: number): boolean {
    const st = this.cols[col]
    return st.length === MAX_H && st.every((c) => c.value === st[0].value)
  }

  /** Whether any column is completely full of one value (ready to MERGE). */
  hasFullUniform(): boolean {
    if (this.busy || this.locked) return false
    for (let i = 0; i < this.cols.length; i++) if (this.isFullUniform(i)) return true
    return false
  }

  /** Whether the player already holds enough coins of a single value (across all
   *  columns) to consolidate into one full column — i.e. they can build a
   *  mergeable column by sorting and don't need to DEAL more. */
  canFormFullColumn(): boolean {
    if (this.busy || this.locked) return false
    const counts = new Map<number, number>()
    for (const col of this.cols) {
      for (const coin of col) {
        const c = (counts.get(coin.value) ?? 0) + 1
        if (c >= MAX_H) return true
        counts.set(coin.value, c)
      }
    }
    return false
  }

  /** MERGE: turn every FULL, single-value column (N coins of value V) into ONE
   *  coin of value V+1. If that higher coin equals the customer's request it is
   *  DELIVERED (arcs up to them) and onMatch fires; otherwise it STAYS as the
   *  column's single new coin. Returns false if no column is full+uniform yet
   *  (an invalid MERGE press). */
  collapseFull(matchValue: number, onMatch: () => void): boolean {
    if (this.busy || this.locked) return false
    const targets: number[] = []
    for (let i = 0; i < this.cols.length; i++) if (this.isFullUniform(i)) targets.push(i)
    if (targets.length === 0) return false
    if (this.selected >= 0) this.deselect()
    this.busy = true
    let matched = false
    let pending = targets.length
    for (const col of targets) {
      const newValue = Math.min(this.cols[col][0].value + 1, COIN_MAX)
      const deliver = newValue === matchValue
      if (deliver) matched = true
      this.mergeColumn(col, newValue, deliver, () => {
        if (--pending === 0) {
          this.busy = false
          if (matched) onMatch()
          this.onChange()
        }
      })
    }
    return true
  }

  /** Merge a full column: its coins converge into the slot (shrink + fade) and a
   *  single higher coin pops into being with a glow. */
  private mergeColumn(col: number, newValue: number, deliver: boolean, onDone: () => void): void {
    const coins = this.cols[col].slice()
    this.cols[col] = []
    const slot = this.tray.slotCenter(col)
    const cx = slot.x
    const cy = slot.y
    this.sound.playMerge()
    let pending = coins.length
    for (let k = 0; k < coins.length; k++) {
      const coin = coins[k]
      coin.image.setDepth(this.coinDepth(col, k, true))
      const s = coin.image.scaleX
      this.scene.tweens.add({
        targets: coin.image,
        x: sx(cx),
        y: sy(cy),
        scaleX: s * 0.25,
        scaleY: s * 0.25,
        alpha: 0,
        duration: 280,
        delay: k * 22,
        ease: 'Back.easeIn',
        onComplete: () => {
          this.pool.release(coin)
          if (--pending === 0) this.spawnMerged(col, newValue, cx, cy, deliver, onDone)
        },
      })
    }
  }

  /** The higher coin that a merge produces: appears in the slot with a glow, then
   *  either flies to the customer (deliver) or settles as the column's new coin. */
  private spawnMerged(
    col: number,
    newValue: number,
    cx: number,
    cy: number,
    deliver: boolean,
    onDone: () => void,
  ): void {
    const coin = this.pool.obtain(newValue)
    if (!coin) {
      onDone()
      return
    }
    coin.image.setDepth(this.coinDepth(col, 0, true))
    coin.place(cx, cy, this.tray.coinWidth())
    // Glow upon merging.
    this.vfx.glowBurst(sx(cx), sy(cy), 240, 0xfff0a0)
    this.vfx.cloudPuff(sx(cx), sy(cy), 150)
    this.vfx.pop(coin.image, 1.35, 240)
    if (deliver) {
      // The merged coin is the customer's change — arc it up to them, then serve.
      this.scene.time.delayedCall(220, () => this.deliverCoin(coin, onDone))
    } else {
      coin.image.setDepth(this.coinDepth(col, 0, false))
      this.cols[col].push(coin)
      onDone()
    }
  }

  /** Throw the merged coin in an arc up to the customer, then release it. */
  private deliverCoin(coin: Coin, onDone: () => void): void {
    const t = this.deliverTarget()
    coin.image.setDepth(DEPTH.DELIVER)
    coin.arcTo(
      this.scene,
      t.x,
      t.y - 80,
      560,
      300,
      'Cubic.easeOut',
      () => {
        this.vfx.glowBurst(sx(t.x), sy(t.y - 80), 260, 0xfff0a0)
        this.pool.release(coin)
        onDone()
      },
      0,
      360,
    )
  }

  /** A cross-column merge to demo: screen coords of a source stack and the
   *  destination it should slide onto (lowest value, deterministic). Null if no
   *  cross-column merge exists (the idle hint then points at MERGE/DEAL). */
  mergeHint(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    if (this.busy || this.locked) return null
    // Key off the FRONT (bottom) value — that's the run a tap actually lifts.
    const byFront = new Map<number, number[]>()
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      if (st.length === 0) continue
      const fv = st[0].value
      if (fv >= COIN_MAX) continue
      const list = byFront.get(fv) ?? []
      list.push(i)
      byFront.set(fv, list)
    }
    let bestV = Infinity
    let pair: number[] | null = null
    for (const [v, idxs] of byFront) {
      if (idxs.length >= 2 && v < bestV) {
        bestV = v
        pair = idxs
      }
    }
    if (!pair) return null
    const a = this.tray.slotCenter(pair[0])
    const b = this.tray.slotCenter(pair[1])
    return { from: { x: sx(a.x), y: sy(a.y) }, to: { x: sx(b.x), y: sy(b.y) } }
  }

  // ---- input zones + relayout --------------------------------------------
  private createZones(): void {
    for (let i = 0; i < this.tray.slotCount; i++) {
      const z = this.scene.add
        .rectangle(0, 0, 10, 10, 0xffffff, 0.001)
        .setDepth(DEPTH.COIN - 1)
        .setInteractive({ useHandCursor: true })
      z.on('pointerdown', () => this.handleClick(i))
      this.zones.push(z)
    }
    this.layoutZones()
  }

  private layoutZones(): void {
    const w = this.tray.coinWidth()
    for (let i = 0; i < this.zones.length; i++) {
      const c = this.tray.slotCenter(i)
      this.zones[i]
        .setPosition(sx(c.x), sy(c.y - w * 0.4))
        .setSize(sd(w * 1.25), sd(w * 1.7))
    }
  }

  relayout(): void {
    this.layoutZones()
    for (let i = 0; i < this.cols.length; i++) this.placeColumn(i, false)
  }
}
