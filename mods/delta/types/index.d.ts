export type Win = { used: number; resetsAt?: string }
export type Snap = {
  now: number
  five: Win | null
  week: Win | null
  usd: number | null
  ctxTokens: number | null
  ctxWindow: number
}

declare module 'claude-code' {
  interface PluginState {
    delta: { snap: Shaped<Snap | null> }
  }
}
