// Live, editable coin-stacking parameters (coin scale + 3D perspective). Mirrors
// the layout.json pattern: this JSON is imported (and frozen into prod builds),
// and in dev the #edit coin-stack tuner POSTs changes back to src/coinstack.json
// via a Vite middleware, with HMR reloading this module so tuning updates the
// live game. The perspective is applied relative to the tray centre, so it is
// symmetric left/right by construction.
import raw from './coinstack.json'

export interface CoinStackConfig {
  coinScale: number // multiplier on the base coin width
  stepFrac: number // vertical pile step, as a fraction of coin height
  inwardFrac: number // horizontal lean per stack level, toward the tray centre
  backRowMult: number // extra inward-lean multiplier for the back (top) row
  liftFrac: number // lift height when a run is selected, fraction of coin width
  backFrac: number // how far the BACK anchor sits above slot centre, fraction of coin width
  depthScale: number // per-level size multiplier: each coin further back shrinks by this
  frontRowScale: number // size multiplier for the near (front) tray row's coins
}

const FALLBACK: CoinStackConfig = {
  coinScale: 1,
  stepFrac: 0.21,
  inwardFrac: 0.012,
  backRowMult: 0.9,
  liftFrac: 0.9,
  backFrac: 0.5,
  depthScale: 0.94,
  frontRowScale: 1.12,
}

const num = (v: unknown, fb: number): number => (typeof v === 'number' && isFinite(v) ? v : fb)

const src = (raw ?? {}) as Partial<CoinStackConfig>
const cfg: CoinStackConfig = {
  coinScale: num(src.coinScale, FALLBACK.coinScale),
  stepFrac: num(src.stepFrac, FALLBACK.stepFrac),
  inwardFrac: num(src.inwardFrac, FALLBACK.inwardFrac),
  backRowMult: num(src.backRowMult, FALLBACK.backRowMult),
  liftFrac: num(src.liftFrac, FALLBACK.liftFrac),
  backFrac: num(src.backFrac, FALLBACK.backFrac),
  depthScale: num(src.depthScale, FALLBACK.depthScale),
  frontRowScale: num(src.frontRowScale, FALLBACK.frontRowScale),
}

/** The live config object — mutate it in #edit; it is serialized on Save. */
export function coinStack(): CoinStackConfig {
  return cfg
}
