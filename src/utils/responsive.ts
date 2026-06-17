// Coordinate helpers. The gameplay column lives in a design space of
// DESIGN_W x DESIGN_H (1080x1920, the mockup composition) and is FIT (contain)
// into the canvas so the tray, coins, customer, HUD and buttons keep identical
// proportions and stay fully visible at any zoom — centered, never cropped.
//
// The background + counter band do NOT fit-letterbox: they EXTEND to fill the
// full viewport width (see coverScale/centerX) so wide screens (landscape /
// iPad) are filled edge-to-edge instead of showing letterbox bars. Their
// vertical scale still tracks the gameplay fit-scale, so in portrait they match
// the mockup exactly — only their width grows.
//
// No hardcoded canvas px in game code — everything goes through sx()/sy()/sd()
// for the fit column and centerX()/coverScale() for the extend layers.
import { DESIGN_W, DESIGN_H } from '../constants'

let _s = 1
let _offX = 0
let _offY = 0
let _vw = DESIGN_W
let _vh = DESIGN_H

let _inset = { top: 0, right: 0, bottom: 0, left: 0 }

/** Recompute the design->canvas transform for a canvas of vw x vh pixels. */
export function computeMetrics(vw: number, vh: number): void {
  _vw = vw
  _vh = vh
  _s = Math.min(vw / DESIGN_W, vh / DESIGN_H)
  _offX = (vw - DESIGN_W * _s) / 2
  _offY = (vh - DESIGN_H * _s) / 2
}

/** Store safe-area insets (already converted to canvas px). */
export function setSafeInsets(top: number, right: number, bottom: number, left: number): void {
  _inset = { top, right, bottom, left }
}

// ---- FIT helpers: the gameplay column (1080x1920, centered, letterboxed) ----
export const sx = (x: number): number => _offX + x * _s
export const sy = (y: number): number => _offY + y * _s
export const sd = (d: number): number => d * _s

/** Inverse of sx/sy — convert a canvas px back to design space (edit mode). */
export const inverseX = (px: number): number => (px - _offX) / _s
export const inverseY = (px: number): number => (px - _offY) / _s

export const scale = (): number => _s
export const viewW = (): number => _vw
export const viewH = (): number => _vh
export const insets = () => _inset

/** Whether the canvas is currently wider than tall (landscape). */
export const isLandscape = (): boolean => _vw > _vh

// ---- EXTEND helpers: bg_extended + table (cover width, fit height) ----------
/** Horizontal anchor for extend layers — always screen-center. */
export const centerX = (): number => _vw / 2

/**
 * Uniform draw scale for an extend layer of native width `nativeW`.
 * - Normally tracks the gameplay vertical scale (`sd(designScale)`), so in
 *   portrait the layer matches the mockup exactly: same height, centered.
 * - Never smaller than `vw / nativeW`, guaranteeing the layer always reaches
 *   both viewport edges (no side gap) even at extreme-wide aspect ratios. For
 *   real phone portrait the art (~2804 wide) is already far wider than the
 *   viewport, so this clamp never fires and there is zero distortion.
 */
export const coverScale = (nativeW: number, designScale: number): number =>
  Math.max(sd(designScale), _vw / nativeW)
