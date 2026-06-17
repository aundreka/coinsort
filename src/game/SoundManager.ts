import Phaser from 'phaser'

// Audio. Muted until the first pointerdown (autoplay policy + AGENTS rule).
// Responds to host mute/volume and to page/ad visibility (suspends the
// AudioContext when hidden so nothing plays behind a closed/hidden ad).
export class SoundManager {
  private scene: Phaser.Scene
  private bgm: Phaser.Sound.BaseSound
  private sfx: Record<string, Phaser.Sound.BaseSound> = {}
  private unlocked = false
  private adMuted = false
  private hostVolume = 1

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.bgm = scene.sound.add('bgm', { loop: true, volume: 0.3 })
    this.sfx.merge = scene.sound.add('sfxMerge', { volume: 0.7 })
    this.sfx.coin = scene.sound.add('sfxCoin', { volume: 0.55 })
    this.sfx.deliver = scene.sound.add('sfxDeliver', { volume: 0.8 })
    this.sfx.click = scene.sound.add('sfxClick', { volume: 0.6 })
    this.sfx.wrong = scene.sound.add('sfxWrong', { volume: 0.75 })
    this.sfx.pop = scene.sound.add('sfxPop', { volume: 0.5 })
    this.sfx.bubble = scene.sound.add('sfxBubble', { volume: 0.6 })
    this.sfx.hello = scene.sound.add('sfxHello', { volume: 0.8 })
    this.sfx.hi = scene.sound.add('sfxHi', { volume: 0.8 })
    this.sfx.gruntM = scene.sound.add('sfxGruntM', { volume: 0.8 })
    this.sfx.gruntF = scene.sound.add('sfxGruntF', { volume: 0.8 })
    scene.sound.mute = true
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  /** Called on the first pointerdown — starts BGM and lifts the autoplay mute. */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.resumeContext()
    this.applyState()
    if (!this.bgm.isPlaying) this.bgm.play()
  }

  private applyState(): void {
    const muted = !this.unlocked || this.adMuted || this.hostVolume <= 0
    this.scene.sound.mute = muted
    this.scene.sound.volume = this.hostVolume
  }

  private play(key: string): void {
    if (this.unlocked) this.sfx[key]?.play()
  }
  playMerge(): void {
    this.play('merge')
  }
  playCoin(): void {
    this.play('coin')
  }
  playDeliver(): void {
    this.play('deliver')
  }
  playClick(): void {
    this.play('click')
  }
  playWrong(): void {
    this.play('wrong')
  }
  playPop(): void {
    this.play('pop')
  }
  /** Coin pickup / lift. */
  playPickup(): void {
    this.play('pop')
  }
  /** Losing a life (heart) — Pop with Bubbles. */
  playLifeLost(): void {
    this.play('bubble')
  }
  /** Customer greeting on arrival (female=Hi, else Hello). */
  playGreet(female: boolean): void {
    this.play(female ? 'hi' : 'hello')
  }
  /** Customer impatient grunt (female / male). */
  playGrunt(female: boolean): void {
    this.play(female ? 'gruntF' : 'gruntM')
  }
  /** End-card appears — Gem Collect Sparkle (shares the deliver clip). */
  playEndcard(): void {
    this.play('deliver')
  }

  setAdMuted(muted: boolean): void {
    this.adMuted = muted
    this.applyState()
  }
  setHostVolume(vol: number): void {
    this.hostVolume = Phaser.Math.Clamp(vol, 0, 1)
    this.applyState()
  }

  pause(): void {
    this.scene.sound.pauseAll()
    this.suspendContext()
  }
  resume(): void {
    if (!this.unlocked) return
    this.resumeContext()
    this.scene.sound.resumeAll()
  }

  private onVisibility = (): void => {
    if (document.hidden) this.pause()
    else this.resume()
  }

  private ctx(): AudioContext | undefined {
    return (this.scene.sound as unknown as { context?: AudioContext }).context
  }
  private resumeContext(): void {
    const c = this.ctx()
    if (c && c.state === 'suspended') void c.resume()
  }
  private suspendContext(): void {
    const c = this.ctx()
    if (c && c.state === 'running') void c.suspend()
  }
}
