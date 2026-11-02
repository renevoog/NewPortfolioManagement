const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

// Load the real service with only its I/O boundaries replaced.
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  const originalRequire = Module.createRequire(filename);
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : originalRequire(id);
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  return mod.exports;
}

const { calculate24h } = require('../server/services/yahoo/watchlistQuoteService');
const NOW = Date.parse('2026-11-01T12:00:00Z');
const SEC = NOW / 1000;
const DAY = 86400;
function history(points, meta = {}) {
  return { meta, timestamp: points.map(([t]) => t), indicators: { quote: [{ close: points.map(([, c]) => c) }] } };
}

test('24h compares with wall-clock history, not regularMarketPreviousClose', () => {
  const values = calculate24h(history([[SEC - DAY - 300, 100], [SEC - 300, 110]], {
    regularMarketPrice: 112, regularMarketTime: SEC, regularMarketPreviousClose: 111
  }), NOW);
  assert.equal(values.price, 112);
  assert.equal(values.change24h, 12);
  assert.equal(values.change24hPct, 12);
  assert.equal(values.comparisonTime, new Date((SEC - DAY - 300) * 1000).toISOString());
});

test('closed market uses the same last trade at both ends of the rolling window', () => {
  const values = calculate24h(history([[SEC - 3 * DAY, 95], [SEC - 2 * DAY, 100]], {
    regularMarketTime: SEC - 2 * DAY + 60, regularMarketPrice: 101
  }), NOW);
  assert.equal(values.price, 101);
  assert.equal(values.change24h, 0);
  assert.equal(values.change24hPct, 0);
});

test('24h handles losses and never borrows a sample after the cutoff', () => {
  const values = calculate24h(history([[SEC - DAY - 300, 200], [SEC - DAY + 60, 190], [SEC - 60, 180]]), NOW);
  assert.equal(values.change24h, -20);
  assert.equal(values.change24hPct, -10);
});

test('missing baseline or invalid history remains unavailable, not a zero change', () => {
  const recent = calculate24h(history([[SEC - DAY - 60, null], [SEC - 60, 50], [SEC + 60, 100]]), NOW);
  assert.equal(recent.price, 50);
  assert.equal(recent.change24h, null);
  assert.equal(recent.change24hPct, null);
  const empty = calculate24h(history([[SEC - DAY, 0], [SEC - 60, NaN]]), NOW);
  assert.equal(empty.price, null);
  assert.equal(empty.change24h, null);
});

test('watchlist quote fetch reuses mappings/cache and isolates unavailable symbols', async () => {
  const calls = [];
  const quotes = load('server/services/yahoo/watchlistQuoteService.js', {
    './yahooFinanceClient': { chart: async (...args) => {
      calls.push(args);
      if (args[0] === 'MISSING') throw new Error('Provider unavailable');
      const now = Math.floor(Date.now() / 1000);
      return history([[now - DAY - 300, 0.5], [now - 60, 0.6]], { shortName: 'Mapped asset', currency: 'EUR' });
    } }
  });
  const assets = [{ tvSymbol: 'LOCAL', yahooSymbol: 'MAPPED.PA' }, { tvSymbol: 'BAD', yahooSymbol: 'MISSING' }];
  const rows = await quotes.getWatchlistRows(assets);
  assert.equal(rows[0].symbol, 'LOCAL');
  assert.equal(rows[0].lastPrice, '0.60 €');
  assert.equal(rows[0].changePct, '+20.00%');
  assert.equal(rows[1].price, null);
  assert.equal(rows[1].changePct, '-');
  await quotes.getWatchlistRows([assets[0]]);
  assert.equal(calls.filter(([symbol]) => symbol === 'MAPPED.PA').length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['MAPPED.PA', '5d', '5m']);
  assert.ok(calls[0][3].signal instanceof AbortSignal);
});

test('resolving a watchlist-only symbol does not change the initial dashboard list', async () => {
  const mappings = [];
  const tracked = load('server/services/trackedAssetsService.js', {
    './symbolMap': { hasSymbol: () => false, addMapping: (...args) => mappings.push(args) },
    './yahoo/yahooStockService': { validateSymbol: async () => true }
  });
  assert.equal(await tracked.resolveSymbol('BTC-USD'), 'BTC-USD');
  assert.equal(mappings.length, 0);
});

function storageFixture() {
  const records = [];
  const tracked = [{ userId: 'one', tvSymbol: 'BRK.B', yahooSymbol: 'BRK-B' }];
  const resolutions = [];
  const matches = (record, filter) => Object.entries(filter).every(([key, value]) => record[key] === value);
  const watchlistAssetModel = {
    find: (filter) => ({ sort: () => ({ lean: async () => records.filter((record) => matches(record, filter)).map((r) => ({ ...r })) }) }),
    findOne: async (filter) => records.find((record) => matches(record, filter)),
    updateOne: async (filter, update) => {
      if (!records.some((record) => matches(record, filter))) records.push({ ...update.$setOnInsert });
    },
    deleteOne: async (filter) => {
      const index = records.findIndex((record) => matches(record, filter));
      if (index !== -1) records.splice(index, 1);
    }
  };
  const mocks = {
    '../model/models': {
      watchlistAssetModel,
      trackedAssetModel: { findOne: async (filter) => tracked.find((record) => matches(record, filter)) }
    },
    './trackedAssetsService': { resolveSymbol: async (symbol) => { resolutions.push(symbol); return symbol === 'INVALID' ? null : symbol; } }
  };
  return { service: load('server/services/watchlistService.js', mocks), records, tracked, resolutions, mocks };
}

test('normalizes favourites and makes repeated/concurrent adds idempotent', async () => {
  const { service, records } = storageFixture();
  await Promise.all([service.addAsset('one', ' aapl '), service.addAsset('one', 'AAPL')]);
  assert.equal(records.length, 1);
  assert.equal(records[0].tvSymbol, 'AAPL');
  assert.equal((await service.addAsset('one', 'aapl')).alreadyAdded, true);
});

test('separates users and preserves dashboard mappings and independent membership', async () => {
  const { service, tracked, resolutions } = storageFixture();
  await service.addAsset('one', 'BRK.B');
  await service.addAsset('two', 'AAPL');
  assert.equal((await service.getAssets('one'))[0].yahooSymbol, 'BRK-B');
  assert.deepEqual(resolutions, ['AAPL']);
  tracked.splice(0); // Removing the dashboard asset must not delete the favourite.
  assert.equal((await service.getAssets('one')).length, 1);
  await service.removeAsset('two', 'BRK.B');
  assert.equal((await service.getAssets('one')).length, 1);
  await service.removeAsset('one', 'BRK.B');
  assert.equal((await service.getAssets('one')).length, 0);
  assert.equal((await service.getAssets('two')).length, 1);
  assert.equal(tracked.length, 0); // Direct favourites never populate the dashboard.
});

test('malformed/unknown inputs cannot create records or become MongoDB selectors', async () => {
  const { service, records, resolutions } = storageFixture();
  for (const value of ['', null, {}, { $ne: '' }, ['AAPL'], '__INITIALIZED__', '<script>', 'A'.repeat(51)]) {
    assert.equal((await service.addAsset('one', value)).success, false);
    assert.equal((await service.removeAsset('one', value)).success, false);
  }
  assert.equal(resolutions.length, 0);
  assert.equal((await service.addAsset('one', 'INVALID')).success, false);
  assert.equal(records.length, 0);
});

test('saved favourites survive a new service instance and duplicate key races', async () => {
  const fixture = storageFixture();
  await fixture.service.addAsset('one', 'AAPL');
  const reloaded = load('server/services/watchlistService.js', fixture.mocks);
  assert.equal((await reloaded.getAssets('one'))[0].tvSymbol, 'AAPL');
  fixture.mocks['../model/models'].watchlistAssetModel.updateOne = async () => { throw Object.assign(new Error('Duplicate'), { code: 11000 }); };
  assert.equal((await reloaded.addAsset('one', 'MSFT')).success, true);
});

test('dashboard cache hits still return current per-user favourite membership', async () => {
  let favourites = [{ tvSymbol: 'AAPL' }];
  const controller = load('server/controller/controller.js', {
    '../services/trackedAssetsService': {
      initializeTrackedAssets: async () => {}, getTrackedSymbols: async () => ['AAPL'], getTrackedSymbolMap: async () => ({ AAPL: 'AAPL' })
    },
    '../services/watchlistService': { getAssets: async () => favourites },
    '../services/stockAggregator': { getStockRows: async () => { throw new Error('Cache should be used'); } }
  });
  const cachedRow = { symbol: 'AAPL' };
  const req = { session: { passport: { user: 'one' }, dashboardCache: { ts: Date.now(), symbols: ['AAPL'], rows: [cachedRow] } } };
  let response;
  const res = { json: (data) => { response = data; } };
  await controller.new_dashboardDataController_GET(req, res);
  assert.equal(response.rows[0].isFavourite, true);
  favourites = [];
  await controller.new_dashboardDataController_GET(req, res);
  assert.equal(response.rows[0].isFavourite, false);
  assert.equal(cachedRow.isFavourite, undefined);
});

test('HTTP routes require login and scope add/list/delete to the authenticated user', async (t) => {
  const fixture = storageFixture();
  const controller = load('server/controller/watchlistController.js', {
    '../services/watchlistService': fixture.service,
    '../services/yahoo/watchlistQuoteService': { getWatchlistRows: async (assets) => assets.map((asset) => ({ symbol: asset.tvSymbol })) }
  });
  const router = load('server/routes/router.js', { '../controller/watchlistController': controller });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-test-user');
    req.isAuthenticated = () => !!user;
    req.flash = () => {};
    req.session = { passport: { user } };
    req.user = { name: 'Test' };
    next();
  });
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const [url, method] of [['/watchlist', 'GET'], ['/api/watchlist', 'GET'], ['/api/watchlist', 'POST'], ['/api/watchlist/AAPL', 'DELETE']]) {
    const response = await fetch(base + url, { method, redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
  const one = { 'x-test-user': 'one', 'Content-Type': 'application/json' };
  const two = { 'x-test-user': 'two' };
  const added = await fetch(base + '/api/watchlist', { method: 'POST', headers: one, body: JSON.stringify({ symbol: 'AAPL', userId: 'two' }) });
  assert.equal(added.status, 200);
  assert.equal((await (await fetch(base + '/api/watchlist', { headers: one })).json()).rows.length, 1);
  assert.equal((await (await fetch(base + '/api/watchlist', { headers: two })).json()).rows.length, 0);
  await fetch(base + '/api/watchlist/AAPL', { method: 'DELETE', headers: two });
  assert.equal(fixture.records.length, 1);
  const invalid = await fetch(base + '/api/watchlist', { method: 'POST', headers: one, body: JSON.stringify({ symbol: { $ne: '' } }) });
  assert.equal(invalid.status, 400);
  await fetch(base + '/api/watchlist/AAPL', { method: 'DELETE', headers: one });
  assert.equal(fixture.records.length, 0);
});
