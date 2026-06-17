import Phaser from 'phaser'
import type { CoinTray } from './CoinTray'
import type { CoinPool } from './CoinPool'
import type { Coin } from './Coin'
import type { Vfx } from './Vfx'
import type { SoundManager } from './SoundManager'
import { DEPTH, COIN_MAX, ART } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { isEditEnabled } from '../edit/registry'

// Column-stack coin model. Each tray cell is a column holding a stack of coins
// (bottom->top). Tap a column to LIFT its top run of equal coins; tap another
// column to MOVE them there (as many as fit) — equal tops then merge (two of N
// -> one N+1, cascading). The MERGE button performs one random valid merge.
const MAX_H = 5 // coins per column (capacity)
const STEP_FRAC = 0.34 // vertical pile step, fraction of coin height
const LIFT_FRAC = 0.9 // lift height, fraction of coin width
const INWARD_FRAC = 0.02 // horizontal lean per stack level, toward the tray center
const DEAL_MAX = 2 // DEAL only ever gives 1s and 2s

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

  // Depth so the stack layers correctly regardless of spawn order. The stack
  // recedes UP-and-back, so a coin higher in the stack (the latest) sits BEHIND
  // the ones below it: depth DECREASES with k. (lifted band stays on top.)
  private coinDepth(k: number, lifted: boolean): number {
    return (lifted ? DEPTH.COIN_POP : DEPTH.COIN) + (MAX_H - k)
  }

  private placeColumn(col: number, animate: boolean): void {
    const stack = this.cols[col]
    const w = this.tray.coinWidth()
    const liftStart = col === this.selected ? stack.length - this.liftN : stack.length
    for (let k = 0; k < stack.length; k++) {
      const coin = stack[k]
      const lifted = k >= liftStart
      coin.image.setDepth(this.coinDepth(k, lifted))
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
    coin.image.setDepth(this.coinDepth(k, false))
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

  /** Start state: exactly two 1-coins, in two spread columns. */
  seedTwoOnes(): void {
    const a = Math.floor(this.tray.slotCount * 0.3)
    const b = Math.floor(this.tray.slotCount * 0.7)
    this.addCoin(a, 1)
    this.addCoin(b === a ? b + 1 : b, 1)
  }

  /** DEAL: add a few base coins — values below the request, and never above 2
   *  (so the 3rd round, which needs a 4, only ever gets 1s and 2s). */
  dealLessThan(req: number): number {
    const maxV = Math.max(1, Math.min(req - 1, DEAL_MAX))
    let added = 0
    for (let t = 0; t < 3; t++) {
      const avail: number[] = []
      for (let i = 0; i < this.cols.length; i++) if (this.cols[i].length < MAX_H) avail.push(i)
      if (avail.length === 0) break
      // DEAL only SUPPLIES coins (values below the request). It must never create
      // an adjacent same-value pair — so place each coin with a value different
      // from that column's top (or into an empty column). Skip if impossible.
      // This keeps DEAL from merging (which could chain to the target and win);
      // the player creates adjacency — and merges — by MOVING coins.
      const col = avail[Math.floor(Math.random() * avail.length)]
      const stack = this.cols[col]
      const top = stack.length ? stack[stack.length - 1].value : 0
      const vals: number[] = []
      for (let v = 1; v <= maxV; v++) if (v !== top) vals.push(v)
      if (vals.length === 0) continue // can't place without matching the top
      const val = vals[Math.floor(Math.random() * vals.length)]
      if (this.addCoin(col, val, true)) added++
    }
    if (added) this.onChange()
    return added
  }

  // ---- selection / movement ----------------------------------------------
  handleClick(i: number): void {
    if (this.busy || this.locked) return
    if (this.selected === -1) this.select(i)
    else if (this.selected === i) this.deselect()
    else this.moveSelectedTo(i)
  }

  private select(i: number): void {
    const stack = this.cols[i]
    if (stack.length === 0) return
    this.selected = i
    this.liftN = stack.length // the WHOLE column is picked up
    this.placeColumn(i, true)
    this.sound.playPickup()
  }

  private deselect(): void {
    const i = this.selected
    this.selected = -1
    this.liftN = 0
    if (i >= 0) this.placeColumn(i, true)
  }

  private moveSelectedTo(dest: number): void {
    const src = this.selected
    const n = this.liftN
    // Move as many as the destination can take (capacity MAX_H); any extra stay.
    // No value restriction — a lower coin can sit on a higher one.
    const cap = MAX_H - this.cols[dest].length
    const moveN = Math.min(n, cap)
    if (moveN <= 0) {
      this.deselect() // destination full
      return
    }
    this.busy = true
    const moving = this.cols[src].splice(this.cols[src].length - moveN, moveN)
    this.selected = -1
    this.liftN = 0
    this.placeColumn(src, true) // lower any leftover (didn't fit) coins

    // Transfer one coin at a time (staggered): each is THROWN along an arc with a
    // heavy ease and a sparkle on landing. Flight depth is ordered to match the
    // final stack (latest behind) and each coin settles to its final depth the
    // moment it lands, so there's no reversed-then-snap.
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
      coin.image.setDepth(DEPTH.COIN_DRAG + (N - j)) // above the board, correct order
      coin.setWidth(this.tray.coinWidth())
      const k = baseLen + j
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
          coin.image.setDepth(this.coinDepth(k, false)) // settle into the stack at once
          this.vfx.sparkle(sx(x), sy(y), 5)
          this.sound.playCoin()
          if (--pending === 0) {
            this.resolveColumn(dest)
            this.placeColumn(dest, false)
            this.busy = false
            this.onChange()
          }
        },
        j * STAGGER,
        360, // rotate sideways as it flies
      )
    }
  }

  /** Merge ALL adjacent equal coins in a column (two of N -> one N+1), anywhere
   *  in the stack, cascading until stable. Same-value coins only fail to merge
   *  if a different-value coin sits between them. */
  private resolveColumn(col: number): boolean {
    const stack = this.cols[col]
    let mergedAny = false
    for (let pass = true; pass; ) {
      pass = false
      for (let k = 0; k < stack.length - 1; k++) {
        const lower = stack[k]
        const upper = stack[k + 1]
        if (lower.value === upper.value && lower.value < COIN_MAX) {
          lower.setValue(lower.value + 1)
          stack.splice(k + 1, 1)
          this.pool.release(upper)
          this.vfx.cloudPuff(lower.image.x, lower.image.y, 150)
          this.vfx.pop(lower.image, 1.3, 200)
          this.sound.playMerge()
          mergedAny = true
          pass = true
          break // stack changed — rescan from the bottom
        }
      }
    }
    if (mergedAny) this.placeColumn(col, false)
    return mergedAny
  }

  /** Whether any valid merge exists right now (drives the idle hand target). */
  canMerge(): boolean {
    if (this.busy || this.locked) return false
    const seenTop = new Set<number>()
    for (const st of this.cols) {
      if (st.length === 0) continue
      const tv = st[st.length - 1].value
      if (tv >= COIN_MAX) continue
      if (st.length >= 2 && st[st.length - 2].value === tv) return true // in-column pair
      if (seenTop.has(tv)) return true // two columns share a top value
      seenTop.add(tv)
    }
    return false
  }

  /** A cross-column merge to demo: screen coords of a source stack and the
   *  destination it should slide onto (lowest value, deterministic). Null if no
   *  cross-column merge exists (the idle hint then points at MERGE/DEAL). */
  mergeHint(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    if (this.busy || this.locked) return null
    const byTop = new Map<number, number[]>()
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      if (st.length === 0) continue
      const tv = st[st.length - 1].value
      if (tv >= COIN_MAX) continue
      const list = byTop.get(tv) ?? []
      list.push(i)
      byTop.set(tv, list)
    }
    let bestV = Infinity
    let pair: number[] | null = null
    for (const [v, idxs] of byTop) {
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

  /** MERGE button: perform one random valid merge. Returns false if none. */
  randomMerge(): boolean {
    if (this.busy || this.locked) return false
    const inCol: number[] = []
    const byTop = new Map<number, number[]>()
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      if (st.length === 0) continue
      const tv = st[st.length - 1].value
      if (tv >= COIN_MAX) continue
      if (st.length >= 2 && st[st.length - 2].value === tv) inCol.push(i)
      const list = byTop.get(tv) ?? []
      list.push(i)
      byTop.set(tv, list)
    }
    type Opt = { type: 'in'; i: number } | { type: 'cross'; a: number; b: number }
    const opts: Opt[] = inCol.map((i) => ({ type: 'in', i }) as Opt)
    for (const idxs of byTop.values()) if (idxs.length >= 2) opts.push({ type: 'cross', a: idxs[0], b: idxs[1] })
    if (opts.length === 0) return false

    const opt = opts[Math.floor(Math.random() * opts.length)]
    if (opt.type === 'in') {
      this.resolveColumn(opt.i)
      this.onChange()
    } else {
      this.busy = true
      const coin = this.cols[opt.a].pop()
      if (!coin) {
        this.busy = false
        return false
      }
      this.placeColumn(opt.a, false)
      coin.slot = opt.b
      this.cols[opt.b].push(coin)
      coin.image.setDepth(DEPTH.COIN_DRAG)
      coin.setWidth(this.tray.coinWidth())
      const k = this.cols[opt.b].length - 1
      const x = this.coinX(opt.b, k)
      const y = this.coinY(opt.b, k, false)
      coin.arcTo(
        this.scene,
        x,
        y,
        260,
        120,
        'Cubic.easeInOut',
        () => {
          coin.image.setDepth(this.coinDepth(k, false))
          this.vfx.sparkle(sx(x), sy(y), 5)
          this.resolveColumn(opt.b)
          this.placeColumn(opt.b, false)
          this.busy = false
          this.onChange()
        },
        0,
        360, // rotate sideways as it flies
      )
    }
    return true
  }

  // ---- delivery -----------------------------------------------------------
  hasValue(v: number): boolean {
    for (const st of this.cols) for (const c of st) if (c.value === v) return true
    return false
  }

  /** Remove one coin of value v (prefer a column top) and return it. */
  takeValue(v: number): Coin | null {
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      if (st.length && st[st.length - 1].value === v) {
        const c = st.pop()!
        this.placeColumn(i, false)
        return c
      }
    }
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      const idx = st.findIndex((c) => c.value === v)
      if (idx >= 0) {
        const c = st.splice(idx, 1)[0]
        this.placeColumn(i, false)
        return c
      }
    }
    return null
  }

  release(coin: Coin): void {
    this.pool.release(coin)
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
