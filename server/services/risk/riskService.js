'use strict';

const defaultStore = require('./riskStore');
const providers = require('./riskProviders');
const { calculateTechnicalRisk, MODEL_VERSION } = require('./technicalRisk');
const { getWatchlistRows } = require('../yahoo/watchlistQuoteService');
const { DAY, utcDate, CBBI_COMPONENTS, CBBI_URL } = providers;
const HOUR = 3600000;
const HISTORY_INTERVAL = 6 * HOUR;
const QUOTE_INTERVAL = 5 * 60000;
const KEYS = ['cm:BTC', 'cm:ETH', 'cbbi:BTC', 'quote:BTC', 'quote:ETH'];

function mergeRows(previous, incoming) {
  return [...new Map([...previous, ...incoming].map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

function createRiskService({ store = defaultStore, source = providers, quoteRows = getWatchlistRows, now = Date.now, env = process.env } = {}) {
  const state = new Map();
  const calculations = new Map();
  let snapshots = [];
  let initialized;
  let running = null;
  let timer;
  let enabled = false;
  let coinMetricsRetryAt = 0;

  async function deferCoinMetrics(error) {
    if (error.status !== 429) return;
    const time = now();
    coinMetricsRetryAt = Math.max(coinMetricsRetryAt, time + Math.max(15 * 60000, error.retryAfterMs || 0));
    await store.deferSources(['cm:BTC', 'cm:ETH'], coinMetricsRetryAt);
  }

  async function initialize() {
    if (!initialized) initialized = (async () => {
      if (store.initialize) await store.initialize();
      for (const key of KEYS) state.set(key, await store.readSource(key));
      snapshots = await store.readSnapshots();
    })().catch((error) => { initialized = null; throw error; });
    return initialized;
  }

  async function refresh(key) {
    const time = now();
    const quote = key.startsWith('quote:');
    const interval = quote ? QUOTE_INTERVAL : HISTORY_INTERVAL;
    if (key.startsWith('cm:') && time < coinMetricsRetryAt) {
      state.set(key, await store.readSource(key));
      return;
    }
    if (!await store.claim(key, time)) {
      state.set(key, await store.readSource(key));
      return;
    }
    const old = await store.readSource(key);
    const asset = key.split(':')[1];
    try {
      let data;
      let dataThrough;
      let quoteValue;
      let lastFullAt = old.lastFullAt || null;
      if (quote) {
        const [row] = await quoteRows([{ tvSymbol: asset, yahooSymbol: `${asset}-USD` }]);
        if (!row || !Number.isFinite(row.price) || row.price <= 0 || !Number.isFinite(Date.parse(row.priceTime)) || row.currency !== 'USD' || Date.parse(row.priceTime) > time) throw new Error('Yahoo Finance ei tagastanud kehtivat USD hinda.');
        quoteValue = { price: row.price, time: row.priceTime, source: 'Yahoo Finance' };
        dataThrough = row.priceTime;
      } else if (key.startsWith('cm:')) {
        // Revisit one week on normal refresh; weekly full imports retain provider
        // corrections as a NEW content version, not changes to old datasets.
        const full = !old.data || !old.lastFullAt || time - Date.parse(old.lastFullAt) >= 7 * DAY;
        const since = !full && old.dataThrough ? utcDate(Date.parse(old.dataThrough) - 7 * DAY) : undefined;
        const settings = { since, now: time, apiKey: env.COIN_METRICS_API_KEY, usage: env.RISK_DATA_USAGE };
        const prices = await source.fetchCoinMetrics(asset, settings);
        let valuationStatus = { status: 'unavailable', message: 'CapRealUSD ei kuulu kontrollitud Community andmetesse. Kasutusel on Price-only Technical Risk.' };
        let caps = [];
        if (env.COIN_METRICS_API_KEY) {
          try {
            caps = await source.fetchCoinMetrics(asset, { ...settings, realizedOnly: true });
            valuationStatus = { status: 'ok', message: 'Litsentsitud Coin Metrics CapRealUSD.' };
          } catch (error) {
            await deferCoinMetrics(error);
            valuationStatus = { status: 'unavailable', message: error.message };
          }
        }
        const capMap = new Map(caps.map((row) => [row.date, row.realizedCap]));
        const incoming = prices.map((row) => ({ ...row, realizedCap: capMap.get(row.date) ?? null }));
        data = { rows: full ? incoming : mergeRows(old.data.rows, incoming), valuationStatus };
        dataThrough = data.rows.filter((row) => row.price !== null).at(-1)?.date || null;
        if (full) lastFullAt = new Date(now());
      } else {
        data = await source.fetchCbbi(time);
        dataThrough = data.history.at(-1).date;
      }
      const receivedAt = now();
      const version = quote ? undefined : await store.saveDataset(key, data, dataThrough);
      if (key === 'cbbi:BTC') {
        const latest = data.history.at(-1);
        // We can attest to observing yesterday's published value TODAY. Never
        // backfill old history as if it had been observed on its original date.
        if (latest.date === utcDate(receivedAt - DAY)) await store.saveSnapshot(latest, receivedAt, version);
        snapshots = await store.readSnapshots();
      }
      const saved = { fetchedAt: new Date(receivedAt), nextAttemptAt: new Date(Math.max(receivedAt + interval, key.startsWith('cm:') ? coinMetricsRetryAt : 0)), dataThrough, lastFullAt, error: null };
      if (version) saved.version = version;
      if (quoteValue) saved.quote = quoteValue;
      await store.complete(key, saved);
      state.set(key, { ...old, ...saved, data: data || old.data });
    } catch (error) {
      if (key.startsWith('cm:')) await deferCoinMetrics(error);
      // Preserve the last successful timestamp and data. A failed refresh never
      // turns old data into fresh data and never invents a zero score.
      const saved = { error: error.message, nextAttemptAt: new Date(now() + Math.max(15 * 60000, error.retryAfterMs || 0)) };
      await store.complete(key, saved);
      state.set(key, { ...old, ...saved });
    }
  }

  function updateAll() {
    if (running) return running;
    running = (async () => {
      await initialize();
      // Sequential requests remain far below the Community limit (10/6s).
      for (const key of KEYS) await refresh(key);
    })().finally(() => { running = null; });
    return running;
  }

  function describe(key, name, url, maxAge) {
    const current = state.get(key) || {};
    const lastTime = key.startsWith('quote:') ? Date.parse(current.dataThrough) : Date.parse(current.dataThrough || '') + DAY;
    const stale = !Number.isFinite(lastTime) || now() - lastTime > maxAge;
    const status = !current.fetchedAt ? 'unavailable' : current.error || stale ? 'stale' : 'ok';
    return { id: key, name, url, status, fetchedAt: current.fetchedAt || null, dataThrough: current.dataThrough || null, message: current.error || (stale ? 'Andmed puuduvad või on aegunud.' : '') };
  }

  async function getRiskData(asset) {
    if (!['BTC', 'ETH'].includes(asset)) throw new Error('Toetamata vara.');
    await initialize();
    const input = state.get(`cm:${asset}`) || {};
    const inputVersion = input.version || 'no-data';
    const cacheKey = `${asset}:${inputVersion}:${MODEL_VERSION}:${utcDate(now())}`;
    let technical = calculations.get(cacheKey);
    if (!technical) {
      technical = calculateTechnicalRisk(input.data?.rows || [], { asset, asOf: now(), dataVersion: inputVersion });
      // Persist the exact output under its model and input versions. Reading a
      // page never triggers provider requests; only this deterministic math.
      if (input.version) await store.saveDataset(`technical:${asset}:${MODEL_VERSION}:${inputVersion}`, technical, technical.latest?.date || null);
      if (calculations.size >= 4) calculations.delete(calculations.keys().next().value);
      calculations.set(cacheKey, technical);
    }
    const sources = [describe(`cm:${asset}`, 'Coin Metrics', 'https://docs.coinmetrics.io/packages/coin-metrics-community-data', 2 * DAY)];
    const valuationThrough = input.data?.rows.filter((row) => Number.isFinite(row.realizedCap) && row.realizedCap > 0).at(-1)?.date || null;
    const valuationStatus = { ...(input.data?.valuationStatus || { status: 'unavailable', message: 'Realiseeritud kapitalisatsiooni andmed puuduvad.' }) };
    if (valuationStatus.status === 'ok' && (!valuationThrough || valuationThrough !== input.dataThrough || sources[0].status !== 'ok')) {
      valuationStatus.status = valuationThrough ? 'stale' : 'unavailable';
      valuationStatus.message = 'Viimase hinnapäeva värske realiseeritud kapitalisatsioon puudub või uuendamine ebaõnnestus.';
    }
    sources.push({ id: `mvrv:${asset}`, name: 'Coin Metrics MVRV', url: 'https://docs.coinmetrics.io/network-data/network-data-overview/market/market-capitalization', fetchedAt: input.fetchedAt || null, dataThrough: valuationThrough, ...valuationStatus });
    const quoteState = state.get(`quote:${asset}`) || {};
    const quoteSource = describe(`quote:${asset}`, 'Yahoo Finance', `https://finance.yahoo.com/quote/${asset}-USD/`, 15 * 60000);
    sources.push(quoteSource);
    const daily = input.data?.rows.filter((row) => row.price !== null).at(-1);
    const quote = quoteState.quote ? { ...quoteState.quote, stale: quoteSource.status !== 'ok' } : {
      price: daily?.price || null, time: daily ? new Date(Date.parse(daily.date) + DAY).toISOString() : null,
      source: 'Coin Metrics · viimane päevahind', stale: true
    };
    let cbbi = null;
    if (asset === 'BTC') {
      const current = state.get('cbbi:BTC') || {};
      const status = describe('cbbi:BTC', 'CBBI · Colin Talks Crypto / Zaczero', 'https://colintalkscrypto.com/cbbi/', 2 * DAY);
      sources.push(status);
      cbbi = { history: current.data?.history || [], latest: current.data?.history.at(-1) || null, snapshots, components: CBBI_COMPONENTS, sourceUrl: CBBI_URL, historyKind: 'recalibrated', methodology: 'cbbi-published-confidence', fetchedAt: current.fetchedAt || null, status: status.status, comparison: current.data?.comparison || null };
    }
    const nextUpdates = [...state.values()].map((value) => Date.parse(value.nextAttemptAt)).filter(Number.isFinite);
    return { asset, generatedAt: new Date(now()).toISOString(), quote, technical, cbbi, sources,
      refresh: { running: Boolean(running), enabled, nextUpdateAt: nextUpdates.length ? new Date(Math.min(...nextUpdates)).toISOString() : null },
      limitations: [
        'Skoor 0–100 kirjeldab ajaloolist ülekuumenemist, mitte hinnalanguse tõenäosust.',
        'Technical Risk kasutab ainult vastava päeva lõpuks teadaolevaid hinnavaatlusi. Allika hilisemaid parandusi hoitakse eraldi andmeversioonidena; varasem tegelik avaldamisviivitus ei ole teada.',
        'Price-only mudel ei sisalda on-chain väärtustamist ega ole täismudeliga samaväärne.',
        'CBBI ajalugu on allika praeguse kalibreeringu järgi; snapshot näitab esimest tegelikku vaatlust koos vaatlusajaga.',
        'Coin Metrics Community: CC BY-NC 4.0, isiklik mitteäriline kasutus; arvutused ja normaliseerimine on selle rakenduse teisendused.'
      ] };
  }

  function start() {
    if (timer || env.RISK_REFRESH_ENABLED === 'false') return;
    enabled = true;
    const tick = () => updateAll().catch(() => console.error('Tururiski andmete uuendamine ebaõnnestus; järgmine katse taustal.'));
    timer = setInterval(tick, 60000);
    timer.unref();
    tick();
  }
  function stop() { clearInterval(timer); timer = null; enabled = false; }
  return { getRiskData, updateAll, initialize, start, stop };
}

const service = createRiskService();
module.exports = { ...service, createRiskService, mergeRows };
