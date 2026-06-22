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
const MERGE_YIELD = 3 // a merged column produces THIS many coins of the next value
const DEAL_PER_SLOT = 3 // DEAL drops this many same-value coins into each empty column
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
  // Per mergeable column: a bright additive glow tracing each coin's silhouette.
  // Each coin gets a soft `coinGlow` sprite parked BEHIND the stack (ADD blend, so
  // it reads as light, never a shadow) whose alpha + size pulse together. This is
  // a cheap sprite halo — NOT a postFX glow shader (the old per-coin glow shader,
  // one render pass each, tanked the frame rate on full columns). `halos` is
  // captured so the exact sprites are destroyed even if the column has changed.
  private mergeHi = new Map<
    number,
    { halos: Phaser.GameObjects.Image[]; tween: Phaser.Tweens.Tween }
  >()

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

  /** Pick a coin value to supply: a 1 / 2 / 3 mix weighted toward #3 (the most
   *  common), giving the tray variety while still providing the 1s and 2s the
   *  earlier customers need. */
  private dealValue(): number {
    const r = Math.random()
    if (r < 0.45) return 3 // #3 is the most common dealt coin
    if (r < 0.75) return 2
    return 1
  }

  /** Start state: a full, lively 1/2/3 spread to sort (each column ~6-8 deep, like
   *  the reference). One column gets a head start of 1s so the first customer's "2"
   *  (a full column of 1s) is quickly reachable — the guided first success. */
  seedSpread(): void {
    const head = Math.floor(Math.random() * this.cols.length)
    for (let j = 0; j < 8; j++) this.addCoin(head, 1, false)
    for (let i = 0; i < this.cols.length; i++) {
      if (i === head) continue
      const count = 5 + Math.floor(Math.random() * 4) // 5..8 per column for a full tray
      for (let j = 0; j < count; j++) this.addCoin(i, this.dealValue(), false)
    }
  }

  /** At least one column is empty — the only state in which DEAL is allowed. */
  hasEmptyColumn(): boolean {
    if (this.busy || this.locked) return false
    return this.cols.some((c, i) => i !== this.selected && c.length === 0)
  }

  /** DEAL: fill ONE empty column per press with DEAL_PER_SLOT coins of a single
   *  value (weighted toward 3). The coins drop in one at a time (staggered + eased)
   *  for a smooth cascade. DEAL stays available while more empty columns remain, so
   *  the player taps it again to fill the next one. Busy until the last coin lands. */
  dealCoins(): number {
    const empties: number[] = []
    for (let i = 0; i < this.cols.length; i++) {
      if (i !== this.selected && this.cols[i].length === 0) empties.push(i)
    }
    if (empties.length === 0) return 0
    const col = empties[Math.floor(Math.random() * empties.length)] // just one this press

    this.busy = true
    const STAGGER = 90 // ms between successive coin drops
    const DROP = 70 // design-px the coin falls in from above
    const value = this.dealValue() // all DEAL_PER_SLOT coins share one value
    let pending = 0
    let added = 0

    for (let j = 0; j < DEAL_PER_SLOT; j++) {
      const coin = this.pool.obtain(value)
      if (!coin) continue
      coin.slot = col
      this.cols[col].push(coin)
      added++
      pending++
      const k = this.cols[col].length - 1
      const x = this.coinX(col, k)
      const y = this.coinY(col, k, false)
      const w = this.coinW(col, k)
      coin.image.setDepth(this.coinDepth(col, k, false))
      coin.image.setVisible(false) // hidden until its turn in the cascade
      this.scene.time.delayedCall(j * STAGGER, () => {
        coin.place(x, y - DROP, w) // appear just above the slot...
        coin.moveTo(this.scene, x, y, 300, 'Back.easeOut', () => {
          if (--pending === 0) {
            this.busy = false
            this.onChange()
          }
        })
        this.sound.playCoin() // a tick per coin as it lands in
      })
    }
    if (pending === 0) this.busy = false
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
    this.removeMergeHighlight(i)
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

  /** Reject feedback for a move the rules don't allow: a RED GLOW flash on the
   *  LIFTED coins themselves (the ones the player is holding), not the destination
   *  — so it reads as "these can't go there." No screen shake; that's reserved for
   *  the patience-meter failure (see GameScene.onPatienceEmpty). */
  private rejectMove(lifted: Coin[]): void {
    this.flashCoinsError(lifted)
    this.sound.playWrong()
  }

  /** Flash a strong RED tint directly on the rejected coins (a brief double-pulse,
   *  white -> red -> white). Tinting the coin images means the red lands exactly on
   *  the coins and rides them down as the lifted run settles — no offset glow. */
  private flashCoinsError(coins: Coin[]): void {
    if (coins.length === 0) return
    const imgs = coins.map((c) => c.image)
    const o = { v: 0 }
    this.scene.tweens.add({
      targets: o,
      v: 1,
      duration: 110,
      yoyo: true,
      hold: 90,
      repeat: 1,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        const g = Math.round(255 - 215 * o.v) // 255 -> 40 (white -> deep red)
        const col = Phaser.Display.Color.GetColor(255, g, g)
        for (const im of imgs) im.setTint(col)
      },
      onComplete: () => {
        for (const im of imgs) if (im.active) im.clearTint()
      },
    })
  }

  /** A generic "invalid action" signal with no specific column (e.g. pressing
   *  MERGE/DEAL when neither is possible): flash the whole tray red + buzz. */
  signalInvalid(): void {
    this.tray.flashInvalid()
    this.sound.playWrong()
  }

  /** Returns true if coins actually moved (false on an illegal/blocked move). */
  private moveSelectedTo(dest: number): boolean {
    const src = this.selected
    const n = this.liftN
    const srcStack = this.cols[src]
    const destStack = this.cols[dest]
    const liftedRun = srcStack.slice(srcStack.length - n) // the coins being held
    const moveV = srcStack[srcStack.length - 1].value // the lifted front-run value
    // Can't stack a different coin on top: the destination's FRONT coin must
    // match the run being placed (or the destination must be empty).
    if (destStack.length > 0 && destStack[destStack.length - 1].value !== moveV) {
      this.rejectMove(liftedRun)
      this.deselect()
      return false
    }
    // Move as many as the destination can take (capacity MAX_H); any extra stay.
    const cap = MAX_H - destStack.length
    const moveN = Math.min(n, cap)
    if (moveN <= 0) {
      this.rejectMove(liftedRun) // destination full
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
      // While IN FLIGHT, ride above every resting coin (any row/column) so the
      // thrown coin never clips behind coins it arcs over. It drops to its real
      // in-pile depth only on landing (in the arc's onComplete).
      coin.image.setDepth(DEPTH.COIN_DRAG + j)
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
          coin.image.setDepth(this.coinDepth(dest, k, false)) // settle into the pile z-order
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

  // ---- merge-ready highlight ----------------------------------------------
  /** Highlight every column that is full + single-value (ready to MERGE) and
   *  clear the highlight once a column is no longer mergeable. The highlight is a
   *  gentle pulsing glow that traces each coin's SILHOUETTE — see addMergeHighlight. */
  updateMergeGlows(): void {
    if (isEditEnabled()) return
    for (let i = 0; i < this.cols.length; i++) {
      const ready = !this.busy && !this.locked && i !== this.selected && this.isFullUniform(i)
      const has = this.mergeHi.has(i)
      if (ready && !has) this.addMergeHighlight(i)
      else if (!ready && has) this.removeMergeHighlight(i)
    }
  }

  /** Build a soft `coinGlow` halo sprite over a coin image (ADD blend so it reads
   *  as light, never a shadow). Returns the sprite at alpha 0 — the caller pulses
   *  or flashes it. Sized as a multiple of the coin so the glow rim spills past
   *  the coin's silhouette. */
  private makeGlow(
    img: Phaser.GameObjects.Image,
    color: number,
    scaleMul: number,
    depth: number,
  ): Phaser.GameObjects.Image {
    const g = this.scene.add
      .image(img.x, img.y, 'coinGlow')
      .setOrigin(0.5)
      .setDepth(depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setAlpha(0)
    g.setDisplaySize(img.displayWidth * scaleMul, img.displayHeight * scaleMul)
    return g
  }

  /** Ready-to-merge cue: a bright warm glow tracing the column's coin silhouettes,
   *  parked behind the stack and pulsing in brightness + size. Cheap additive
   *  sprites (no postFX), so a full glowing column costs nothing on the frame. */
  private addMergeHighlight(i: number): void {
    const stack = this.cols[i]
    if (stack.length === 0) return
    const imgs = stack.map((c) => c.image)
    const backDepth = imgs[0].depth // imgs[0] = back coin (the column's lowest depth)
    const halos = imgs.map((img) => this.makeGlow(img, 0xffe7a0, 1.5, backDepth - 1))
    const baseW = imgs.map((im) => im.displayWidth)
    const baseH = imgs.map((im) => im.displayHeight)
    const o = { v: 0 }
    const tween = this.scene.tweens.add({
      targets: o,
      v: 1,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const a = 0.16 + 0.2 * o.v // subtle brightness pulse (0.16 -> 0.36)
        const s = 1.22 + 0.13 * o.v // gentle size pulse (1.22 -> 1.35)
        for (let j = 0; j < halos.length; j++) {
          halos[j].setAlpha(a).setDisplaySize(baseW[j] * s, baseH[j] * s)
        }
      },
    })
    this.mergeHi.set(i, { halos, tween })
  }

  /** Tear down a column's highlight, destroying exactly the halo sprites it made
   *  (so a since-recycled coin can't keep glowing). */
  private removeMergeHighlight(i: number): void {
    const h = this.mergeHi.get(i)
    if (!h) return
    h.tween.remove()
    for (const g of h.halos) g.destroy()
    this.mergeHi.delete(i)
  }

  private clearMergeGlows(): void {
    for (const i of [...this.mergeHi.keys()]) this.removeMergeHighlight(i)
  }

  /** MERGE: turn every FULL, single-value column (N coins of value V) into
   *  MERGE_YIELD coins of value V+1. If that higher value equals the customer's
   *  request the coins are DELIVERED (arc up to them) and onMatch fires; otherwise
   *  they STAY as the column's new stack. Returns false if no column is
   *  full+uniform yet (an invalid MERGE press). */
  collapseFull(matchValue: number, onResult: (matched: boolean) => void): boolean {
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
          // Report the outcome: matched -> the change was delivered (serve);
          // not matched -> the player merged the WRONG value (a mistake).
          onResult(matched)
          this.onChange()
        }
      })
    }
    return true
  }

  /** Merge a full column: its coins converge into the slot (shrink + fade), then
   *  MERGE_YIELD higher coins burst out (see spawnMerged). */
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

  /** A merge produces MERGE_YIELD coins of the next value, bursting out of the slot
   *  with a glow. When the value matches the request they all ARC up to the
   *  customer (the change being handed over); otherwise they settle into the
   *  column as its new, smaller stack. */
  private spawnMerged(
    col: number,
    newValue: number,
    cx: number,
    cy: number,
    deliver: boolean,
    onDone: () => void,
  ): void {
    this.vfx.glowBurst(sx(cx), sy(cy), 260, 0xfff0a0)
    this.vfx.cloudPuff(sx(cx), sy(cy), 150)

    const coins: Coin[] = []
    for (let m = 0; m < MERGE_YIELD; m++) {
      const c = this.pool.obtain(newValue)
      if (c) coins.push(c)
    }
    if (coins.length === 0) {
      onDone()
      return
    }
    let pending = coins.length

    if (deliver) {
      // The merged coins are the customer's change — pop them at the slot, then
      // arc them up to the customer one after another and serve once they land.
      const t = this.deliverTarget()
      coins.forEach((coin, m) => {
        coin.image.setDepth(DEPTH.DELIVER + m)
        coin.place(cx, cy, this.tray.coinWidth(col))
        this.vfx.pop(coin.image, 1.25, 200)
        coin.arcTo(
          this.scene,
          t.x,
          t.y - 80,
          540,
          300,
          'Cubic.easeOut',
          () => {
            this.vfx.glowBurst(sx(t.x), sy(t.y - 80), 240, 0xfff0a0)
            this.pool.release(coin)
            if (--pending === 0) onDone()
          },
          120 + m * 90,
          360,
        )
      })
    } else {
      // Settle as the column's new stack: each coin flies from the slot centre to
      // its back-anchored resting spot (index 0..MERGE_YIELD-1), staggered + eased.
      coins.forEach((coin, m) => {
        const k = m
        const x = this.coinX(col, k)
        const y = this.coinY(col, k, false)
        coin.image.setDepth(this.coinDepth(col, k, true))
        coin.place(cx, cy, this.coinW(col, k)) // start at the slot centre, visible
        this.cols[col].push(coin)
        coin.moveTo(
          this.scene,
          x,
          y,
          280,
          'Back.easeOut',
          () => {
            coin.image.setDepth(this.coinDepth(col, k, false))
            this.vfx.pop(coin.image, 1.18, 160)
            if (--pending === 0) onDone()
          },
          m * 70,
        )
      })
    }
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
