'use strict';

// Verifies real stored data without modifying holdings, users or old snapshots.
require('dotenv').config({ path: 'config.env' });
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const store = require('../server/services/risk/riskStore');
const { riskDatasetModel } = require('../server/model/models');
const { calculateTechnicalRisk, MODEL_VERSION } = require('../server/services/risk/technicalRisk');

async function main() {
  await mongoose.connect(process.env.DATABASE_URI);
  if (process.argv.includes('--refresh')) await require('../server/services/risk/riskService').updateAll();
  const summary = [];
  for (const asset of ['BTC', 'ETH']) {
    const input = await store.readSource(`cm:${asset}`);
    assert.ok(input.data, `${asset}: no stored history; run the app or npm run risk:refresh first`);
    assert.equal(store.contentVersion(input.data), input.version, `${asset}: input hash mismatch`);
    const result = calculateTechnicalRisk(input.data.rows, { asset, dataVersion: input.version });
    const stored = await riskDatasetModel.findOne({ key: `technical:${asset}:${MODEL_VERSION}:${input.version}` }).lean();
    if (stored) assert.deepEqual(store.decode(stored.payload), result, `${asset}: stored calculation mismatch`);
    summary.push({ asset, days: result.history.length, dataThrough: result.latest?.date, model: result.modelVersion,
      variant: result.latest?.variant, score: result.latest?.score, dataVersion: input.version,
      storedCalculationMatched: Boolean(stored), sensitivity: result.sensitivity.priceOnly });
  }
  const cbbi = await store.readSource('cbbi:BTC');
  assert.ok(cbbi.data, 'No stored CBBI history');
  assert.equal(store.contentVersion(cbbi.data), cbbi.version, 'CBBI input hash mismatch');
  assert.equal(cbbi.data.comparison.withinTolerance, true, 'Published CBBI component comparison is outside tolerance');
  const snapshots = await store.readSnapshots();
  for (const snapshot of snapshots) {
    const original = await riskDatasetModel.findOne({ key: 'cbbi:BTC', version: snapshot.sourceVersion }).lean();
    assert.ok(original, 'Snapshot original dataset is missing');
    const row = store.decode(original.payload).history.find((point) => point.date === snapshot.date);
    assert.ok(row, 'Snapshot day is missing from original dataset');
    assert.equal(snapshot.score, row.score);
    assert.deepEqual(snapshot.components, row.components);
    assert.ok(new Date(snapshot.observedAt).getTime() >= Date.parse(snapshot.date) + 86400000);
  }
  console.log(JSON.stringify({ assets: summary, cbbi: { days: cbbi.data.history.length, latest: cbbi.data.history.at(-1), comparison: cbbi.data.comparison, snapshotsVerified: snapshots.length } }, null, 2));
}

main().catch((error) => {
  // Avoid printing connection strings, provider URLs containing credentials or stack frames.
  console.error('Risk data verification failed:', error.name, error.code || 'Check data availability, database connection and assertions.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
