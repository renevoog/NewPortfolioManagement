'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const providers = require('../server/services/risk/riskProviders');
const { contentVersion } = require('../server/services/risk/riskStore');
const { MODEL_VERSION } = require('../server/services/risk/technicalRisk');

const NOW = Date.parse('2026-11-02T12:00:00Z');
const HOUR = 3600000;
const DAY = providers.DAY;
const clone = (value) => structuredClone(value);

// Replace only I/O boundaries; calculation, scheduling and controller code stay real.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  const originalRequire = Module.createRequire(filename);
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : originalRequire(id);
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  return mod.exports;
}

function priceRows(asset, count = 3, end = '2026-11-01') {
  const last = Date.parse(end + 'T00:00:00Z');
  return Array.from({ length: count }, (_, index) => ({
    date: providers.utcDate(last - (count - 1 - index) * DAY),
    price: (asset === 'BTC' ? 100 : 200) + index,
    marketCap: (asset === 'BTC' ? 1000000 : 2000000) + index * 100,
    realizedCap: null
  }));
}

function publishedCbbi(score = 60, end = '2026-11-01') {
  const last = Date.parse(end + 'T00:00:00Z');
  return {
    history: [0, 1, 2].map((index) => ({
      date: providers.utcDate(last - (2 - index) * DAY), score, price: 100 + index,
      components: Object.fromEntries(providers.CBBI_COMPONENTS.map(({ key }) => [key, score]))
    })),
    comparison: { kind: 'published-component-mean-check', comparedDays: 3, incompleteDays: 0, maxDifference: 0, withinTolerance: true }
  };
}

function fixture({ initial = {}, clock = NOW, env = {}, source = {}, quoteRows } = {}) {
  let time = clock;
  const records = new Map(Object.entries(clone(initial)));
  const datasets = new Map();
  const snapshots = new Map();
  const calls = { prices: [], cbbi: [], quote: [], reads: [], writes: [], completions: [] };
  const store = {
    readSource: async (key) => {
      calls.reads.push(key);
      const record = records.get(key) || { key, data: null };
      const stored = record.version && datasets.get(key + ':' + record.version);
      return clone({ ...record, data: stored || record.data || null });
    },
    claim: async (key, now) => {
      const record = records.get(key) || { key, data: null };
      if (Date.parse(record.nextAttemptAt || 0) > now || Date.parse(record.leaseUntil || 0) > now) return false;
      records.set(key, { ...record, leaseUntil: new Date(now + 15 * 60000) });
      return true;
    },
    saveDataset: async (key, data, dataThrough) => {
      const version = contentVersion(data);
      calls.writes.push({ key, version, dataThrough });
      if (!datasets.has(key + ':' + version)) datasets.set(key + ':' + version, clone(data));
      return version;
    },
    complete: async (key, values) => {
      calls.completions.push({ key, values: clone(values) });
      records.set(key, { ...records.get(key), ...clone(values), leaseUntil: new Date(0) });
    },
    deferSources: async (keys, until) => {
      for (const key of keys) {
        const record = records.get(key) || { key, data: null };
        const previous = Date.parse(record.nextAttemptAt || new Date(0));
        records.set(key, { ...record, nextAttemptAt: new Date(Math.max(previous, until)) });
      }
    },
    saveSnapshot: async (row, observedAt, sourceVersion) => {
      if (!snapshots.has(row.date)) snapshots.set(row.date, {
        asset: 'BTC', methodology: 'cbbi-published-confidence', ...clone(row), observedAt: new Date(observedAt), sourceVersion
      });
    },
    readSnapshots: async () => clone([...snapshots.values()].sort((a, b) => a.date.localeCompare(b.date)))
  };
  const defaultSource = {
    fetchCoinMetrics: async (asset, settings) => {
      calls.prices.push({ asset, settings: clone(settings) });
      return priceRows(asset);
    },
    fetchCbbi: async (now) => { calls.cbbi.push(now); return publishedCbbi(); }
  };
  const quotes = quoteRows || (async ([asset]) => {
    calls.quote.push(clone(asset));
    return [{ price: asset.tvSymbol === 'BTC' ? 111 : 222, priceTime: new Date(time - 60000).toISOString(), currency: 'USD' }];
  });
  const module = load('server/services/risk/riskService.js', {
    './riskStore': store,
    '../yahoo/watchlistQuoteService': { getWatchlistRows: quotes }
  });
  const configuration = { store, source: { ...defaultSource, ...source }, quoteRows: quotes, now: () => time, env: { RISK_DATA_USAGE: 'personal-noncommercial', ...env } };
  return {
    service: module.createRiskService(configuration), newService: () => module.createRiskService(configuration),
    records, datasets, snapshots, calls, store,
    setTime: (value) => { time = value; }
  };
}

function persisted(asset, { fetchedAt = NOW - HOUR, rows = priceRows(asset), extra = {} } = {}) {
  const data = { rows, valuationStatus: { status: 'unavailable', message: 'No realized capitalization' } };
  return {
    key: 'cm:' + asset, version: contentVersion(data), data,
    dataThrough: rows.at(-1).date, fetchedAt: new Date(fetchedAt), nextAttemptAt: new Date(NOW + HOUR), lastFullAt: new Date(NOW - HOUR), ...extra
  };
}

test('warm startup and repeated page reads use persisted history without external requests', async () => {
  const f = fixture({ initial: { 'cm:BTC': persisted('BTC', { rows: priceRows('BTC', 1200) }) } });
  const first = await f.service.getRiskData('BTC');
  const second = await f.service.getRiskData('BTC');
  assert.deepEqual(second.technical, first.technical);
  assert.equal(first.technical.latest.variant, 'price-only');
  assert.equal(first.technical.modelVersion, MODEL_VERSION);
  assert.equal(f.calls.reads.length, 5);
  assert.equal(f.calls.prices.length, 0);
  assert.equal(f.calls.cbbi.length, 0);
  assert.equal(f.calls.quote.length, 0);
  assert.equal(f.calls.writes.filter(({ key }) => key.startsWith('technical:BTC:')).length, 1);
});

test('concurrent refreshes share one in-flight job and refresh intervals survive later calls', async () => {
  const f = fixture();
  await Promise.all([f.service.updateAll(), f.service.updateAll(), f.service.updateAll()]);
  assert.deepEqual(f.calls.prices.map(({ asset }) => asset), ['BTC', 'ETH']);
  assert.equal(f.calls.cbbi.length, 1);
  assert.equal(f.calls.quote.length, 2);
  await f.service.updateAll();
  assert.equal(f.calls.prices.length, 2);
  assert.equal(f.calls.cbbi.length, 1);
  assert.equal(f.calls.quote.length, 2);
  f.setTime(NOW + 6 * 60000);
  await f.service.updateAll();
  assert.equal(f.calls.prices.length, 2);
  assert.equal(f.calls.cbbi.length, 1);
  assert.equal(f.calls.quote.length, 4);
});

test('provider Retry-After longer than the normal retry window survives process restart', async () => {
  let btcCalls = 0;
  let ethCalls = 0;
  const f = fixture({ source: { fetchCoinMetrics: async (asset) => {
    if (asset === 'BTC') { btcCalls += 1; throw Object.assign(new Error('Rate limited'), { status: 429, retryAfterMs: 24 * HOUR }); }
    ethCalls += 1;
    return priceRows(asset);
  } } });
  await f.service.updateAll();
  assert.equal(Date.parse(f.records.get('cm:BTC').nextAttemptAt), NOW + 24 * HOUR);
  f.setTime(NOW + 23 * HOUR);
  const restarted = f.newService();
  await restarted.updateAll();
  assert.equal(btcCalls, 1);
  assert.equal(ethCalls, 0, 'The IP-wide cooldown must also cover ETH');
  f.setTime(NOW + 24 * HOUR);
  await restarted.updateAll();
  assert.equal(btcCalls, 2);
});

test('optional realized-cap 429 preserves downloaded prices and defers both assets for the requested time', async () => {
  const requests = [];
  const f = fixture({ env: { COIN_METRICS_API_KEY: 'test-key' }, source: { fetchCoinMetrics: async (asset, settings) => {
    requests.push({ asset, realizedOnly: Boolean(settings.realizedOnly) });
    if (settings.realizedOnly) throw Object.assign(new Error('Rate limited valuation data'), { status: 429, retryAfterMs: 24 * HOUR });
    return priceRows(asset);
  } } });
  await f.service.updateAll();
  assert.deepEqual(requests, [{ asset: 'BTC', realizedOnly: false }, { asset: 'BTC', realizedOnly: true }]);
  assert.equal(Date.parse(f.records.get('cm:BTC').nextAttemptAt), NOW + 24 * HOUR);
  assert.equal(Date.parse(f.records.get('cm:ETH').nextAttemptAt), NOW + 24 * HOUR);
  const data = await f.service.getRiskData('BTC');
  assert.equal(data.technical.latest.price, 102);
  assert.equal(data.sources.find(({ id }) => id === 'mvrv:BTC').status, 'unavailable');
  f.setTime(NOW + 23 * HOUR);
  await f.newService().updateAll();
  assert.equal(requests.length, 2);
});

test('Retry-After starts when the failing response arrives, including request latency', async () => {
  const f = fixture({ source: { fetchCoinMetrics: async (asset) => {
    if (asset === 'BTC') {
      f.setTime(NOW + 45000);
      throw Object.assign(new Error('Delayed rate-limit response'), { status: 429, retryAfterMs: 24 * HOUR });
    }
    return priceRows(asset);
  } } });
  await f.service.updateAll();
  for (const asset of ['BTC', 'ETH']) {
    assert.equal(Date.parse(f.records.get('cm:' + asset).nextAttemptAt), NOW + 45000 + 24 * HOUR, asset);
  }
});

test('refresh failure preserves last successful data, version and timestamps with stale status', async () => {
  const old = persisted('BTC', { fetchedAt: NOW - 4 * DAY, rows: priceRows('BTC', 3, '2026-10-28'), extra: { nextAttemptAt: new Date(0) } });
  const f = fixture({ initial: { 'cm:BTC': old }, source: { fetchCoinMetrics: async (asset) => {
    if (asset === 'BTC') throw new Error('Temporary provider failure');
    return priceRows(asset);
  } } });
  await f.service.updateAll();
  const result = await f.service.getRiskData('BTC');
  const status = result.sources.find(({ id }) => id === 'cm:BTC');
  assert.equal(status.status, 'stale');
  assert.equal(status.message, 'Temporary provider failure');
  assert.equal(Date.parse(status.fetchedAt), Date.parse(old.fetchedAt));
  assert.equal(status.dataThrough, '2026-10-28');
  assert.equal(result.technical.dataVersion, old.version);
  assert.equal(result.technical.latest.price, old.data.rows.at(-1).price);
});

test('MVRV source cannot report fresh data when the current capitalization is missing or the source failed', async () => {
  for (const kind of ['missing-latest', 'failed-refresh', 'old-data']) {
    const rows = priceRows('BTC', 3, kind === 'old-data' ? '2026-10-28' : '2026-11-01').map((row) => ({ ...row, realizedCap: 500000 }));
    if (kind === 'missing-latest') rows.at(-1).realizedCap = null;
    const data = { rows, valuationStatus: { status: 'ok', message: 'Licensed capitalization' } };
    const input = persisted('BTC', { rows, extra: { data, version: contentVersion(data), error: kind === 'failed-refresh' ? 'Provider failed' : null } });
    const f = fixture({ initial: { 'cm:BTC': input } });
    const result = await f.service.getRiskData('BTC');
    assert.equal(result.sources.find(({ id }) => id === 'mvrv:BTC').status, 'stale', kind);
  }
});

test('BTC and ETH use independent datasets, calculations and quote symbols', async () => {
  const f = fixture();
  await f.service.updateAll();
  const [btc, eth] = await Promise.all([f.service.getRiskData('BTC'), f.service.getRiskData('ETH')]);
  assert.equal(btc.technical.asset, 'BTC');
  assert.equal(eth.technical.asset, 'ETH');
  assert.equal(btc.technical.latest.price, 102);
  assert.equal(eth.technical.latest.price, 202);
  assert.equal(btc.quote.price, 111);
  assert.equal(eth.quote.price, 222);
  assert.notEqual(btc.technical.dataVersion, eth.technical.dataVersion);
  assert.equal(eth.cbbi, null);
  assert.equal(btc.cbbi.latest.score, 60);
  assert.deepEqual(f.calls.quote.map(({ yahooSymbol }) => yahooSymbol), ['BTC-USD', 'ETH-USD']);
});

test('unavailable licensed realized cap does not block prices or produce synthetic MVRV', async () => {
  const requested = [];
  const f = fixture({ env: { COIN_METRICS_API_KEY: 'test-key' }, source: { fetchCoinMetrics: async (asset, settings) => {
    requested.push({ asset, realizedOnly: Boolean(settings.realizedOnly) });
    if (settings.realizedOnly) throw Object.assign(new Error('Not entitled to CapRealUSD'), { status: 403 });
    return priceRows(asset, 1200);
  } } });
  await f.service.updateAll();
  for (const asset of ['BTC', 'ETH']) {
    const data = await f.service.getRiskData(asset);
    assert.equal(data.sources.find(({ id }) => id === 'cm:' + asset).status, 'ok');
    assert.equal(data.sources.find(({ id }) => id === 'mvrv:' + asset).status, 'unavailable');
    assert.equal(data.technical.latest.variant, 'price-only');
    assert.equal(data.technical.latest.mvrv, null);
    assert.equal(data.technical.latest.mvrvZ, null);
  }
  assert.deepEqual(requested, [
    { asset: 'BTC', realizedOnly: false }, { asset: 'BTC', realizedOnly: true },
    { asset: 'ETH', realizedOnly: false }, { asset: 'ETH', realizedOnly: true }
  ]);
});

test('weekly full import and normal incremental import are distinguishable provider requests', async () => {
  const f = fixture({ initial: { 'cm:BTC': persisted('BTC', { extra: { nextAttemptAt: new Date(0) } }) } });
  await f.service.updateAll();
  assert.equal(f.calls.prices.find(({ asset }) => asset === 'BTC').settings.since, '2026-10-25');
  f.setTime(NOW + 8 * DAY);
  await f.service.updateAll();
  assert.equal(f.calls.prices.filter(({ asset }) => asset === 'BTC').at(-1).settings.since, undefined);
});

test('CBBI snapshots record only the first observed latest completed day, never backfilled history', async () => {
  let score = 60;
  const f = fixture({ source: { fetchCbbi: async () => publishedCbbi(score) } });
  await f.service.updateAll();
  const original = clone([...f.snapshots.values()]);
  assert.equal(original.length, 1);
  assert.equal(original[0].date, '2026-11-01');
  assert.equal(Date.parse(original[0].observedAt), NOW);
  assert.equal(original[0].score, 60);
  assert.ok(original[0].sourceVersion);
  score = 80;
  f.setTime(NOW + 6 * HOUR);
  await f.service.updateAll();
  const data = await f.service.getRiskData('BTC');
  assert.equal(data.cbbi.latest.score, 80);
  assert.deepEqual([...f.snapshots.values()], original);
  assert.deepEqual(data.cbbi.snapshots, original);
  assert.notEqual(f.records.get('cbbi:BTC').version, original[0].sourceVersion);
});

test('snapshot observation timestamp records data receipt rather than request start', async () => {
  const f = fixture({ source: { fetchCbbi: async () => {
    f.setTime(NOW + 12000);
    return publishedCbbi();
  } } });
  await f.service.updateAll();
  const [snapshot] = [...f.snapshots.values()];
  assert.equal(Date.parse(snapshot.observedAt), NOW + 12000);
  assert.equal(Date.parse(f.records.get('cbbi:BTC').fetchedAt), NOW + 12000);
});

test('stale CBBI history is visible as stale and cannot create retrospective snapshots', async () => {
  const f = fixture({ source: { fetchCbbi: async () => publishedCbbi(60, '2026-10-28') } });
  await f.service.updateAll();
  const data = await f.service.getRiskData('BTC');
  assert.equal(data.cbbi.status, 'stale');
  assert.equal(data.cbbi.latest.date, '2026-10-28');
  assert.equal(data.cbbi.snapshots.length, 0);
});

test('latest missing technical observation remains unavailable instead of falling back to an old score', async () => {
  const rows = priceRows('ETH', 1200);
  rows.at(-1).price = null;
  const f = fixture({ initial: { 'cm:ETH': persisted('ETH', { rows }) } });
  const data = await f.service.getRiskData('ETH');
  assert.equal(data.technical.latest.date, '2026-11-01');
  assert.equal(data.technical.latest.price, null);
  assert.equal(data.technical.latest.score, null);
  assert.equal(data.technical.latest.variant, 'unavailable');
  assert.equal(data.technical.history.at(-2).variant, 'price-only');
});

test('missing newest CBBI Confidence key rejects the refresh and preserves the previous dated score as stale', async () => {
  const payload = { Confidence: {}, Price: {} };
  for (const { key } of providers.CBBI_COMPONENTS) payload[key] = {};
  for (const date of ['2026-10-31', '2026-11-01']) {
    const timestamp = String(Date.parse(date + 'T00:00:00Z') / 1000);
    payload.Price[timestamp] = 100;
    for (const { key } of providers.CBBI_COMPONENTS) payload[key][timestamp] = 0.7;
    if (date === '2026-10-31') payload.Confidence[timestamp] = 0.7;
  }
  const oldData = publishedCbbi(55, '2026-10-31');
  const f = fixture({ initial: { 'cbbi:BTC': {
    data: oldData, version: contentVersion(oldData), dataThrough: '2026-10-31', fetchedAt: new Date(NOW - DAY), nextAttemptAt: new Date(0)
  } }, source: { fetchCbbi: async (now) => providers.parseCbbi(payload, now) } });
  await f.service.updateAll();
  const data = await f.service.getRiskData('BTC');
  assert.equal(data.cbbi.status, 'stale');
  assert.equal(data.cbbi.latest.date, '2026-10-31');
  assert.equal(data.cbbi.latest.score, 55);
  assert.equal(Date.parse(data.cbbi.fetchedAt), NOW - DAY);
  assert.equal(data.cbbi.snapshots.length, 0);
});

test('restart recalculates identically from the same immutable data version', async () => {
  const f = fixture({ source: { fetchCoinMetrics: async (asset) => priceRows(asset, 1200) } });
  await f.service.updateAll();
  const before = await f.service.getRiskData('ETH');
  const after = await f.newService().getRiskData('ETH');
  assert.deepEqual(after.technical, before.technical);
  const versions = f.calls.writes.filter(({ key }) => key.startsWith('technical:ETH:')).map(({ version }) => version);
  assert.equal(versions.length, 2);
  assert.equal(new Set(versions).size, 1);
});

test('malformed and future quote timestamps are rejected without replacing a valid cached quote', async () => {
  for (const priceTime of ['not-a-date', new Date(NOW + HOUR).toISOString()]) {
    const cachedQuote = { price: 99, time: new Date(NOW - HOUR).toISOString(), source: 'Yahoo Finance' };
    const f = fixture({ initial: { 'quote:BTC': { quote: cachedQuote, fetchedAt: new Date(NOW - HOUR), dataThrough: cachedQuote.time, nextAttemptAt: new Date(0) } }, quoteRows: async () => [{ price: 999, currency: 'USD', priceTime }] });
    await f.service.updateAll();
    const result = await f.service.getRiskData('BTC');
    assert.equal(result.quote.price, 99, priceTime);
    assert.equal(result.quote.time, cachedQuote.time);
    assert.equal(result.quote.stale, true);
  }
});

test('unknown assets cannot trigger storage or network access', async () => {
  const f = fixture();
  await assert.rejects(f.service.getRiskData('DOGE'));
  assert.equal(f.calls.reads.length, 0);
  assert.equal(f.calls.prices.length, 0);
});

test('snapshot storage uses insert-only writes and tolerates duplicate-key races', async () => {
  const writes = [];
  let duplicate = false;
  const store = load('server/services/risk/riskStore.js', {
    '../../model/models': { riskSnapshotModel: { updateOne: async (...args) => {
      writes.push(args);
      if (duplicate) throw Object.assign(new Error('Concurrent insert'), { code: 11000 });
    } } }
  });
  const row = publishedCbbi().history.at(-1);
  await store.saveSnapshot(row, NOW, 'original-version');
  duplicate = true;
  await store.saveSnapshot({ ...row, score: 90 }, NOW + HOUR, 'revised-version');
  assert.deepEqual(writes[0][0], { asset: 'BTC', methodology: 'cbbi-published-confidence', date: '2026-11-01' });
  assert.deepEqual(Object.keys(writes[0][1]), ['$setOnInsert']);
  assert.equal(Date.parse(writes[0][1].$setOnInsert.observedAt), NOW);
  assert.equal(writes[0][1].$setOnInsert.sourceVersion, 'original-version');
  assert.equal(writes[0][2].upsert, true);
});

test('risk HTTP routes require authentication and expose validated asset data without shared browser caching', async (t) => {
  const requests = [];
  let fail = false;
  const controller = load('server/controller/riskController.js', {
    '../services/risk/riskService': { getRiskData: async (asset) => {
      requests.push(asset);
      if (fail) throw new Error('Secret provider diagnostic');
      return { asset, technical: { latest: null } };
    } }
  });
  const noop = () => {};
  const unrelated = new Proxy({}, { get: () => noop });
  const router = load('server/routes/router.js', {
    '../controller/riskController': controller,
    '../controller/controller': unrelated,
    '../controller/watchlistController': unrelated
  });
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = () => req.get('x-test-user') === 'one';
    req.flash = () => {};
    req.user = { name: 'User One' };
    next();
  });
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const url of ['/risk', '/api/risk-data?asset=BTC']) {
    const response = await fetch(base + url, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
  assert.deepEqual(requests, []);
  const headers = { 'x-test-user': 'one' };
  for (const [query, asset] of [['', 'BTC'], ['?asset=eth', 'ETH'], ['?asset=BTC', 'BTC']]) {
    const response = await fetch(base + '/api/risk-data' + query, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('vary'), 'Accept-Encoding');
    assert.equal((await response.json()).asset, asset);
  }
  const identity = await fetch(base + '/api/risk-data?asset=ETH', { headers: { ...headers, 'Accept-Encoding': 'identity' } });
  assert.equal(identity.headers.get('content-encoding'), null);
  assert.equal((await identity.json()).asset, 'ETH');
  const bad = await fetch(base + '/api/risk-data?asset=DOGE', { headers });
  assert.equal(bad.status, 400);
  for (const query of ['?asset=BTC&asset=ETH', '?asset[$ne]=BTC', '?asset=']) {
    const invalid = await fetch(base + '/api/risk-data' + query, { headers });
    assert.equal(invalid.status, 400, query);
  }
  assert.deepEqual(requests, ['BTC', 'ETH', 'BTC', 'ETH']);
  fail = true;
  const error = await fetch(base + '/api/risk-data?asset=ETH', { headers });
  assert.equal(error.status, 503);
  assert.ok(!(await error.text()).includes('Secret provider diagnostic'));
  let rendered;
  controller.view({ user: { name: 'User One' } }, { render: (...args) => { rendered = args; } });
  assert.equal(rendered[0], 'risk');
  assert.equal(rendered[1].activeTab, 'risk');
  assert.equal(rendered[1].userName, 'User One');
});
