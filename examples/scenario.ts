import type { Scenario } from '../src/core/types.ts'

/**
 * Illustrative scenario: move SGD 1,000,000 to THB three ways.
 * Every rate and fee below is made up for the example. Replace them with quotes you were actually given.
 */
const ttToThai = {
  kind: 'transfer' as const,
  label: 'TT: SG entity to Thai entity (SGD)',
  currency: 'SGD',
  chargeCode: 'SHA' as const,
  // SHA: the sender's own bank fee is paid on top; the intermediary and receiving fees are deducted in flight
  senderFees: [{ label: 'outward TT fee', amount: '20', currency: 'SGD' }],
  deductedFees: [
    { label: 'intermediary bank fee', amount: '10', currency: 'SGD' },
    { label: 'receiving bank fee', amount: '0', currency: 'SGD' },
  ],
  transitDays: 1,
}

export const referenceMid = '25.80'

export const scenario: Scenario = {
  id: 'sgd-thb-reference',
  title: 'SGD 1,000,000 to THB, three routes (illustrative inputs)',
  amount: '1000000',
  from: 'SGD',
  to: 'THB',
  referenceMid,
  routes: [
    {
      id: 'A',
      label: 'A. Convert in Singapore (Your SG entity)',
      legs: [{ kind: 'convert', label: 'convert in SG', provider: 'SG bank', from: 'SGD', to: 'THB', rate: { fixed: '25.62' }, fees: [] }],
    },
    {
      id: 'B',
      label: 'B. TT the SGD to Your Thai entity, then convert',
      legs: [
        ttToThai,
        { kind: 'convert', label: 'convert in TH', provider: 'Thai bank', from: 'SGD', to: 'THB', rate: { fixed: '25.71' }, fees: [] },
      ],
    },
    {
      id: 'C',
      label: 'C. Convert in Thailand (SGD already held there)',
      notes: 'Not like-for-like with A and B for money that starts in Singapore.',
      legs: [{ kind: 'convert', label: 'convert in TH', provider: 'Thai bank', from: 'SGD', to: 'THB', rate: { fixed: '25.70' }, fees: [] }],
    },
  ],
}
