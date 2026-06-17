import Phaser from 'phaser'
import { Placeable } from './Placeable'

// The two EXTEND layers — the bank-lobby panorama (bg_extended) and the navy
// counter band (table). Both cover the full viewport width and reveal more of
// their width as the screen widens; in portrait they match the mockup. No
// full-screen backstop rect is needed: the canvas is transparent and the page
// background is navy, so any gap at an extreme aspect simply shows that navy.
export class Background {
  private bg: Placeable
  private table: Placeable

  constructor(scene: Phaser.Scene) {
    this.bg = new Placeable(scene, 'bg', 'bg')
    this.table = new Placeable(scene, 'table', 'table')
    this.relayout()
  }

  relayout(): void {
    this.bg.relayout()
    this.table.relayout()
  }
}
