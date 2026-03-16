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
