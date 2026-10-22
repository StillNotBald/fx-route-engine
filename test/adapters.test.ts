import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frankfurter, fawazahmed0, bnm, ADAPTERS, setSourceTimeoutMs } from '../src/adapters/index.ts'
import { consensusMid } from '../src/core/consensus.ts'

const NOW = '2026-10-21T12:00:00.000Z'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const urls: string[] = []

/** Mock fetch shaped as the three public APIs return: Frankfurter v2 rows, fawazahmed0 {date, <base>:{..}}, BNM {data, meta}. */
const mock = ((input: RequestInfo | URL) => {
  const url = String(input)
  urls.push(url)
  if (url.includes('api.frankfurter.dev'))
    return Promise.resolve(json([{ date: '2026-10-21', base: 'SGD', quote: 'THB', rate: 26.3 }]))
  if (url.includes('currency-api') || url.includes('jsdelivr'))
    return Promise.resolve(json({ date: '2026-10-21', sgd: { thb: 26.31, myr: 3.3 } }))
  if (url.includes('api.bnm.gov.my'))
    return Promise.resolve(json({
      data: [
        { currency_code: 'SGD', unit: 1, rate: { date: '2026-10-21', buying_rate: null, selling_rate: null, middle_rate: 3.3 } },
        { currency_code: 'THB', unit: 100, rate: { date: '2026-10-21', buying_rate: null, selling_rate: null, middle_rate: 12.55 } },
      ],
      meta: { session: '1200', last_updated: '2026-10-21 19:00:00' },
    }))
  throw new Error('unmocked ' + url)
}) as typeof fetch

test('only documented public endpoints are called, read-only, no keys', async () => {
  for (const a of ADAPTERS) await a.fetch([['SGD', 'THB']], NOW, mock)
  assert.ok(urls.length >= 3)
  const hosts = new Set(urls.map((u) => new URL(u).host))
  assert.deepEqual([...hosts].sort(), ['api.bnm.gov.my', 'api.frankfurter.dev', 'cdn.jsdelivr.net'])
})

test('frankfurter and fawazahmed0 produce labelled mids', async () => {
  const [f] = await frankfurter.fetch([['SGD', 'THB']], NOW, mock)
  assert.equal(f.rate, '26.3')
  assert.equal(f.rateType, 'central_bank_ref')
  assert.equal(f.sourceTs, '2026-10-21T00:00:00Z')
  const [g] = await fawazahmed0.fetch([['SGD', 'THB']], NOW, mock)
  assert.equal(g.rate, '26.31')
  assert.equal(g.rateType, 'aggregator_mid')
})

test('BNM: THB quoted per 100 units is normalised and crossed via MYR', async () => {
  const [q] = await bnm.fetch([['SGD', 'THB']], NOW, mock)
  // MYR per SGD 3.3, MYR per THB 12.55/100 -> 26.29...
  assert.ok(q.rate.startsWith('26.29'))
  assert.match(q.evidence!, /cross via MYR/)
  assert.equal(q.sourceTs, '2026-10-21T11:00:00.000Z')
})

test('the three sources agree into one consensus mid', async () => {
  const quotes = (await Promise.all(ADAPTERS.map((a) => a.fetch([['SGD', 'THB']], NOW, mock)))).flat()
  const c = consensusMid(quotes.map((q) => ({ sourceId: q.sourceId, rate: q.rate, sourceTs: q.sourceTs })))!
  assert.equal(c.n, 3)
  assert.equal(c.mid, '26.3')
})

test('an HTTP error surfaces with the url; a hung source times out', async () => {
  const bad = (async () => json({}, 500)) as unknown as typeof fetch
  await assert.rejects(frankfurter.fetch([['SGD', 'THB']], NOW, bad), /HTTP 500/)
  setSourceTimeoutMs(50)
  // AbortSignal.timeout's timer is unref'd and the mock holds no socket, so on Node 22 the event loop
  // would empty before the abort fires and node:test cancels the test. Keep the loop alive meanwhile.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const hang = ((_: unknown, init?: RequestInit) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))
    })) as unknown as typeof fetch
    await assert.rejects(frankfurter.fetch([['SGD', 'THB']], NOW, hang), /timed out/)
  } finally { clearInterval(keepAlive); setSourceTimeoutMs() }
})
