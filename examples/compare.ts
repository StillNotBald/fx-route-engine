// Run: node examples/compare.ts
import { compareRoutes, type EvalContext } from '../src/core/route.ts'
import { dailyVol } from '../src/core/vol.ts'
import { referenceMid, scenario } from './scenario.ts'

const ctx: EvalContext = {
  mid: referenceMid,
  midSource: 'illustrative reference',
  // every rate in this example is fixed; a real caller would look up stored quotes here
  resolveRate: (ref) => ref.fixed ? { rate: ref.fixed, sourceId: 'illustrative', rateType: 'fixed', sourceTs: null, estimated: false } : null,
  vol: dailyVol([]), // no history supplied: falls back to the assumed 3% annual volatility
}

const c = compareRoutes(scenario, ctx)
console.log(`${c.title}\nreference mid ${c.mid} (${c.midSource}), daily vol ${(c.vol.daily * 1e4).toFixed(1)} bps (${c.vol.basis})\n`)
for (const r of c.results) {
  console.log(`${r.label}`)
  console.log(`  spent ${c.from} ${r.sourceSpent} | net ${c.to} ${r.netReceived} | effective ${r.effectiveRate}`)
  console.log(`  cost vs mid ${r.costBps} bps | edge vs A ${r.edgeVsBaseline} ${c.to} | transit days ${r.exposureDays} | 1-sigma band ${r.transitBand1s}`)
  if (r.edgeLossProbability !== null) console.log(`  chance a transit move erases the edge: ${(r.edgeLossProbability * 100).toFixed(1)}%`)
}
console.log(`\nBest on net received: ${c.bestId}`)
for (const w of c.warnings) console.log(`warning: ${w}`)
console.log('\nDemo and educational use only. Not financial advice.')
