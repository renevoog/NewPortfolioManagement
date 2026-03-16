const { quote, quoteSummary, search } = require('./yahooFinanceClient');

// Extract raw value from Yahoo's nested {raw, fmt} format
const rawVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'raw' in v) return v.raw;
  if (typeof v === 'number') return v;
  return null;
};

// Batch fetch quotes for multiple Yahoo symbols
// Returns a map: { yahooSymbol: quoteData }
const batchQuotes = async (yahooSymbols) => {
  if (!yahooSymbols || !yahooSymbols.length) return {};

  try {
    const results = await quote(yahooSymbols);

    const map = {};
    if (Array.isArray(results)) {
      results.forEach((item) => {
        if (item && item.symbol) {
          map[item.symbol] = item;
        }
      });
    } else if (results && results.symbol) {
      map[results.symbol] = results;
    }

    return map;
  } catch (err) {
    console.log('Yahoo batch quote failed:', err.message);
    return {};
  }
};

// Fetch analyst data + beta for a single Yahoo symbol
const getAnalystData = async (yahooSymbol) => {
  try {
    const summary = await quoteSummary(yahooSymbol, {
      modules: ['financialData', 'summaryDetail']
    });

    const fd = summary.financialData || {};
    const sd = summary.summaryDetail || {};

    return {
      targetPrice: rawVal(fd.targetMeanPrice),
      rating: fd.recommendationKey || null,
      numberOfAnalysts: rawVal(fd.numberOfAnalystOpinions),
      beta: rawVal(sd.beta)
    };
  } catch (err) {
    return { targetPrice: null, rating: null, numberOfAnalysts: null, beta: null };
  }
};

// Batch fetch analyst data for multiple symbols
// quoteSummary only supports single symbols, so we parallelize with concurrency limit
const batchAnalystData = async (yahooSymbols) => {
  if (!yahooSymbols || !yahooSymbols.length) return {};

  const map = {};
  // Process in chunks of 5 to avoid rate limiting
  const chunkSize = 5;
  for (let i = 0; i < yahooSymbols.length; i += chunkSize) {
    const chunk = yahooSymbols.slice(i, i + chunkSize);
    const promises = chunk.map(async (sym) => {
      const data = await getAnalystData(sym);
      map[sym] = data;
    });
    await Promise.all(promises);
  }

  return map;
};

// Validate if a Yahoo symbol exists by attempting a quote
const validateSymbol = async (yahooSymbol) => {
  try {
    const result = await quote(yahooSymbol);
    if (Array.isArray(result)) return result.length > 0;
    return result && result.symbol ? true : false;
  } catch (err) {
    return false;
  }
};

// Search Yahoo for a symbol/name and return best match Yahoo symbol
const searchSymbol = async (query) => {
  try {
    const results = await search(query);
    if (results && results.quotes && results.quotes.length > 0) {
      const best = results.quotes[0];
      return best.symbol || null;
    }
    return null;
  } catch (err) {
    return null;
  }
};

exports.batchQuotes = batchQuotes;
exports.batchAnalystData = batchAnalystData;
exports.getAnalystData = getAnalystData;
exports.validateSymbol = validateSymbol;
exports.searchSymbol = searchSymbol;
