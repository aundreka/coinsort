import Phaser from 'phaser'
import { PATIENCE_MS, IDLE_HINT_MS } from '../constants'
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
import { DeliverFlow } from '../game/DeliverFlow'
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
  private deliver!: DeliverFlow
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
  private mergeCount = 0
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
    this.board = new CoinBoard(this, this.tray, this.pool, this.vfx, this.audio, () =>
      this.onBoardChange(),
    )
    this.queue = new CustomerQueue(this)
    this.patience = new PatienceBar(this, () => this.onPatienceEmpty())
    this.hearts = new Hearts(this)
    this.deliver = new DeliverFlow(this, this.board, this.vfx)
    this.hand = new HandHint(this)
    this.buttons = new Buttons(this, this.vfx, this.audio, {
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
      // Start state: exactly two 1-coins (player merges them into the first 2).
      this.board.seedTwoOnes()
      this.queue.begin()
      this.greet()
      this.startCustomerPhase()
      this.lastInteract = this.time.now
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
      // Re-evaluated every frame (idempotent calls): demonstrate the move-merge
      // gesture by sliding a mergeable stack onto its target; if only an
      // in-column merge exists, tap MERGE; if nothing is mergeable, point DEAL.
      const slide = this.board.mergeHint()
      if (slide) this.hand.slide(slide.from, slide.to)
      else if (this.board.canMerge()) this.hand.pointAt('mergeBtn')
      else this.hand.pointAt('dealBtn')
    }
  }

  // ---- merge / deal -------------------------------------------------------
  private handleMerge(): void {
    if (this.ended || this.busy || this.board.isBusy()) return
    this.markInteract()
    const merged = this.board.randomMerge()
    if (!merged) {
      // No valid merge -> wrong buzzer + guide the player to DEAL immediately.
      this.audio.playWrong()
      this.vfx.shake(0.004, 160)
      this.buttons.pulseDeal()
      this.hand.pointAt('dealBtn')
      this.lastInteract = this.time.now // keep idle logic from overriding it
      this.time.delayedCall(2600, () => {
        if (!this.ended) this.hand.hide()
      })
      return
    }
    this.mergeCount++
    if (ITERATION.mode === 'clicks' && this.mergeCount >= (ITERATION.limit ?? 2)) {
      this.time.delayedCall(500, () => this.endGame())
    }
  }

  private handleDeal(): void {
    if (this.ended || this.busy || this.board.isBusy()) return
    this.markInteract()
    const n = this.board.dealLessThan(this.queue.requestValue)
    if (n > 0) this.audio.playCoin()
  }

  /** Fired by the board after any move/merge/deal settles. */
  private onBoardChange(): void {
    if (this.ended) return
    this.tryDeliver()
  }

  private greet(): void {
    this.audio.playGreet(this.queue.isFemale)
  }

  /** Show the request bubble for 3s, then swap it for the patience bar + timer. */
  private startCustomerPhase(): void {
    this.patience.hide()
    this.bubbleTimer?.remove()
    this.bubbleTimer = this.time.delayedCall(3000, () => {
      if (this.ended || this.busy) return
      this.queue.bubble.hide()
      this.patience.start(PATIENCE_MS)
    })
  }

  // ---- delivery -----------------------------------------------------------
  private tryDeliver(): void {
    const req = this.queue.requestValue
    if (!this.board.hasValue(req)) return
    const coin = this.board.takeValue(req)
    if (!coin) return
    this.busy = true
    this.bubbleTimer?.remove()
    this.board.setLocked(true)
    this.buttons.setEnabled(false)
    this.queue.bubble.pop()
    this.deliver.deliver(coin, this.queue.bubble.badgeScreen, () => this.onDelivered())
  }

  private onDelivered(): void {
    this.audio.playDeliver()
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
    this.queue.leaveCurrent(() => {
      const more = this.queue.next()
      if (more) {
        this.busy = false
        this.board.setLocked(false)
        this.buttons.setEnabled(true)
        this.greet()
        this.startCustomerPhase()
        this.markInteract()
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
    this.patience.start(PATIENCE_MS)
  }

  // ---- end ----------------------------------------------------------------
  private endGame(): void {
    if (this.ended) return
    this.ended = true
    this.busy = true
    this.bubbleTimer?.remove()
    this.board.setLocked(true)
    this.buttons.setEnabled(false)
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
  relayout(): void {
    if (!this.ready) return
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
