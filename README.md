# Coin Sort — Change Change · Phaser 3 Playable Ad

A bank-counter coin-merge playable. The player works a bank counter serving a
line of customers. Each customer's speech bubble shows the coin value they need;
the player taps **MERGE** to combine lower coins (two of value _N_ → one of value
_N+1_) until the requested coin is made, then it's delivered and the next
customer steps up. Let a customer's **PATIENCE** bar empty and you lose a heart;
lose all three and it's game over. Either way the end card / CTA appears.

Built with **Phaser 3.90 · TypeScript · Vite + vite-plugin-singlefile**. Each
build is a single self-contained `.html` (all images/audio inlined as base64),
fanned out to per-network variants for AppLovin, Google, Ironsource, Mintegral,
Facebook, Unity, Vungle and Moloco.

---

## Controls / interactions
- **Tap a coin column** → its top run of equal coins **lifts** up; **tap another
  column** → those coins move there (as many as fit) and **merge** with a matching
  top (two of _N_ → one _N+1_, cascading). Tap the same column again to drop them.
- **MERGE** — auto-performs one random valid merge. If nothing is mergeable it
  plays the wrong-answer buzzer and a hand points you to **DEAL**.
- **DEAL** — drops fresh coins of value **less than** the current request.
- Make the customer's requested coin → it auto-delivers, the customer leaves
  (with a voice line), the next one arrives.
- **Tutorial / hint** — after **4 s** of inactivity a pointing hand + a centered
  "tap to merge coins" appears over MERGE. Cancelled on the next tap.
- **Tap anywhere on the end card** → store redirect.
- Audio is muted until the first tap (autoplay policy) and pauses when the ad is
  hidden. Customer greetings/grunts + coin pickup use the New-Folder voice SFX.

Start state is exactly **two 1-coins** — move one onto the other (or press MERGE)
to make the first **2**.

## Iterations (end-card trigger)
Baked per build via `VITE_ITERATION`; `build:all` produces all three:

| `VITE_ITERATION` | End card appears after |
|---|---|
| `2cust` | 2 customers served |
| `2clk`  | 2 MERGE interactions |
| `full`  | the whole scripted customer line (default for `dev`/`build`) |

---

## Setup & build
```bash
npm install
npm run assets   # PNG  -> WebP   (src/assets/Main -> src/assets-webp/Main)
npm run audio    # WAV/MP3 -> MP3 96k mono (-> src/assets-webp/Audio)

npm run dev        # local dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run build      # single dist/index.html (full iteration)
npm run build:all  # all 3 iterations x all networks -> dist/<length>/<Network>/
```
> Run `npm run assets` and `npm run audio` once before the first `dev`/`build`
> (they generate the WebP/MP3 files the code imports).

### Build output layout
```
dist/
  2cust/  2clk/  full/
    Applovin/   cs_mip_hpl_coinsortvar1_01_cartoon_na_noseason_en_<len>_na_al.html
    Google/     ...gg.zip
    Ironsource/ ...is.html
    Mintegral/  ...mtg.zip
    Facebook/   ...fb.html
    Unity/      ...un.html
    Vungle/     ...vu.zip
    Moloco/     ...mo.html
  full.html   # convenience single file for a quick file:// open
```
Each file's first line is its network tag comment (`<!-- ad-network: Name | tag -->`);
MRAID networks (al/is/un) inject `mraid.js`; the build strips `type="module"` /
`crossorigin` and neutralizes `console.error`. All variants are well under 5 MB
(~3 MB HTML / ~1.7 MB zip).

---

## Layout edit mode (`#edit`)
Every on-screen asset's position / scale / z-index lives in **`src/layout.json`**
— the single source of truth the game reads at boot. To lay assets out visually:

```bash
npm run dev          # then open  http://localhost:5173/#edit
```
- **Tab / Shift+Tab** = cycle-select any asset (reliable even when assets
  overlap) · **tap** = select · **drag** / **arrows** = move (Shift = ×10) ·
  **wheel** = scale · **`[` / `]`** = z-index · **C** = preview the end card.
- **Edits are NOT auto-saved** — they only reposition the live game so you can
  see them. Press **S** when you're done to write `src/layout.json` (the HUD
  shows `● UNSAVED` while dirty, `SAVED ✓` after). Saving goes through a tiny
  Vite dev-server middleware (`POST /api/layout`).
- **Coin placement per column/row**: in edit mode a green marker (`slot0..slot9`)
  sits on each tray cell — drag/cycle to it and place it; coins follow live.
  Saved slots override the computed grid (place the tray first, then the slots,
  since slot overrides are absolute). With no saved slots, coins use the grid.
- Edit mode is **dev-only** (`import.meta.env.DEV` + `#edit`, dynamically
  imported); production builds contain none of it.

---

## Responsive model
The gameplay column is authored in a fixed **1080×1920** design space, fit-scaled
and centered, so its structure is identical at any zoom (`sx`/`sy`/`sd` in
`src/utils/responsive.ts`). The **background (`bg_extended.png`)** and **counter
band (`table.png`)** are the only `extend` layers: they track the gameplay
vertical scale (so portrait matches the mockup exactly) but always cover the full
viewport width — so on landscape / iPad they continue edge-to-edge with **no
letterbox**, only their width grows (`centerX`/`coverScale`).

---

## Project structure
```
src/
  main.ts            boot, resize poll, MRAID gate, lifecycle stubs
  constants.ts       design coords, DEPTH map, store URLs, timings, art dims
  networks.ts        CTA fallback chain, MRAID 3.0, pause/mute lifecycle
  analytics.ts       trackEvent -> SDK
  iteration.ts       2cust | 2clk | full gating
  assets.ts          base64 asset imports + texture-key helpers
  layout.json        SINGLE SOURCE OF TRUTH for every asset (x,y,scale,zIndex,mode)
  layout.ts          typed reader for layout.json
  utils/responsive.ts  sx/sy/sd (fit) + centerX/coverScale (extend)
  edit/              EditMode + layoutClient (dev-only, #edit)
  scenes/            BootScene, GameScene (orchestrator), cta.ts (end card)
  game/              one module per concern (Placeable, Background, CoinTray,
                     Coin/Pool/Board, Merge/DealController, Customer/Queue,
                     SpeechBubble, PatienceBar, Hearts, Buttons, DeliverFlow,
                     HandHint, Vfx, SoundManager)
scripts/             build-all.mjs, convert-assets.mjs, convert-audio.mjs
```
`game/` modules never call the ad SDK; only `GameScene.ts` and `scenes/cta.ts`
do (at the right lifecycle moments).

---

## Known limitations / notes
- **Store URLs are placeholders** in `src/constants.ts` (`STORE_URL`) — the
  assessment PDF's links weren't resolvable here; replace before launch.
- The coin tray is an isometric sprite; coins are placed on an approximated 2×5
  grid (tunable via the `TRAY` insets in `constants.ts` or by moving the tray in
  `#edit`).
- End-card elements are laid out from `layout.json` but are only draggable in
  `#edit` after pressing **`C`** to preview the card.
- TikTok (`tt`) is prepared in `build-all.mjs` but `included: false` (not built
  by default).
