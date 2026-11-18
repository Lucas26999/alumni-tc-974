import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'delta',
  component: 'Pane',
  requestId: 'delta',
  props: { title: 'Delta', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('le delta 5h = temps écoulé − utilisé, sur chaque surface', async ($, on) => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  // 5h window, 54 % elapsed → resets in 2.3h; 42 % used → +12,0 %
  const reset5 = new Date(now + 0.46 * 5 * 3600_000).toISOString()
  const resetW = new Date(now + 4 * 24 * 3600_000).toISOString()
  on('command.register', () => ({ value: { command: 'delta' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: now }))
  on('clock.every', () => ({ value: { id: 't' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200000 } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', () => ({ changed: ['rateLimits'] }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: reset5 },
      { kind: 'seven_day', percentUsed: 61, resetsAt: resetW },
    ],
    context: { tokens: 86000, window: 200000 },
    cost: { usd: 4.21 },
    changed: ['rateLimits'],
  } as any)

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^\+12,0 %$/ }))?.text).toBe('+12,0 %')
    expect((await ui.find({ type: 'Text', text: /86k/ }))?.text).toBe('86k/200k')
    expect((await ui.find({ type: 'Text', text: /4\.21/ }))?.text).toBe('$4.21')
    await ui.unmount()
  }
})
