import Phaser from 'phaser'
import { PATIENCE_MS, PATIENCE_MULT, IDLE_HINT_MS } from '../constants'
import { ITERATION } from '../iteration'
import { bindLifecycle, notifyGameStart, notifyGameEnd } from '../networks'
import { trackEvent } from '../analytics'
import { Background } from '../game/Background'
import { Placeable } from '../game/Placeable'
import { CoinTray } from '../game/CoinTray'
import { CoinPool } from '../game/CoinPool'
import { CoinBoard } from '../game/CoinBoard'
import { CustomerQueue } from '../game/CustomerQueue'
import { PatienceBar } from '../game/PatienceBar'
import { Hearts } from '../game/Hearts'
import { Buttons } from '../game/Buttons'
import { HandHint } from '../game/HandHint'
import { Vfx } from '../game/Vfx'
import { SoundManager } from '../game/SoundManager'
import { EndCard } from './cta'
import type { EditMode } from '../edit/EditMode'

const EDIT_MODE = import.meta.env.DEV && location.hash.toLowerCase().includes('edit')

// Orchestrator. Builds the game/ modules, wires them, and is (with cta.ts) the
// only place that calls the ad-SDK lifecycle. game/ modules stay SDK-free.
export class GameScene extends Phaser.Scene {
  private bg!: Background
  private logo!: Placeable
  private tray!: CoinTray
  private pool!: CoinPool
  private board!: CoinBoard
  private queue!: CustomerQueue
  private patience!: PatienceBar
  private hearts!: Hearts
  private buttons!: Buttons
  private hand!: HandHint
  private vfx!: Vfx
  private audio!: SoundManager
  private endCard!: EndCard
  private editMode?: EditMode

  private ready = false
  private started = false
  private ended = false
  private busy = false
  private bubbleTimer?: Phaser.Time.TimerEvent
  private solvedTracked = false
  private clicks = 0
  private lastInteract = 0

  constructor() {
    super('Game')
  }

  create(): void {
    this.vfx = new Vfx(this)
    this.audio = new SoundManager(this)
    this.bg = new Background(this)
    this.logo = new Placeable(this, 'logo', 'logo')
    this.tray = new CoinTray(this)
    this.pool = new CoinPool(this)
    this.board = new CoinBoard(
      this,
      this.tray,
      this.pool,
      this.vfx,
      this.audio,
      () => this.onBoardChange(),
      () => this.registerClick(),
      () => this.queue.customerDesign,
    )
    this.queue = new CustomerQueue(this)
    this.patience = new PatienceBar(this, () => this.onPatienceEmpty())
    this.hearts = new Hearts(this)
    this.hand = new HandHint(this)
    this.buttons = new Buttons(this, this.audio, {
      onDeal: () => this.handleDeal(),
      onMerge: () => this.handleMerge(),
    })
    this.endCard = new EndCard(this)

    // Network lifecycle -> SoundManager + pause.
    this.game.events.on('ad-pause', this.onAdPause, this)
    this.game.events.on('ad-resume', this.onAdResume, this)
    this.game.events.on('ad-mute', (m: boolean) => this.audio.setAdMuted(m))
    this.game.events.on('ad-volume', (v: number) => this.audio.setHostVolume(v))
    bindLifecycle(this)
    trackEvent('DISPLAYED')

    this.input.on('pointerdown', this.onAnyPointer, this)

    this.events.once('shutdown', () => {
      this.game.events.off('ad-pause', this.onAdPause, this)
      this.game.events.off('ad-resume', this.onAdResume, this)
    })

    if (EDIT_MODE) {
      // Edit mode: fill every slot so coin placement per column/row is visible.
      this.board.fillForEdit()
      // Dev-only in-game layout editor — dynamic import so prod never ships it.
      void import('../edit/EditMode').then(({ EditMode }) => {
        this.editMode = new EditMode(
          this,
          () => this.relayout(),
          () => this.endCard.show(false),
        )
      })
    } else {
      this.queue.begin()
      // Start with a spread of sub-request coins to sort and merge upward.
      this.board.seedSpread(this.queue.requestValue)
      this.greet()
      this.startCustomerPhase()
      this.lastInteract = this.time.now
      this.updateButtonHints()
    }

    this.ready = true
  }

  // ---- input / idle -------------------------------------------------------
  private onAnyPointer(): void {
    if (EDIT_MODE) return
    if (!this.started) {
      this.started = true
      this.audio.unlock()
      this.greet() // the customer "talks" (Hello) on the first tap
      notifyGameStart()
      trackEvent('CHALLENGE_STARTED')
    }
    this.markInteract()
  }

  private markInteract(): void {
    this.lastInteract = this.time.now
    if (this.hand.isVisible) this.hand.hide()
  }

  update(): void {
    if (!this.ready || EDIT_MODE || this.ended || !this.started || this.busy) return
    // Empty tray -> the only move is DEAL, so guide there IMMEDIATELY (no idle
    // wait). Otherwise wait for inactivity, then demonstrate the best action.
    if (this.board.isEmpty()) {
      this.hand.pointAt('dealBtn')
      return
    }
    if (this.time.now - this.lastInteract > IDLE_HINT_MS) {
      // Re-evaluated every frame (idempotent). A full same-value column is ready
      // -> tap MERGE. Else, demonstrate sorting by sliding matching coins
      // together. Else nothing to do -> DEAL.
      if (this.board.hasFullUniform()) {
        this.hand.pointAt('mergeBtn')
        return
      }
      const slide = this.board.mergeHint()
      if (slide) this.hand.slide(slide.from, slide.to)
      else this.hand.pointAt('dealBtn')
    }
  }

  // ---- merge / deal -------------------------------------------------------
  private handleMerge(): void {
    if (this.ended || this.busy || this.board.isBusy()) return
    this.markInteract()
    this.registerClick() // pressing MERGE counts toward the "2 clicks" iteration
    // Collapse any full single-value column (gives the change). If the matching
    // value is collapsed, the customer is served.
    const did = this.board.collapseFull(this.queue.requestValue, () => this.serveCustomer())
    if (!did) {
      // No full column yet -> immediately show the hand guiding the player to
      // MERGE coins: demonstrate sliding matching coins together to build a full
      // column. (If there's nothing to combine yet, fall back to DEAL.)
      this.audio.playWrong()
      this.vfx.shake(0.004, 160)
      const slide = this.board.mergeHint()
      if (slide) this.hand.slide(slide.from, slide.to)
      else this.hand.pointAt('dealBtn')
      this.lastInteract = this.time.now // keep idle logic from overriding it
      this.time.delayedCall(2600, () => {
        if (!this.ended) this.hand.hide()
      })
    }
  }

  private handleDeal(): void {
    if (this.ended || this.busy || this.board.isBusy()) return
    this.markInteract()
    this.registerClick() // pressing DEAL counts toward the "2 clicks" iteration
    // DEAL only fails when the tray is full. If a column is still mergeable, that
    // is an error -> buzz + guide the player to MERGE ("tap to merge"). If there
    // is nothing left to merge, the tray is a dead end -> end scene.
    if (this.board.isFull()) {
      if (this.board.hasFullUniform()) {
        this.audio.playWrong()
        this.vfx.shake(0.004, 160)
        this.hand.pointAt('mergeBtn') // hand over MERGE + "tap to merge" label
        this.lastInteract = this.time.now
        this.time.delayedCall(2600, () => {
          if (!this.ended) this.hand.hide()
        })
      } else {
        this.endGame()
      }
      return
    }
    const n = this.board.dealCoins(this.queue.requestValue)
    if (n > 0) this.audio.playCoin()
  }

  /** Same pulse on both buttons: MERGE pulses whenever a column is mergeable;
   *  DEAL pulses only when the player can't yet assemble a full column from the
   *  coins they already hold (so they need to deal more). */
  private updateButtonHints(): void {
    this.board.updateMergeGlows() // subtle glow on any mergeable column
    if (this.ended || this.busy) {
      this.buttons.setMergeReady(false)
      this.buttons.setDealReady(false)
      return
    }
    this.buttons.setMergeReady(this.board.hasFullUniform())
    this.buttons.setDealReady(!this.board.canFormFullColumn())
  }

  /** A "click" = any player interaction: tapping a coin column (pick up / move)
   *  OR pressing DEAL / MERGE. The "2 clicks" iteration ends after two of these. */
  private registerClick(): void {
    if (this.ended) return
    this.clicks++
    if (ITERATION.mode === 'clicks' && this.clicks >= (ITERATION.limit ?? 2)) {
      this.time.delayedCall(600, () => this.endGame())
    }
  }

  /** Fired by the board after any move/deal/merge settles. Ends the game if the
   *  tray filled up with nothing left to merge; otherwise refreshes the
   *  MERGE/DEAL attention pulses. */
  private onBoardChange(): void {
    if (this.ended) return
    // A full tray with nothing left to merge is a dead end -> end scene. If a
    // column is still mergeable, keep playing (the MERGE pulse guides the player).
    if (this.board.isFull() && !this.board.hasFullUniform()) {
      this.endGame()
      return
    }
    this.updateButtonHints()
  }

  private greet(): void {
    this.audio.playGreet(this.queue.isFemale)
  }

  /** Per-customer patience duration (customer 2 longer, customer 3 twice). */
  private patienceMs(): number {
    const i = Math.min(this.queue.currentIndex, PATIENCE_MULT.length - 1)
    return PATIENCE_MS * PATIENCE_MULT[i]
  }

  /** Show the request bubble for 3s, then swap it for the patience bar + timer. */
  private startCustomerPhase(): void {
    this.patience.hide()
    this.bubbleTimer?.remove()
    this.bubbleTimer = this.time.delayedCall(3000, () => {
      if (this.ended || this.busy) return
      this.queue.bubble.hide()
      this.patience.start(this.patienceMs())
    })
  }

  // ---- serving (a full column of the requested value was merged) ----------
  private serveCustomer(): void {
    this.audio.playDeliver()
    this.bubbleTimer?.remove()
    this.busy = true
    this.board.setLocked(true)
    this.buttons.setEnabled(false)
    this.updateButtonHints() // stop the pulses while the customer is served
    this.queue.markServed()
    if (!this.solvedTracked) {
      this.solvedTracked = true
      trackEvent('CHALLENGE_SOLVED')
    }

    if (ITERATION.mode === 'customers' && this.queue.servedCount >= (ITERATION.limit ?? 2)) {
      this.endGame()
      return
    }

    this.patience.stop()
    this.queue.bubble.pop()
    this.queue.leaveCurrent(() => {
      const more = this.queue.next()
      if (more) {
        this.busy = false
        this.board.setLocked(false)
        this.buttons.setEnabled(true)
        this.greet()
        this.startCustomerPhase()
        this.markInteract()
        this.updateButtonHints()
      } else {
        this.endGame() // full sequence complete
      }
    })
  }

  // ---- patience / hearts --------------------------------------------------
  private onPatienceEmpty(): void {
    if (this.ended || this.busy) return
    this.hearts.lose()
    this.audio.playLifeLost() // Pop with Bubbles on heart loss
    this.audio.playGrunt(this.queue.isFemale)
    this.vfx.shake()
    this.queue.showAngry(true)
    if (this.hearts.isDead()) {
      this.endGame()
      return
    }
    this.time.delayedCall(600, () => this.queue.showAngry(false))
    this.patience.start(this.patienceMs())
  }

  // ---- end ----------------------------------------------------------------
  private endGame(): void {
    if (this.ended) return
    this.ended = true
    this.busy = true
    this.bubbleTimer?.remove()
    this.board.setLocked(true)
    this.buttons.setEnabled(false)
    this.updateButtonHints() // stop any attention pulses
    this.patience.stop()
    this.hand.hide()
    notifyGameEnd()
    this.time.delayedCall(380, () => {
      this.endCard.show()
      this.audio.playEndcard() // Gem Collect Sparkle when the end scene appears
    })
  }

  // ---- lifecycle ----------------------------------------------------------
  private onAdPause(): void {
    this.audio.pause()
    this.patience.pause()
    this.tweens.pauseAll()
  }
  private onAdResume(): void {
    this.audio.resume()
    this.patience.resume()
    this.tweens.resumeAll()
  }

  // ---- relayout cascade ---------------------------------------------------
  /** Called synchronously the instant a resize event fires (before the debounced
   *  relayout), so a held stack is dropped + taps guarded as early as possible. */
  onViewportResizing(): void {
    if (this.ready) this.board.onViewportChange()
  }

  relayout(): void {
    if (!this.ready) return
    // A resize drops any held coin run + guards against the synthetic tap some
    // ad SDKs fire on resize (which otherwise merged the lifted stack sideways).
    this.board.onViewportChange()
    this.bg.relayout()
    this.logo.relayout()
    this.tray.relayout()
    this.board.relayout()
    this.queue.relayout()
    this.patience.relayout()
    this.hearts.relayout()
    this.buttons.relayout()
    this.hand.relayout()
    this.endCard.relayout()
    this.editMode?.relayout()
  }
}
