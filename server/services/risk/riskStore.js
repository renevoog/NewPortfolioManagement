'use strict';

const { createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { riskDatasetModel, riskSourceModel, riskSnapshotModel } = require('../../model/models');

const contentVersion = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const encode = (data) => gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
const decode = (payload) => JSON.parse(gunzipSync(Buffer.isBuffer(payload) ? payload : Buffer.from(payload.buffer)).toString('utf8'));
const initialize = () => Promise.all([riskDatasetModel.init(), riskSourceModel.init(), riskSnapshotModel.init()]);

// Immutable writes use only $setOnInsert. A competing process may win the
// unique-index race; that already-stored version/snapshot is authoritative.
async function insertOnce(model, filter, values) {
  try {
    await model.updateOne(filter, { $setOnInsert: values }, { upsert: true, runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function readSource(key) {
  const state = await riskSourceModel.findById(key).lean();
  if (!state) return { key, data: null };
  const dataset = state.version && await riskDatasetModel.findOne({ key, version: state.version }).lean();
  return { ...state, key, data: dataset ? decode(dataset.payload) : null };
}

async function claim(key, now, leaseMs = 15 * 60 * 1000) {
  await insertOnce(riskSourceModel, { _id: key }, { _id: key, nextAttemptAt: new Date(0), leaseUntil: new Date(0) });
  const state = await riskSourceModel.findOneAndUpdate(
    { _id: key, nextAttemptAt: { $lte: new Date(now) }, leaseUntil: { $lte: new Date(now) } },
    { $set: { leaseUntil: new Date(now + leaseMs) } }, { new: true }
  ).lean();
  return Boolean(state);
}

async function saveDataset(key, data, dataThrough) {
  const version = contentVersion(data);
  await insertOnce(riskDatasetModel, { key, version }, { key, version, payload: encode(data), dataThrough });
  return version;
}

async function complete(key, values) {
  await riskSourceModel.updateOne({ _id: key }, { $set: { ...values, leaseUntil: new Date(0) } }, { runValidators: true });
}

async function deferSources(keys, until) {
  for (const key of keys) {
    await insertOnce(riskSourceModel, { _id: key }, { _id: key, leaseUntil: new Date(0) });
    await riskSourceModel.updateOne({ _id: key }, { $max: { nextAttemptAt: new Date(until) } });
  }
}

async function saveSnapshot(row, observedAt, sourceVersion) {
  const filter = { asset: 'BTC', methodology: 'cbbi-published-confidence', date: row.date };
  await insertOnce(riskSnapshotModel, filter, { ...filter, observedAt: new Date(observedAt), sourceVersion, score: row.score, components: row.components });
}

const readSnapshots = () => riskSnapshotModel.find({ asset: 'BTC', methodology: 'cbbi-published-confidence' }).sort({ date: 1 }).lean();

module.exports = { initialize, readSource, claim, saveDataset, complete, deferSources, saveSnapshot, readSnapshots, contentVersion, encode, decode };
