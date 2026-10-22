import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareRoutes, normCdf, type EvalContext } from '../src/core/route.ts'
import { consensusMid } from '../src/core/consensus.ts'
import { applyMarkup, checkSanity, markupBps } from '../src/core/markup.ts'
import { dailyVol, ASSUMED_ANNUAL_VOL } from '../src/core/vol.ts'
import { scenario as refScenario } from '../examples/scenario.ts'
import type { Scenario } from '../src/core/types.ts'

const scenarioUnderTest = refScenario
const ctx: EvalContext = {
  mid: '25.80',
  midSource: 'illustrative reference',
  resolveRate: (ref) => ref.fixed ? { rate: ref.fixed, sourceId: 'fixed', rateType: 'fixed', sourceTs: null, estimated: false } : null,
  vol: dailyVol([]),
}

test('reference valuation: whole amount converts, fees valued at the 25.80 reference mid', () => {
  const c = compareRoutes(scenarioUnderTest, { ...ctx, feeValuation: 'reference' })
  const by = Object.fromEntries(c.results.map((r) => [r.routeId, r]))
  assert.deepEqual(c.results.map((r) => r.routeId), ['A', 'B', 'C'])
  assert.equal(by.A.netReceived, '25620000.00')
  assert.equal(by.B.sourceSpent, '1000000.00')
  assert.equal(by.B.feesSource, '30.00')
  assert.equal(by.B.fees, '774.00')
  assert.equal(by.B.netReceived, '25709226.00') // 1,000,000 x 25.71 - 30 x 25.80
  assert.equal(by.B.edgeVsBaseline, '89226.00')
  assert.equal(by.C.edgeVsBaseline, '80000.00')
  assert.equal(c.bestId, 'B')
})

test('leg valuation (default): SHA, fees at the rate of the leg that pays them', () => {
  const c = compareRoutes(scenarioUnderTest, ctx)
  const by = Object.fromEntries(c.results.map((r) => [r.routeId, r]))
  assert.equal(by.A.netReceived, '25620000.00')
  assert.equal(by.A.costBps, '69.77')
  // B, SHA: SGD 20 paid on top, SGD 10 deducted in flight, 999,990 converted at 25.71
  assert.equal(by.B.sourceSpent, '1000020.00')
  assert.equal(by.B.netReceived, '25709742.90')
  assert.equal(by.B.effectiveRate, '25.709229')
  assert.equal(by.B.netPerAmount, '25709228.72')
  assert.equal(by.B.edgeVsBaseline, '89228.72')
  assert.equal(by.B.feesSource, '30.00')
  assert.equal(by.C.edgeVsBaseline, '80000.00')
  assert.equal(c.bestId, 'B')
})

test('route B edge vs one day of transit risk (3% annual vol)', () => {
  const c = compareRoutes(scenarioUnderTest, ctx)
  const b = c.results.find((r) => r.routeId === 'B')!
  assert.equal(b.exposureDays, 1)
  assert.equal(b.transitBand1s, '48587') // 25.71M x 3% / sqrt(252)
  assert.equal(b.edgeWithinNoise, false)
  assert.ok(b.edgeLossProbability! > 0.02 && b.edgeLossProbability! < 0.05)
  // routes converting immediately carry no transit risk
  assert.equal(c.results.find((r) => r.routeId === 'A')!.edgeLossProbability, null)
})

test('normCdf', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7)
  assert.ok(Math.abs(normCdf(-1.96) - 0.025) < 1e-4)
})

test('charge codes: OUR keeps principal intact, BEN deducts everything', () => {
  const mk = (code: 'OUR' | 'SHA' | 'BEN'): Scenario => ({
    id: code, title: code, amount: '1000', from: 'SGD', to: 'THB',
    routes: [{
      id: code, label: code,
      legs: [
        { kind: 'transfer', label: 'tt', currency: 'SGD', chargeCode: code, transitDays: 0,
          senderFees: [{ label: 'out', amount: '20', currency: 'SGD' }],
          deductedFees: [{ label: 'mid', amount: '10', currency: 'SGD' }] },
        { kind: 'convert', label: 'cv', provider: 'x', from: 'SGD', to: 'THB', rate: { fixed: '26' }, fees: [] },
      ],
    }],
  })
  const run = (code: 'OUR' | 'SHA' | 'BEN') => compareRoutes(mk(code), { ...ctx, mid: '26' }).results[0]
  assert.deepEqual([run('OUR').sourceSpent, run('OUR').netReceived], ['1030.00', '26000.00'])
  assert.deepEqual([run('SHA').sourceSpent, run('SHA').netReceived], ['1020.00', '25740.00'])
  assert.deepEqual([run('BEN').sourceSpent, run('BEN').netReceived], ['1000.00', '25220.00'])
  // all three cost exactly SGD 30 x 26 = 780 THB vs mid
  for (const c of ['OUR', 'SHA', 'BEN'] as const) assert.equal(run(c).totalCost, '780.00')
})

test('percent fee and fee in target currency', () => {
  const sc: Scenario = {
    id: 'p', title: 'p', amount: '1000', from: 'SGD', to: 'THB',
    routes: [{ id: 'p', label: 'p', legs: [{ kind: 'convert', label: 'cv', provider: 'x', from: 'SGD', to: 'THB', rate: { fixed: '26' },
      fees: [{ label: '0.5%', amount: '0.5', currency: 'SGD', kind: 'percent' }, { label: 'lifting', amount: '100', currency: 'THB' }] }] }],
  }
  const r = compareRoutes(sc, { ...ctx, mid: '26' }).results[0]
  assert.equal(r.netReceived, '25770.00') // (1000-5)*26 - 100
  assert.equal(r.fxMargin, '0.00')
  assert.equal(r.fees, '230.00')
})

test('route errors are reported, not thrown', () => {
  const sc: Scenario = { ...scenarioUnderTest, routes: [{ id: 'X', label: 'X', legs: [{ kind: 'convert', label: 'cv', provider: 'x', from: 'SGD', to: 'THB', rate: { sourceId: 'missing' }, fees: [] }] }] }
  const c = compareRoutes(sc, ctx)
  assert.equal(c.results[0].ok, false)
  assert.match(c.warnings[0], /no rate available/)
})

test('consensus: median, outlier rejected, dispersion', () => {
  const c = consensusMid([
    { sourceId: 'frankfurter', rate: '26.303', sourceTs: 't' },
    { sourceId: 'fawaz', rate: '26.2967', sourceTs: 't' },
    { sourceId: 'aggregator3', rate: '26.3099', sourceTs: 't' },
    { sourceId: 'broken', rate: '2.6303', sourceTs: 't' },
  ])!
  assert.equal(c.n, 3)
  assert.equal(c.mid, '26.303')
  assert.equal(c.rejected[0].sourceId, 'broken')
  assert.equal(c.dispersionBps, '2.62')
  assert.equal(consensusMid([]), null)
})

test('Markup model: markup survives, rate is re-applied to live mid', () => {
  const m = markupBps('26.0938', '26.3099') // provider rate at capture
  assert.equal(m, '82.1364')
  assert.equal(applyMarkup('26.40', m), '26.183159904')
})

test('sanity band catches unit errors in keyed rates', () => {
  assert.equal(checkSanity('26.10', '26.30').ok, true)
  const per100 = checkSanity('3.80', '26.30') // keyed SGD per 100 THB
  assert.equal(per100.ok, false)
  const inverted = checkSanity('27.5', '26.30')
  assert.equal(inverted.ok, false)
  assert.match((inverted as { reason: string }).reason, /BETTER than mid/)
})

test('daily vol: history vs assumption', () => {
  assert.equal(dailyVol(['1', '1.01']).basis, 'assumed')
  assert.equal(dailyVol([]).daily, ASSUMED_ANNUAL_VOL / Math.sqrt(252))
  const series = Array.from({ length: 30 }, (_, i) => String(26 + (i % 2 ? 0.1 : -0.1)))
  const v = dailyVol(series)
  assert.equal(v.basis, 'history')
  assert.ok(v.daily > 0.007 && v.daily < 0.008)
})
