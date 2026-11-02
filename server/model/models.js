const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },

  email: {
    type: String,
    required: true
  },

  password: {
    type: String,
    required: true
  },

  date: {
    type: Date,
    default: Date.now
  },

  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  // Saved hidden dashboard-column keys (per user). `undefined` = never saved,
  // so the client falls back to its local state; an array (incl. empty) = saved.
  columnPreferences: {
    type: [String],
    default: undefined
  }
});

exports.userModel = mongoose.model('user', userSchema);

// Tracked assets per user
const trackedAssetSchema = new mongoose.Schema({
  tvSymbol: {
    type: String,
    required: true
  },
  yahooSymbol: {
    type: String,
    default: null
  },
  userId: {
    type: String,
    required: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index: one entry per symbol per user
trackedAssetSchema.index({ userId: 1, tvSymbol: 1 }, { unique: true });

exports.trackedAssetModel = mongoose.model('trackedAsset', trackedAssetSchema);

// Favourites are independent of the dashboard's tracked assets.
const watchlistAssetSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  tvSymbol: { type: String, required: true },
  yahooSymbol: { type: String, required: true },
  addedAt: { type: Date, default: Date.now }
});
watchlistAssetSchema.index({ userId: 1, tvSymbol: 1 }, { unique: true });
exports.watchlistAssetModel = mongoose.model('watchlistAsset', watchlistAssetSchema);

// Shared public market data, independent of users' holdings and watchlists.
// Content-addressed compressed datasets retain the inputs for reproducible runs.
const riskDatasetSchema = new mongoose.Schema({
  key: { type: String, required: true },
  version: { type: String, required: true },
  payload: { type: Buffer, required: true },
  createdAt: { type: Date, default: Date.now },
  dataThrough: String
});
riskDatasetSchema.index({ key: 1, version: 1 }, { unique: true });
exports.riskDatasetModel = mongoose.model('riskDataset', riskDatasetSchema);

const riskSourceSchema = new mongoose.Schema({
  _id: String,
  version: String,
  fetchedAt: Date,
  dataThrough: String,
  lastFullAt: Date,
  nextAttemptAt: Date,
  leaseUntil: Date,
  error: String,
  quote: mongoose.Schema.Types.Mixed
});
exports.riskSourceModel = mongoose.model('riskSource', riskSourceSchema);

const riskSnapshotSchema = new mongoose.Schema({
  asset: { type: String, enum: ['BTC'], required: true },
  methodology: { type: String, required: true },
  date: { type: String, required: true },
  observedAt: { type: Date, required: true },
  sourceVersion: { type: String, required: true },
  score: { type: Number, required: true },
  components: mongoose.Schema.Types.Mixed
});
riskSnapshotSchema.index({ asset: 1, methodology: 1, date: 1 }, { unique: true });
exports.riskSnapshotModel = mongoose.model('riskSnapshot', riskSnapshotSchema);
