// A/B iteration config. VITE_ITERATION is baked at build time (see
// vite.config.ts / build-all.mjs) and selects when the end card appears:
//   2cust -> after 2 customers have been served
//   2clk  -> after 2 MERGE interactions
//   full  -> after the whole scripted customer sequence is served
export type IterationMode = 'customers' | 'clicks' | 'complete'

export interface IterationConfig {
  length: string
  mode: IterationMode
  limit: number | null
}

const RAW = (import.meta.env.VITE_ITERATION as string | undefined) || 'full'

const MAP: Record<string, IterationConfig> = {
  '2cust': { length: '2cust', mode: 'customers', limit: 2 },
  '2clk': { length: '2clk', mode: 'clicks', limit: 2 },
  full: { length: 'full', mode: 'complete', limit: null },
}

export const ITERATION: IterationConfig = MAP[RAW] ?? MAP.full
