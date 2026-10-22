import Decimal from 'decimal.js'
import type { Dec } from './types.ts'

/**
 * A Wise-style markup model: a provider's rate goes stale, its markup does not
 * (much). Store markup vs the mid at capture time, re-apply it to the live mid.
 *
 * markupBps > 0 means the customer gets less than mid (the normal case).
 */
export function markupBps(customerRate: Dec, midAtCapture: Dec): Dec {
  return new Decimal(midAtCapture).minus(customerRate).div(midAtCapture).times(10_000).toFixed(4)
}

export function applyMarkup(liveMid: Dec, bps: Dec): Dec {
  return new Decimal(liveMid)
    .times(new Decimal(1).minus(new Decimal(bps).div(10_000)))
    .toSignificantDigits(12)
    .toString()
}

/**
 * Sanity band for keyed rates. A customer rate better than mid by more than
 * `minBps`, or worse by more than `maxBps`, is almost always a unit error
 * (per-100 vs per-1, inverted pair, wrong column).
 */
export function checkSanity(
  customerRate: Dec,
  mid: Dec,
  minBps = -25,
  maxBps = 500,
): { ok: true; markupBps: Dec } | { ok: false; markupBps: Dec; reason: string } {
  const m = markupBps(customerRate, mid)
  const d = new Decimal(m)
  if (d.lessThan(minBps))
    return { ok: false, markupBps: m, reason: `rate is ${d.neg().toFixed(1)} bps BETTER than mid ${mid} — probable unit/column error` }
  if (d.greaterThan(maxBps))
    return { ok: false, markupBps: m, reason: `rate is ${d.toFixed(1)} bps worse than mid ${mid} — probable unit/column error` }
  return { ok: true, markupBps: m }
}
