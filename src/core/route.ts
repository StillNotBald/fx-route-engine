import Decimal from 'decimal.js'
import type { ConvertLeg, Dec, Fee, RateRef, RateType, Route, Scenario } from './types.ts'
import { transitBand, type DailyVol } from './vol.ts'

export interface ResolvedRate {
  rate: Dec
  sourceId: string
  rateType: RateType | 'fixed'
  sourceTs: string | null
  /** true when the rate is an estimate (stored markup on live mid) */
  estimated: boolean
  markupBps?: Dec | null
  ageMinutes?: number | null
  /** board rate older than one business day: still used, marked "re-check with the bank" */
  stale?: boolean
}

export interface EvalContext {
  /** mid for scenario.from -> scenario.to */
  mid: Dec
  midSource: string
  resolveRate: (ref: RateRef, leg: ConvertLeg) => ResolvedRate | null
  vol: DailyVol
  /**
   * How transfer fees are counted. 'leg' (default): paid on top or deducted from the money in flight, so they cost
   * whatever rate that leg converts at. 'reference': the whole amount converts, and each
   * fee is valued at the reference mid and subtracted from what is received.
   */
  feeValuation?: 'leg' | 'reference'
}

export interface Step {
  leg: string
  text: string
  currency: string
  balance: Dec
}

export interface RouteResult {
  routeId: string
  label: string
  ok: boolean
  error?: string
  /** total spent in scenario.from, incl. fees paid on top */
  sourceSpent: Dec
  netReceived: Dec
  /** net received per 1 source unit spent all-in */
  effectiveRate: Dec
  /** net received scaled to exactly `amount` spent all-in — the fair comparison figure */
  netPerAmount: Dec
  midValue: Dec
  totalCost: Dec
  costBps: Dec
  costPct: Dec
  fxMargin: Dec
  fees: Dec
  /** every fee in the source currency, added up (on top, deducted and per-leg) */
  feesSource: Dec
  rates: (ResolvedRate & { leg: string })[]
  exposureDays: number
  transitBand1s: Dec
  steps: Step[]
}

function feeValue(f: Fee, flow: Decimal): Decimal {
  return f.kind === 'percent' ? flow.times(f.amount).div(100) : new Decimal(f.amount)
}

const fmt = (d: Decimal, dp = 2) => d.toFixed(dp)

export function evaluateRoute(route: Route, sc: Scenario, ctx: EvalContext): RouteResult {
  const amount = new Decimal(sc.amount)
  const mid = new Decimal(ctx.mid)
  let cur = sc.from
  let bal = amount
  let spentOnTop = new Decimal(0)
  let fxMargin = new Decimal(0)
  let feesSource = new Decimal(0)
  let feesAtReference = new Decimal(0)
  let pendingTransitDays = 0
  let exposureDays = 0
  const steps: Step[] = []
  const rates: RouteResult['rates'] = []
  const fail = (error: string): RouteResult => ({
    ...empty(route), error,
  })

  for (const leg of route.legs) {
    if (leg.kind === 'transfer') {
      if (leg.currency !== cur) return fail(`${leg.label}: transfers ${leg.currency} but balance is ${cur}`)
      // OUR: every fee paid on top. SHA: sender's own fees on top, the rest deducted. BEN: all deducted.
      const all = [...leg.senderFees, ...leg.deductedFees]
      if (ctx.feeValuation === 'reference') {
        for (const f of all) {
          if (f.currency !== sc.from) return fail(`${leg.label}: fee "${f.label}" in ${f.currency}; the reference method needs fees in ${sc.from}`)
          const v = feeValue(f, bal)
          feesSource = feesSource.plus(v)
          feesAtReference = feesAtReference.plus(v.times(mid))
          steps.push({ leg: leg.label, text: `${f.label}: ${f.currency} ${fmt(v)}, valued at the reference ${ctx.mid} = ${sc.to} ${fmt(v.times(mid))}`, currency: cur, balance: fmt(bal) })
        }
        pendingTransitDays += leg.transitDays
        steps.push({ leg: leg.label, text: `transfer, ${leg.transitDays} business day(s) in flight unconverted`, currency: cur, balance: fmt(bal) })
        continue
      }
      const onTop = leg.chargeCode === 'OUR' ? all : leg.chargeCode === 'SHA' ? leg.senderFees : []
      const deducted = leg.chargeCode === 'OUR' ? [] : leg.chargeCode === 'SHA' ? leg.deductedFees : all
      for (const f of onTop) {
        if (f.currency !== sc.from) return fail(`${leg.label}: fee "${f.label}" in ${f.currency}; fees paid on top must be in ${sc.from}`)
        const v = feeValue(f, bal)
        spentOnTop = spentOnTop.plus(v)
        feesSource = feesSource.plus(v)
        steps.push({ leg: leg.label, text: `pay ${f.label} on top: ${f.currency} ${fmt(v)}`, currency: cur, balance: fmt(bal) })
      }
      for (const f of deducted) {
        if (f.currency !== cur) return fail(`${leg.label}: deducted fee "${f.label}" in ${f.currency}, balance is ${cur}`)
        const v = feeValue(f, bal)
        bal = bal.minus(v)
        feesSource = feesSource.plus(v)
        steps.push({ leg: leg.label, text: `deducted ${f.label}: ${f.currency} ${fmt(v)}`, currency: cur, balance: fmt(bal) })
      }
      pendingTransitDays += leg.transitDays
      steps.push({ leg: leg.label, text: `${leg.chargeCode} transfer, ${leg.transitDays} business day(s) in flight unconverted`, currency: cur, balance: fmt(bal) })
    } else {
      if (leg.from !== cur) return fail(`${leg.label}: converts ${leg.from} but balance is ${cur}`)
      const r = ctx.resolveRate(leg.rate, leg)
      if (!r) return fail(`${leg.label}: no rate available for ${leg.rate.sourceId ?? 'fixed'}`)
      rates.push({ ...r, leg: leg.label })
      for (const f of leg.fees.filter((f) => f.currency === leg.from)) {
        const v = feeValue(f, bal)
        bal = bal.minus(v)
        if (f.currency === sc.from) feesSource = feesSource.plus(v)
        steps.push({ leg: leg.label, text: `deducted ${f.label}: ${f.currency} ${fmt(v)}`, currency: cur, balance: fmt(bal) })
      }
      const rate = new Decimal(r.rate)
      if (leg.from === sc.from && leg.to === sc.to) fxMargin = fxMargin.plus(bal.times(mid.minus(rate)))
      bal = bal.times(rate)
      cur = leg.to
      steps.push({ leg: leg.label, text: `convert at ${r.rate} (${r.sourceId}${r.estimated ? ', estimated on live mid' : ''})`, currency: cur, balance: fmt(bal) })
      for (const f of leg.fees.filter((f) => f.currency === leg.to)) {
        const v = feeValue(f, bal)
        bal = bal.minus(v)
        steps.push({ leg: leg.label, text: `deducted ${f.label}: ${f.currency} ${fmt(v)}`, currency: cur, balance: fmt(bal) })
      }
      for (const f of leg.fees.filter((f) => f.currency !== leg.from && f.currency !== leg.to)) {
        return fail(`${leg.label}: fee "${f.label}" in ${f.currency} not supported`)
      }
      exposureDays += pendingTransitDays
      pendingTransitDays = 0
    }
  }
  if (cur !== sc.to) return fail(`route ends in ${cur}, expected ${sc.to}`)
  if (feesAtReference.greaterThan(0)) {
    bal = bal.minus(feesAtReference)
    steps.push({ leg: 'fees', text: `less fees valued at the reference: ${sc.to} ${fmt(feesAtReference)}`, currency: cur, balance: fmt(bal) })
  }

  const sourceSpent = amount.plus(spentOnTop)
  const midValue = sourceSpent.times(mid)
  const totalCost = midValue.minus(bal)
  const effectiveRate = bal.div(sourceSpent)
  return {
    routeId: route.id,
    label: route.label,
    ok: true,
    sourceSpent: fmt(sourceSpent),
    netReceived: fmt(bal),
    effectiveRate: effectiveRate.toFixed(6),
    netPerAmount: fmt(effectiveRate.times(amount)),
    midValue: fmt(midValue),
    totalCost: fmt(totalCost),
    costBps: totalCost.div(midValue).times(10_000).toFixed(2),
    costPct: totalCost.div(midValue).times(100).toFixed(4),
    fxMargin: fmt(fxMargin),
    fees: fmt(totalCost.minus(fxMargin)),
    feesSource: fmt(feesSource),
    rates,
    exposureDays,
    transitBand1s: transitBand(bal.toString(), exposureDays, ctx.vol),
    steps,
  }
}

function empty(route: Route): RouteResult {
  return {
    routeId: route.id, label: route.label, ok: false,
    sourceSpent: '0', netReceived: '0', effectiveRate: '0', netPerAmount: '0', midValue: '0',
    totalCost: '0', costBps: '0', costPct: '0', fxMargin: '0', fees: '0', feesSource: '0',
    rates: [], exposureDays: 0, transitBand1s: '0', steps: [],
  }
}

export interface Comparison {
  scenarioId: string
  title: string
  amount: Dec
  from: string
  to: string
  mid: Dec
  midSource: string
  vol: DailyVol
  baselineId: string
  bestId: string | null
  results: (RouteResult & {
    edgeVsBaseline: Dec
    edgeVsBaselineBps: Dec
    /** |edge| smaller than the 1-sigma transit band: a normal day's move can flip it */
    edgeWithinNoise: boolean
    /** chance an adverse move during transit exceeds a positive edge (normal approx.); null when no exposure or no edge */
    edgeLossProbability: number | null
  })[]
  warnings: string[]
}

export function compareRoutes(sc: Scenario, ctx: EvalContext): Comparison {
  const raw = sc.routes.map((r) => evaluateRoute(r, sc, ctx))
  const base = raw[0]
  const amount = new Decimal(sc.amount)
  const results = raw.map((r) => {
    const edge = r.ok && base.ok ? new Decimal(r.netPerAmount).minus(base.netPerAmount) : new Decimal(0)
    const band = Decimal.max(new Decimal(r.transitBand1s), new Decimal(base.transitBand1s))
    return {
      ...r,
      edgeVsBaseline: edge.toFixed(2),
      edgeVsBaselineBps: base.ok ? edge.div(amount.times(ctx.mid)).times(10_000).toFixed(2) : '0',
      edgeWithinNoise: band.greaterThan(0) && edge.abs().lessThan(band),
      edgeLossProbability: band.greaterThan(0) && edge.greaterThan(0) ? normCdf(-edge.div(band).toNumber()) : null,
    }
  })
  const ok = results.filter((r) => r.ok)
  const best = ok.length ? ok.reduce((a, b) => (new Decimal(b.netPerAmount).greaterThan(a.netPerAmount) ? b : a)) : null
  const warnings: string[] = []
  for (const r of results) {
    if (!r.ok) warnings.push(`${r.label}: ${r.error}`)
    for (const q of r.rates) {
      if (q.rateType === 'board_rate') warnings.push(`${r.label}: ${q.sourceId} is a board rate — a ticket of ${sc.from} ${amount.toFixed(0)} usually gets a tighter dealer rate (RFQ).`)
      if (q.estimated) warnings.push(`${r.label}: ${q.sourceId} is estimated (markup ${q.markupBps} bps captured ${q.ageMinutes ?? '?'} min ago, applied to live mid).`)
    }
    if (r.ok && r.edgeLossProbability !== null && r.edgeLossProbability >= 0.05 && !r.edgeWithinNoise)
      warnings.push(`${r.label}: ${(r.edgeLossProbability * 100).toFixed(0)}% chance a move during ${r.exposureDays} day(s) in transit wipes out its edge. Locking the rate on arrival, or converting at once, removes that risk.`)
    if (r.ok && r.edgeWithinNoise) warnings.push(`${r.label}: edge ${r.edgeVsBaseline} ${sc.to} is inside the 1σ transit band ±${Decimal.max(r.transitBand1s, base.transitBand1s).toFixed(0)} — one normal day's move can erase it if the rate is not locked.`)
  }
  if (ctx.vol.basis === 'assumed') warnings.push(`Transit band uses an assumed ${(ctx.vol.daily * 1e4).toFixed(0)} bps daily vol — not enough stored history yet.`)
  return {
    scenarioId: sc.id, title: sc.title, amount: sc.amount, from: sc.from, to: sc.to,
    mid: ctx.mid, midSource: ctx.midSource, vol: ctx.vol,
    baselineId: base.routeId, bestId: best?.routeId ?? null,
    results, warnings: [...new Set(warnings)],
  }
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}
