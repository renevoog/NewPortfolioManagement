'use strict';

// Original, causal calculations. A row dated D is the close of the UTC day D,
// available at D + 1 day. This module never imputes prices or on-chain values.
const DAY_MS = 86400000;
const MODEL_VERSION = 'technical-risk-1.0.0';
const FULL_WEIGHTS = Object.freeze({ trend: 0.4, momentum: 0.25, valuation: 0.35 });
const PRICE_WEIGHTS = Object.freeze({ trend: 40 / 65, momentum: 25 / 65 });
const NORMALIZATION = Object.freeze({
  method: 'expanding-prior-midrank-percentile',
  formula: '100 * (prior values below current + 0.5 * prior values equal to current) / prior sample count',
  trendMinimumSamples: 365,
  momentumMinimumSamples: 52,
  valuationMinimumSamples: 365,
  momentumFrequency: 'one observation per completed UTC week, Sunday close',
  includesCurrentInReference: false
});
const SENSITIVITY_SCENARIOS = Object.freeze({
  full: [
    { id: 'trend-emphasis', weights: { trend: 0.5, momentum: 0.2, valuation: 0.3 } },
    { id: 'momentum-emphasis', weights: { trend: 0.35, momentum: 0.35, valuation: 0.3 } },
    { id: 'valuation-emphasis', weights: { trend: 0.35, momentum: 0.2, valuation: 0.45 } }
  ],
  priceOnly: [
    { id: 'equal-weight', weights: { trend: 0.5, momentum: 0.5 } },
    { id: 'trend-emphasis', weights: { trend: 0.75, momentum: 0.25 } }
  ]
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const bounded = (value) => finite(value) ? Math.max(0, Math.min(100, value)) : null;

function rollingMean(period) {
  let values = [];
  let total = 0;
  return {
    reset() { values = []; total = 0; },
    next(value) {
      if (!positive(value)) { this.reset(); return null; }
      values.push(value);
      total += value;
      if (values.length > period) total -= values.shift();
      const mean = total / period;
      return values.length === period && finite(mean) ? mean : null;
    }
  };
}

function sma(values, period) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('Invalid SMA period');
  const state = rollingMean(period);
  return values.map((value) => state.next(value));
}

function rsiState(period) {
  let previous = null;
  let changes = 0;
  let averageGain = 0;
  let averageLoss = 0;
  return {
    reset() { previous = null; changes = 0; averageGain = 0; averageLoss = 0; },
    next(value) {
      if (!positive(value)) { this.reset(); return null; }
      if (previous === null) { previous = value; return null; }
      const difference = value - previous;
      previous = value;
      const gain = Math.max(difference, 0);
      const loss = Math.max(-difference, 0);
      changes += 1;
      if (changes <= period) {
        averageGain += gain / period;
        averageLoss += loss / period;
      } else {
        averageGain = (averageGain * (period - 1) + gain) / period;
        averageLoss = (averageLoss * (period - 1) + loss) / period;
      }
      if (changes < period) return null;
      if (averageGain === 0 && averageLoss === 0) return 50;
      if (averageLoss === 0) return 100;
      return bounded(100 - 100 / (1 + averageGain / averageLoss));
    }
  };
}

function wilderRSI(values, period = 14) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError('Invalid RSI period');
  const state = rsiState(period);
  return values.map((value) => state.next(value));
}

function lowerBound(values, target, upper = false) {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (values[middle] < target || (upper && values[middle] === target)) left = middle + 1;
    else right = middle;
  }
  return left;
}

function percentileState(minimumSamples) {
  const prior = [];
  return {
    next(value) {
      const samples = prior.length;
      let score = null;
      if (finite(value)) {
        const below = lowerBound(prior, value);
        if (samples >= minimumSamples) {
          const atOrBelow = lowerBound(prior, value, true);
          score = bounded(100 * (below + (atOrBelow - below) / 2) / samples);
        }
        prior.splice(below, 0, value);
      }
      return { raw: finite(value) ? value : null, score, samples };
    }
  };
}

function percentileRank(value, history, minimumSamples = 1) {
  if (!finite(value)) return null;
  const prior = history.filter(finite).sort((a, b) => a - b);
  if (!prior.length || prior.length < minimumSamples) return null;
  const below = lowerBound(prior, value);
  return bounded(100 * (below + (lowerBound(prior, value, true) - below) / 2) / prior.length);
}

function calculateMVRV(marketCap, realizedCap) {
  if (!positive(marketCap) || !positive(realizedCap)) return null;
  const ratio = marketCap / realizedCap;
  return finite(ratio) ? ratio : null;
}

function varianceState() {
  let count = 0;
  let mean = 0;
  let m2 = 0;
  return {
    next(value) {
      if (positive(value)) {
        count += 1;
        const delta = value - mean;
        mean += delta / count;
        m2 += delta * (value - mean);
      }
      const deviation = count >= 2 ? Math.sqrt(Math.max(0, m2 / count)) : null;
      return { count, deviation: positive(deviation) ? deviation : null };
    }
  };
}

function calculateMVRVZ(marketCap, realizedCap, marketCaps) {
  if (!positive(marketCap) || !positive(realizedCap)) return null;
  const state = varianceState();
  let statistics = { deviation: null };
  for (const value of marketCaps) statistics = state.next(value);
  const score = statistics.deviation ? (marketCap - realizedCap) / statistics.deviation : null;
  return finite(score) ? score : null;
}

function weightedScore(components, weights) {
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([, weight]) => !finite(weight) || weight < 0)) return null;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (Math.abs(total - 1) > 1e-12) return null;
  let score = 0;
  for (const [component, weight] of entries) {
    if (weight === 0) continue;
    const value = components[component] && components[component].score;
    if (!finite(value) || value < 0 || value > 100) return null;
    score += value * weight;
  }
  return bounded(score);
}

function sensitivityFor(components, base, scenarios) {
  if (!finite(base)) return null;
  const values = scenarios.map(({ weights }) => weightedScore(components, weights));
  const min = Math.min(base, ...values);
  const max = Math.max(base, ...values);
  return { min, max, spread: max - min, maxAbsoluteDelta: Math.max(...values.map((value) => Math.abs(value - base))) };
}

function parseDay(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(date + 'T00:00:00.000Z');
  return finite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? timestamp : null;
}

function prepareRows(rows, asset, asOf) {
  const dates = new Set();
  return rows.reduce((result, row) => {
    if (!row || typeof row !== 'object') return result;
    if (row.asset && String(row.asset).toUpperCase() !== asset) throw new Error('Mixed asset history is not permitted');
    const timestamp = parseDay(row.date);
    if (timestamp === null || timestamp + DAY_MS > asOf) return result;
    if (dates.has(row.date)) throw new Error('Duplicate UTC date: ' + row.date);
    dates.add(row.date);
    result.push({
      timestamp, date: row.date,
      price: positive(row.price) ? row.price : null,
      marketCap: positive(row.marketCap) ? row.marketCap : null,
      realizedCap: positive(row.realizedCap) ? row.realizedCap : null
    });
    return result;
  }, []).sort((a, b) => a.timestamp - b.timestamp);
}

function sensitivitySummary(history, key) {
  const values = history.map((point) => point.sensitivity[key]).filter(Boolean);
  return {
    observations: values.length,
    maxAbsoluteDelta: values.length ? Math.max(...values.map((value) => value.maxAbsoluteDelta)) : null,
    meanMaximumAbsoluteDelta: values.length ? values.reduce((sum, value) => sum + value.maxAbsoluteDelta, 0) / values.length : null
  };
}

function calculateTechnicalRisk(rows, options = {}) {
  const asset = String(options.asset || '').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) throw new Error('Technical Risk supports BTC and ETH only');
  if (!Array.isArray(rows)) throw new TypeError('History must be an array');
  const asOf = options.asOf === undefined ? Date.now() : new Date(options.asOf).getTime();
  if (!finite(asOf)) throw new Error('Invalid calculation time');
  const input = prepareRows(rows, asset, asOf);
  const trendDistribution = percentileState(NORMALIZATION.trendMinimumSamples);
  const momentumDistribution = percentileState(NORMALIZATION.momentumMinimumSamples);
  const valuationDistribution = percentileState(NORMALIZATION.valuationMinimumSamples);
  const dailyMean = rollingMean(730);
  const weeklyMean = rollingMean(200);
  const weeklyRSI = rsiState(14);
  const marketCapVariance = varianceState();
  let previousDay = null;
  let previousSunday = null;
  let weeklyObservation = { raw: null, score: null, samples: 0, observationDate: null };
  let sma200w = null;

  const history = input.map((row) => {
    if (previousDay !== null && row.timestamp - previousDay !== DAY_MS) dailyMean.reset();
    previousDay = row.timestamp;
    const sma730 = dailyMean.next(row.price);
    const trendRaw = positive(row.price) && positive(sma730) ? Math.log(row.price / sma730) : null;
    const trend = { ...trendDistribution.next(trendRaw), observationDate: row.date };

    const weekday = new Date(row.timestamp).getUTCDay();
    const latestSunday = row.timestamp - weekday * DAY_MS;
    if (weekday === 0) {
      if (previousSunday !== null && row.timestamp - previousSunday !== 7 * DAY_MS) {
        weeklyMean.reset();
        weeklyRSI.reset();
      }
      previousSunday = row.timestamp;
      sma200w = weeklyMean.next(row.price);
      weeklyObservation = { ...momentumDistribution.next(weeklyRSI.next(row.price)), observationDate: row.date };
    }
    // Do not silently carry a weekly observation across a missing Sunday.
    const momentum = previousSunday === latestSunday ? { ...weeklyObservation } : {
      raw: null, score: null, samples: weeklyObservation.samples, observationDate: null
    };
    const availableWeeklyMean = previousSunday === latestSunday ? sma200w : null;
    const mvrv = calculateMVRV(row.marketCap, row.realizedCap);
    const valuation = { ...valuationDistribution.next(mvrv), observationDate: row.date };
    const variance = marketCapVariance.next(row.marketCap);
    const z = mvrv !== null && variance.deviation ? (row.marketCap - row.realizedCap) / variance.deviation : null;
    const mvrvZ = finite(z) ? z : null;
    const components = { trend, momentum, valuation };
    const fullScore = weightedScore(components, FULL_WEIGHTS);
    const priceOnlyScore = weightedScore(components, PRICE_WEIGHTS);
    const variant = fullScore !== null ? 'full' : (priceOnlyScore !== null ? 'price-only' : 'unavailable');
    return {
      date: row.date,
      availableAt: new Date(row.timestamp + DAY_MS).toISOString(),
      price: row.price,
      score: fullScore !== null ? fullScore : priceOnlyScore,
      fullScore, priceOnlyScore, variant, components,
      sma730, sma200w: availableWeeklyMean, rsi14w: momentum.raw, mvrv, mvrvZ,
      mvrvZSamples: variance.count,
      weights: variant === 'full' ? { ...FULL_WEIGHTS } : (variant === 'price-only' ? { ...PRICE_WEIGHTS } : null),
      sensitivity: {
        full: sensitivityFor(components, fullScore, SENSITIVITY_SCENARIOS.full),
        priceOnly: sensitivityFor(components, priceOnlyScore, SENSITIVITY_SCENARIOS.priceOnly)
      }
    };
  });

  return {
    asset,
    modelVersion: MODEL_VERSION,
    dataVersion: options.dataVersion || null,
    normalization: { ...NORMALIZATION },
    weights: { full: { ...FULL_WEIGHTS }, priceOnly: { ...PRICE_WEIGHTS } },
    history,
    latest: history.length ? history[history.length - 1] : null,
    sensitivity: {
      scenarios: SENSITIVITY_SCENARIOS,
      full: sensitivitySummary(history, 'full'),
      priceOnly: sensitivitySummary(history, 'priceOnly'),
      interpretation: 'Fixed alternative hypotheses; descriptive sensitivity only, not optimized weights or predictive validation.'
    }
  };
}

module.exports = {
  calculateTechnicalRisk, sma, wilderRSI, percentileRank, calculateMVRV,
  calculateMVRVZ, weightedScore, MODEL_VERSION, NORMALIZATION, FULL_WEIGHTS, PRICE_WEIGHTS
};
