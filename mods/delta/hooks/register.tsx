import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Snap, Win } from '../types'

const PANE = 'delta'
const H5 = 5 * 3600_000
const WEEK = 7 * 24 * 3600_000
const GREEN = '#4cc764'
const RED = '#ef5350'
const YELLOW = '#f2c335'
const BLUE = '#5b9cf5'

const snap = atom({ plugin: 'delta', key: 'snap' } as const, null, { shape: 'snap-1' })

const pick = (list: SessionRateLimit[], kind: string): Win | null => {
  const r = list.find(l => l.kind === kind)
  return r ? { used: r.percentUsed, resetsAt: r.resetsAt } : null
}

// Share of the window already elapsed, 0..100.
const elapsed = (w: Win | null, len: number, now: number): number | null => {
  if (!w?.resetsAt) return null
  const left = Date.parse(w.resetsAt) - now
  if (Number.isNaN(left)) return null
  return Math.min(100, Math.max(0, 100 - (left / len) * 100))
}

// Positive = en avance (tu as consommé moins que le temps écoulé).
const delta = (w: Win | null, len: number, now: number): number | null => {
  const t = elapsed(w, len, now)
  return t === null || !w ? null : t - w.used
}

const fr = (n: number, d = 1) => n.toFixed(d).replace('.', ',')
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fr(Math.abs(n))} %`
const signedShort = (n: number) => `${n >= 0 ? '+' : '−'}${fr(Math.abs(n))}%`
const tone = (n: number | null) => (n === null ? undefined : n >= 0 ? GREEN : RED)

const left = (w: Win | null, now: number): string => {
  if (!w?.resetsAt) return ''
  const ms = Date.parse(w.resetsAt) - now
  if (!(ms > 0)) return '0m'
  const h = ms / 3600_000
  if (h >= 24) return `${Math.round(h / 24)}j`
  if (h >= 1) return `${Math.round(h)}h`
  return `${Math.max(1, Math.round(ms / 60_000))}m`
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

const toSnap = (u: Pick<SessionUsage, 'rateLimits' | 'context' | 'cost'>, now: number): Snap => ({
  now,
  five: pick(u.rateLimits, 'five_hour'),
  week: pick(u.rateLimits, 'seven_day'),
  usd: u.cost?.usd ?? null,
  ctxTokens: u.context.tokens ?? null,
  ctxWindow: u.context.window,
})

function asText(s: Snap | null): string {
  if (!s || (!s.five && !s.week)) {
    return "Delta : en attente d'une réponse de Claude (limites 5h / semaine visibles avec un abonnement)."
  }
  const now = s.now
  const d5 = delta(s.five, H5, now)
  const t5 = elapsed(s.five, H5, now)
  const dW = delta(s.week, WEEK, now)
  const bar = (used: number, time: number | null) => {
    const cells = 20
    const u = Math.round((Math.min(100, used) / 100) * cells)
    const t = time === null ? -1 : Math.min(cells - 1, Math.round((time / 100) * cells))
    return Array.from({ length: cells }, (_, i) => (i === t ? '│' : i < u ? '█' : '░')).join('')
  }
  const lines: string[] = []
  if (d5 !== null) lines.push(`${d5 >= 0 ? '🟢' : '🔴'} ${signed(d5)} ${d5 >= 0 ? 'en avance' : 'en retard'}`)
  if (s.five) {
    lines.push(`5h   ${bar(s.five.used, t5)} utilisé ${Math.round(s.five.used)} %${t5 === null ? '' : ` · temps ${Math.round(t5)} %`} · reset ${left(s.five, now)}`)
  }
  if (s.week) {
    lines.push(`Week ${bar(s.week.used, elapsed(s.week, WEEK, now))} ${Math.round(s.week.used)} %${dW === null ? '' : ` ${signedShort(dW)}`} · reset ${left(s.week, now)}`)
  }
  const extra: string[] = []
  if (s.usd !== null) extra.push(`S $${s.usd.toFixed(2)} (estimation)`)
  if (s.ctxTokens !== null) extra.push(`contexte ${k(s.ctxTokens)}/${k(s.ctxWindow)}`)
  if (extra.length) lines.push(extra.join(' · '))
  return lines.join('\n')
}

type Measured = Pick<SessionUsage, 'rateLimits' | 'context' | 'cost'>

async function refresh($: Engine, u?: Measured): Promise<void> {
  const usage = u ?? (await $.session.usage())
  const now = await $.clock.now()
  const fresh = toSnap(usage, now)
  // Keep the last reading of a window the latest measure has no figure for.
  const s = await update($, snap, prev => ({
    ...fresh,
    five: fresh.five ?? prev?.five ?? null,
    week: fresh.week ?? prev?.week ?? null,
    usd: fresh.usd ?? prev?.usd ?? null,
    ctxTokens: fresh.ctxTokens ?? prev?.ctxTokens ?? null,
  }))
  const d = s ? delta(s.five, H5, now) : null
  $.ui.status(d === null ? undefined : `Δ5h ${signedShort(d)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'delta', description: 'Ouvre le panneau Delta (5h, semaine, coût, contexte)' })
    void $.ui.open({ id: PANE, title: 'Delta' })
    await refresh($)
    $.clock.every(30_000, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'delta' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Delta' })
    await refresh($)
    if (opened.isPlaced) return { text: 'Panneau Delta ouvert.' }
    // No surface draws panes here: answer with the same figures as text.
    return { text: asText(await read($, snap)) }
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const isTerm = e.surface === 'terminal'
    const s = await read($, snap)

    if (!s || (!s.five && !s.week)) {
      return (
        <Box flexDirection="column" padding="sm">
          <Text dimColor>En attente d'une première réponse de Claude…</Text>
          <Text dimColor>Les limites 5h / semaine s'affichent avec un abonnement.</Text>
        </Box>
      )
    }

    const now = s.now
    const d5 = delta(s.five, H5, now)
    const t5 = elapsed(s.five, H5, now)
    const dW = delta(s.week, WEEK, now)
    const used5 = s.five?.used ?? 0
    const usedW = s.week?.used ?? 0

    // A bar: filled to `used`, with a marker at `time`.
    const bar = (used: number, time: number | null, color: string, cells: number) => {
      if (isTerm) {
        const u = Math.round((used / 100) * cells)
        const t = time === null ? -1 : Math.min(cells - 1, Math.round((time / 100) * cells))
        const chars = Array.from({ length: cells }, (_, i) => (i === t ? '┃' : i < u ? '━' : '─'))
        return (
          <Text>
            <Text color={color}>{chars.slice(0, u).join('')}</Text>
            <Text dimColor>{chars.slice(u).join('')}</Text>
          </Text>
        )
      }
      const lo = Math.min(used, time ?? used)
      const hi = Math.max(used, time ?? used)
      return (
        <Box flexDirection="row" width="100%" height={1} backgroundColor="#3a3a3c">
          <Box width={`${lo}%`} height={1} backgroundColor={color} />
          <Box width={`${hi - lo}%`} height={1} backgroundColor={used > (time ?? 0) ? RED : '#2f6b3a'} />
          {time !== null && <Box width={1} height={1} backgroundColor="#ffffff" />}
        </Box>
      )
    }

    const chip = (children: any, key: string) => (
      <Box key={key} flexDirection="row" gap="xs" paddingX="sm" borderStyle="round" borderColor="#3a3a3c" backgroundColor={isTerm ? undefined : '#2c2c2e'}>
        {children}
      </Box>
    )

    return (
      <Box flexDirection="column" gap="sm" padding="sm">
        <Text size="title" weight="bold" bold color={tone(d5)} tabular>
          {d5 === null ? '—' : signed(d5)}
        </Text>

        <Box flexDirection="column" gap="xs" padding="sm" borderStyle="round" borderColor="#3a3a3c" backgroundColor={isTerm ? undefined : '#2c2c2e'}>
          {t5 !== null && (
            <Text dimColor size="footnote">Temps {Math.round(t5)} %</Text>
          )}
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text dimColor>5h</Text>
            <Box flexGrow={1}>{bar(used5, t5, GREEN, 28)}</Box>
          </Box>
          <Text color={used5 > (t5 ?? 100) ? RED : GREEN} size="footnote">Utilisé {Math.round(used5)} %</Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" gap="xs">
          {s.usd !== null && chip(<Box flexDirection="row" gap="xs" alignItems="center"><Text dimColor mono>S</Text><Text mono>${s.usd.toFixed(2)}</Text></Box>, 'cost')}
          {s.five && chip(
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Text dimColor mono>5h</Text>
              {!isTerm && <Box width={6}>{bar(used5, null, GREEN, 6)}</Box>}
              <Text mono>{Math.round(used5)}%</Text>
              {d5 !== null && <Text mono color={tone(d5)} bold>{signedShort(d5)}</Text>}
              <Text mono dimColor>{left(s.five, now)}</Text>
            </Box>, 'five')}
          {s.week && chip(
            <Box flexDirection="row" gap="xs" alignItems="center">
              <Text dimColor mono>Week</Text>
              {!isTerm && <Box width={6}>{bar(usedW, null, YELLOW, 6)}</Box>}
              <Text mono>{Math.round(usedW)}%</Text>
              {dW !== null && <Text mono color={tone(dW)}>{signedShort(dW)}</Text>}
              <Text mono dimColor>{left(s.week, now)}</Text>
            </Box>, 'week')}
          {s.ctxTokens !== null && chip(
            <Text mono color={BLUE}>{k(s.ctxTokens)}/{k(s.ctxWindow)}</Text>, 'ctx')}
        </Box>
        {s.usd !== null && <Text dimColor size="caption">Coût : estimation, pas une facture.</Text>}
      </Box>
    )
  })
}
