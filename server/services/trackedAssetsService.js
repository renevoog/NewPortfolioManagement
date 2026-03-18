const { trackedAssetModel, userModel } = require('../model/models');
const { getYahooSymbol, getInitialSymbols, hasSymbol, addMapping } = require('./symbolMap');
const { validateSymbol: yahooValidate, searchSymbol: yahooSearch } = require('./yahoo/yahooStockService');
const { validateSymbol: etoroValidate } = require('./etoro/etoroStockService');

const ADMIN_EMAIL = 'renevoog@gmail.com';

// Get all tracked symbols for a user
// Get tracked symbols for a user (returns array of tvSymbols)
const getTrackedSymbols = async (userId) => {
  const assets = await trackedAssetModel.find({ userId, tvSymbol: { $ne: '__INITIALIZED__' } }).sort({ addedAt: 1 });
  return assets.map((a) => a.tvSymbol);
};

// Get tracked symbols with their stored Yahoo mappings
// Returns: { tvSymbol: yahooSymbol } map
const getTrackedSymbolMap = async (userId) => {
  const assets = await trackedAssetModel.find({ userId, tvSymbol: { $ne: '__INITIALIZED__' } }).sort({ addedAt: 1 });
  const map = {};
  assets.forEach((a) => {
    if (a.yahooSymbol) {
      map[a.tvSymbol] = a.yahooSymbol;
    }
  });
  return map;
};

// Get tracked assets with full documents (for sharing)
const getTrackedAssets = async (userId) => {
  return trackedAssetModel.find({ userId }).sort({ addedAt: 1 });
};

// Check if this is the very first load (user has never had any assets)
// Different from "user deleted everything" — we track this with an initialized flag
const initializeTrackedAssets = async (userId) => {
  // Check if user already has any assets OR has been initialized before
  const existing = await trackedAssetModel.countDocuments({ userId });
  if (existing > 0) return;

  // Check if this user was ever initialized (has a sentinel record)
  const sentinel = await trackedAssetModel.findOne({ userId, tvSymbol: '__INITIALIZED__' });
  if (sentinel) return; // User was initialized before — they deleted everything intentionally

  // First-time user: seed with initial list and mark as initialized
  const initialSymbols = getInitialSymbols();
  const docs = initialSymbols.map((tvSym) => ({
    tvSymbol: tvSym,
    yahooSymbol: getYahooSymbol(tvSym),
    userId: userId
  }));

  // Add sentinel record to mark this user as initialized
  docs.push({ tvSymbol: '__INITIALIZED__', yahooSymbol: null, userId: userId });

  try {
    await trackedAssetModel.insertMany(docs, { ordered: false });
  } catch (err) {
    if (err.code !== 11000 && !(err.writeErrors && err.writeErrors.every((e) => e.err.code === 11000))) {
      throw err;
    }
  }
};

// Add a new symbol for a user
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

// Share the current admin's watchlist to another user (admin-only action)
// Adds any symbols the target user doesn't already have
const shareWatchlist = async (adminUserId, targetEmail) => {
  // Verify the caller is admin
  const adminUser = await userModel.findById(adminUserId);
  if (!adminUser || adminUser.email !== ADMIN_EMAIL) {
    return { success: false, error: 'Only the admin can share watchlists.' };
  }

  // Find target user
  const targetUser = await userModel.findOne({ email: targetEmail });
  if (!targetUser) {
    return { success: false, error: `User not found: ${targetEmail}` };
  }

  if (String(targetUser._id) === String(adminUserId)) {
    return { success: false, error: 'Cannot share to yourself.' };
  }

  // Get admin's symbols (excluding sentinel)
  const adminAssets = await trackedAssetModel.find({
    userId: adminUserId,
    tvSymbol: { $ne: '__INITIALIZED__' }
  });

  // Get target user's existing symbols
  const targetAssets = await trackedAssetModel.find({ userId: String(targetUser._id) });
  const targetSymbols = new Set(targetAssets.map((a) => a.tvSymbol));

  // Add missing symbols to target
  const toAdd = adminAssets
    .filter((a) => !targetSymbols.has(a.tvSymbol))
    .map((a) => ({
      tvSymbol: a.tvSymbol,
      yahooSymbol: a.yahooSymbol,
      userId: String(targetUser._id)
    }));

  // Ensure target has sentinel so they won't get re-seeded
  if (!targetSymbols.has('__INITIALIZED__')) {
    toAdd.push({ tvSymbol: '__INITIALIZED__', yahooSymbol: null, userId: String(targetUser._id) });
  }

  if (toAdd.length === 0) {
    return { success: true, added: 0, message: 'User already has all symbols.' };
  }

  try {
    await trackedAssetModel.insertMany(toAdd, { ordered: false });
  } catch (err) {
    if (err.code !== 11000 && !(err.writeErrors && err.writeErrors.every((e) => e.err.code === 11000))) {
      throw err;
    }
  }

  const addedCount = toAdd.filter((a) => a.tvSymbol !== '__INITIALIZED__').length;
  return { success: true, added: addedCount, message: `Shared ${addedCount} symbols to ${targetEmail}.` };
};

// Check if a user is admin
const isAdmin = async (userId) => {
  const user = await userModel.findById(userId);
  return user && user.email === ADMIN_EMAIL;
};

exports.getTrackedSymbols = getTrackedSymbols;
exports.getTrackedSymbolMap = getTrackedSymbolMap;
exports.getTrackedAssets = getTrackedAssets;
exports.initializeTrackedAssets = initializeTrackedAssets;
exports.addSymbol = addSymbol;
exports.removeSymbol = removeSymbol;
exports.shareWatchlist = shareWatchlist;
exports.isAdmin = isAdmin;
