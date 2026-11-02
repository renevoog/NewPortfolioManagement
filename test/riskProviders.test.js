'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchJson, fetchCoinMetrics, fetchCbbi, parseCoinMetrics, parseCbbi,
  CBBI_COMPONENTS, CBBI_URL, COMMUNITY_URL, PRO_URL
} = require('../server/services/risk/riskProviders');
const { contentVersion, encode, decode } = require('../server/services/risk/riskStore');

const NOW = Date.parse('2026-11-02T12:00:00Z');
const options = { now: NOW, usage: 'personal-noncommercial' };
const coinRow = (date = '2026-11-01', asset = 'btc', fields = {}) => ({
  asset, time: date + 'T00:00:00.000000000Z', PriceUSD: '100', CapMrktCurUSD: '1000000', CapRealUSD: '500000', ...fields
});
function response(data, status = 200, headers = {}, cancel = async () => {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: { cancel }, json: async () => data };
}
function cbbiPayload(days = [['2026-10-31', 0.5], ['2026-11-01', 0.75]]) {
  const data = { Confidence: {}, Price: {} };
  for (const { key } of CBBI_COMPONENTS) data[key] = {};
  for (const [date, score] of days) {
    const timestamp = String(Date.parse(date + 'T00:00:00Z') / 1000);
    data.Confidence[timestamp] = score;
    data.Price[timestamp] = 100;
    for (const { key } of CBBI_COMPONENTS) data[key][timestamp] = score;
  }
  return data;
}
const latestKey = String(Date.parse('2026-11-01T00:00:00Z') / 1000);

test('provider client retries 429 according to Retry-After seconds and releases responses', async () => {
  let calls = 0;
  let cancellations = 0;
  const sleeps = [];
  const value = await fetchJson('https://provider.example/data', {
    fetch: async (_url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.headers.Accept, 'application/json');
      calls += 1;
      return calls === 1 ? response(null, 429, { 'retry-after': '2.5' }, async () => { cancellations += 1; }) : response({ okay: true });
    }, sleep: async (ms) => sleeps.push(ms)
  });
  assert.deepEqual(value, { okay: true });
  assert.deepEqual(sleeps, [2500]);
  assert.equal(calls, 2);
  assert.equal(cancellations, 1);
});

test('provider client honors HTTP-date Retry-After using the injected clock', async () => {
  let calls = 0;
  const sleeps = [];
  await fetchJson('https://provider.example/data', {
    now: () => NOW,
    fetch: async () => ++calls === 1 ? response(null, 429, { 'retry-after': new Date(NOW + 15000).toUTCString() }) : response({}),
    sleep: async (ms) => sleeps.push(ms)
  });
  assert.deepEqual(sleeps, [15000]);
});

test('long Retry-After is deferred without early retries or a blocking sleep', async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(fetchJson('https://provider.example/data', {
    fetch: async () => { calls += 1; return response(null, 429, { 'retry-after': '3600' }); },
    sleep: async (ms) => sleeps.push(ms)
  }), (error) => error.status === 429 && error.retryAfterMs === 3600000);
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('server errors and network failures use bounded exponential backoff', async () => {
  for (const network of [false, true]) {
    let calls = 0;
    const sleeps = [];
    await assert.rejects(fetchJson('https://provider.example/data', {
      fetch: async () => { calls += 1; if (network) throw new Error('Private network detail'); return response(null, 503); },
      sleep: async (ms) => sleeps.push(ms)
    }));
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  }
});

test('non-transient HTTP errors are never retried', async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    await assert.rejects(fetchJson('https://provider.example/data', {
      fetch: async () => { calls += 1; return response(null, status); },
      sleep: async () => assert.fail('A permanent error must not retry')
    }), (error) => error.status === status);
    assert.equal(calls, 1);
  }
});

test('malformed JSON fails without fabricating a successful response', async () => {
  await assert.rejects(fetchJson('https://provider.example/data', {
    fetch: async () => ({ ...response(null), json: async () => { throw new SyntaxError('Bad JSON'); } })
  }), SyntaxError);
});

test('Coin Metrics parses observed numeric fields and orders completed UTC days', () => {
  const result = parseCoinMetrics({ data: [coinRow('2026-11-02'), coinRow('2026-11-01'), coinRow('2026-10-31')] }, 'BTC', NOW);
  assert.deepEqual(result, [
    { date: '2026-10-31', price: 100, marketCap: 1000000, realizedCap: 500000 },
    { date: '2026-11-01', price: 100, marketCap: 1000000, realizedCap: 500000 }
  ]);
  assert.equal(parseCoinMetrics({ data: [coinRow('2026-11-01')] }, 'BTC', Date.parse('2026-11-01T23:59:59.999Z')).length, 0);
  assert.equal(parseCoinMetrics({ data: [coinRow('2026-11-01')] }, 'BTC', Date.parse('2026-11-02T00:00:00Z')).length, 1);
});

test('Coin Metrics missing and non-finite observations remain null', () => {
  for (const value of [null, undefined, '', 'NaN', 'Infinity', NaN, Infinity, true, false, 0, '0', -100]) {
    const [row] = parseCoinMetrics({ data: [coinRow('2026-11-01', 'btc', { PriceUSD: value, CapMrktCurUSD: value, CapRealUSD: value })] }, 'BTC', NOW);
    assert.equal(row.price, null);
    assert.equal(row.marketCap, null);
    assert.equal(row.realizedCap, null);
  }
});

test('Coin Metrics rejects object and array metric values instead of numeric coercion', () => {
  for (const value of [[], [123], {}, { value: 123 }]) {
    const [row] = parseCoinMetrics({ data: [coinRow('2026-11-01', 'btc', { PriceUSD: value, CapRealUSD: value })] }, 'BTC', NOW);
    assert.equal(row.price, null);
    assert.equal(row.realizedCap, null);
  }
});

test('Coin Metrics rejects invalid dates, non-midnight UTC records, and malformed time suffixes', () => {
  for (const time of ['2026-02-30T00:00:00Z', 'not-a-date', '2026-11-01garbage', '2026-11-01T12:00:00Z', '2026-11-01T00:00:00+03:00']) {
    assert.throws(() => parseCoinMetrics({ data: [coinRow('2026-11-01', 'btc', { time })] }, 'BTC', NOW));
  }
});

test('Coin Metrics cannot mix BTC and ETH or overwrite duplicate daily observations', () => {
  assert.throws(() => parseCoinMetrics({ data: [coinRow('2026-11-01', 'eth')] }, 'BTC', NOW));
  assert.throws(() => parseCoinMetrics({ data: [coinRow(), coinRow()] }, 'BTC', NOW));
  assert.throws(() => parseCoinMetrics({ data: null }, 'BTC', NOW));
  assert.equal(parseCoinMetrics({ data: [coinRow('2026-11-01', 'eth')] }, 'ETH', NOW)[0].price, 100);
});

test('Coin Metrics community data requires declared noncommercial use before any request', async () => {
  let calls = 0;
  await assert.rejects(fetchCoinMetrics('BTC', { now: NOW }, { fetch: async () => { calls += 1; return response({}); } }), (error) => error.code === 'LICENSE_REQUIRED');
  assert.equal(calls, 0);
  await assert.rejects(fetchCoinMetrics('DOGE', options, { fetch: async () => assert.fail('Invalid asset must not reach provider') }));
});

test('Coin Metrics query requests supported community metrics and completed days only', async () => {
  const urls = [];
  const result = await fetchCoinMetrics('ETH', { ...options, since: '2026-10-30' }, {
    fetch: async (url) => { urls.push(new URL(url)); return response({ data: [coinRow('2026-11-01', 'eth', { CapRealUSD: undefined })] }); }
  });
  assert.equal(urls.length, 1);
  const url = urls[0];
  assert.equal(url.origin + url.pathname, COMMUNITY_URL);
  assert.equal(url.searchParams.get('assets'), 'eth');
  assert.equal(url.searchParams.get('frequency'), '1d');
  assert.equal(url.searchParams.get('start_time'), '2026-10-30');
  assert.equal(url.searchParams.get('end_time'), '2026-11-01');
  assert.ok(url.searchParams.get('metrics').includes('PriceUSD'));
  assert.ok(!url.searchParams.get('metrics').includes('CapRealUSD'));
  assert.equal(url.searchParams.has('api_key'), false);
  assert.equal(result[0].realizedCap, null);
});

test('licensed realized-cap requests are separate and retain null price fields', async () => {
  const result = await fetchCoinMetrics('ETH', { now: NOW, apiKey: 'test-key', realizedOnly: true }, {
    fetch: async (value) => {
      const url = new URL(value);
      assert.equal(url.origin + url.pathname, PRO_URL);
      assert.equal(url.searchParams.get('metrics'), 'CapRealUSD');
      assert.equal(url.searchParams.get('assets'), 'eth');
      assert.equal(url.searchParams.get('api_key'), 'test-key');
      return response({ data: [coinRow('2026-11-01', 'eth', { PriceUSD: undefined, CapMrktCurUSD: undefined })] });
    }
  });
  assert.deepEqual(result, [{ date: '2026-11-01', price: null, marketCap: null, realizedCap: 500000 }]);
  await assert.rejects(fetchCoinMetrics('ETH', { now: NOW, apiKey: 'test-key', realizedOnly: true }, {
    fetch: async () => response({ data: [coinRow('2026-11-01', 'eth', { CapRealUSD: null })] })
  }));
});

test('licensed price requests do not require access to the paid realized-cap metric', async () => {
  const result = await fetchCoinMetrics('BTC', { now: NOW, apiKey: 'test-key' }, {
    fetch: async (value) => {
      const url = new URL(value);
      assert.equal(url.origin + url.pathname, PRO_URL);
      assert.equal(url.searchParams.get('metrics'), 'PriceUSD,CapMrktCurUSD');
      return response({ data: [coinRow('2026-11-01', 'btc', { CapRealUSD: undefined })] });
    }
  });
  assert.equal(result[0].price, 100);
  assert.equal(result[0].realizedCap, null);
});

test('Coin Metrics pagination preserves asset separation and waits between pages', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await fetchCoinMetrics('BTC', options, {
    fetch: async () => ++calls === 1
      ? response({ data: [coinRow('2026-10-31')], next_page_url: COMMUNITY_URL + '?page=2' })
      : response({ data: [coinRow('2026-11-01')] }),
    sleep: async (ms) => sleeps.push(ms)
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.map((row) => row.date), ['2026-10-31', '2026-11-01']);
  assert.ok(sleeps.every((ms) => ms >= 1000));
  assert.equal(sleeps.length, 1);
});

test('Coin Metrics refuses hostile pagination origins and paths before following them', async () => {
  for (const next_page_url of ['https://attacker.example/steal', 'https://community-api.coinmetrics.io/other', 'http://community-api.coinmetrics.io/v4/timeseries/asset-metrics']) {
    let calls = 0;
    await assert.rejects(fetchCoinMetrics('BTC', options, {
      fetch: async () => { calls += 1; return response({ data: [coinRow()], next_page_url }); },
      sleep: async () => {}
    }));
    assert.equal(calls, 1);
  }
});

test('Coin Metrics rejects repeated pages and duplicate dates spanning pages', async () => {
  for (const cycle of [false, true]) {
    let calls = 0;
    await assert.rejects(fetchCoinMetrics('BTC', options, {
      fetch: async () => {
        calls += 1;
        return response({ data: [coinRow()], next_page_url: cycle || calls === 1 ? COMMUNITY_URL + '?page=2' : undefined });
      }, sleep: async () => {}
    }));
    assert.equal(calls, 2);
  }
});

test('Coin Metrics caps runaway pagination and rejects an entirely unavailable price history', async () => {
  let calls = 0;
  await assert.rejects(fetchCoinMetrics('BTC', options, {
    fetch: async () => { calls += 1; return response({ data: [], next_page_url: COMMUNITY_URL + '?page=' + calls }); },
    sleep: async () => {}
  }));
  assert.equal(calls, 30);
  await assert.rejects(fetchCoinMetrics('BTC', options, {
    fetch: async () => response({ data: [coinRow('2026-11-01', 'btc', { PriceUSD: null })] })
  }));
});

test('CBBI preserves the official score and scales all nine published components', () => {
  const result = parseCbbi(cbbiPayload(), NOW);
  assert.equal(result.history[0].score, 50);
  assert.equal(result.history[1].score, 75);
  assert.equal(Object.keys(result.history[1].components).length, 9);
  assert.ok(Object.values(result.history[1].components).every((value) => value === 75));
  assert.equal(result.comparison.comparedDays, 2);
  assert.equal(result.comparison.maxDifference, 0);
  assert.equal(result.comparison.withinTolerance, true);
});

test('CBBI component comparison reports disagreement without replacing official confidence', () => {
  const payload = cbbiPayload();
  for (const { key } of CBBI_COMPONENTS) payload[key][latestKey] = 0.5;
  const result = parseCbbi(payload, NOW);
  assert.equal(result.history[1].score, 75);
  assert.equal(result.comparison.latest.officialScore, 75);
  assert.equal(result.comparison.latest.componentMean, 50);
  assert.equal(result.comparison.latest.difference, 25);
  assert.equal(result.comparison.withinTolerance, false);
});

test('CBBI never averages an incomplete component set into a substitute official score', () => {
  const payload = cbbiPayload();
  delete payload.RHODL[latestKey];
  const result = parseCbbi(payload, NOW);
  assert.equal(result.history[1].score, 75);
  assert.equal(result.history[1].components.RHODL, null);
  assert.equal(result.comparison.comparedDays, 1);
  assert.equal(result.comparison.incompleteDays, 1);
  assert.equal(result.comparison.latest.date, '2026-10-31');
});

test('CBBI zero is valid but null, NaN, infinities and out-of-range components stay unavailable', () => {
  const values = [0, null, NaN, Infinity, -0.1, 1.1, '0.5', undefined, false];
  const payload = cbbiPayload();
  CBBI_COMPONENTS.forEach(({ key }, index) => { payload[key][latestKey] = values[index]; });
  const result = parseCbbi(payload, NOW);
  assert.equal(result.history[1].components[CBBI_COMPONENTS[0].key], 0);
  for (const { key } of CBBI_COMPONENTS.slice(1)) assert.equal(result.history[1].components[key], null);
  assert.equal(result.history[1].score, 75);
  const zero = parseCbbi(cbbiPayload([['2026-11-01', 0]]), NOW);
  assert.equal(zero.history[0].score, 0);
});

test('CBBI requires actual published Confidence and rejects a missing latest official score', () => {
  assert.throws(() => parseCbbi({ Price: {} }, NOW));
  assert.throws(() => parseCbbi({ Confidence: {} }, NOW));
  for (const value of [null, undefined, NaN, Infinity, -0.01, 1.01, '0.75']) {
    const payload = cbbiPayload();
    payload.Confidence[latestKey] = value;
    assert.throws(() => parseCbbi(payload, NOW));
  }
});

test('CBBI excludes the current UTC day and rejects non-midnight or malformed timestamps', () => {
  const result = parseCbbi(cbbiPayload([['2026-11-01', 0.5], ['2026-11-02', 1]]), NOW);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].date, '2026-11-01');
  for (const key of ['oops', String(Number(latestKey) + 1), 'Infinity', '99999999999999999999999']) {
    assert.throws(() => parseCbbi({ Confidence: { [key]: 0.5 } }, NOW));
  }
  assert.equal(parseCbbi(cbbiPayload([['2026-11-01', 0.5]]), Date.parse('2026-11-02T00:00:00Z')).history.length, 1);
});

test('CBBI fetch uses the official endpoint and returns validated published data', async () => {
  const result = await fetchCbbi(NOW, {
    fetch: async (url) => { assert.equal(url, CBBI_URL); return response(cbbiPayload()); }
  });
  assert.equal(result.history[1].score, 75);
});

test('dataset codec preserves values and produces repeatable content versions', () => {
  const data = { asset: 'ETH', rows: [{ date: '2026-11-01', price: 123.456, score: null }], text: 'Värskus: ööpäev' };
  const first = encode(data);
  const second = encode(data);
  assert.ok(Buffer.isBuffer(first));
  assert.deepEqual(first, second);
  assert.deepEqual(decode(first), data);
  assert.deepEqual(decode({ buffer: first }), data);
  assert.equal(contentVersion(data), contentVersion(JSON.parse(JSON.stringify(data))));
  assert.notEqual(contentVersion(data), contentVersion({ ...data, asset: 'BTC' }));
  assert.notEqual(contentVersion(data), contentVersion({ ...data, rows: [{ ...data.rows[0], price: 123.457 }] }));
  assert.throws(() => decode(Buffer.from('corrupt payload')));
});
