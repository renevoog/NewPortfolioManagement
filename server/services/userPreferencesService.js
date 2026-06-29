// Per-user dashboard preferences (currently: hidden table columns)

const { userModel } = require('../model/models');

// Whitelist of toggleable dashboard column keys — must match the <th data-col-key>
// values in views/home.ejs. Anything outside this set is rejected on save.
const VALID_COLUMN_KEYS = [
  'company', 'marketCap', 'price', 'dailyChange', 'dailyChangePct',
  'change7d', 'change1mo', 'change3mo', 'change6mo', 'change1y',
  'range52w', 'vs200d', 'forwardPE', 'peg', 'divYield', 'payout',
  'beta', 'target', 'upside', 'rating', 'events'
];
const VALID_SET = new Set(VALID_COLUMN_KEYS);

// Get a user's saved hidden columns. Returns an array (possibly empty) if the
// user has saved before, or null if they never have.
const getColumnPreferences = async (userId) => {
  const user = await userModel.findById(userId).select('columnPreferences');
  if (!user || !Array.isArray(user.columnPreferences)) return null;
  return user.columnPreferences.filter((k) => VALID_SET.has(k));
};

// Save a user's hidden columns. Sanitizes against the whitelist and dedupes.
const saveColumnPreferences = async (userId, hiddenColumns) => {
  const list = Array.isArray(hiddenColumns) ? hiddenColumns : [];
  const clean = [...new Set(list.filter((k) => typeof k === 'string' && VALID_SET.has(k)))];
  await userModel.findByIdAndUpdate(userId, { columnPreferences: clean });
  return clean;
};

exports.getColumnPreferences = getColumnPreferences;
exports.saveColumnPreferences = saveColumnPreferences;
exports.VALID_COLUMN_KEYS = VALID_COLUMN_KEYS;
