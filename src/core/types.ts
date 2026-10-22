// Every rate in the engine is a decimal string. Never a float across a boundary.
export type Dec = string

/**
 * What kind of number this is. Mixing these unlabelled is the main correctness
 * trap in FX comparison, so every stored rate carries one.
 */
export type RateType =
  | 'central_bank_ref' // daily official reference (ECB, BNM, BOT, MAS)
  | 'aggregator_mid' // mid-market from a data aggregator
  | 'provider_quote' // what a provider gives a customer (incl. markup), e.g. a quote you were given or collected
  | 'board_rate' // bank's published TT/board rate (indicative, retail)
  | 'dealer_rfq' // negotiated quote for a specific ticket
  | 'manual' // keyed by hand with no better label

export const MID_TYPES: RateType[] = ['central_bank_ref', 'aggregator_mid']

/**
 * One observed rate. `rate` is always "quote currency received per 1 base sold"
 * for customer rates, or the plain mid for mid types.
 */
export interface Quote {
  sourceId: string
  base: string
  quote: string
  rate: Dec
  rateType: RateType
  /** When the source says the rate applies (ISO 8601 UTC). */
  sourceTs: string
  /** When we captured it (ISO 8601 UTC). */
  fetchedAt: string
  /** Send amount (in base) the quote was collected for; null = any amount. */
  amountTier?: Dec | null
  feeAmount?: Dec | null
  feeCurrency?: string | null
  enteredBy?: 'cron' | 'ai' | 'human'
  evidence?: string | null
  /** Markup model: consensus mid at capture time and markup vs it, in bps. */
  midAtCapture?: Dec | null
  markupBps?: Dec | null
}

export type ChargeCode = 'OUR' | 'SHA' | 'BEN'

export interface Fee {
  label: string
  amount: Dec
  currency: string
  /** fixed amount, or percent of the amount flowing through the leg */
  kind?: 'fixed' | 'percent'
}

export interface TransferLeg {
  kind: 'transfer'
  label: string
  currency: string
  /**
   * OUR: sender pays every fee on top (principal arrives intact).
   * SHA: sender pays own bank on top; intermediary + receiving fees are deducted.
   * BEN: every fee is deducted from the principal.
   */
  chargeCode: ChargeCode
  senderFees: Fee[]
  deductedFees: Fee[]
  /** Business days the money is in flight, unconverted. */
  transitDays: number
}

export interface RateRef {
  /** a fixed rate (illustrative or user-supplied) */
  fixed?: Dec
  /** or: latest stored quote from this source */
  sourceId?: string
}

export interface ConvertLeg {
  kind: 'convert'
  label: string
  provider: string
  from: string
  to: string
  rate: RateRef
  fees: Fee[]
}

export type Leg = TransferLeg | ConvertLeg

export interface Route {
  id: string
  label: string
  legs: Leg[]
  notes?: string
}

export interface Scenario {
  id: string
  title: string
  amount: Dec
  from: string
  to: string
  /** fixed reference mid, used with feeValuation 'reference' */
  referenceMid?: Dec
  routes: Route[]
  notes?: string[]
}
