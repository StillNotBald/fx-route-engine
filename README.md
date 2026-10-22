# fx-route-engine

A small, tested TypeScript engine for comparing the all-in cost of converting a large amount of money across different routes.

> **Demo and educational use only. Not financial advice. No affiliation with any bank or provider. Rates may be stale.**
> Nothing here is an offer to convert or transfer money, and the engine never moves money. Bank and provider names, where they appear in your own data, belong to their owners.

## What it does

- **Consensus mid** from several independent free sources: the median of the sources that agree, with outliers (default more than 50 bps from the first-pass median) rejected and shown, not hidden.
- **Wise-style markup model**: a provider's rate goes stale faster than its markup. Store each customer rate as a markup in bps against the mid at capture, then re-apply that markup to a fresher mid.
- **Route modelling**: a route is a list of legs (transfers and conversions). The engine walks the legs and tracks the balance, so "convert here" and "send first, convert there" are compared on the same footing.
- **SWIFT charge codes OUR / SHA / BEN**: decides which transfer fees are paid on top and which are deducted from the money in flight. Each fee is valued at the rate of the leg where it is paid (an alternative "reference" valuation is available).
- **Transit-risk probability**: money in flight unconverted is exposed to the rate. The engine turns daily volatility into a one-sigma band and the chance that a normal move wipes out a route's advantage.
- **Decimal arithmetic** (decimal.js). Rates cross every boundary as strings, never as floats.

Provider quotes (bank board rates, dealer quotes, comparison-site quotes) are **supplied by you**. This repository ships no scrapers for banks or comparison sites and no cached rate data. You type in, or load from a source you are entitled to use, the rates you were actually quoted.

## Quick start

Requires Node 22.6+ (it runs the TypeScript directly; tested on Node 24).

```sh
npm install
npm test
npm run example
```

The example compares SGD 1,000,000 to THB three ways, using generic names and made-up rates:

- A. convert in Singapore ("Your SG entity")
- B. telegraphic transfer to "Your Thai entity", then convert there
- C. convert in Thailand from funds already held there

```ts
import { compareRoutes } from './src/core/route.ts'
import { dailyVol } from './src/core/vol.ts'
import { scenario, referenceMid } from './examples/scenario.ts'

const comparison = compareRoutes(scenario, {
  mid: referenceMid,
  midSource: 'your source',
  resolveRate: (ref) => ref.fixed ? { rate: ref.fixed, sourceId: 'fixed', rateType: 'fixed', sourceTs: null, estimated: false } : null,
  vol: dailyVol([]), // pass daily mids (oldest first) for a measured volatility
})
```

To fetch a live consensus mid from the free sources:

```ts
import { ADAPTERS } from './src/adapters/index.ts'
import { consensusMid } from './src/core/consensus.ts'

const now = new Date().toISOString()
const quotes = (await Promise.all(ADAPTERS.map((a) => a.fetch([['SGD', 'THB']], now, fetch)))).flat()
const mid = consensusMid(quotes.map((q) => ({ sourceId: q.sourceId, rate: q.rate, sourceTs: q.sourceTs })))
```

## Layout

```
src/core/       consensus mid, markup model, route evaluation, volatility and transit band
src/adapters/   Frankfurter, fawazahmed0 currency-api, Bank Negara Malaysia (read-only, no keys)
examples/       the three-route SGD to THB comparison
test/           node --test suites for all of the above
docs/METHODOLOGY.md   formulas, sources, assumptions, limitations
```

## Method in brief

1. Collect mids from independent sources; reject outliers; take the median (the consensus mid).
2. Express each customer rate as `markup_bps = (mid - rate) / mid x 10,000`; re-apply to a fresher mid with `rate = live_mid x (1 - markup_bps / 10,000)`.
3. Walk each route's legs: pay on-top fees, deduct in-flight fees, convert at the leg's rate.
4. Compare routes on `netPerAmount`, the net received scaled to the same amount spent, so routes that spend slightly different totals compare fairly.
5. Report cost versus mid in bps, edge versus the baseline route, and the probability a transit move erases the edge.

Full formulas and worked numbers are in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Data sources

| Source | Used for | Terms |
|---|---|---|
| [Frankfurter](https://frankfurter.dev) (api.frankfurter.dev) | Blended central-bank and official daily rates | Free, no key; the software is MIT. Rates derive from central bank publications such as the ECB. |
| [fawazahmed0/exchange-api](https://github.com/fawazahmed0/exchange-api) via jsDelivr | Daily aggregated mids | CC0, no key, no SLA |
| [Bank Negara Malaysia open API](https://apikijangportal.bnm.gov.my) | MYR-based official rates (non-MYR pairs are crosses via MYR) | Open API, no key. Read BNM's terms of use before relying on it. |

Each source is subject to its own terms; check them before any production or commercial use. See [NOTICE](NOTICE) for attributions.

## What this is not

- Not a product, a service or a maintained project. It is a reference implementation shared as-is, with no support and no SLA.
- Not advice. Board rates are indicative and a large ticket normally gets a negotiated dealer rate. Compliance and tax treatment of any transfer are for you and your bank to confirm.
- Not an execution tool. It never suggests splitting a transfer to stay under reporting or review thresholds.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Security reports: see [SECURITY.md](SECURITY.md).
