'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateTechnicalRisk, sma, wilderRSI, percentileRank,
  calculateMVRV, calculateMVRVZ, weightedScore, FULL_WEIGHTS, PRICE_WEIGHTS
} = require('../server/services/risk/technicalRisk');

const DAY = 86400000;
const START = Date.parse('2015-01-01T00:00:00Z');
const AS_OF = '2026-11-02T12:00:00Z';
function makeRows(count, withCaps = true) {
  return Array.from({ length: count }, (_, index) => {
    const price = 100 + index * 0.1 + 25 * Math.sin(index / 48) + 5 * Math.cos(index / 7);
    return {
      date: new Date(START + index * DAY).toISOString().slice(0, 10), price,
      marketCap: withCaps ? price * (1000000 + index) : null,
      realizedCap: withCaps ? (75 + index * 0.07) * (1000000 + index) : null
    };
  });
}
const calculate = (rows, options = {}) => calculateTechnicalRisk(rows, {
  asset: 'BTC', asOf: AS_OF, dataVersion: 'fixed-input-v1', ...options
});
function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('SMA requires a complete window and uses each observation exactly once', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(sma([1, 2], 3), [null, null]);
  assert.throws(() => sma([1], 0), /period/);
});

test('SMA resets for absent, zero, non-number and non-finite prices', () => {
  for (const missing of [null, undefined, NaN, Infinity, -1, 0, '2']) {
    assert.deepEqual(sma([1, 2, missing, 3, 4, 5], 3), [null, null, null, null, null, 4]);
  }
});

test('Wilder RSI matches the independently published standard initialization example', () => {
  const prices = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46, 46.03];
  const values = wilderRSI(prices);
  assert.equal(values.slice(0, 14).every((value) => value === null), true);
  close(values[14], 70.46413502109705);
  close(values[15], 66.24961855355505);
  close(values[16], 66.48094183471265);
});

test('Wilder RSI defines flat, rising and falling histories and restarts after a gap', () => {
  assert.equal(wilderRSI(Array(15).fill(10))[14], 50);
  assert.equal(wilderRSI(Array.from({ length: 15 }, (_, index) => index + 1))[14], 100);
  assert.equal(wilderRSI(Array.from({ length: 15 }, (_, index) => 20 - index))[14], 0);
  const gap = wilderRSI([...Array(15).fill(10), null, ...Array(15).fill(20)]);
  assert.ok(gap.slice(15, 30).every((value) => value === null));
  assert.equal(gap[30], 50);
});

test('normalization is empirical midrank, has warmup, and never invents missing values', () => {
  assert.equal(percentileRank(2, [1, 2, 2, 3]), 50);
  assert.equal(percentileRank(0, [1, 2, 3]), 0);
  assert.equal(percentileRank(4, [1, 2, 3]), 100);
  assert.equal(percentileRank(2, [2, 2, 2]), 50);
  assert.equal(percentileRank(2, [1, 2], 3), null);
  assert.equal(percentileRank(null, [1, 2]), null);
  assert.equal(percentileRank(NaN, [1, 2]), null);
  assert.equal(percentileRank(2, [null, NaN, Infinity]), null);
});

test('MVRV uses observed capitalization; Z uses population standard deviation', () => {
  assert.equal(calculateMVRV(300, 150), 2);
  close(calculateMVRVZ(300, 150, [100, 200, 300]), 150 / Math.sqrt(20000 / 3));
  assert.equal(calculateMVRVZ(300, 150, [300, 300]), null);
  assert.equal(calculateMVRVZ(300, 150, [300]), null);
  for (const missing of [null, undefined, NaN, Infinity, -1, 0, '100']) {
    assert.equal(calculateMVRV(300, missing), null);
    assert.equal(calculateMVRV(missing, 150), null);
    assert.equal(calculateMVRVZ(300, missing, [100, 200, 300]), null);
  }
});

test('weighting is explicit, bounded and does not silently renormalize missing inputs', () => {
  const components = { trend: { score: 10 }, momentum: { score: 80 }, valuation: { score: 50 } };
  close(weightedScore(components, FULL_WEIGHTS), 41.5);
  close(weightedScore(components, PRICE_WEIGHTS), (10 * 40 + 80 * 25) / 65);
  assert.equal(weightedScore({ ...components, valuation: { score: null } }, FULL_WEIGHTS), null);
  assert.equal(weightedScore(components, { trend: 0.5 }), null);
  assert.equal(weightedScore(components, { trend: -1, momentum: 2 }), null);
  assert.equal(weightedScore({ trend: { score: 101 } }, { trend: 1 }), null);
});

test('insufficient history exposes observations but no synthetic risk score', () => {
  const result = calculate(makeRows(729));
  assert.equal(result.latest.sma730, null);
  assert.equal(result.latest.score, null);
  assert.equal(result.latest.variant, 'unavailable');
  const initial = calculate(makeRows(730)).latest;
  assert.ok(initial.sma730 > 0);
  assert.equal(initial.components.trend.samples, 0);
  assert.equal(initial.components.trend.score, null);
  assert.equal(initial.score, null);
});

test('trend percentile requires 365 prior valid daily trend observations', () => {
  const result = calculate(makeRows(1095));
  assert.equal(result.history[1093].components.trend.score, null);
  assert.equal(result.latest.components.trend.samples, 365);
  assert.notEqual(result.latest.priceOnlyScore, null);
  const row = result.latest;
  close(row.components.trend.raw, Math.log(row.price / row.sma730));
});

test('RSI is calculated from actual completed Sunday closes, not daily RSI', () => {
  const rows = makeRows(600);
  const weekly = rows.filter((row) => new Date(row.date + 'T00:00:00Z').getUTCDay() === 0);
  const expected = wilderRSI(weekly.map((row) => row.price));
  const result = calculate(rows);
  weekly.forEach((row, index) => {
    const point = result.history.find((value) => value.date === row.date);
    assert.equal(point.rsi14w, expected[index]);
  });
  const sunday = result.history.findIndex((point) => point.components.momentum.samples === 52 && point.components.momentum.score !== null);
  assert.ok(sunday > 0);
  for (let offset = 1; offset <= 6; offset += 1) {
    assert.deepEqual(result.history[sunday + offset].components.momentum, result.history[sunday].components.momentum);
  }
});

test('200-week mean waits for 200 weekly observations and is only supplemental', () => {
  const rows = makeRows(1500);
  const weekly = rows.filter((row) => new Date(row.date + 'T00:00:00Z').getUTCDay() === 0);
  const expected = sma(weekly.map((row) => row.price), 200);
  const result = calculate(rows);
  weekly.forEach((row, index) => {
    const point = result.history.find((value) => value.date === row.date);
    assert.equal(point.sma200w, expected[index]);
  });
  assert.equal(result.history[1094].sma200w, null);
  assert.notEqual(result.history[1094].score, null);
});

test('current UTC day and incomplete week cannot influence historical results', () => {
  const rows = [
    { date: '2026-10-30', price: 100 },
    { date: '2026-10-31', price: 110 },
    { date: '2026-11-01', price: 999999 }
  ];
  const beforeClose = calculate(rows, { asOf: '2026-11-01T23:59:59.999Z' });
  assert.equal(beforeClose.history.length, 2);
  assert.equal(beforeClose.latest.date, '2026-10-31');
  const afterClose = calculate(rows, { asOf: '2026-11-02T00:00:00.000Z' });
  assert.equal(afterClose.history.length, 3);
  assert.equal(afterClose.latest.components.momentum.observationDate, '2026-11-01');
  assert.equal(afterClose.latest.availableAt, '2026-11-02T00:00:00.000Z');
});

test('full and price-only histories remain distinct when valuation disappears', () => {
  const rows = makeRows(1600);
  rows[1599].realizedCap = null;
  const result = calculate(rows);
  assert.equal(result.history[1598].variant, 'full');
  assert.equal(result.latest.variant, 'price-only');
  assert.equal(result.latest.fullScore, null);
  assert.equal(result.latest.mvrv, null);
  assert.equal(result.latest.mvrvZ, null);
  assert.equal(result.latest.score, result.latest.priceOnlyScore);
  assert.deepEqual(result.latest.weights, PRICE_WEIGHTS);
  const priceOnly = calculate(makeRows(1600, false));
  assert.equal(priceOnly.latest.fullScore, null);
  assert.equal(priceOnly.latest.priceOnlyScore, result.latest.priceOnlyScore);
  assert.equal(priceOnly.latest.components.valuation.samples, 0);
});

test('all available historical scores and component percentiles stay in 0-100', () => {
  const result = calculate(makeRows(2200));
  assert.ok(result.history.some((point) => point.fullScore !== null));
  for (const point of result.history) {
    for (const value of [point.score, point.fullScore, point.priceOnlyScore, ...Object.values(point.components).map((component) => component.score)]) {
      assert.ok(value === null || (Number.isFinite(value) && value >= 0 && value <= 100));
    }
  }
});

test('appending extreme future observations does not change any historical point', () => {
  const rows = makeRows(1800);
  const prefix = calculate(rows.slice(0, 1500));
  for (let index = 1500; index < rows.length; index += 1) {
    rows[index].price *= 500;
    rows[index].marketCap *= 500;
    rows[index].realizedCap *= 0.1;
  }
  const extended = calculate(rows);
  assert.deepEqual(extended.history.slice(0, prefix.history.length), prefix.history);
});

test('the same input and data version reproduce identical output without mutating inputs', () => {
  const rows = makeRows(1500);
  const before = JSON.stringify(rows);
  const first = calculate(rows);
  const second = calculate([...rows].reverse());
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(first.dataVersion, 'fixed-input-v1');
  assert.equal(first.modelVersion, 'technical-risk-1.0.0');
});

test('missing UTC dates reset the daily SMA rather than compressing calendar time', () => {
  const rows = makeRows(1550);
  const missingDate = rows[800].date;
  const result = calculate(rows.filter((row) => row.date !== missingDate));
  const byDate = new Map(result.history.map((row) => [row.date, row]));
  assert.notEqual(byDate.get(rows[799].date).sma730, null);
  assert.equal(byDate.get(rows[801].date).sma730, null);
  assert.equal(byDate.get(rows[1529].date).sma730, null);
  assert.notEqual(byDate.get(rows[1530].date).sma730, null);
});

test('a missing Sunday invalidates weekly values until sufficient new contiguous weeks', () => {
  const rows = makeRows(1800);
  const missingIndex = rows.findIndex((row, index) => index > 1500 && new Date(row.date + 'T00:00:00Z').getUTCDay() === 0);
  const result = calculate(rows.filter((_, index) => index !== missingIndex));
  const nextMonday = result.history.find((point) => point.date === rows[missingIndex + 1].date);
  assert.equal(nextMonday.rsi14w, null);
  assert.equal(nextMonday.sma200w, null);
  const nextSunday = result.history.find((point) => point.date === rows[missingIndex + 7].date);
  assert.equal(nextSunday.rsi14w, null);
  assert.equal(nextSunday.sma200w, null);
  const rebuiltRSI = result.history.find((point) => point.date === rows[missingIndex + 15 * 7].date);
  assert.notEqual(rebuiltRSI.rsi14w, null);
});

test('BTC and ETH histories are independently calculated and mixed-asset inputs rejected', () => {
  const btc = makeRows(1500).map((row) => ({ ...row, asset: 'BTC' }));
  const eth = makeRows(1500, false).map((row, index) => ({ ...row, asset: 'eth', price: row.price * (1 + index / 500) }));
  const btcResult = calculate(btc);
  const ethResult = calculate(eth, { asset: 'ETH' });
  assert.equal(btcResult.asset, 'BTC');
  assert.equal(ethResult.asset, 'ETH');
  assert.equal(ethResult.latest.fullScore, null);
  assert.notEqual(ethResult.latest.sma730, btcResult.latest.sma730);
  assert.deepEqual(calculate(btc), btcResult);
  assert.throws(() => calculate([...btc, eth[0]]), /Mixed asset/);
  assert.throws(() => calculate([], { asset: 'DOGE' }), /BTC and ETH/);
});

test('invalid dates are ignored and duplicate dates cannot silently override history', () => {
  const valid = { date: '2026-10-31', price: 100 };
  const result = calculate([valid, { date: '2026-02-30', price: 20 }, { date: 'bad', price: 30 }, null]);
  assert.equal(result.history.length, 1);
  assert.throws(() => calculate([valid, { ...valid, price: 200 }]), /Duplicate UTC date/);
  assert.throws(() => calculate([], { asOf: 'bad' }), /calculation time/);
});

test('null and non-finite rows never serialize as fabricated zero-valued measurements', () => {
  const rows = makeRows(1500);
  rows[1499] = { date: rows[1499].date, price: NaN, marketCap: Infinity, realizedCap: null };
  const result = calculate(rows);
  assert.equal(result.latest.price, null);
  assert.equal(result.latest.score, null);
  assert.equal(result.latest.sma730, null);
  assert.equal(result.latest.mvrv, null);
  assert.equal(result.latest.components.trend.raw, null);
  assert.ok(!JSON.stringify(result).includes('NaN'));
});

test('weight sensitivity reports fixed alternatives without optimizing scores', () => {
  const result = calculate(makeRows(1800));
  const point = result.latest;
  assert.ok(result.sensitivity.full.observations > 0);
  assert.equal(result.sensitivity.scenarios.full.length, 3);
  const alternatives = result.sensitivity.scenarios.full.map(({ weights }) => weightedScore(point.components, weights));
  assert.equal(point.sensitivity.full.min, Math.min(point.fullScore, ...alternatives));
  assert.equal(point.sensitivity.full.max, Math.max(point.fullScore, ...alternatives));
  assert.equal(point.sensitivity.full.maxAbsoluteDelta, Math.max(...alternatives.map((value) => Math.abs(value - point.fullScore))));
  assert.ok(result.sensitivity.full.maxAbsoluteDelta >= point.sensitivity.full.maxAbsoluteDelta);
  assert.deepEqual(point.weights, FULL_WEIGHTS);
});

test('empty history stays unavailable without an exception', () => {
  const result = calculate([]);
  assert.equal(result.latest, null);
  assert.deepEqual(result.history, []);
  assert.equal(result.sensitivity.full.observations, 0);
});
