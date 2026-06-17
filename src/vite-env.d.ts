/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Baked-in iteration selector: '2cust' | '2clk' | 'full'. */
  readonly VITE_ITERATION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.json' {
  const value: unknown
  export default value
}
