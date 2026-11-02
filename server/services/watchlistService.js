const { watchlistAssetModel, trackedAssetModel } = require('../model/models');
const { resolveSymbol } = require('./trackedAssetsService');

const normalizeSymbol = (value) => {
  if (typeof value !== 'string') return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^=:_/-]{0,49}$/.test(symbol) ? symbol : null;
};

const getAssets = (userId) => watchlistAssetModel.find({ userId }).sort({ addedAt: 1, _id: 1 }).lean();

const addAsset = async (userId, value) => {
  const symbol = normalizeSymbol(value);
  if (!symbol) return { success: false, error: 'Enter a valid ticker symbol (for example AAPL or BTC-USD).' };

  const existing = await watchlistAssetModel.findOne({ userId, tvSymbol: symbol });
  if (existing) return { success: true, symbol, alreadyAdded: true };

  // Preserve the mapping already resolved for this user's dashboard.
  const tracked = await trackedAssetModel.findOne({ userId, tvSymbol: symbol });
  const yahooSymbol = (tracked && tracked.yahooSymbol) || await resolveSymbol(symbol);
  if (!yahooSymbol) return { success: false, error: `Symbol not found: ${symbol}` };

  try {
    await watchlistAssetModel.updateOne(
      { userId, tvSymbol: symbol },
      { $setOnInsert: { userId, tvSymbol: symbol, yahooSymbol } },
      { upsert: true, runValidators: true }
    );
  } catch (err) {
    // Concurrent clicks must still produce a single favourite.
    if (err.code !== 11000) throw err;
  }
  return { success: true, symbol };
};

const removeAsset = async (userId, value) => {
  const symbol = normalizeSymbol(value);
  if (!symbol) return { success: false, error: 'Invalid ticker symbol.' };
  await watchlistAssetModel.deleteOne({ userId, tvSymbol: symbol });
  return { success: true, symbol };
};

module.exports = { getAssets, addAsset, removeAsset, normalizeSymbol };
