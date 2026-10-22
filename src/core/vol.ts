import Decimal from 'decimal.js'
import type { Dec } from './types.ts'

/** Fallback when there is not enough history. SGD/THB measured 3.0% annualised (Frankfurter daily rates, Apr-Oct 2026). */
export const ASSUMED_ANNUAL_VOL = 0.03

export interface DailyVol {
  /** 1-sigma daily move as a fraction (0.0038 = 38 bps) */
  daily: number
  basis: 'history' | 'assumed'
  observations: number
}

/**
 * Daily volatility from a series of daily mids (oldest first), as the sample
 * standard deviation of log returns. Needs >= 10 days, else the assumption.
 */
export function dailyVol(mids: Dec[], minObs = 10): DailyVol {
  const xs = mids.map(Number).filter((x) => x > 0)
  const rets: number[] = []
  for (let i = 1; i < xs.length; i++) rets.push(Math.log(xs[i] / xs[i - 1]))
  if (rets.length < minObs) {
    return { daily: ASSUMED_ANNUAL_VOL / Math.sqrt(252), basis: 'assumed', observations: rets.length }
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
  return { daily: Math.sqrt(variance), basis: 'history', observations: rets.length }
}

/** 1-sigma band, in target units, on an amount converted `days` later. */
export function transitBand(netReceived: Dec, days: number, vol: DailyVol): Dec {
  if (days <= 0) return '0'
  return new Decimal(netReceived).times(vol.daily).times(Math.sqrt(days)).toFixed(0)
}
