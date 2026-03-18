const { etoroGet } = require('./etoroHttpClient');

// In-memory instrument resolution cache: symbol -> instrumentData
const instrumentCache = {};

// Stock/ETF instrument types on eToro (excludes crypto, CFDs, etc.)
const STOCK_TYPES = new Set(['Stocks', 'ETF', 'StocksETFs']);

const pickBestSymbolMatch = (items, symbol) => {
  if (!Array.isArray(items) || !items.length) return null;

  const target = String(symbol || '').toUpperCase();

  // Filter to stock/ETF instruments only (avoid crypto matches like SPX crypto)
  const stockItems = items.filter((item) => {
    const type = item.instrumentTypeID || item.instrumentType || '';
    // If type info is available, filter. If not, keep the item.
    if (!type) return true;
    return STOCK_TYPES.has(type) || typeof type === 'number';
  });

  const pool = stockItems.length > 0 ? stockItems : items;

  // Try exact match on internalSymbolFull
  const exact = pool.find((item) => {
    return String(item.internalSymbolFull || '').toUpperCase() === target;
  });
  if (exact) return exact;

  // Try match on symbolFull
  const symbolMatch = pool.find((item) => {
    return String(item.symbolFull || '').toUpperCase() === target;
  });
  if (symbolMatch) return symbolMatch;

  // Try match on instrumentDisplayName containing the target
  const nameMatch = pool.find((item) => {
    const name = String(item.internalSymbolFull || item.symbolFull || '').toUpperCase();
    return name === target;
  });
  if (nameMatch) return nameMatch;

  // Do NOT fall back to items[0] — ambiguous matches are dangerous
  return null;
};

// Resolve a single symbol to an eToro instrument (with cache)
const resolveInstrument = async (symbol) => {
  const key = String(symbol).toUpperCase();

  if (instrumentCache[key]) {
    return instrumentCache[key];
  }

  try {
    const searchResponse = await etoroGet('/market-data/search', {
      internalSymbolFull: symbol,
      pageSize: 20
    });

    const items = searchResponse && searchResponse.items ? searchResponse.items : [];
    const match = pickBestSymbolMatch(items, symbol);

    if (match) {
      instrumentCache[key] = match;
    }

    return match;
  } catch (err) {
    console.log(`eToro instrument resolve failed for ${symbol}:`, err.message);
    return null;
  }
};

// Batch resolve instruments (parallel in chunks)
const resolveInstruments = async (symbols) => {
  const results = {};
  const uncached = [];

  symbols.forEach((symbol) => {
    const key = String(symbol).toUpperCase();
    if (instrumentCache[key]) {
      results[symbol] = instrumentCache[key];
    } else {
      uncached.push(symbol);
    }
  });

  const chunkSize = 5;
  for (let i = 0; i < uncached.length; i += chunkSize) {
    const chunk = uncached.slice(i, i + chunkSize);
    const promises = chunk.map(async (sym) => {
      results[sym] = await resolveInstrument(sym);
    });
    await Promise.all(promises);
  }

  return results;
};

// Fetch rates for multiple instrument IDs in one batch call
const getRatesForInstrumentIds = async (instrumentIds) => {
  if (!instrumentIds.length) return {};

  try {
    const rateResponse = await etoroGet('/market-data/instruments/rates', {
      instrumentIds: instrumentIds.join(',')
    });

    const rates = rateResponse && rateResponse.rates ? rateResponse.rates : [];
    const map = {};

    rates.forEach((rate) => {
      map[String(rate.instrumentID)] = rate;
    });

    return map;
  } catch (err) {
    console.log('eToro rates batch fetch failed:', err.message);
    return {};
  }
};

// Get full instrument details from cached search response
const getInstrumentDetails = (instrument) => {
  if (!instrument) return {};

  return {
    instrumentId: instrument.instrumentId || instrument.internalInstrumentId || null,
    companyName: instrument.internalInstrumentDisplayName || instrument.instrumentDisplayName || instrument.symbolFull || null,
    symbol: instrument.internalSymbolFull || instrument.symbolFull || null,
    currentRate: typeof instrument.currentRate === 'number' ? instrument.currentRate : null,
    closingPrice: typeof instrument.internalClosingPrice === 'number' ? instrument.internalClosingPrice : null,
    dailyPriceChangePct: typeof instrument.dailyPriceChange === 'number' ? instrument.dailyPriceChange : null,
    // eToro stock snapshot fields the audit confirmed are available
    marketCap: instrument.marketCapInUSD || null,
    beta: instrument['beta-TTM'] || null,
    tipranksConsensus: instrument.tipranksConsensus || null,
    tipranksTargetPrice: typeof instrument.tipranksTargetPrice === 'number' ? instrument.tipranksTargetPrice : null,
    tipranksTotalAnalysts: typeof instrument.tipranksTotalAnalysts === 'number' ? instrument.tipranksTotalAnalysts : null,
    nextEarningDate: instrument.nextEarningDate || null
  };
};

// Validate if a symbol exists on eToro (exact match only)
const validateSymbol = async (symbol) => {
  const instrument = await resolveInstrument(symbol);
  return instrument !== null;
};

// Get cache contents (for debugging)
const getCache = () => ({ ...instrumentCache });

// Clear cache
const clearCache = () => {
  Object.keys(instrumentCache).forEach((key) => delete instrumentCache[key]);
};

exports.resolveInstrument = resolveInstrument;
exports.resolveInstruments = resolveInstruments;
exports.getRatesForInstrumentIds = getRatesForInstrumentIds;
exports.getInstrumentDetails = getInstrumentDetails;
exports.validateSymbol = validateSymbol;
exports.getCache = getCache;
exports.clearCache = clearCache;
