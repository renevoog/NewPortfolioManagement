const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');

const raw = (value) => ({ raw: value });
const epoch = (date) => raw(Date.parse(date + 'T00:00:00Z') / 1000);
const statement = (date, revenue = 100e6, netIncome = -10e6) => ({
  endDate: epoch(date), totalRevenue: raw(revenue), netIncome: raw(netIncome)
});
const earnings = (date, actual, estimate) => ({
  quarter: epoch(date), epsActual: raw(actual), epsEstimate: raw(estimate), currency: 'USD'
});

function financialService(history, { quarterly, yearly = [], failEstimates = false } = {}) {
  const filename = path.resolve(__dirname, '../server/services/yahoo/yahooFinancialService.js');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.require = (id) => {
    if (id === '../symbolMap') return { getYahooSymbol: () => 'IREN' };
    if (id === './yahooFinanceClient') return {
      insights: async () => null,
      quoteSummary: async (symbol, { modules }) => {
        assert.equal(symbol, 'IREN');
        if (modules.includes('earningsHistory')) {
          if (failEstimates) throw new Error('Estimate source unavailable');
          return { earningsHistory: { history, defaultMethodology: 'nongaap' } };
        }
        return {
          incomeStatementHistoryQuarterly: { incomeStatementHistory: quarterly || [statement('2026-03-31')] },
          incomeStatementHistory: { incomeStatementHistory: yearly },
          financialData: { financialCurrency: 'USD' }
        };
      }
    };
    throw new Error('Unexpected dependency: ' + id);
  };
  mod._compile(fs.readFileSync(filename, 'utf8'), filename);
  return mod.exports;
}

test('EPS beats and misses use the absolute estimate, including losses and zero actuals', async () => {
  for (const [actual, estimate, result, percent] of [
    [1.2, 1, 'beat', 20], [0.8, 1, 'miss', -20],
    [-0.2, -0.4, 'beat', 50], [-0.6, -0.4, 'miss', -50],
    [0, -0.4, 'beat', 100], [0.4, 0.4, 'met', 0]
  ]) {
    const data = await financialService([earnings('2026-03-31', actual, estimate)]).getFinancialHistory('NASDAQ:IREN');
    const comparison = data.quarterly.periods[0].epsComparison;
    assert.equal(comparison.result, result);
    assert.ok(Math.abs(comparison.surprisePercent - percent) < 1e-10);
    assert.equal(comparison.difference, actual - estimate);
    assert.equal(comparison.methodology, 'nongaap');
    assert.equal(comparison.currency, 'USD');
    assert.equal(data.financialCurrency, 'USD');
    assert.equal(data.quarterly.periods[0].netIncome, -10e6);
  }
});

test('zero estimates retain the absolute difference without an infinite percentage', async () => {
  for (const [actual, result] of [[0.1, 'beat'], [-0.1, 'miss'], [0, 'met']]) {
    const data = await financialService([earnings('2026-03-31', actual, 0)]).getFinancialHistory('IREN');
    assert.equal(data.quarterly.periods[0].epsComparison.result, result);
    assert.equal(data.quarterly.periods[0].epsComparison.difference, actual);
    assert.equal(data.quarterly.periods[0].epsComparison.surprisePercent, null);
  }
});

test('missing or invalid EPS does not become a zero actual or a beat/miss', async () => {
  for (const [actual, estimate] of [[null, 1], [undefined, 1], [NaN, 1], [Infinity, 1], [1, null], [1, '1']]) {
    const data = await financialService([earnings('2026-03-31', actual, estimate)]).getFinancialHistory('IREN');
    const comparison = data.quarterly.periods[0].epsComparison;
    assert.equal(comparison.result, null);
    assert.equal(comparison.difference, null);
    assert.equal(comparison.surprisePercent, null);
  }
});

test('EPS matches exact period ends independently of order and never populates yearly results', async () => {
  const service = financialService([
    earnings('2026-06-30', 2, 1), earnings('2026-03-31', -0.2, -0.4),
    earnings('2026-09-29', 3, 1), { quarter: raw(1e99), epsActual: 5, epsEstimate: 1 }
  ], {
    quarterly: [statement('2026-09-30'), statement('2026-03-31'), statement('2026-06-30')],
    yearly: [statement('2026-06-30')]
  });
  const data = await service.getFinancialHistory('IREN');
  assert.deepEqual(data.quarterly.periods.map((p) => p.label), ['Q1 2026', 'Q2 2026', 'Q3 2026']);
  assert.deepEqual(data.quarterly.periods.map((p) => p.epsComparison && p.epsComparison.actual), [-0.2, 2, null]);
  assert.equal(data.yearly.periods[0].epsComparison, undefined);
});

test('unavailable estimate source leaves statements and their period changes usable', async () => {
  for (const failEstimates of [false, true]) {
    const data = await financialService(undefined, {
      failEstimates,
      quarterly: [statement('2025-12-31', 80e6), statement('2026-03-31')]
    }).getFinancialHistory('IREN');
    assert.equal(data.availability.quarterly, true);
    assert.equal(data.quarterly.periods[1].revenueChange, 25);
    assert.equal(data.quarterly.periods[1].epsComparison, null);
  }
});

// Exercise the public detail-reopen and toggle handlers without a browser or network.
async function renderDetail(data) {
  const handlers = {};
  const buttons = {};
  const panel = {
    innerHTML: '',
    querySelectorAll: () => ['quarterly', 'yearly'].map((view) => ({
      addEventListener: (_, handler) => { buttons[view] = () => handler({ target: { closest: () => ({
        getAttribute: (key) => key === 'data-symbol' ? 'IREN' : view
      }) } }); }
    }))
  };
  const charts = [];
  const document = {
    getElementById: (id) => id === 'panel-IREN' ? panel : id === 'chart-IREN' ? { getContext: () => ({}) } : null,
    querySelector: () => null,
    addEventListener: (event, handler) => { handlers[event] = handler; }
  };
  function Chart(context, config) {
    this.config = config;
    this.destroy = () => { this.destroyed = true; };
    charts.push(this);
  }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/js/financial-detail.js'), 'utf8'), {
    document, window: {}, Chart, fetch: async () => ({ json: async () => data })
  });
  handlers['detail-reopen']({ detail: { symbol: 'IREN' } });
  await new Promise((resolve) => setImmediate(resolve));
  return { panel, buttons, charts };
}

test('detail shows values and EPS statuses, with an unavailable comparison for pending results', async () => {
  const data = await financialService([
    earnings('2025-12-31', -0.2, -0.4), earnings('2026-03-31', 0.8, 1),
    earnings('2026-06-30', 0.1, 0), earnings('2026-09-30', undefined, -0.665)
  ], {
    quarterly: ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].map((date) => statement(date)),
    yearly: [statement('2026-06-30')]
  }).getFinancialHistory('IREN');
  const { panel, buttons, charts } = await renderDetail(data);
  assert.match(panel.innerHTML, /Beat \+50\.0%/);
  assert.match(panel.innerHTML, /Miss -20\.0%/);
  assert.match(panel.innerHTML, /Beat \+0\.10 \/ share/);
  assert.match(panel.innerHTML, /Comparison unavailable/);
  assert.match(panel.innerHTML, /Actual <strong class="detail-estimate-unavailable">—<\/strong>/);
  assert.match(panel.innerHTML, /Est\. <strong>-0\.665<\/strong>/);
  assert.match(panel.innerHTML, /Adjusted EPS/);
  assert.doesNotMatch(panel.innerHTML, /Est\. —/);
  const config = charts[0].config;
  assert.equal(config.data.datasets[0].data[0], 100e6);
  assert.equal(config.data.datasets[1].data[0], -10e6);

  buttons.yearly();
  assert.equal(charts[0].destroyed, true);
  assert.match(panel.innerHTML, /Annual EPS estimates are unavailable/);
  assert.doesNotMatch(panel.innerHTML, /detail-estimate-beat|detail-estimate-miss/);
  buttons.quarterly();
  assert.match(panel.innerHTML, /Beat \+50\.0%/);
});

test('bar labels sit outside positive and negative bars, render missing values, and respect hidden series', async () => {
  const data = await financialService([]).getFinancialHistory('IREN');
  const { charts } = await renderDetail(data);
  const plugin = charts[0].config.plugins[0];
  const draws = [];
  const ctx = {
    save() {}, restore() {},
    fillText(text, x, y) { draws.push({ text, x, y, color: this.fillStyle }); }
  };
  const chart = {
    ctx,
    data: { datasets: [{ data: [100e6, -10e6, null, 0], borderColor: '#123456' }, { data: [5] }] },
    isDatasetVisible: (index) => index === 0,
    getDatasetMeta: () => ({ data: [{ x: 100, y: 80 }, { x: 200, y: 200 }, { x: 300, y: 150 }, { x: 400, y: 150 }] }),
    scales: { y: { getPixelForValue: () => 150 } }
  };
  plugin.afterDatasetsDraw(chart);
  assert.deepEqual(draws.map(({ text }) => text), ['100.0M', '-10.0M', '—', '0']);
  assert.ok(draws[0].y < 80);
  assert.ok(draws[1].y > 200);
  assert.equal(draws[2].color, '#94a3b8');
});

test('yearly-only history opens the available view', async () => {
  const data = await financialService([], { quarterly: [], yearly: [statement('2026-06-30')] }).getFinancialHistory('IREN');
  const { panel, charts } = await renderDetail(data);
  assert.match(panel.innerHTML, /Annual EPS estimates are unavailable/);
  assert.equal(charts.length, 1);
  assert.equal(charts[0].config.data.labels[0], '2026');
});
