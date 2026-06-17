// Tiny, always-present bridge between Placeables and the (dev-only) EditMode.
// Placeable calls registerEditable(this) at construction; it no-ops unless the
// registry was enabled (dev + #edit). This lets the heavy EditMode module be a
// dynamic import that ships only in dev, while Placeable stays decoupled.
import type Phaser from 'phaser'
import type { LayoutEntry } from '../layout'

export interface Editable {
  readonly key: string
  readonly image: Phaser.GameObjects.Image
  readonly entry: LayoutEntry
  relayout(): void
}

let _enabled = false
const _items: Editable[] = []
let _onAdd: ((e: Editable) => void) | null = null

export function enableEditRegistry(): void {
  _enabled = true
}
export function isEditEnabled(): boolean {
  return _enabled
}
export function registerEditable(e: Editable): void {
  if (!_enabled) return
  _items.push(e)
  _onAdd?.(e)
}
export function editItems(): Editable[] {
  return _items
}
export function onEditAdd(cb: (e: Editable) => void): void {
  _onAdd = cb
}
