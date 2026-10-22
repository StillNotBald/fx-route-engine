export type Pair = readonly [base: string, quote: string]

/** Default currency pairs the example adapters are asked for. Direction = what you sell, then what you receive. */
export const PAIRS: Pair[] = [
  ['SGD', 'THB'],
  ['SGD', 'MYR'],
  ['MYR', 'THB'],
  ['SGD', 'USD'],
]

/** A mid source older than this is left out of the consensus (carries a business-day fix over a weekend plus a holiday). */
export const MID_MAX_AGE_H = 96
/** Sources further than this from the first-pass median are rejected as outliers (bps). */
export const OUTLIER_REJECT_BPS = 50
/** Each source call stops after this and counts as failed (ms). */
export const SOURCE_TIMEOUT_MS = 8000
