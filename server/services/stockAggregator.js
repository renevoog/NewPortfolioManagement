const { resolveInstruments, getRatesForInstrumentIds, getInstrumentDetails } = require('./etoro/etoroStockService');
const { batchQuotes, batchAnalystData } = require('./yahoo/yahooStockService');
const { batchPriceChanges, emptyChanges } = require('./yahoo/yahooHistoryService');
const { getYahooSymbol } = require('./symbolMap');
const { formatMarketCap, formatPrice, formatDailyChange, formatPercent, formatPercentPlain, formatRatio, formatBeta, formatTargetPrice, formatEstoniaTime } = require('./formatters');
const { buildEvent } = require('./eventService');

// Build a mapping of tvSymbol -> yahooSymbol for a list of TV symbols
// Prefers DB-stored mapping, then in-memory map, then falls back to symbol itself
const buildYahooMap = (tvSymbols, dbSymbolMap) => {
  const map = {};
  tvSymbols.forEach((tv) => {
    // Prefer DB-stored mapping (from addSymbol resolution)
    if (dbSymbolMap && dbSymbolMap[tv]) {
      map[tv] = dbSymbolMap[tv];
    } else {
      const yahoo = getYahooSymbol(tv);
      map[tv] = yahoo || tv;
    }
  });
  return map;
};

// Get stock rows for all symbols
// Primary: Yahoo Finance. Fallback: eToro (for price when Yahoo fails, and for analyst data when Yahoo lacks it)
const getStockRows = async (tvSymbols, dbSymbolMap) => {
  if (!tvSymbols || !tvSymbols.length) return [];

  const yahooMap = buildYahooMap(tvSymbols, dbSymbolMap);
  const yahooSymbols = [...new Set(Object.values(yahooMap))];

  // Phase 1: Fetch everything from Yahoo
  let yahooQuotes = {};
  let yahooAnalyst = {};
  let yahooChanges = {};

  try {
    const [quotes, analyst, changes] = await Promise.all([
      batchQuotes(yahooSymbols),
      batchAnalystData(yahooSymbols),
      batchPriceChanges(yahooSymbols)
    ]);
    yahooQuotes = quotes;
    yahooAnalyst = analyst;
    yahooChanges = changes;
  } catch (err) {
    console.log('Yahoo data fetch error:', err.message);
  }

  // Phase 2: Identify symbols where Yahoo returned no price (need eToro fallback)
  const missingSymbols = tvSymbols.filter((tv) => {
    const yq = yahooQuotes[yahooMap[tv]];
    return !yq || typeof yq.regularMarketPrice !== 'number';
  });

  // Phase 2b: Also resolve eToro for symbols missing analyst data
  const missingAnalystSymbols = tvSymbols.filter((tv) => {
    const ya = yahooAnalyst[yahooMap[tv]];
    const hasAnalyst = ya && (ya.targetPrice !== null || ya.rating !== null);
    return !hasAnalyst;
  });

  // Union of symbols needing eToro
  const needEtoro = [...new Set([...missingSymbols, ...missingAnalystSymbols])];

  let etoroData = {};
  if (needEtoro.length > 0) {
    console.log('eToro lookup for', needEtoro.length, 'symbols');
    etoroData = await fetchEtoroFallback(needEtoro);
  }

  const now = new Date();

  return tvSymbols.map((tvSymbol) => {
    const yahooSym = yahooMap[tvSymbol];
    const yQuote = yahooQuotes[yahooSym] || null;
    const yAnalyst = yahooAnalyst[yahooSym] || null;
    const changes = yahooChanges[yahooSym] || emptyChanges();
    const etoro = etoroData[tvSymbol] || null;

    const raw = extractRawValues(yQuote, yAnalyst, etoro);
    const event = buildEvent(yQuote, now);

    return {
      symbol: tvSymbol,
      companyName: raw.companyName || '-',
      marketCap: formatMarketCap(raw.marketCap, raw.currency),
      lastPrice: formatPrice(raw.lastPrice, raw.currency),
      dailyChange: formatDailyChange(raw.dailyChange, raw.currency),
      dailyChangePct: formatPercent(raw.dailyChangePct),
      change7d: formatPercent(changes.change7d),
      change1mo: formatPercent(changes.change1mo),
      change3mo: formatPercent(changes.change3mo),
      change6mo: formatPercent(changes.change6mo),
      change1y: formatPercent(changes.change1y),
      range52w: formatPercentPlain(raw.range52wPct, 0),
      vs200d: formatPercent(raw.vs200dPct),
      forwardPE: formatRatio(raw.forwardPE, 1),
      peg: formatRatio(raw.pegRatio, 2),
      divYield: formatPercentPlain(raw.dividendYieldPct, 2),
      payout: formatPercentPlain(raw.payoutRatioPct, 0),
      beta: formatBeta(raw.beta),
      targetPrice: formatTargetPrice(raw.targetPrice, raw.currency),
      upside: formatPercent(raw.upsidePct),
      rating: raw.rating || '-',
      event: event
    };
  });
};

// Fetch eToro data only for the symbols that need it
const fetchEtoroFallback = async (tvSymbols) => {
  const result = {};

  try {
    const instruments = await resolveInstruments(tvSymbols);

    const idToSymbol = {};
    const instrumentIds = [];
    Object.entries(instruments).forEach(([sym, inst]) => {
      if (inst && (inst.instrumentId || inst.internalInstrumentId)) {
        const id = String(inst.instrumentId || inst.internalInstrumentId);
        idToSymbol[id] = sym;
        instrumentIds.push(id);
      }
    });

    const rates = await getRatesForInstrumentIds(instrumentIds);

    tvSymbols.forEach((sym) => {
      const inst = instruments[sym];
      const details = getInstrumentDetails(inst);
      const id = String(details.instrumentId || '');
      const rate = rates[id] || null;

      result[sym] = { details, rate };
    });
  } catch (err) {
    console.log('eToro fallback fetch failed:', err.message);
  }

  return result;
};

// Extract raw values — Yahoo primary, eToro fills gaps for price AND analyst data
const extractRawValues = (yQuote, yAnalyst, etoro) => {
  const etoroDetails = (etoro && etoro.details) || {};
  const etoroRate = (etoro && etoro.rate) || null;

  // Company name
  const companyName = (yQuote && (yQuote.longName || yQuote.shortName))
    || etoroDetails.companyName
    || null;

  // Currency
  const currency = (yQuote && yQuote.currency) || 'USD';

  // Market cap — Yahoo primary, eToro fallback
  const marketCap = (yQuote && yQuote.marketCap)
    || etoroDetails.marketCap
    || null;

  // Last price
  let lastPrice = null;
  if (yQuote && typeof yQuote.regularMarketPrice === 'number') {
    lastPrice = yQuote.regularMarketPrice;
  } else if (etoroRate && typeof etoroRate.lastExecution === 'number') {
    lastPrice = etoroRate.lastExecution;
  } else if (etoroDetails.currentRate !== null && etoroDetails.currentRate !== undefined) {
    lastPrice = etoroDetails.currentRate;
  }

  // Daily change
  let dailyChange = null;
  let dailyChangePct = null;
  if (yQuote && typeof yQuote.regularMarketChange === 'number') {
    dailyChange = yQuote.regularMarketChange;
    dailyChangePct = yQuote.regularMarketChangePercent;
  } else if (etoroDetails.dailyPriceChangePct !== null && etoroDetails.dailyPriceChangePct !== undefined) {
    dailyChangePct = etoroDetails.dailyPriceChangePct;
    if (etoroDetails.closingPrice) {
      dailyChange = etoroDetails.closingPrice * (dailyChangePct / 100);
    }
  }

  // Beta — Yahoo primary, eToro fallback
  let beta = (yAnalyst && typeof yAnalyst.beta === 'number') ? yAnalyst.beta : null;
  if (beta === null && typeof etoroDetails.beta === 'number') {
    beta = etoroDetails.beta;
  }

  // Target price — Yahoo primary, eToro TipRanks fallback
  let targetPrice = (yAnalyst && typeof yAnalyst.targetPrice === 'number') ? yAnalyst.targetPrice : null;
  if (targetPrice === null && typeof etoroDetails.tipranksTargetPrice === 'number') {
    targetPrice = etoroDetails.tipranksTargetPrice;
  }

  // Rating — Yahoo primary, eToro TipRanks fallback
  let rating = (yAnalyst && yAnalyst.rating) ? formatRating(yAnalyst.rating) : null;
  if (rating === null && etoroDetails.tipranksConsensus) {
    rating = formatRating(etoroDetails.tipranksConsensus);
  }

  // Forward P/E — quote primary, summaryDetail fallback
  let forwardPE = (yQuote && typeof yQuote.forwardPE === 'number') ? yQuote.forwardPE : null;
  if (forwardPE === null && yAnalyst && typeof yAnalyst.forwardPE === 'number') {
    forwardPE = yAnalyst.forwardPE;
  }

  // PEG ratio (defaultKeyStatistics)
  const pegRatio = (yAnalyst && typeof yAnalyst.pegRatio === 'number') ? yAnalyst.pegRatio : null;

  // Dividend yield & payout ratio — stored as fractions by Yahoo, convert to %
  const dividendYieldPct = (yAnalyst && typeof yAnalyst.dividendYield === 'number')
    ? yAnalyst.dividendYield * 100 : null;
  const payoutRatioPct = (yAnalyst && typeof yAnalyst.payoutRatio === 'number')
    ? yAnalyst.payoutRatio * 100 : null;

  // Upside to analyst target: (target - price) / price
  let upsidePct = null;
  if (targetPrice !== null && lastPrice !== null && lastPrice > 0) {
    upsidePct = ((targetPrice - lastPrice) / lastPrice) * 100;
  }

  // 52-week range position: 0% = at the year low, 100% = at the year high
  let range52wPct = null;
  const hi52 = (yQuote && typeof yQuote.fiftyTwoWeekHigh === 'number') ? yQuote.fiftyTwoWeekHigh : null;
  const lo52 = (yQuote && typeof yQuote.fiftyTwoWeekLow === 'number') ? yQuote.fiftyTwoWeekLow : null;
  if (lastPrice !== null && hi52 !== null && lo52 !== null && hi52 > lo52) {
    range52wPct = ((lastPrice - lo52) / (hi52 - lo52)) * 100;
    if (range52wPct < 0) range52wPct = 0;
    if (range52wPct > 100) range52wPct = 100;
  }

  // Price vs 200-day moving average: + = above (uptrend), - = below
  let vs200dPct = null;
  const ma200 = (yQuote && typeof yQuote.twoHundredDayAverage === 'number') ? yQuote.twoHundredDayAverage : null;
  if (lastPrice !== null && ma200 !== null && ma200 > 0) {
    vs200dPct = ((lastPrice - ma200) / ma200) * 100;
  }

  return {
    companyName, currency, marketCap, lastPrice,
    dailyChange, dailyChangePct, beta, targetPrice, rating,
    forwardPE, pegRatio, dividendYieldPct, payoutRatioPct,
    upsidePct, range52wPct, vs200dPct
  };
};

// Format recommendation key to readable form
const formatRating = (key) => {
  if (!key || key === 'none') return null;
  const map = {
    'strongBuy': 'Strong Buy',
    'strong_buy': 'Strong Buy',
    'buy': 'Buy',
    'hold': 'Hold',
    'sell': 'Sell',
    'strongSell': 'Strong Sell',
    'strong_sell': 'Strong Sell',
    'underperform': 'Underperform',
    'outperform': 'Outperform'
  };
  return map[key] || key;
};

exports.getStockRows = getStockRows;
