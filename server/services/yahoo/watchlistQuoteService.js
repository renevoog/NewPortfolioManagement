const { chart } = require('./yahooFinanceClient');
const { extractPoints, computeChanges } = require('./yahooHistoryService');
const { formatPrice, formatDailyChange, formatPercent } = require('../formatters');

const DAY = 24 * 60 * 60;
const CACHE_TTL = 60 * 1000;
const chartCache = new Map();
const pending = new Map();

const pricePoints = (result, end) => {
  const points = extractPoints(result, { adjusted: false }).filter((point) => point.t <= end);
  const meta = (result && result.meta) || {};
  if (Number.isFinite(meta.regularMarketPrice) && meta.regularMarketPrice > 0
      && Number.isFinite(meta.regularMarketTime) && meta.regularMarketTime <= end) {
    points.push({ t: meta.regularMarketTime, c: meta.regularMarketPrice });
    points.sort((a, b) => a.t - b.t);
  }
  return points;
};

// Anchor every period to the latest price, so the last change remains visible
// after hours and over weekends. Prefer intraday history for 24h; daily closes
// also cover provider gaps, holidays and longer periods. These are price changes,
// not dividend-adjusted returns. Longer periods reuse the dashboard's 7/30/182 days.
const calculatePriceChanges = (intradayResult, dailyResult = null, now = Date.now()) => {
  const end = Math.floor(now / 1000);
  const intraday = pricePoints(intradayResult, end);
  const daily = pricePoints(dailyResult, end);
  const latest = [intraday[intraday.length - 1], daily[daily.length - 1]]
    .filter(Boolean).sort((a, b) => b.t - a.t)[0];
  const cutoff = latest ? latest.t - DAY : null;
  const baseline = latest && (intraday.findLast((point) => point.t <= cutoff)
    || daily.findLast((point) => point.t <= cutoff));
  const change = latest && baseline ? latest.c - baseline.c : null;
  const periods = computeChanges(latest ? [...daily.filter((point) => point.t < latest.t), latest] : []);
  return {
    price: latest ? latest.c : null,
    change24h: change,
    change24hPct: change === null ? null : change / baseline.c * 100,
    change7dPct: periods.change7d,
    change1moPct: periods.change1mo,
    change6moPct: periods.change6mo,
    priceTime: latest ? new Date(latest.t * 1000).toISOString() : null,
    comparisonTime: baseline ? new Date(baseline.t * 1000).toISOString() : null
  };
};

const getChart = async (symbol, range, interval) => {
  const key = `${symbol}:${range}:${interval}`;
  const cached = chartCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;
  if (pending.has(key)) return pending.get(key);
  const request = chart(symbol, range, interval, { signal: AbortSignal.timeout(15000) }).then((result) => {
    // Bound the process cache; never cache failed responses as fresh quotes.
    if (chartCache.size >= 500) chartCache.delete(chartCache.keys().next().value);
    if (result) chartCache.set(key, { result, ts: Date.now() });
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};

const getWatchlistRows = async (assets) => {
  const rows = [];
  // Only price history is needed here, not the dashboard's financial analysis.
  for (let i = 0; i < assets.length; i += 5) {
    const chunk = await Promise.all(assets.slice(i, i + 5).map(async (asset) => {
      const results = await Promise.allSettled([
        getChart(asset.yahooSymbol, '5d', '5m'),
        getChart(asset.yahooSymbol, '1y', '1d')
      ]);
      const [intraday, daily] = results.map((result) => result.status === 'fulfilled' ? result.value : null);
      const meta = { ...((daily && daily.meta) || {}), ...((intraday && intraday.meta) || {}) };
      const values = calculatePriceChanges(intraday, daily);
      return {
        symbol: asset.tvSymbol,
        companyName: meta.longName || meta.shortName || asset.tvSymbol,
        currency: meta.currency || null,
        ...values,
        lastPrice: values.price === null ? '-' : formatPrice(values.price, meta.currency),
        change: formatDailyChange(values.change24h, meta.currency),
        changePct: formatPercent(values.change24hPct),
        change7d: formatPercent(values.change7dPct),
        change1mo: formatPercent(values.change1moPct),
        change6mo: formatPercent(values.change6moPct)
      };
    }));
    rows.push(...chunk);
  }
  return rows;
};

module.exports = { calculatePriceChanges, getWatchlistRows };
