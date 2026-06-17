import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import shared from './vite.shared.js'

// VITE_ITERATION selects which end-card trigger this build bakes in
// (2cust | 2clk | full). build-all.mjs sets it per build via process.env;
// defaults to 'full' for plain `npm run dev` / `npm run build`.
const ITERATION = process.env.VITE_ITERATION || 'full'

// Post-build cleanup on the single inlined HTML:
//  - neutralize Phaser's internal console.error (validators reject it; esbuild
//    `pure` doesn't drop calls inside the bundled dependency under Vite 8).
//    Safe as a text replace — base64 data URIs can't contain "console.error"
//    because '.' isn't in the base64 alphabet.
//  - strip `type="module"` / `crossorigin` (ad networks reject ES modules; also
//    lets the file run from file://).
function cleanOutput(): Plugin {
  return {
    name: 'clean-output',
    closeBundle() {
      const file = resolve(process.cwd(), 'dist/index.html')
      let html: string
      try {
        html = readFileSync(file, 'utf8')
      } catch {
        return
      }
      html = html
        .replace(/console\.error/g, '(()=>{})')
        .replace(/\s+type="module"/g, '')
        .replace(/\s+crossorigin/g, '')
      writeFileSync(file, html)
    },
  }
}

// Dev-only middleware that persists the in-game layout editor's output.
// EditMode (#edit) POSTs the full layout array to /api/layout; this writes it
// straight to src/layout.json (the same file the game imports), so editing
// repositions the real game live via HMR. `apply: 'serve'` keeps it out of
// production builds entirely.
function layoutPersist(): Plugin {
  return {
    name: 'layout-persist',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/layout', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            if (!Array.isArray(parsed)) throw new Error('expected array')
            const file = resolve(server.config.root, 'src/layout.json')
            writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n')
            res.statusCode = 200
            res.end('ok')
          } catch (e) {
            res.statusCode = 400
            res.end('bad json: ' + (e as Error).message)
          }
        })
      })
    },
  }
}

export default defineConfig({
  ...shared,
  plugins: [viteSingleFile(), cleanOutput(), layoutPersist()],
  define: {
    'import.meta.env.VITE_ITERATION': JSON.stringify(ITERATION),
  },
  build: {
    // build-all.mjs writes per-network variants into dist/<length>/ between
    // builds; emptying the dir each build would wipe them. It cleans dist once
    // up front instead.
    emptyOutDir: false,
    // Inline every asset as base64 so the output is a single self-contained HTML.
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    // Older WebViews used by ad containers — keep transpile target conservative.
    target: 'es2018',
    rollupOptions: {
      output: {
        // IIFE single chunk — ad networks reject ES modules.
        format: 'iife',
      },
    },
  },
})
