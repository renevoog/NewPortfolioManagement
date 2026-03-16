const { etoroGet } = require('./etoroHttpClient');

const pickBestSymbolMatch = (items, symbol) => {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }

  const target = String(symbol || '').toUpperCase();

  const exact = items.find((item) => {
    return String(item.internalSymbolFull || '').toUpperCase() === target;
  });

  if (exact) {
    return exact;
  }

  return items[0];
};

const lookupInstrument = async (symbol) => {
  const searchResponse = await etoroGet('/market-data/search', {
    internalSymbolFull: symbol,
    fields: 'instrumentId,internalSymbolFull,currentRate', //Selle v6ib v2lja kommenteerida ja siis saad kogu data, aga ID kaudu on turvalisem, sest see ei muutu kunagi
    pageSize: 20
  });

  const items = searchResponse && searchResponse.items ? searchResponse.items : [];
  return pickBestSymbolMatch(items, symbol);
};

const getRatesForInstrumentIds = async (instrumentIds) => {
  if (!instrumentIds.length) {
    return {};
  }

  const rateResponse = await etoroGet('/market-data/instruments/rates', {
    instrumentIds: instrumentIds.join(',')
  });

  const rates = rateResponse && rateResponse.rates ? rateResponse.rates : [];
  const map = {};

  rates.forEach((rate) => {
    map[String(rate.instrumentID)] = rate;
  });

  return map;
};

const buildUnavailableRow = (symbol) => {
  return {
    symbol,
    price: null,
    timestamp: null,
    source: 'eToro'
  };
};

const getMarketPrices = async (symbols) => {
  const inputSymbols = Array.isArray(symbols) ? symbols : [];
  const sanitizedSymbols = inputSymbols
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter((symbol) => symbol);

  if (!sanitizedSymbols.length) {
    return [];
  }

  try {
    const lookupResults = [];

    for (const symbol of sanitizedSymbols) {
      const instrument = await lookupInstrument(symbol);
      lookupResults.push({
        symbol,
        instrumentId: instrument ? instrument.instrumentId : null
      });
    }

    const instrumentIds = lookupResults
      .map((item) => item.instrumentId)
      .filter((item) => !!item);

    const ratesMap = await getRatesForInstrumentIds(instrumentIds);

    return lookupResults.map((item) => {
      if (!item.instrumentId) {
        return buildUnavailableRow(item.symbol);
      }

      const rate = ratesMap[String(item.instrumentId)];
      if (!rate) {
        return buildUnavailableRow(item.symbol);
      }

      return {
        symbol: item.symbol,
        price: typeof rate.lastExecution === 'number' ? rate.lastExecution : null,
        timestamp: rate.date || null,
        source: 'eToro'
      };
    });
  } catch (err) {
    console.log('eToro market price fetch failed');
    console.log({
      name: err.name,
      code: err.code || null,
      status: err.status || null,
      message: err.message
    });

    return sanitizedSymbols.map((symbol) => buildUnavailableRow(symbol));
  }
};

exports.getMarketPrices = getMarketPrices;
