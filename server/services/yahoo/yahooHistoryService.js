// Yahoo Finance — historical price-change service
// Computes multi-period % price changes (7d, 1mo, 3mo, 6mo, 1y) from the
// v8 chart endpoint. The 24h change comes from the live quote elsewhere.
//
// For each period we take the latest close and the close on (or on the last
// trading day before) the target date, then compute the percent change.
// If the symbol has no history reaching back to the target date (e.g. a recent
// IPO), the value is null and the UI renders "-".

const { chart } = require('./yahooFinanceClient');

const DAY = 24 * 60 * 60; // seconds in a day

// Periods to compute, keyed to the row fields consumed by the client
const PERIODS = [
  { key: 'change7d', days: 7 },
  { key: 'change1mo', days: 30 },
  { key: 'change3mo', days: 91 },
  { key: 'change6mo', days: 182 },
  { key: 'change1y', days: 365 }
];

const emptyChanges = () => ({
  change7d: null,
  change1mo: null,
  change3mo: null,
  change6mo: null,
  change1y: null
});

// Build a sorted (ascending) array of { t, c } points from a chart result.
// Prefers adjusted close (handles splits & dividends) and skips null entries.
const extractPoints = (result) => {
  if (!result || !Array.isArray(result.timestamp)) return [];

  const ts = result.timestamp;
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const adj = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0];
  const closes = (adj && Array.isArray(adj.adjclose)) ? adj.adjclose
    : (quote && Array.isArray(quote.close)) ? quote.close
      : [];

  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof ts[i] === 'number' && typeof c === 'number' && isFinite(c) && c > 0) {
      points.push({ t: ts[i], c: c });
    }
  }
  // Yahoo returns ascending order, but guard anyway
  points.sort((a, b) => a.t - b.t);
  return points;
};

// Compute the percent changes for all periods from a points array
const computeChanges = (points) => {
  const out = emptyChanges();
  if (!points.length) return out;

  const latest = points[points.length - 1];
  const refTime = latest.t;
  const latestClose = latest.c;

  PERIODS.forEach((p) => {
    const targetTime = refTime - p.days * DAY;

    // Last point on or before the target date (handles weekends/holidays).
    let past = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].t <= targetTime) {
        past = points[i];
        break;
      }
    }

    // No data old enough → symbol is too new for this period
    if (past && past.c > 0) {
      out[p.key] = ((latestClose - past.c) / past.c) * 100;
    }
  });

  return out;
};

// Fetch and compute period changes for many Yahoo symbols.
// Returns a map: { yahooSymbol: { change7d, change1mo, change3mo, change6mo, change1y } }
const batchPriceChanges = async (yahooSymbols) => {
  if (!yahooSymbols || !yahooSymbols.length) return {};

  const map = {};
  const chunkSize = 5; // limit concurrency to avoid Yahoo rate limiting

  for (let i = 0; i < yahooSymbols.length; i += chunkSize) {
    const chunk = yahooSymbols.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (sym) => {
      try {
        const result = await chart(sym, '2y', '1d');
        map[sym] = computeChanges(extractPoints(result));
      } catch (err) {
        map[sym] = emptyChanges();
      }
    }));
  }

  return map;
};

exports.batchPriceChanges = batchPriceChanges;
exports.computeChanges = computeChanges;
exports.extractPoints = extractPoints;
exports.emptyChanges = emptyChanges;
