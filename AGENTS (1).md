# AGENTS.md — Playable Ads

## Stack
Phaser 3.90 · TypeScript · Vite + vite-plugin-singlefile · WebP · MP3 96kbps
Networks: Applovin (al) · GoogleAds (gg) · Ironsource (is) · Mintegral (mtg) · Facebook (fb) · Unity (un) · Vungle (vu) · Moloco (mo) · TikTok (tt)

## Porting to a new project
1. Update naming fields (3LC, vendor, concept name) in [scripts/build-all.mjs](scripts/build-all.mjs) — drives the output filename
2. Update store URLs in [constants.ts](src/constants.ts) (iOS + Android)
3. Adjust the Depth Map below to match the project's layer needs
4. Update [iteration.ts](src/iteration.ts) A/B config shape for this project's variants
5. Replace `Assets/` with project assets; update asset manifests in [BootScene.ts](src/scenes/BootScene.ts)
6. Rewrite `game/` modules for the new mechanic(s) — keep the single-responsibility split
7. Update this AGENTS.md's Depth Map and any project-specific pitfalls

## Structure
```
src/
  main.ts              # Bootstrap, resize, MRAID gating, lifecycle stubs on window
  constants.ts         # Design coords (1080×1920), store URLs
  networks.ts          # triggerCTA(), initMraid(), bindLifecycle(), notifyGameX()
  analytics.ts         # trackEvent() → SDK
  iteration.ts         # A/B iteration config
  utils/
    responsive.ts      # sx(), sy(), sd() — coordinate helpers
  scenes/
    BootScene.ts       # Critical preload + deferred asset manifest
    GameScene.ts       # Orchestrator only — wires game/ modules, handles lifecycle
    cta.ts             # End-card layout + redirectToStore() → notifyGameClose() + triggerCTA()
  game/                # Single-responsibility modules (no direct ad-SDK calls)
    # …one file per distinct mechanic or UI widget
Assets/
scripts/build-all.mjs  # Single build → per-network HTML variants
```

### Responsibility split
- **`game/`** modules each own a single concern (one mechanic, one widget, one system).
  They receive the Phaser scene as a constructor arg and own their own game objects.
  They never call ad-SDK functions (`triggerCTA`, `notifyGameX`, `trackEvent`).
- **`GameScene.ts`** is the wiring layer: creates modules, passes data between them,
  and calls SDK helpers at the correct lifecycle moments.
- **`scenes/cta.ts`** owns end-card presentation and the store-redirect sequence.

## Rules
- 60 FPS target; never below 30 on mid-range Android
- `dist/index.html` < 5 MB; WebP images, short audio
- No hardcoded px — `sx()`, `sy()`, `sd()` only
- No audio autoplay — unmute on first `pointerdown`
- `for` loops in game logic; pool objects; no GC
- `setDisplaySize(sd())` on images — never `setScale`
- Never dim via `body`/page background

## Phaser Config
```ts
{ type: Phaser.AUTO, transparent: true,
  scale:  { mode: Phaser.Scale.NONE, width: 1080, height: 1920 },
  render: { antialias: true, pixelArt: false } }
```
`Scale.NONE` — manual sizing; CSS = viewport px; internal = viewport × DPR.
`antialias: true` — required to avoid jagged edges on scaled WebP assets (end-card logo, CTA, score pill). Never set to `false`.

## Responsive (1080×1920 ref)
```ts
const s    = Math.min(viewW / 1080, viewH / 1920)
const offX = (viewW - 1080 * s) / 2
const offY = (viewH - 1920 * s) / 2
// sx/sy/sd apply offX, offY, s
```
- `update()` polls `visualViewport` per-frame for rotation
- On change: `game.scale.resize(vw*dpr, vh*dpr)` → `relayout()`
- `bindResponsiveResize()`: rAF debounce + 100/300/600ms retries

## CTA — SDK Priority (triggerCTA fallback chain)
```
1. ExitApi.exit()             → GoogleAds (gg)
2. FbPlayableAd.onCTAClick()  → Facebook (fb) · Moloco (mo)
3. Luna.Unity.Playable        → Unity (un)
4. playableSDK.openAppStore() → (runtime fallback if SDK present)
5. window.install()           → Mintegral (mtg)
6. window.openAppStore()      → (runtime fallback)
7. window.clickTag            → Moloco (mo) fallback
8. window.__VUNGLE__          → Vungle (vu) via parent.postMessage
9. window.__TIKTOK__          → TikTok (tt) → openAppStore() or window.open fallback
10. mraid.open(url)           → Applovin (al) / Ironsource (is) / Unity (un fallback after Luna)
11. window.open(storeUrl)     → Fallback (all others)
```
`notifyGameClose()` fires before every CTA redirect (all networks, no-op when SDK absent).
MRAID CTA calls must be guarded: require `typeof mraid.open === 'function'`; treat missing `mraid.getState()` as `ready`; if state is still `loading`, fall through to `window.open(storeUrl)`.

## Analytics — SDK Priority
```
ALPlayableAnalytics.trackEvent(e)  → Applovin (al)
playableSDK.reportEvent(e)        → (runtime fallback if SDK present)
console.log('[Analytics]', e)      → All other networks
```
Events: `DISPLAYED` · `CTA_CLICKED` · `ENDCARD_SHOWN` · `CHALLENGE_STARTED` · `CHALLENGE_SOLVED`

## Game Lifecycle (all networks)
`main.ts` exposes stubs on `window` so every network's preview tool detects them.
Stubs only set if the SDK hasn't already provided its own (`typeof` guard).
```
gameReady()  → stub in main.ts; Mintegral also gets onload body attr from build
gameStart()  → notifyGameStart() in GameScene.startPlaying()
gameEnd()    → notifyGameEnd()  in GameScene.triggerFail() / triggerWin()
gameClose()  → notifyGameClose() in cta.ts redirectToStore(), before triggerCTA()
```

### Pause / Resume / Mute (bindLifecycle in networks.ts)
| Network | Mechanism |
|---|---|
| Unity | `luna:mute` / `luna:unmute` / `luna:pause` / `luna:resume` events; also shared MRAID exposure/viewability when `mraid.js` is present |
| Mintegral | `window.message` → `onPause` / `onResume` |
| Vungle | `ad-event-pause` / `ad-event-resume` events |
| Applovin / Ironsource / Unity | MRAID 3.0 `exposureChange`, MRAID 2.0 fallback `viewableChange` / `isViewable`, and `audioVolumeChange` (gated in `initMraid`) |
| GoogleAds / Facebook / Moloco | No SDK pause — browser handles visibility |

### MRAID 3.0 Requirements & Best Practices
MRAID networks are **Applovin (`al`)**, **Ironsource (`is`)**, and **Unity (`un`)**. All three must request `<script src="mraid.js"></script>` early in the generated HTML. Unity still uses Luna first for CTA/lifecycle where available, but MRAID must exist as the standards fallback.

Creative requirements from the MRAID 3.0 spec and Best Practices Guide:
- Request `mraid.js` as early as possible, exactly once, either with `<script src="mraid.js"></script>` or DOM insertion. Do not rely on the container to inject it automatically.
- Wait for both DOM readiness and MRAID readiness before starting rich media behavior. Use `document.readyState` / `DOMContentLoaded` or `load` for the DOM side.
- Use `mraid.getState()` together with `mraid.addEventListener('ready', ...)` so the creative still starts when the container fires `ready` before the listener attaches.
- Guard access to `mraid` and MRAID methods with `typeof` checks. Treat missing optional methods as unsupported and fall back gracefully.
- Use `mraid.open(url)` for MRAID clickthroughs. Avoid `<a href>`, `location.href` / `assign` / `replace`, and unguarded `window.open`.
- Include `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">` or an equivalent mobile viewport tag.
- Do not assume nested iframes can access native MRAID. If nested iframe access is required, the outer frame must provide its own bridge.
- Use `exposureChange` as the MRAID 3.0 viewability signal, then degrade to `viewableChange` / `isViewable()` for MRAID 2.0 compatibility.
- Listen for `audioVolumeChange`; `null` is valid and must be ignored. Only apply volume math when the value is numeric.
- Listen for `error`; if the ad cannot run or assets fail, gracefully degrade or call `mraid.unload()` instead of showing a broken/blank ad.
- Call `setResizeProperties()` before `resize()`. Do not use `resize()` for full-screen takeovers; use `expand()` for that case.
- Avoid resizing or expanding interstitials. Check placement with `getPlacementType()` when one creative can serve inline and interstitial placements.
- Avoid `useCustomClose()` and custom close indicators in MRAID 3.0. The host provides the close control.
- Avoid two-part expandable ads (`expand(url)`); use self-contained one-part expandables.
- Call `supports()` before optional/native features such as `storePicture`, `createCalendarEvent`, `getLocation`, VPAID, SMS/tel, or inline video behavior.
- Use `playVideo()` for native video playback cases instead of `mraid.open(videoUrl)`. Use HTML5 `<video>` for inline playback when supported.

Implementation requirements for `networks.ts` / `networks.js`:
- Export `initMraid(timeoutMs = 2000, detectTimeoutMs = 500)` and call it at module load.
- If `window.mraid` is missing at module load, poll briefly (`detectTimeoutMs`, default 500 ms) for late container injection before resolving as no-MRAID.
- If MRAID exists and `mraid.getState() === 'loading'`, wait for `mraid.addEventListener('ready', ...)`; self-resolve after `timeoutMs` (default 2000 ms) so startup never hangs.
- `main` / boot must `await initMraid()` before constructing `new Phaser.Game(...)`.
- On setup, seed cached visibility from `mraid.isViewable()` when available.
- Register MRAID callbacks once, before any Phaser scene is ready:
  - `mraid.addEventListener('error', (message, action) => ...)` — log or gracefully handle failed/unsupported MRAID calls.
  - `mraid.addEventListener('stateChange', state => ...)` — required when using state-changing MRAID behavior such as `close`, `expand`, or `resize`.
  - `mraid.addEventListener('exposureChange', exposedPercentage => ...)` — MRAID 3.0 primary viewability. Pause when `exposedPercentage <= 0`; resume when positive.
  - `mraid.addEventListener('viewableChange', viewable => ...)` — MRAID 2.0 compatibility fallback.
  - `mraid.addEventListener('audioVolumeChange', pct => ...)` — only apply `pct / 100` when `typeof pct === 'number'`.
- In `bindLifecycle(scene)`, apply cached hidden/non-exposed MRAID state immediately once a scene exists.
- If the creative renders its own close control, wire that control to a guarded `mraid.close()` helper and call `notifyGameClose()` before closing.

## Build
Vite outputs IIFE format (`format: 'iife'`, `modulePreload: false`).
Build script strips `type="module"` and `crossorigin` — ad networks reject ES modules.

### Network Tag Comment
Every HTML output file **must begin with** a network identifier comment as its very first line, before `<!DOCTYPE html>`:

```html
<!-- ad-network: Applovin | al -->
<!DOCTYPE html>
...
```

Format: `<!-- ad-network: <Full Network Name> | <tag> -->`

All nine network values:
```
<!-- ad-network: Applovin | al -->
<!-- ad-network: Google | gg -->
<!-- ad-network: Ironsource | is -->
<!-- ad-network: Mintegral | mtg -->
<!-- ad-network: Facebook | fb -->
<!-- ad-network: Unity | un -->
<!-- ad-network: Vungle | vu -->
<!-- ad-network: Moloco | mo -->
<!-- ad-network: TikTok | tt -->
```

In `build-all.mjs`, prepend this comment to the HTML string before writing the file (and before zipping, so the comment is inside the zip's `index.html` too):

```js
const networkComment = `<!-- ad-network: ${network.name} | ${network.tag} -->\n`;
fs.writeFileSync(outPath, networkComment + htmlContent);
```

Parsers must treat `<!-- ad-network:` as the sentinel. Extract the tag (e.g. `al`) by splitting on `|` and trimming the second segment up to ` -->`. The comment must be on line 1 — parsers should not scan the full file.
MRAID networks (`al`, `is`, `un`) inject exactly one `<script src="mraid.js"></script>` request.
If built output contains `console.error` from Phaser or bundled node modules, prefer dropping it at bundle time instead of editing library source. Add this option to the shared Vite config, usually `vite.shared.js`:

```js
export default {
  esbuild: {
    pure: ['console.error'],
  },
};
```

Keep project-authored error handling meaningful: use visible fallback UI, `console.warn`, or guarded debug logging where needed.

| Network | Tag | Injected | Zipped | Included |
|---|---|---|---|---|
| Applovin | al | `mraid.js` | — | ✓ |
| Google | gg | `exitapi.js` | ✓ | ✓ |
| Ironsource | is | `mraid.js` | — | ✓ |
| Mintegral | mtg | `onload="gameReady()"` | ✓ | ✓ |
| Facebook | fb | — | — | ✓ |
| Unity | un | `mraid.js` | — | ✓ |
| Vungle | vu | `window.__VUNGLE__=true` | ✓ | ✓ |
| Moloco | mo | — | — | ✓ |
| TikTok | tt | `window.__TIKTOK__=true` | — | — |


Networks marked **Zipped** ingest zipped creatives — [scripts/build-all.mjs](scripts/build-all.mjs) writes a `.zip` containing the HTML (one zip per variant, containing just that HTML at the root named index.html). Toggled per-network via `zip: true` in the `NETWORKS` array.

Networks marked **Included** are built by default. Networks not marked are prepared for but not built. Toggle per-network via `included: true` in the `NETWORKS` array.

Output is grouped by **iteration length** (e.g. `2words/`, `4words/`, `full/`) then by **network** (e.g. `Applovin/`, `Google/`, `Mintegral/`), with all per-network HTML or ZIP variants for that iteration sitting together inside the folder:

`dist/<length>/<3lc>_<creative-type>_<vendor>_<concept-name>_<concept-num>_<gameplay>_<ugc>_<seasonal>_<lang>_<length>_<size>_<network>`

Example layout:
```
dist/
  2words/
    Applovin/
      ws_mip_grhpl_wbinspiredvar1_01_real_na_noseason_en_2words_na_al.html
    Google/
      ws_mip_grhpl_wbinspiredvar1_01_real_na_noseason_en_2words_na_gg.zip
    Ironsource/
      ws_mip_grhpl_wbinspiredvar1_01_real_na_noseason_en_2words_na_is.html
    …one HTML or ZIP per network…
  4words/
  full/
```

| Field | Description | Example |
|---|---|---|
| 3LC | 3-letter project code | `ws` (Wordscapes), `pp` (PeoplePuzzle) |
| Creative Type | Format identifier | `mip` |
| Vendor | Studio / vendor code | `grhpl` |
| Concept Name | Creative concept (append `var1`, `var2`… for variants) | `wbinspiredvar1`, `wbinspiredvar2`, `burglar` |
| Concept # | Iteration number, zero-padded | `01`, `02`, `03` |
| Gameplay | Gameplay style | `real`, `cartoon` |
| UGC | UGC presence | `na`, `ugc`, `nougc` |
| Seasonal | Seasonal tie-in | `noseason`, `xmas` |
| Language | Locale code | `en` |
| Length | Run length | `2words`, `4words`, `7words`, `full` (Wordscapes); `2clk`, `10clk`, `120sec` (other projects) |
| Size | Region / size code | `na` |
| Network | Network tag (last segment) | `al`, `gg`, `is`, `mtg`, `fb`, `un`, `vu`, `mo`, `tt` |

Examples (this project):
- `ws_mip_grhpl_wbinspiredvar1_01_real_na_noseason_en_2words_na_al.html`  (cta2, default theme)
- `ws_mip_grhpl_wbinspiredvar1_04_real_na_noseason_en_full_na_fb.html`    (full, default theme)
- `ws_mip_grhpl_wbinspiredvar2_01_real_na_noseason_en_2words_na_gg.html`  (cta2, v1 theme)

Naming fields are defined in [scripts/build-all.mjs](scripts/build-all.mjs) — update them when porting.

## Asset Loading
- **Critical** (BootScene): first-frame assets, target < 200 KB
- **Deferred**: audio, overlays, secondary UI — loads during intro
- Gameplay start waits on a deferred-ready flag set when the secondary manifest finishes loading

## Depth Map (adjust per project)
Define depths as named constants in [constants.ts](src/constants.ts) — never use magic numbers in scene code.

| Layer | Depth |
|---|---|
| Background | 0 |
| Game objects | 1–10 |
| Logo | 17 |
| Dim overlay | 20 |
| Fail/win UI | 21 |
| EndCard input | 25 |

## Ship Checklist
- [ ] < 5 MB, all WebP
- [ ] FPS ≥ 55 under CPU throttle
- [ ] Portrait + landscape pass
- [ ] MRAID ready before gameplay
- [ ] Audio muted by default
- [ ] CTA fires in fallback
- [ ] No `console.error`
- [ ] No `type="module"` or `crossorigin` on `<script>` in output HTML
- [ ] Lifecycle: gameReady / gameStart / gameEnd / gameClose detected by all network preview tools

## Pitfalls
| Issue | Fix |
|---|---|
| Rotation stuck | `Scale.NONE` + per-frame poll |
| Mobile aliasing | Canvas = viewport × DPR |
| FPS drop on resize | rAF debounce |
| MRAID crash | `typeof mraid !== 'undefined'` guard |
| Assets not inlined | `assetsInlineLimit: 100_000_000` |
| Bundle > 5 MB | WebP q75, shorter audio |
| Built output contains library `console.error` | If `console.error` comes from Phaser or bundled node modules, add `esbuild: { pure: ['console.error'] }` in `vite.shared.js` so it is dropped at bundle time. Do not edit library source. |
| Audio blocked | Gate on `pointerdown` |
| Letterbox | Avoid `Scale.FIT/EXPAND/CENTER_BOTH` |
| CORS / module error | `format: 'iife'` + strip `type="module"` and `crossorigin` |
| Network preview checklist fail | Expose lifecycle stubs on `window` + call `notifyX()` with `typeof` guards |
| `playableSDK.reportEvent is not a function` | Applovin preview injects `playableSDK` without `reportEvent` — guard with `typeof playableSDK.reportEvent === 'function'`, not just `typeof playableSDK !== 'undefined'` |
| iPhone black screen (Android works) | **Only one `Phaser.Game` per page, ever.** iOS WKWebView — used by Applovin/Ironsource preview apps and most in-app ad containers — caps or outright rejects the 2nd WebGL context. If a background scene is spun up as a separate `new Phaser.Game()` synchronously at module load, it can throw before `await initMraid()` and before the font promise resolves, so the rest of `main.ts` never runs → black screen with no visible error. Render the background as a CSS `background-image` on `#bg-container` (cover-sized) instead — zero WebGL contexts for the background, and nothing to throw at module-load time. iOS-debug path: enable Safari → Advanced → Web Inspector on the iPhone, connect to a Mac, open Develop → iPhone → preview WebView, read the Console. Without a Mac, temporarily install top-of-`main.ts` `window.addEventListener('error',…)` and `unhandledrejection` handlers that write the error into `document.body.innerHTML` so the failure is visible on-screen. |
| iOS hangs on font load | `document.fonts.load()` silently stalls in WKWebView when `@font-face` uses base64 `data:` URLs. Race against a 1.5 s timeout: `Promise.race([Promise.all([…fonts]), new Promise(r=>setTimeout(r,1500))]).then(startGame)` |
| iOS hangs on MRAID ready | `mraid.addEventListener('ready', …)` can miss the event if the container fires it before the listener attaches. `initMraid()` must self-resolve after ~2 s so `startGame()` always runs; also check `mraid.getState() !== 'loading'` first. |
| External `src=` survives build | `vite-plugin-singlefile` only inlines assets *imported from JS*. A raw `<img src="src/assets/…">` in `index.html` ships as a literal relative path and fails in ad sandboxes, producing inconsistent per-device load failures. Leave DOM `<img>` elements with no `src`; assign via JS from `assets.ts` at boot (`setEndcardHtmlAssets()`). |
| Audio keeps playing when ad hides | Add `visibilitychange` listener in the sound module — mute Phaser's sound system and `suspend()` the `AudioContext` when `document.hidden`, resume on return. Spec requires audio stop on hide/close. |
| `mraid.open()` silently no-ops | Guard with `mraid.getState() !== 'loading'` before calling; fall through to `window.open()` if still loading. |
| Previewer black screen with `Cannot read properties of null (reading 'appendChild')` in Phaser boot | Two compounding causes: (1) `vite-plugin-singlefile` hoists the bundled script into `<head>`, and the build strips `type="module"`, so the script runs **synchronously before `<body>` is parsed** — `document.body` is null. Wrap main.ts in a `DOMContentLoaded` gate (`if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot) else boot()`). (2) `parent: 'game'` (string selector) fails when the previewer sandbox strips custom DOM; create `<div id="game">` at runtime inside `boot()` and pass the **element reference** (not the string) to `Phaser.Game({ parent })`. The cascading `ScaleManager.resize → Cannot set properties of undefined (setting 'width')` errors all trace back to `game.canvas` never being created when either of these fail. |
| NineSlice won't shrink in landscape | Phaser's `NineSlice` silently clamps its minimum dimensions to `(leftWidth + rightWidth) × (topHeight + bottomHeight)` **in source pixels**. Symptom: one UI chrome element stays huge in landscape while every other `sd()`-driven element rescales correctly — because the requested `sd(H)` is below the inset total. Shrinking the insets fixes the scale clamp but stretches the art's rounded corners. The right fix: **operate the NineSlice in source-pixel space and scale it uniformly with `setScale(sd(1))`**. Keep `setSize(wSrc, hSrc)` in source px so the center stretches horizontally with text growth while corners stay intact; the `sd(1)` scale is what makes the whole object shrink in landscape, bypassing the min-dim clamp entirely. When reading `this.preview.width` (which is in scaled px) to decide `wSrc`, divide by `sd(1)` to convert back to source space. Tween callers that reset `setScale(1)` also need updating — the bg's base scale is now `sd(1)`, not 1. See [SelectionLine.ts](src/game/SelectionLine.ts) for the pattern. |
| Unity (un) submission: "not allowed to use window.top" | Luna's static scan flags the literal `window.top`, which Phaser 3 ships internally. In `build-all.mjs`, rewrite `window.top` → `window.self` for the `un` HTML only (other networks keep the original). Safe inside the playable's own frame because the iframe-vs-top check collapses to always-top. |
| MRAID network missing `mraid.js` | MRAID 3.0 creatives must request `mraid.js` early. Inject `<script src="mraid.js"></script>` exactly once for Applovin (`al`), Ironsource (`is`), and Unity (`un`), even if the container may also expose runtime MRAID objects. |
| MRAID listener wired too late | Previewers can probe MRAID before any Phaser scene is ready — if listeners are wired only inside `bindLifecycle` / scene `create()`, the creative can miss `ready`, `exposureChange`, or `viewableChange`. Fix: call `initMraid()` at `networks.ts` module-load time, guarded by `getState() === 'loading'` → `addEventListener('ready', setupMraid)` vs immediate call. Cache `_mraidViewable` / `_mraidExposed`; in `bindLifecycle` apply cached hidden/non-exposed state immediately. |
| MRAID 3.0 `exposureChange` not handled | MRAID 3.0 containers dispatch `exposureChange` with `exposedPercentage` directly instead of — or in addition to — `viewableChange`. If only listening to `viewableChange`, the ad may never receive pause signals on newer AL/IS/Unity builds. Register both: `mraid.addEventListener('exposureChange', exposedPercentage => onExposure(exposedPercentage > 0))` and `mraid.addEventListener('viewableChange', onViewable)` inside `initMraid()`. Seed initial state from `mraid.isViewable()` on ready. |
| MRAID 3.0 `audioVolumeChange` not handled | MRAID 3.0 containers fire `audioVolumeChange` with a volume level (0–100) or `null` when unavailable. Without a listener, the ad ignores host-level mute/unmute signals; if `null` is divided by 100, the ad can mute accidentally. Register `mraid.addEventListener('audioVolumeChange', v => { if (typeof v === 'number') scene.sound.setVolume(v / 100) })` in `initMraid()`. |
| MRAID `error` listener missing | Validators expect failed or unsupported MRAID calls to be observable. Register `mraid.addEventListener('error', (message, action) => console.warn('[MRAID error]', { message, action }))` during early MRAID setup. |
| MRAID `stateChange` listener missing | If the creative uses state-changing container behavior such as `mraid.close()`, `expand`, or `resize`, validators expect a `stateChange` listener. Register `mraid.addEventListener('stateChange', state => console.log('[MRAID stateChange]', state))` with the other early MRAID callbacks. |
| Custom close control not wired to MRAID | If the creative renders its own close button, the button must call a guarded close helper: `notifyGameClose()` then `mraid.close()` when `typeof mraid.close === 'function'` and `mraid.getState() !== 'loading'`. Do not use CTA/install buttons as close controls. |
| MRAID init not awaited before Phaser boot | If `new Phaser.Game()` is created before `initMraid()` resolves, the scene may fire `create()` before MRAID state is known — `bindLifecycle` then cannot apply a cached hidden/paused state. Make `boot()` async and `await initMraid()` before constructing the Phaser game. `initMraid()` must self-resolve after a timeout (~2 s) so a missing or non-firing MRAID container never blocks startup. |
| Late MRAID injection not handled | Some containers inject `window.mraid` after the script executes — a synchronous `typeof window.mraid !== 'undefined'` check at module load returns false even though MRAID will be present. After the immediate check fails, poll briefly (~500 ms) before concluding no-MRAID, then proceed. |
| Unsafe optional MRAID API calls | `useCustomClose()` was removed in MRAID 3.0, and APIs such as `expand`, `resize`, `storePicture`, and `createCalendarEvent` are optional/capability-dependent. Do not call them unless the project intentionally supports the feature and guards every call with `typeof mraid.method === 'function'` / `mraid.supports(...)` where relevant. |

## Ironsource — Runtime Analysis
Ironsource requires every `_is.html` build to pass **LevelPlay → Creative Management → Playable Workshop** (Runtime Analysis / Playable Validator) before launch. Skipping this can get the ad disabled. The validator runs in an iOS-like WKWebView sandbox and exposes console errors — use it as a free diagnostic channel for iPhone-only failures when a Mac + Safari remote-debug isn't available.

## Moloco — Upload Checklist & CTA Implementation
Creative specs: HTML5 (`.html` / `.htm`), < 5 MB, portrait + landscape.

Before uploading to Moloco Ads, confirm all three:
- [ ] No `XMLHttpRequest` anywhere in the ad (Moloco rejects it outright)
- [ ] CTA calls `FbPlayableAd.onCTAClick()` with no parameters — Moloco uses this for store redirect (not `window.clickTag`)
- [ ] No JavaScript redirects in ad file assets

### CTA implementation options

**Option 1 — event listener**
```html
<button id="ctaButton">Install</button>
<script>
  document.getElementById('ctaButton').addEventListener('click', function() {
    FbPlayableAd.onCTAClick();
  });
</script>
```

**Option 2 — inline onClick**
```html
<button onclick="FbPlayableAd.onCTAClick()">Install</button>
```

Moloco's validator requires `FbPlayableAd.onCTAClick()` — this is why it shares priority #2 in the CTA chain with Facebook. `window.clickTag` is kept as a fallback at priority #7.

***EOF***
 [05/28/2026]
