import Decimal from 'decimal.js'
import { OUTLIER_REJECT_BPS } from '../config.ts'
import type { Dec } from './types.ts'

export interface MidInput {
  sourceId: string
  rate: Dec
  sourceTs: string
}

export interface Consensus {
  mid: Dec
  n: number
  used: MidInput[]
  rejected: (MidInput & { deviationBps: Dec })[]
  /** max deviation of a used source from the consensus, in bps */
  dispersionBps: Dec
}

function median(xs: Decimal[]): Decimal {
  const s = [...xs].sort((a, b) => a.comparedTo(b))
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : s[m - 1].plus(s[m]).div(2)
}

export function bpsBetween(a: Decimal.Value, ref: Decimal.Value): Decimal {
  return new Decimal(a).minus(ref).div(ref).times(10_000)
}

/**
 * Median of independent mids, rejecting any source further than
 * `maxDeviationBps` from the first-pass median. A single source passes through.
 * Returns null when there is nothing to agree on: no inputs, or every input
 * rejected (e.g. two sources far apart), so no number is shown that nothing confirms.
 */
export function consensusMid(inputs: MidInput[], maxDeviationBps = OUTLIER_REJECT_BPS): Consensus | null {
  if (inputs.length === 0) return null
  const first = median(inputs.map((i) => new Decimal(i.rate)))
  const used: MidInput[] = []
  const rejected: Consensus['rejected'] = []
  for (const i of inputs) {
    const dev = bpsBetween(i.rate, first)
    if (dev.abs().greaterThan(maxDeviationBps)) rejected.push({ ...i, deviationBps: dev.toFixed(2) })
    else used.push(i)
  }
  if (used.length === 0) return null
  const mid = median(used.map((i) => new Decimal(i.rate)))
  const dispersion = used.reduce((m, i) => Decimal.max(m, bpsBetween(i.rate, mid).abs()), new Decimal(0))
  return {
    mid: mid.toSignificantDigits(12).toString(),
    n: used.length,
    used,
    rejected,
    dispersionBps: dispersion.toFixed(2),
  }
}
