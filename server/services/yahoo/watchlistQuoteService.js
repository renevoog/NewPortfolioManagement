const { chart } = require('./yahooFinanceClient');
const { extractPoints } = require('./yahooHistoryService');
const { formatPrice, formatDailyChange, formatPercent } = require('../formatters');

const DAY = 24 * 60 * 60;
const CACHE_TTL = 60 * 1000;
const chartCache = new Map();
const pending = new Map();

// A rolling wall-clock window, including weekends, rather than previous close.
// Both ends use the last available trade; intraday samples are five minutes apart.
const calculate24h = (result, now = Date.now()) => {
  const end = Math.floor(now / 1000);
  const cutoff = end - DAY;
  const points = extractPoints(result).filter((point) => point.t <= end);
  const meta = (result && result.meta) || {};
  if (Number.isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
      && Number.isFinite(meta.regularMarketTime) && meta.regularMarketTime <= end) {
    points.push({ t: meta.regularMarketTime, c: meta.regularMarketPrice });
    points.sort((a, b) => a.t - b.t);
  }
  const latest = points[points.length - 1];
  const baseline = points.findLast((point) => point.t <= cutoff);
  const change = latest && baseline ? latest.c - baseline.c : null;
  return {
    price: latest ? latest.c : null,
    change24h: change,
    change24hPct: change === null ? null : change / baseline.c * 100,
    priceTime: latest ? new Date(latest.t * 1000).toISOString() : null,
    comparisonTime: baseline ? new Date(baseline.t * 1000).toISOString() : null
  };
};

const getChart = async (symbol) => {
  const cached = chartCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;
  if (pending.has(symbol)) return pending.get(symbol);
  const request = chart(symbol, '5d', '5m', { signal: AbortSignal.timeout(15000) }).then((result) => {
    // Bound the process cache; never cache failed responses as fresh quotes.
    if (chartCache.size >= 500) chartCache.delete(chartCache.keys().next().value);
    if (result) chartCache.set(symbol, { result, ts: Date.now() });
    return result;
  }).finally(() => pending.delete(symbol));
  pending.set(symbol, request);
  return request;
};

const getWatchlistRows = async (assets) => {
  const rows = [];
  const now = Date.now();
  // Only price history is needed here, not the dashboard's financial analysis.
  for (let i = 0; i < assets.length; i += 5) {
    const chunk = await Promise.all(assets.slice(i, i + 5).map(async (asset) => {
      let result = null;
      try { result = await getChart(asset.yahooSymbol); } catch (err) { /* Show unavailable values. */ }
      const meta = (result && result.meta) || {};
      const values = calculate24h(result, now);
      return {
        symbol: asset.tvSymbol,
        companyName: meta.longName || meta.shortName || asset.tvSymbol,
        currency: meta.currency || null,
        ...values,
        lastPrice: values.price === null ? '-' : formatPrice(values.price, meta.currency),
        change: formatDailyChange(values.change24h, meta.currency),
        changePct: formatPercent(values.change24hPct)
      };
    }));
    rows.push(...chunk);
  }
  return rows;
};

module.exports = { calculate24h, getWatchlistRows };
