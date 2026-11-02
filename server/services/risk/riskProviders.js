'use strict';

// Independent adapters for published data; no CBBI implementation is copied.
const CBBI_URL = 'https://colintalkscrypto.com/cbbi/data/latest.json';
const COMMUNITY_URL = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics';
const PRO_URL = 'https://api.coinmetrics.io/v4/timeseries/asset-metrics';
const DAY = 86400000;
const CBBI_COMPONENTS = [
  { key: 'PiCycle', name: 'Pi Cycle Top', description: 'Võrdleb lühikest ja pikka hinnakeskmist. Lähenemine on ajalooliselt viidanud kuumenemisele; vähesed varasemad ristumised ei taga uut turutipuprognoosi.' },
  { key: 'RUPL', name: 'RUPL / NUPL', description: 'Mõõdab võrgu realiseerimata kasumit. Suur kasum võib suurendada müügisurvet, kuid kasumlik turg võib kaua jätkuda.' },
  { key: 'RHODL', name: 'RHODL Ratio', description: 'Võrdleb noorte ja vanemate müntide realiseeritud väärtust. Noorte müntide suur osakaal võib viidata spekulatsioonile; mündi liikumine ei tähenda alati müüki.' },
  { key: 'Puell', name: 'Puell Multiple', description: 'Võrdleb kaevandajate päevast emissioonitulu aastakeskmisega. Kõrge suhtarv viitab tugevale tulule, kuid pooldumised muudavad võrdlusbaasi.' },
  { key: '2YMA', name: '2-Year Moving Average', description: 'Paigutab hinna pikaajalise keskmise suhtes. Suur kõrvalekalle võib viidata kuumenemisele; trend ja keskmine reageerivad aeglaselt.' },
  { key: 'Trolololo', name: 'Bitcoin Trolololo Trend Line', description: 'Võrdleb hinda ajaloolise kasvukõveraga. Kõrge paiknemine viitab kallidusele mudeli suhtes; kasvukõver ja kalibreerimine võivad vananeda.' },
  { key: 'MVRV', name: 'MVRV Z-Score', description: 'Võrdleb turuväärtust realiseeritud väärtusega. Kõrge näit võib viidata suurele realiseerimata kasumile; tulemus sõltub kapitalisatsiooni metoodikast.' },
  { key: 'ReserveRisk', name: 'Reserve Risk', description: 'Seostab hinda pikaajaliste hoidjate käitumisega. Kõrge risk viitab kõrgemale hinnale hoidjate kindlustunde suhtes; hoidjate kavatsust ei saa ahelaandmetest otseselt järeldada.' },
  { key: 'Woobull', name: 'Woobull Top Cap vs CVDD', description: 'Paigutab hinna ajalooliste ülemise ja alumise väärtusmudeli vahele. Suur väärtus on ülemisele piirile lähemal; piirid ei ole hinna garantii.' }
];

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const positive = (value) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const normalizedScore = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value * 100 : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry only transient errors. Long Retry-After delays are deferred to the
// background scheduler, never shortened into a request before the provider allows.
async function fetchJson(url, options = {}) {
  const fetcher = options.fetch || fetch;
  const delay = options.sleep || sleep;
  const now = options.now || Date.now;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
    } catch (cause) {
      if (attempt === 2) throw new Error('Andmeallika ühendus ebaõnnestus.');
      await delay(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    const error = new Error(`Andmeallika HTTP viga ${response.status}.`);
    error.status = response.status;
    const retryAfter = response.headers.get('retry-after');
    const seconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : null;
    const retryAt = retryAfter ? Date.parse(retryAfter) : NaN;
    error.retryAfterMs = Math.max(0, seconds ?? (Number.isFinite(retryAt) ? retryAt - now() : 0));
    // Release the response before retrying a rate-limited connection.
    if (response.body && response.body.cancel) await response.body.cancel();
    if ((response.status !== 429 && response.status < 500) || attempt === 2 || error.retryAfterMs > 30000) throw error;
    await delay(Math.max(1000 * 2 ** attempt, error.retryAfterMs));
  }
}

function parseCoinMetrics(data, asset, now = Date.now()) {
  if (!data || !Array.isArray(data.data)) throw new Error('Coin Metricsi vastuse vorming muutus.');
  const today = utcDate(now);
  const dates = new Set();
  return data.data.map((row) => {
    if (!row || row.asset !== asset.toLowerCase()) throw new Error('Coin Metrics tagastas vale vara andmed.');
    const date = typeof row.time === 'string' ? row.time.slice(0, 10) : '';
    // Coin Metrics may serialize nanosecond precision. Accept only a complete
    // UTC midnight timestamp; slicing arbitrary timestamps would shift days.
    if (!/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,9})?Z$/.test(row.time) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || utcDate(Date.parse(date)) !== date) throw new Error('Vigane UTC kuupäev.');
    if (dates.has(date)) throw new Error('Coin Metrics tagastas korduva päeva.');
    dates.add(date);
    return { date, price: positive(row.PriceUSD), marketCap: positive(row.CapMrktCurUSD), realizedCap: positive(row.CapRealUSD) };
  }).filter((row) => row.date < today).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchCoinMetrics(asset, { since, now = Date.now(), apiKey, usage, realizedOnly = false } = {}, io = {}) {
  if (!['BTC', 'ETH'].includes(asset)) throw new Error('Toetamata vara.');
  if (!apiKey && usage !== 'personal-noncommercial') {
    const error = new Error('Coin Metricsi CC BY-NC andmed vajavad mitteärilist kasutust; ärikasutuseks seadista litsentsitud API.');
    error.code = 'LICENSE_REQUIRED';
    throw error;
  }
  const base = apiKey ? PRO_URL : COMMUNITY_URL;
  const query = new URLSearchParams({ assets: asset.toLowerCase(), metrics: realizedOnly ? 'CapRealUSD' : 'PriceUSD,CapMrktCurUSD', frequency: '1d', page_size: '10000', start_time: since || '2009-01-01', end_time: utcDate(now - DAY) });
  if (apiKey) query.set('api_key', apiKey);
  let url = `${base}?${query}`;
  const rows = [];
  const seen = new Set();
  for (let page = 0; url && page < 30; page++) {
    if (seen.has(url)) throw new Error('Coin Metricsi lehekülgede tsükkel.');
    seen.add(url);
    const payload = await fetchJson(url, io);
    rows.push(...parseCoinMetrics(payload, asset, now));
    if (payload.next_page_url) {
      const next = new URL(payload.next_page_url, base);
      if (next.origin !== new URL(base).origin || next.pathname !== new URL(base).pathname) throw new Error('Ootamatu Coin Metricsi järgmise lehe aadress.');
      url = next.href;
      await (io.sleep || sleep)(1100);
    } else url = null;
  }
  if (url) throw new Error('Coin Metricsi ajalugu ületas lehekülgede piiri.');
  const unique = new Set(rows.map((row) => row.date));
  if (unique.size !== rows.length) throw new Error('Korduvad päevad Coin Metricsi lehekülgedel.');
  if (!rows.some((row) => (realizedOnly ? row.realizedCap : row.price) !== null)) throw new Error('Coin Metrics ei tagastanud kasutatavaid mõõdikuid.');
  return rows;
}

function parseCbbi(payload, now = Date.now()) {
  if (!payload || !payload.Confidence || typeof payload.Confidence !== 'object') throw new Error('CBBI vastusest puudub ametlik Confidence.');
  const today = utcDate(now);
  const dates = new Set();
  const history = Object.keys(payload.Confidence).map((timestamp) => {
    if (!/^\d+$/.test(timestamp)) throw new Error('Vigane CBBI ajatempel.');
    const time = Number(timestamp) * 1000;
    if (!Number.isFinite(time) || time % DAY !== 0) throw new Error('Vigane CBBI UTC päevapiir.');
    const date = utcDate(time);
    if (dates.has(date)) throw new Error('Korduv CBBI kuupäev.');
    dates.add(date);
    return { date, score: normalizedScore(payload.Confidence[timestamp]), price: positive(payload.Price && payload.Price[timestamp]), components: Object.fromEntries(CBBI_COMPONENTS.map(({ key }) => [key, normalizedScore(payload[key] && payload[key][timestamp])])) };
  }).filter((row) => row.date < today).sort((a, b) => a.date.localeCompare(b.date));
  if (!history.length || history[history.length - 1].score === null) throw new Error('CBBI viimane avaldatud skoor puudub või on vigane.');
  const latestTime = Date.parse(history.at(-1).date);
  for (const key of ['Price', ...CBBI_COMPONENTS.map((component) => component.key)]) {
    if (Object.keys(payload[key] || {}).some((timestamp) => /^\d+$/.test(timestamp) && Number(timestamp) * 1000 > latestTime && Number(timestamp) * 1000 < Date.parse(today))) {
      throw new Error('CBBI uusima päeva ametlik Confidence puudub.');
    }
  }
  let comparedDays = 0;
  let maxDifference = 0;
  let latest = null;
  for (const row of history) {
    const values = Object.values(row.components);
    if (row.score === null || values.some((value) => value === null)) continue;
    const componentMean = values.reduce((sum, value) => sum + value, 0) / 9;
    const difference = Math.abs(componentMean - row.score);
    maxDifference = Math.max(maxDifference, difference);
    comparedDays++;
    latest = { date: row.date, officialScore: row.score, componentMean, difference };
  }
  return { history, comparison: { kind: 'published-component-mean-check', comparedDays, incompleteDays: history.length - comparedDays, maxDifference, tolerance: 0.011, withinTolerance: comparedDays > 0 && maxDifference <= 0.011, latest } };
}

const fetchCbbi = async (now = Date.now(), io = {}) => parseCbbi(await fetchJson(CBBI_URL, io), now);

module.exports = { fetchJson, fetchCoinMetrics, fetchCbbi, parseCoinMetrics, parseCbbi, CBBI_COMPONENTS, CBBI_URL, COMMUNITY_URL, PRO_URL, utcDate, DAY };
