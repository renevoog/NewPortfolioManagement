// Sharpe simulation — historical price fetch & alignment.
//
// Port of CRYPTO_API's yahoo_API_for_sharpe.js onto this project's direct
// Yahoo v8 chart client. For each asset it pulls daily closes over the chosen
// date range, then aligns them onto their COMMON trading days (set intersection)
// so mixed-market watchlists work, and returns them in the shape the calc expects:
//   rawDataArray = [ ['2024-01-02', ...dates], [close, ...], [close, ...] ]
//
// Contract (matches the original so the controller can branch on it):
//   { listOfAssets, outputListForRawDataArray, errorList }
// On any problem `errorList` is non-empty and the other fields may be absent.

'use strict';

const { chartRange } = require('../yahoo/yahooFinanceClient');

const DAY_MS = 24 * 60 * 60 * 1000;

// UTC YYYY-MM-DD from a UNIX seconds timestamp (consistent across assets).
const toDateKey = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Normalise Yahoo's meta.firstTradeDate (number of seconds, ms, or ISO string)
// to milliseconds; returns null if it can't be parsed.
const firstTradeMs = (meta) => {
  if (!meta) return null;
  const v = meta.firstTradeDate;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const p = Date.parse(v);
    return isNaN(p) ? null : p;
  }
  return null;
};

// Align many assets onto their COMMON trading days (set intersection of dates).
// This makes mixed-market selections work (e.g. a US stock + a Paris stock)
// instead of erroring on holiday-calendar mismatch. Input: array (per asset)
// of ascending [{ date, close }]. Returns { dates, closes } where `dates` is the
// sorted common date list and closes[i] is that asset's closes on those dates.
const alignByCommonDates = (perAssetPoints) => {
  if (!perAssetPoints.length) return { dates: [], closes: [] };

  // date -> close map per asset
  const maps = perAssetPoints.map((points) => {
    const m = new Map();
    points.forEach((p) => m.set(p.date, p.close));
    return m;
  });

  // Intersection: start from the first asset's dates, keep those in every map.
  let common = Array.from(maps[0].keys());
  for (let i = 1; i < maps.length; i++) {
    common = common.filter((d) => maps[i].has(d));
  }
  common.sort(); // ISO YYYY-MM-DD sorts chronologically as strings

  const closes = maps.map((m) => common.map((d) => m.get(d)));
  return { dates: common, closes: closes };
};

// Pull ascending { date, close } points (raw close, finite, > 0) from a v8 result.
// `maxDateKey` (YYYY-MM-DD, optional) drops any bar after the requested end date
// — this excludes Yahoo's trailing live/partial "today" bar (intraday price),
// which would otherwise overwrite a settled close and corrupt the last return.
const extractSeries = (result, maxDateKey) => {
  if (!result || !Array.isArray(result.timestamp)) return [];
  const ts = result.timestamp;
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  const closes = (quote && Array.isArray(quote.close)) ? quote.close : [];

  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof ts[i] === 'number' && typeof c === 'number' && isFinite(c) && c > 0) {
      const dateKey = toDateKey(ts[i]);
      if (maxDateKey && dateKey > maxDateKey) continue;
      points.push({ date: dateKey, close: c });
    }
  }
  return points;
};

// assets_yahoo   — Yahoo symbols to fetch (already mapped from tvSymbols)
// assets_labels  — user-facing labels, same order (for legend + messages)
// start_ms / end_ms — inclusive date range in epoch milliseconds
// asset_type     — 'stocks' | 'crypto' (only affects the end-date padding)
const fetchSharpeHistory = async (assets_yahoo, assets_labels, start_ms, end_ms, asset_type) => {
  const errorList = [];
  const labels = assets_labels && assets_labels.length === assets_yahoo.length
    ? assets_labels
    : assets_yahoo;

  try {
    // Yahoo's period2 is exclusive of the final bar for daily stock data; pad
    // by a day so the chosen end date is included (crypto trades every day).
    const period1Sec = Math.floor(start_ms / 1000);
    const period2Sec = Math.floor((end_ms + (asset_type === 'stocks' ? DAY_MS : 0)) / 1000);

    // Compare/bound on UTC date keys (day granularity) so intraday market-open
    // timestamps don't skew boundary checks.
    const startDateKey = toDateKey(period1Sec);
    const endDateKey = toDateKey(Math.floor(end_ms / 1000));

    const perAssetPoints = [];

    for (let i = 0; i < assets_yahoo.length; i++) {
      const sym = assets_yahoo[i];
      const result = await chartRange(sym, period1Sec, period2Sec, '1d');

      if (!result) {
        errorList.push(`No data returned for ${labels[i]}.`);
        return { errorList };
      }

      // Reject symbols whose history doesn't reach the requested start date.
      // Compare by UTC day, not raw ms — meta.firstTradeDate is the first bar's
      // intraday market-open moment, so a same-day start must NOT be rejected.
      const ftMs = firstTradeMs(result.meta);
      if (ftMs !== null) {
        const firstTradeKey = toDateKey(Math.floor(ftMs / 1000));
        if (startDateKey < firstTradeKey) {
          errorList.push(`The first trading day of ${labels[i]} is ${firstTradeKey}. Pick a later start date.`);
          return { errorList };
        }
      }

      const points = extractSeries(result, endDateKey);
      if (points.length === 0) {
        errorList.push(`No price data for ${labels[i]} in the selected interval.`);
        return { errorList };
      }

      perAssetPoints.push(points);
    }

    // Align on the assets' common trading days (works across market calendars).
    const aligned = alignByCommonDates(perAssetPoints);

    // Need enough overlapping days to compute meaningful returns/covariance.
    const MIN_POINTS = 5;
    if (aligned.dates.length < MIN_POINTS) {
      errorList.push('Not enough overlapping trading days for the selected assets and date range. Try a longer range or assets from the same market.');
      return { errorList };
    }

    // Header list mirrors the original: 'date' followed by the asset labels.
    const listOfAssets = ['date'].concat(labels);

    // rawDataArray = [ dates, asset0Closes, asset1Closes, ... ]
    const outputListForRawDataArray = [aligned.dates].concat(aligned.closes);

    return { listOfAssets, outputListForRawDataArray, errorList };
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown error';
    // The direct v8 client throws "Yahoo chart failed: <status>" on any non-2xx
    // (bad/delisted symbol, out-of-range period, rate limit). Surface a friendly
    // message instead of the raw status string.
    if (msg.indexOf('Yahoo chart failed') !== -1 || msg.indexOf("Data doesn't exist for") !== -1) {
      errorList.push('Could not fetch price data for the selected assets and interval. Check the symbols and date range, then try again.');
    } else {
      errorList.push(msg);
    }
    return { errorList };
  }
};

exports.fetchSharpeHistory = fetchSharpeHistory;
exports.alignByCommonDates = alignByCommonDates;
exports.extractSeries = extractSeries;
