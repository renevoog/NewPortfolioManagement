const { etoroGet } = require('./etoroHttpClient');

// In-memory instrument resolution cache: symbol -> instrumentData
const instrumentCache = {};

const pickBestSymbolMatch = (items, symbol) => {
  if (!Array.isArray(items) || !items.length) return null;

  const target = String(symbol || '').toUpperCase();

  // Try exact match on internalSymbolFull
  const exact = items.find((item) => {
    return String(item.internalSymbolFull || '').toUpperCase() === target;
  });

  if (exact) return exact;

  // Try match on symbolFull
  const symbolMatch = items.find((item) => {
    return String(item.symbolFull || '').toUpperCase() === target;
  });

  if (symbolMatch) return symbolMatch;

  return items[0];
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

// Batch resolve instruments (parallel in chunks to balance speed vs rate limits)
const resolveInstruments = async (symbols) => {
  const results = {};
  const uncached = [];

  // Return cached results immediately
  symbols.forEach((symbol) => {
    const key = String(symbol).toUpperCase();
    if (instrumentCache[key]) {
      results[symbol] = instrumentCache[key];
    } else {
      uncached.push(symbol);
    }
  });

  // Resolve uncached in parallel chunks of 5 (eToro rate limits at ~60 req/min)
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
// eToro search returns: currentRate, dailyPriceChange, internalClosingPrice, etc.
const getInstrumentDetails = (instrument) => {
  if (!instrument) return {};

  return {
    instrumentId: instrument.instrumentId || instrument.internalInstrumentId || null,
    companyName: instrument.internalInstrumentDisplayName || instrument.instrumentDisplayName || instrument.symbolFull || null,
    symbol: instrument.internalSymbolFull || instrument.symbolFull || null,
    currentRate: typeof instrument.currentRate === 'number' ? instrument.currentRate : null,
    closingPrice: typeof instrument.internalClosingPrice === 'number' ? instrument.internalClosingPrice : null,
    dailyPriceChangePct: typeof instrument.dailyPriceChange === 'number' ? instrument.dailyPriceChange : null
  };
};

// Validate if a symbol exists on eToro
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
