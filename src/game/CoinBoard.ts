import Phaser from 'phaser'
import type { CoinTray } from './CoinTray'
import type { CoinPool } from './CoinPool'
import type { Coin } from './Coin'
import type { Vfx } from './Vfx'
import type { SoundManager } from './SoundManager'
import { DEPTH, COIN_MAX, ART, TRAY } from '../constants'
import { sx, sy, sd } from '../utils/responsive'
import { isEditEnabled } from '../edit/registry'
import { coinStack } from '../coinstack'

// Column-stack coin model. Each tray cell is a column that fills from the BACK
// (far/receded) toward the FRONT (near). cols[col][0] is the BACK-most coin (it
// rests against the cell's back wall); pushing appends toward the FRONT. Tap a
// column to LIFT its FRONT run of equal coins — the near, accessible coins; tap
// another column to MOVE them onto the FRONT of that pile. A run can only land
// on a matching coin (or an empty column) — you can't stack a different value on
// top. MERGE turns a FULL single-value column into one higher coin.
const MAX_H = 10 // coins per column (capacity)
const ROW_BAND = 20 // depth gap so the FRONT tray row always draws over the back row
// An AppLovin-style device switch fires a (trusted-looking) tap AND a resize a
// short time apart, in either order. These windows must comfortably cover that
// gap in BOTH switch directions (the tablet->phone gap is larger than
// phone->tablet), so the synthetic tap is either ignored or its move undone.
const RESIZE_TAP_GUARD_MS = 600 // ignore column taps this long after a viewport resize
const UNDO_WINDOW_MS = 700 // undo a move if a resize lands within this long after it
// Coin scale + perspective (step / inward lean / back-row lean / lift) are live,
// editable values in src/coinstack.json — see coinStack() and the #edit tuner.

export class CoinBoard {
  private cols: Coin[][]
  private zones: Phaser.GameObjects.Rectangle[] = []
  private selected = -1
  private liftN = 0
  private busy = false
  private locked = false
  private lastViewportChange = -1e9
  private lastMove?: { src: number; dest: number; coins: Coin[]; t: number }
  // Per mergeable column: a soft glow sprite behind the stack + its pulse tween.
  private mergeGlows = new Map<number, { glow: Phaser.GameObjects.Image; tween: Phaser.Tweens.Tween }>()

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
    if (b) {
      this.lastMove = undefined
      this.clearMergeGlows()
    }
    if (b && this.selected >= 0) this.deselect()
  }

  /** The scene calls this on every viewport resize. An AppLovin device switch
   *  delivers a (trusted) tap that lands on a column AND then resizes ~tens of ms
   *  later — so a move executes and the resize arrives just after. Here we UNDO a
   *  move that happened right before this resize, drop any held run, and briefly
   *  ignore column taps. */
  onViewportChange(): void {
    const now = this.scene.time.now
    this.lastViewportChange = now
    if (this.lastMove && now - this.lastMove.t < UNDO_WINDOW_MS) this.undoLastMove()
    else this.lastMove = undefined
    if (this.selected >= 0 && !this.busy) this.deselect()
  }

  /** Reverse the most recent transfer: stop the coins (even mid-flight) and
   *  return them to the front of their source column. */
  private undoLastMove(): void {
    const m = this.lastMove
    if (!m) return
    this.lastMove = undefined
    const moved = new Set(m.coins)
    for (const c of m.coins) {
      c.stopTween()
      c.slot = m.src
    }
    this.cols[m.dest] = this.cols[m.dest].filter((c) => !moved.has(c))
    this.cols[m.src] = [...m.coins, ...this.cols[m.src]]
    this.busy = false
    this.placeColumn(m.src, false)
    this.placeColumn(m.dest, false)
    this.onChange()
  }

  // ---- geometry -----------------------------------------------------------
  // The whole column is BACK-anchored: index k (0 = back-most) maps to a fixed
  // ladder of positions that grow forward/down from a back anchor sitting a
  // little above the slot centre. So a partial stack rests against the back wall
  // and each added coin fills toward the near/front edge. The perspective knobs
  // key off the level FROM THE FRONT (L = n-1-k): the near coin (L=0) sits low,
  // unleaned and on top; deeper coins lean inward and tuck behind.
  private step(col: number): number {
    return this.tray.coinWidth(col) * (ART.coin[1] / ART.coin[0]) * coinStack().stepFrac
  }

  /** Per-coin design width: the column's base width shrunk by depthScale once per
   *  level back, so a coin reads as smaller the deeper it sits in the pile. Keyed
   *  off the ABSOLUTE slot (against a full MAX_H pile), not the current height, so
   *  the coin at index k looks identical whether the stack is partial or full —
   *  index 0 always rests at the deepest/smallest spot against the back wall. */
  private coinW(col: number, k: number): number {
    const level = MAX_H - 1 - k // 0 = the front of a full pile (full size)
    return this.tray.coinWidth(col) * Math.pow(coinStack().depthScale, level)
  }

  private coinY(col: number, k: number, lifted: boolean): number {
    const w = this.tray.coinWidth(col)
    const lift = lifted ? w * coinStack().liftFrac : 0
    const back = w * coinStack().backFrac // back anchor offset above the slot centre
    return this.tray.slotCenter(col).y - back + k * this.step(col) - lift
  }

  // Each coin deeper in the stack leans toward the tray center, so the pile reads
  // as receding inward (3D) instead of a flat vertical column. The back (top) row
  // leans by an extra multiplier, exaggerating the depth. Both knobs live in
  // coinStack() so they can be tuned in #edit. Leaning toward the tray centre
  // keeps the perspective symmetric on the left and right halves automatically.
  private coinX(col: number, k: number): number {
    const slot = this.tray.slotCenter(col)
    const cs = coinStack()
    const inward = cs.inwardFrac * (Math.floor(col / TRAY.cols) === 0 ? cs.backRowMult : 1)
    const level = MAX_H - 1 - k // absolute slot: 0 = front of a full pile (unleaned)
    return slot.x + (this.tray.placeable.entry.x - slot.x) * inward * level
  }

  // Depth so coins layer naturally. Two independent axes:
  //  - The FRONT tray row (cols 5..9) always draws over the back row (cols 0..4)
  //    via ROW_BAND, so transferred coins don't look like they "teleported to the
  //    back" on landing.
  //  - Within a column the stack RECEDES up-and-back: the near (front, L=0) coin
  //    sits IN FRONT of the deeper ones (depth DECREASES with level), so the pile
  //    reads as a 3D tower.
  // `pop` (merge collapse only) lifts the whole band above resting coins; the
  // selection lift does NOT use it, so a lifted run keeps its in-pile z-order.
  private coinDepth(col: number, k: number, pop: boolean): number {
    const row = Math.floor(col / TRAY.cols)
    // Absolute slot: depth rises with k, so the near (front) coin draws on top of
    // the pile and incoming front coins always land above the existing ones.
    return (pop ? DEPTH.COIN_POP : DEPTH.COIN) + row * ROW_BAND + (1 + k)
  }

  private placeColumn(col: number, animate: boolean): void {
    const stack = this.cols[col]
    const n = stack.length
    // The lifted group is the FRONT run (the top liftN indices) — the near,
    // accessible coins, so lifting reads as pulling them off the front.
    const liftCount = col === this.selected ? this.liftN : 0
    for (let k = 0; k < n; k++) {
      const coin = stack[k]
      const lifted = k >= n - liftCount
      const w = this.coinW(col, k) // smaller the deeper this coin sits
      // Lifting only raises the coins in Y — their z-order stays put, so the
      // lifted BACK run keeps sitting behind the front coins instead of phasing
      // in front of them.
      coin.image.setDepth(this.coinDepth(col, k, false))
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
    this.cols[col].push(coin) // the new coin lands FRONT-most (against the near edge)
    const k = this.cols[col].length - 1
    const w = this.coinW(col, k) // the newcomer's slot width (front-most of the partial pile)
    // Place the newcomer at the front of the ladder. The coins already in the
    // column are position-anchored, so they don't move when one is added.
    this.placeColumn(col, false)
    if (drop) {
      const x = this.coinX(col, k)
      const y = this.coinY(col, k, false)
      coin.place(x, y - w * 0.6, w)
      coin.moveTo(this.scene, x, y, 240, 'Bounce.easeOut')
    }
    return coin
  }

  /** Edit-mode only: fill every column to capacity so the coin scale + perspective
   *  (and per-slot placement) are all visible while tuning in #edit. */
  fillForEdit(): void {
    for (let i = 0; i < this.tray.slotCount; i++) {
      const value = (i % COIN_MAX) + 1
      for (let k = 0; k < MAX_H; k++) this.addCoin(i, value)
    }
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
  handleClick(i: number, pointer?: Phaser.Input.Pointer): void {
    if (this.busy || this.locked) return
    // Ignore SYNTHETIC taps. Some ad SDKs (e.g. AppLovin's device switch) script-
    // dispatch a tap when they resize the creative; that phantom tap lands on a
    // shifted column and merges the lifted stack. Only genuine user input has
    // event.isTrusted === true, so a script-dispatched event is rejected here.
    if (pointer?.event && pointer.event.isTrusted === false) return
    // Belt-and-braces: also swallow taps right after a resize (the column the SDK
    // tap targets has just moved), in case a re-dispatched event reads as trusted.
    if (this.scene.time.now - this.lastViewportChange < RESIZE_TAP_GUARD_MS) return
    if (this.selected === -1) {
      if (this.cols[i].length === 0) return // tapping an empty column does nothing
      this.select(i)
      this.onInteract() // picking up a coin = a coin interaction
    } else if (this.selected === i) {
      this.deselect() // putting it back down — not counted
    } else {
      // Count only a real move (a coin actually changed columns); a blocked move
      // onto a full column just puts the stack back down. If a viewport resize
      // lands right after (an SDK device switch), onViewportChange undoes it.
      if (this.moveSelectedTo(i)) this.onInteract()
    }
  }

  private select(i: number): void {
    const stack = this.cols[i]
    if (stack.length === 0) return
    // Clear this column's ready-to-merge highlight while it's being handled.
    this.removeMergeGlow(i)
    // Lift the FRONT RUN of same-value coins (the near coins, top of the pile).
    // Those are the only coins the player can pick up — you can't reach past a
    // different value sitting in front of the ones you want.
    const top = stack.length - 1
    const frontV = stack[top].value
    let n = 0
    for (let k = top; k >= 0 && stack[k].value === frontV; k--) n++
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
    // If the column we just put down is still mergeable, its highlight can resume.
    this.updateMergeGlows()
  }

  /** Flash the tray red + buzz: feedback for a move the rules don't allow. */
  private rejectMove(): void {
    this.tray.flashInvalid()
    this.sound.playWrong()
    this.vfx.shake(0.004, 160)
  }

  /** Returns true if coins actually moved (false on an illegal/blocked move). */
  private moveSelectedTo(dest: number): boolean {
    const src = this.selected
    const n = this.liftN
    const srcStack = this.cols[src]
    const destStack = this.cols[dest]
    const moveV = srcStack[srcStack.length - 1].value // the lifted front-run value
    // Can't stack a different coin on top: the destination's FRONT coin must
    // match the run being placed (or the destination must be empty).
    if (destStack.length > 0 && destStack[destStack.length - 1].value !== moveV) {
      this.rejectMove()
      this.deselect()
      return false
    }
    // Move as many as the destination can take (capacity MAX_H); any extra stay.
    const cap = MAX_H - destStack.length
    const moveN = Math.min(n, cap)
    if (moveN <= 0) {
      this.rejectMove() // destination full
      this.deselect()
      return false
    }
    this.busy = true
    // Take the FRONT coins (the lifted run) off the top; the coins behind them
    // stay put. They get appended to the FRONT of the dest pile.
    const moving = this.cols[src].splice(this.cols[src].length - moveN, moveN)
    // Remember it so a resize landing right after can undo it (AppLovin switch).
    this.lastMove = { src, dest, coins: moving.slice(), t: this.scene.time.now }
    this.selected = -1
    this.liftN = 0
    this.placeColumn(src, true) // settle the coins that were behind / didn't fit

    // Transfer one coin at a time (staggered): each is THROWN along an arc with a
    // heavy ease and a sparkle on landing. Each coin flies straight to its FINAL
    // slot depth/size. Slots are absolute, so the coins already in the dest don't
    // move, and an incoming FRONT coin (higher k) always layers on top of them.
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
      coin.setWidth(this.coinW(dest, k))
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

  // ---- merge-ready wave ----------------------------------------------------
  /** Run a subtle staggered "wave" over the coins of every column that is full +
   *  single-value (ready to MERGE) and stop it once the column is no longer
   *  mergeable. The juice lives on the coins themselves — a soft hop + swell that
   *  ripples up the stack one coin at a time — instead of a glow sprite. */
  updateMergeGlows(): void {
    if (isEditEnabled()) return
    for (let i = 0; i < this.cols.length; i++) {
      // Never wave the SELECTED column: the wave rewrites coin positions every
      // frame and would fight the lift (the stack would snap back down).
      const ready = !this.busy && !this.locked && i !== this.selected && this.isFullUniform(i)
      const has = this.mergeWaves.has(i)
      if (ready && !has) this.addMergeWave(i)
      else if (!ready && has) this.removeMergeWave(i)
    }
  }

  // Period (ms) of one full ripple and the per-coin phase offset that staggers
  // it up the stack. Both deliberately gentle — this should read as "alive", not
  // "bouncing".
  private static readonly WAVE_MS = 1600
  private static readonly WAVE_PHASE = 0.55 // radians between adjacent coins

  private addMergeWave(i: number): void {
    const o = { t: 0 }
    const tween = this.scene.tweens.add({
      targets: o,
      t: 1,
      duration: CoinBoard.WAVE_MS,
      repeat: -1,
      ease: 'Linear',
      onUpdate: () => this.applyWave(i, o.t),
    })
    this.mergeWaves.set(i, tween)
  }

  /** Drive one column's coins for the current wave phase: a one-sided sine gives
   *  each coin a soft hop + size swell, offset per coin so a crest travels from
   *  the near coin up toward the back. */
  private applyWave(i: number, t: number): void {
    const stack = this.cols[i]
    const n = stack.length
    if (n === 0) return
    const ar = ART.coin[1] / ART.coin[0]
    for (let k = 0; k < n; k++) {
      const coin = stack[k]
      const w = this.coinW(i, k) // this coin's resting (tapered) width
      const phase = t * Math.PI * 2 - (n - 1 - k) * CoinBoard.WAVE_PHASE
      const up = Math.max(0, Math.sin(phase)) // 0..1, gentle one-sided rise
      coin.image.y = sy(this.coinY(i, k, false)) - sd(w * 0.05) * up
      const sc = 1 + 0.05 * up
      coin.image.setDisplaySize(sd(w * sc), sd(w * ar * sc))
    }
  }

  private removeMergeWave(i: number): void {
    const tween = this.mergeWaves.get(i)
    if (!tween) return
    tween.remove()
    this.mergeWaves.delete(i)
    // Settle the coins back to rest (undoes the hop + swell the wave applied).
    this.placeColumn(i, false)
  }

  private clearMergeGlows(): void {
    for (const i of [...this.mergeWaves.keys()]) this.removeMergeWave(i)
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
    this.clearMergeGlows() // these columns are about to merge away
    this.lastMove = undefined // merged coins are released — never undo them
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
    if (deliver) {
      // The merged coin is the customer's change — pop it big at the slot centre,
      // then arc it up to them and serve. (It leaves the tray, so no perspective.)
      coin.image.setDepth(this.coinDepth(col, 0, true))
      coin.place(cx, cy, this.tray.coinWidth(col))
      this.vfx.glowBurst(sx(cx), sy(cy), 240, 0xfff0a0)
      this.vfx.cloudPuff(sx(cx), sy(cy), 150)
      this.vfx.pop(coin.image, 1.35, 240)
      this.scene.time.delayedCall(220, () => this.deliverCoin(coin, onDone))
    } else {
      // Settle as the column's lone coin: back-anchored and tapered, exactly like
      // any single resting coin (index 0 against the back wall).
      const x = this.coinX(col, 0)
      const y = this.coinY(col, 0, false)
      coin.image.setDepth(this.coinDepth(col, 0, false))
      coin.place(x, y, this.coinW(col, 0))
      this.cols[col].push(coin)
      this.vfx.glowBurst(sx(x), sy(y), 240, 0xfff0a0)
      this.vfx.cloudPuff(sx(x), sy(y), 150)
      this.vfx.pop(coin.image, 1.35, 240)
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
    // Key off the BACK value (index 0) — that's the run a tap actually lifts.
    const byBack = new Map<number, number[]>()
    for (let i = 0; i < this.cols.length; i++) {
      const st = this.cols[i]
      if (st.length === 0) continue
      const fv = st[0].value
      if (fv >= COIN_MAX) continue
      const list = byBack.get(fv) ?? []
      list.push(i)
      byBack.set(fv, list)
    }
    let bestV = Infinity
    let pair: number[] | null = null
    for (const [v, idxs] of byBack) {
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
      z.on('pointerdown', (p: Phaser.Input.Pointer) => this.handleClick(i, p))
      this.zones.push(z)
    }
    this.layoutZones()
  }

  private layoutZones(): void {
    const ar = ART.coin[1] / ART.coin[0]
    for (let i = 0; i < this.zones.length; i++) {
      const cx = this.tray.slotCenter(i).x
      const w = this.tray.coinWidth(i)
      // Track the actual coin ladder: from the top of the back coin down to the
      // bottom of a full pile's front coin, so every coin in the column is on the
      // hit area (back-anchored + tapered, not a fixed box at the slot centre).
      const top = this.coinY(i, 0, false) - this.coinW(i, 0) * ar * 0.5
      const bottom = this.coinY(i, MAX_H - 1, false) + this.coinW(i, MAX_H - 1) * ar * 0.5
      this.zones[i]
        .setPosition(sx(cx), sy((top + bottom) / 2))
        .setSize(sd(w * 1.2), sd(bottom - top))
    }
  }

  relayout(): void {
    this.layoutZones()
    for (let i = 0; i < this.cols.length; i++) this.placeColumn(i, false)
    // Rebuild the merge glows at the new scale/positions.
    this.clearMergeGlows()
    this.updateMergeGlows()
  }
}
