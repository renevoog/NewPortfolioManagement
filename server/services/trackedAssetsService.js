const { trackedAssetModel } = require('../model/models');
const { getYahooSymbol, getInitialSymbols, hasSymbol, addMapping } = require('./symbolMap');
const { validateSymbol: yahooValidate, searchSymbol: yahooSearch } = require('./yahoo/yahooStockService');
const { validateSymbol: etoroValidate } = require('./etoro/etoroStockService');

// Get all tracked symbols for a user
const getTrackedSymbols = async (userId) => {
  const assets = await trackedAssetModel.find({ userId }).sort({ addedAt: 1 });
  return assets.map((a) => a.tvSymbol);
};

// Initialize tracked assets for a user (seeds the initial list if empty)
const initializeTrackedAssets = async (userId) => {
  const existing = await trackedAssetModel.countDocuments({ userId });

  if (existing > 0) {
    return; // Already initialized
  }

  const initialSymbols = getInitialSymbols();
  const docs = initialSymbols.map((tvSym) => ({
    tvSymbol: tvSym,
    yahooSymbol: getYahooSymbol(tvSym),
    userId: userId
  }));

  try {
    await trackedAssetModel.insertMany(docs, { ordered: false });
  } catch (err) {
    // Ignore duplicate key errors (E11000) from race conditions
    if (err.code !== 11000 && !(err.writeErrors && err.writeErrors.every((e) => e.err.code === 11000))) {
      throw err;
    }
  }
};

// Add a new symbol for a user
// Returns: { success: true } or { success: false, error: 'message' }
const addSymbol = async (userId, tvSymbol) => {
  const sym = String(tvSymbol || '').trim();
  if (!sym) {
    return { success: false, error: 'Symbol cannot be empty' };
  }

  // Check if already tracked
  const existing = await trackedAssetModel.findOne({ userId, tvSymbol: sym });
  if (existing) {
    return { success: false, error: `Symbol already tracked: ${sym}` };
  }

  // Check if it's in our known mapping
  if (hasSymbol(sym)) {
    await trackedAssetModel.create({
      tvSymbol: sym,
      yahooSymbol: getYahooSymbol(sym),
      userId: userId
    });
    return { success: true };
  }

  // Unknown symbol - try Yahoo first, then eToro as fallback
  let yahooSym = null;
  try {
    const directValid = await yahooValidate(sym);
    if (directValid) {
      yahooSym = sym;
    } else {
      yahooSym = await yahooSearch(sym);
    }
  } catch (err) {
    // Yahoo failed
  }

  if (yahooSym) {
    addMapping(sym, yahooSym);
    await trackedAssetModel.create({
      tvSymbol: sym,
      yahooSymbol: yahooSym,
      userId: userId
    });
    return { success: true };
  }

  // Yahoo didn't find it — try eToro as fallback
  try {
    const etoroFound = await etoroValidate(sym);
    if (etoroFound) {
      addMapping(sym, sym);
      await trackedAssetModel.create({
        tvSymbol: sym,
        yahooSymbol: sym,
        userId: userId
      });
      return { success: true };
    }
  } catch (err) {
    // eToro also failed
  }

  return { success: false, error: `Symbol not found: ${sym}` };
};

// Remove a symbol for a user
const removeSymbol = async (userId, tvSymbol) => {
  await trackedAssetModel.deleteOne({ userId, tvSymbol });
};

exports.getTrackedSymbols = getTrackedSymbols;
exports.initializeTrackedAssets = initializeTrackedAssets;
exports.addSymbol = addSymbol;
exports.removeSymbol = removeSymbol;
