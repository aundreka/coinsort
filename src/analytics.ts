// Analytics facade. Routes to the network SDK when present, else logs.
// Applovin's preview injects `playableSDK` WITHOUT `reportEvent`, so the guard
// checks the method, not just the object (see AGENTS.md pitfall).
export type AnalyticsEvent =
  | 'DISPLAYED'
  | 'CTA_CLICKED'
  | 'ENDCARD_SHOWN'
  | 'CHALLENGE_STARTED'
  | 'CHALLENGE_SOLVED'

export function trackEvent(event: AnalyticsEvent): void {
  const w = window as unknown as Record<string, any>
  try {
    if (typeof w.ALPlayableAnalytics?.trackEvent === 'function') {
      w.ALPlayableAnalytics.trackEvent(event)
      return
    }
  } catch {
    /* ignore SDK errors */
  }
  try {
    if (typeof w.playableSDK?.reportEvent === 'function') {
      w.playableSDK.reportEvent(event)
      return
    }
  } catch {
    /* ignore SDK errors */
  }
  console.log('[Analytics]', event)
}
