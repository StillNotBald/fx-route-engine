import Decimal from 'decimal.js'
import type { Quote, RateType } from '../core/types.ts'
import { SOURCE_TIMEOUT_MS, type Pair } from '../config.ts'

export type Fetch = typeof fetch

export interface Adapter {
  id: string
  label: string
  rateType: RateType
  cadence: string
  terms: string
  fetch(pairs: Pair[], now: string, f: Fetch): Promise<Quote[]>
}

const UA = { 'user-agent': 'fx-route-engine (open source; read-only)' }

let timeoutMs = SOURCE_TIMEOUT_MS
/** Test hook: shorten the per-call timeout. Pass no argument to restore the configured value. */
export function setSourceTimeoutMs(ms: number = SOURCE_TIMEOUT_MS) { timeoutMs = ms }

async function getJson(f: Fetch, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response
  try {
    res = await f(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    const n = (e as Error)?.name
    if (n === 'TimeoutError' || n === 'AbortError') throw new Error(`${url} timed out after ${timeoutMs / 1000} s`)
    throw e
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

const byBase = (pairs: Pair[]) => {
  const m = new Map<string, string[]>()
  for (const [b, q] of pairs) m.set(b, [...(m.get(b) ?? []), q])
  return m
}

const dec = (x: number | string) => new Decimal(x).toSignificantDigits(12).toString()

/** Frankfurter v2 — blended central-bank / official daily rates (MIT, no key). */
export const frankfurter: Adapter = {
  id: 'frankfurter',
  label: 'Frankfurter (central banks, blended)',
  rateType: 'central_bank_ref',
  cadence: 'daily',
  terms: 'Free, no key; blended rates free for commercial use (frankfurter.dev).',
  async fetch(pairs, now, f) {
    const out: Quote[] = []
    for (const [base, quotes] of byBase(pairs)) {
      const rows = (await getJson(f, `https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quotes.join(',')}`)) as
        { date: string; base: string; quote: string; rate: number }[]
      for (const r of rows)
        out.push({ sourceId: this.id, base: r.base, quote: r.quote, rate: dec(r.rate), rateType: this.rateType,
          sourceTs: `${r.date}T00:00:00Z`, fetchedAt: now, enteredBy: 'cron', evidence: 'api.frankfurter.dev/v2/rates' })
    }
    return out
  },
}

/** fawazahmed0 exchange-api — daily aggregated mids on a CDN (CC0, no key). Two mirrors. */
export const fawazahmed0: Adapter = {
  id: 'fawazahmed0',
  label: 'fawazahmed0 currency-api (CDN)',
  rateType: 'aggregator_mid',
  cadence: 'daily',
  terms: 'CC0, no key, no SLA; votes in the consensus median',
  async fetch(pairs, now, f) {
    const out: Quote[] = []
    for (const [base, quotes] of byBase(pairs)) {
      const b = base.toLowerCase()
      let j: Record<string, unknown>
      try {
        j = (await getJson(f, `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${b}.json`)) as Record<string, unknown>
      } catch {
        j = (await getJson(f, `https://latest.currency-api.pages.dev/v1/currencies/${b}.json`)) as Record<string, unknown>
      }
      const rates = j[b] as Record<string, number>
      for (const q of quotes) {
        const r = rates[q.toLowerCase()]
        if (r) out.push({ sourceId: this.id, base, quote: q, rate: dec(r), rateType: this.rateType,
          sourceTs: `${j.date as string}T00:00:00Z`, fetchedAt: now, enteredBy: 'cron', evidence: 'currency-api (jsDelivr)' })
      }
    }
    return out
  },
}

/** Bank Negara Malaysia — MYR per unit; non-MYR pairs are crosses via MYR (flagged). */
export const bnm: Adapter = {
  id: 'bnm',
  label: 'Bank Negara Malaysia (open API)',
  rateType: 'central_bank_ref',
  cadence: 'sessions 0900/1130/1200/1700 MYT',
  terms: 'BNM open API, no key.',
  async fetch(pairs, now, f) {
    const j = (await getJson(f, 'https://api.bnm.gov.my/public/exchange-rate', { accept: 'application/vnd.BNM.API.v1+json' })) as {
      data: { currency_code: string; unit: number; rate: { date: string; buying_rate: number | null; selling_rate: number | null; middle_rate: number | null } }[]
      meta: { session: string; last_updated: string }
    }
    // MYR per 1 unit of currency
    const myrPer = new Map<string, Decimal>([['MYR', new Decimal(1)]])
    for (const r of j.data) {
      const { middle_rate: m, buying_rate: b, selling_rate: s } = r.rate
      const mid = m ?? (b !== null && s !== null ? (b + s) / 2 : null)
      if (mid) myrPer.set(r.currency_code, new Decimal(mid).div(r.unit))
    }
    const ts = `${j.meta.last_updated.replace(' ', 'T')}+08:00`
    const sourceTs = new Date(ts).toISOString()
    const out: Quote[] = []
    for (const [base, quote] of pairs) {
      const b = myrPer.get(base), q = myrPer.get(quote)
      if (!b || !q) continue
      const cross = base !== 'MYR' && quote !== 'MYR'
      out.push({ sourceId: this.id, base, quote, rate: b.div(q).toSignificantDigits(12).toString(), rateType: this.rateType,
        sourceTs, fetchedAt: now, enteredBy: 'cron', evidence: `BNM session ${j.meta.session}${cross ? ', cross via MYR' : ''}` })
    }
    return out
  },
}

export const ADAPTERS: Adapter[] = [frankfurter, fawazahmed0, bnm]
