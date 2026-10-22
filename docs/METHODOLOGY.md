# Methodology

Demo and educational use only. Not financial, legal or tax advice. Rates are indicative.

Every formula below mirrors the code named in its heading. All worked numbers come from `examples/scenario.ts` (SGD 1,000,000 to THB, reference mid 25.80, illustrative rates: A converts in Singapore at 25.62, B sends a TT then converts at 25.71, C converts in Thailand at 25.70; TT fee SGD 20 paid on top and SGD 10 deducted in flight, SHA, 1 day in transit). The rates are made up.

## 1. Rate types (`src/core/types.ts`)

Every stored rate carries one of six types, so unlike things are never mixed unlabelled:

```
RateType = central_bank_ref | aggregator_mid | provider_quote | board_rate | dealer_rfq | manual
MID_TYPES = { central_bank_ref, aggregator_mid }
```

Only the two mid types feed the consensus mid. A customer rate is always "quote currency received per 1 base sold"; a mid is the plain mid-market rate. Every quote carries a source, a source timestamp (when the rate applies) and a fetched-at timestamp (when it was captured).

## 2. Consensus mid (`src/core/consensus.ts`)

```
first = median(all mids)
dev_i = (rate_i - first) / first x 10,000          (bps)
used  = sources with |dev_i| <= 50 bps
mid   = median(used)
dispersion_bps = max over used of |(rate_i - mid) / mid x 10,000|
```

- The median of an even count is the average of the two middle values; a single source passes through.
- Rejected sources are returned with their deviation in bps, so an outlier is visible rather than silently dropped.
- If every source is rejected (for example two sources far apart) the result is `null`: no number is shown that nothing confirms.
- Callers should leave out mid sources older than a freshness limit (`MID_MAX_AGE_H` in `src/config.ts`).
- The mid is kept to 12 significant digits.

Test case: mids 26.303, 26.2967, 26.3099 and a broken 2.6303 give three used sources, mid 26.303, dispersion 2.62 bps; the broken one is rejected.

## 3. Wise-style markup model (`src/core/markup.ts`)

A provider's rate goes stale; its markup changes little. Store the markup against the mid at capture and re-apply it to a fresher mid:

```
markup_bps    = (mid_at_capture - customer_rate) / mid_at_capture x 10,000
repriced_rate = live_mid x (1 - markup_bps / 10,000)
```

Positive markup means the customer gets less than the mid (the normal case). A repriced rate should be flagged as an estimate, with its age. Test case: a rate of 26.0938 against a mid of 26.3099 is 82.1364 bps; on a live mid of 26.40 it becomes 26.183159904.

Sanity band for rates keyed by hand: a rate better than mid by more than 25 bps, or worse by more than 500 bps, is almost always a unit error (per-100 versus per-1, an inverted pair, the wrong column) and is rejected (`checkSanity`).

Provider quotes are supplied by the user. The repository includes no fetcher for any comparison site or bank.

## 4. Routes and legs (`src/core/route.ts`, `types.ts`)

A route is an ordered list of legs:

- **transfer leg**: a telegraphic transfer in one currency, with a charge code, sender fees, deducted fees and business days in flight;
- **convert leg**: changes currency at a rate (fixed, or looked up by source id) with optional fees.

The engine walks the legs tracking the balance. A transfer must be in the currency currently held; a convert must convert the currency currently held; the route must end in the target currency. A violation is reported as an error on that route, not thrown. The first route is the baseline.

## 5. SWIFT charge codes OUR / SHA / BEN

```
OUR: all fees on top (senderFees + deductedFees)
SHA: senderFees on top; deductedFees deducted from the balance
BEN: all fees deducted from the balance
```

On-top fees must be in the source currency and are added to `sourceSpent`. Deducted fees must be in the currency of the balance at that point. Percent fees apply to the balance flowing through the leg.

Test case, SGD 1,000, fees 20 (sender) and 10 (intermediary), rate 26: OUR spends 1,030 and nets 26,000; SHA spends 1,020 and nets 25,740; BEN spends 1,000 and nets 25,220. All three cost 780 THB against the mid.

## 6. Fee valuation

Default (`feeValuation` unset, "leg"): a fee costs whatever the leg's rate makes it cost. A deducted SGD fee reduces the balance that is converted, so it costs `fee x leg_rate` in THB. An on-top fee is carried by the effective rate:

```
sourceSpent   = amount + sum(on-top fees)
netReceived   = final balance in the target currency
effectiveRate = netReceived / sourceSpent
netPerAmount  = effectiveRate x amount
```

Alternative (`feeValuation: 'reference'`): convert the whole amount, value each fee at the reference mid and subtract it in the target currency: `net = amount x rate - sum(fees) x reference_mid`. The two differ slightly. In the example, route B nets 25,709,226.00 by the reference method and 25,709,228.72 (`netPerAmount`) by the leg method, a difference of about THB 2.72, because the fees are worth about 25.71 each rather than 25.80.

## 7. Cost versus mid and edge

```
midValue   = sourceSpent x mid
totalCost  = midValue - netReceived
costBps    = totalCost / midValue x 10,000
fxMargin   = balance_converted x (mid - rate)       (the leg that converts straight from source to target currency)
fees       = totalCost - fxMargin                   (reporting only)

edgeVsBaseline    = netPerAmount(route) - netPerAmount(baseline)
edgeVsBaselineBps = edge / (amount x mid) x 10,000
```

`netPerAmount` puts every route on the same amount spent, so routes that spend slightly different totals (B spends 1,000,020) compare fairly. The best route is the one with the largest `netPerAmount` among routes that evaluated without error.

Example: route A has midValue 25,800,000, net 25,620,000, totalCost 180,000, 69.77 bps. Route B has totalCost 90,773.10, 35.18 bps, and an edge of +89,228.72 THB over A.

## 8. Volatility (`src/core/vol.ts`)

```
r_t = ln(mid_t / mid_{t-1})
daily_vol = sqrt( sum (r_t - mean)^2 / (n - 1) )     if n >= 10
daily_vol = 0.03 / sqrt(252)                          otherwise (about 18.9 bps)
```

History is a series of daily mids, oldest first; use weekdays only so carried weekend values do not flatten the estimate. With fewer than 10 returns the engine falls back to an assumed 3 percent annual volatility and says so in its warnings.

## 9. Transit band and probability the edge is lost

```
transitBand         = netReceived x daily_vol x sqrt(days)       (target units, 0 decimals)
band                = max(transitBand(route), transitBand(baseline))
edgeWithinNoise     = band > 0 and |edge| < band
edgeLossProbability = Phi(-edge / band)      (only if band > 0 and edge > 0, else null)
```

`Phi` is the standard normal CDF (Abramowitz and Stegun 7.1.26, absolute error below 1.5e-7). `days` counts business days of transfer legs that sit before a convert leg; a route that converts immediately has no exposure and no probability. A warning is raised when the loss probability is 5 percent or more.

Example: route B, 3 percent annual vol: band = 25,709,742.90 x 0.03 / sqrt(252) = THB 48,587; the edge of 89,228.72 is 1.84 sigma, so the chance a transit move erases it is about 3.3 percent. Locking the rate on arrival, or converting at once, removes that risk.

## 10. Decimal arithmetic

Money is handled with decimal.js and decimal strings. Amounts are formatted to 2 decimals, the effective rate to 6, bps to 2. Floating point is used in only two places that are not money: daily volatility and the normal CDF.

## 11. Sources (`src/adapters`)

| Source | Provides | Rate type | Cadence |
|---|---|---|---|
| Frankfurter v2 (api.frankfurter.dev) | Blended central-bank and official daily rates | central_bank_ref | Daily |
| fawazahmed0 currency-api (jsDelivr, with a pages.dev mirror) | Daily aggregated mids | aggregator_mid | Daily |
| Bank Negara Malaysia open API (api.bnm.gov.my) | MYR per unit; non-MYR pairs are crosses via MYR, flagged as such; quoted per-100 units are normalised | central_bank_ref | Sessions through the Malaysian business day |

All adapters make read-only GET requests to public, keyless endpoints with a per-call timeout (default 8 s). Each source remains subject to its own terms; see NOTICE.

## 12. Limitations

- Demo and educational use only. Not financial, legal or tax advice. Rates are indicative.
- Board rates are retail and indicative; a large ticket usually gets a tighter negotiated dealer rate that this engine does not fetch.
- Repricing assumes a provider's markup stays constant while the mid moves; real providers can change markup at any time.
- The transit band and loss probability assume normally distributed daily moves and constant volatility; real FX has fat tails and event risk.
- The consensus mid depends on a few free sources with different timestamps; daily sources can lag intraday moves.
- The leg valuation of fees differs slightly from the reference valuation (see section 6).
- The engine does not execute, pay, custody funds or advise on compliance, and never suggests splitting transfers to avoid thresholds.
