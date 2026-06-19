import { allEntries } from '../layout'
import { coinStack } from '../coinstack'

// Persists the live layout to src/layout.json via the Vite dev middleware
// (POST /api/layout). Manual: only called when the user presses Save in
// EditMode — no live auto-save. No-op outside dev.
export async function saveLayout(): Promise<boolean> {
  if (!import.meta.env.DEV) return false
  try {
    const res = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allEntries(), null, 2),
    })
    if (!res.ok) console.warn('[layout save]', res.status, await res.text())
    return res.ok
  } catch (e) {
    console.warn('[layout save failed]', e)
    return false
  }
}

// Persists the live coin-stack tuning to src/coinstack.json (POST /api/coinstack).
// Same manual-save model as saveLayout(). No-op outside dev.
export async function saveCoinStack(): Promise<boolean> {
  if (!import.meta.env.DEV) return false
  try {
    const res = await fetch('/api/coinstack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coinStack(), null, 2),
    })
    if (!res.ok) console.warn('[coinstack save]', res.status, await res.text())
    return res.ok
  } catch (e) {
    console.warn('[coinstack save failed]', e)
    return false
  }
}
