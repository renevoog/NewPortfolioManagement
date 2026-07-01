/* ============================================================
   Sharpe Ratio simulation — client logic
   - pick assets from the watchlist (toggle chips) or add custom ones
   - validate params, request /api/sharpe-data, draw a Chart.js scatter
   No jQuery: uses fetch + vanilla DOM (Chart.js is loaded in the footer).
   ============================================================ */

(function () {
  'use strict';

  var page = document.querySelector('.sharpe-page');
  if (!page) return;

  // --- element handles ------------------------------------------------
  var watchlistList = document.getElementById('watchlist-list');
  var selectAllBtn = document.getElementById('assets-select-all');
  var clearBtn = document.getElementById('assets-clear');
  var countEl = document.getElementById('assets-count');
  var summaryEl = document.getElementById('selected-summary');
  var summaryEmptyEl = document.getElementById('selected-summary-empty');

  var listToggle = document.getElementById('asset-list-toggle');
  var listPanel = document.getElementById('asset-list-panel');
  var listFilter = document.getElementById('asset-list-filter');

  var customInput = document.getElementById('custom-symbol-input');
  var customAddBtn = document.getElementById('custom-add-btn');

  // Custom ("Other") symbols the user typed — the source of truth for
  // non-watchlist picks (upper-cased, order preserved).
  var customSet = [];

  var assetTypeEl = document.getElementById('sharpe-asset-type');
  var iterationsEl = document.getElementById('sharpe-iterations');
  var startEl = document.getElementById('sharpe-start-date');
  var endEl = document.getElementById('sharpe-end-date');
  var runBtn = document.getElementById('sharpe-run-btn');

  var loadingEl = document.getElementById('sharpe-loading');
  var resultEl = document.getElementById('sharpe-result');
  var idleEl = document.getElementById('sharpe-idle');
  var idleMain = document.getElementById('sharpe-idle-main');
  var idleDetail = document.getElementById('sharpe-idle-detail');
  var canvas = document.getElementById('sharpe-canvas');
  var mainValuesBox = document.getElementById('sharpe-main-values');
  var weightsBox = document.getElementById('sharpe-weights');

  var chart = null;

  // --- helpers --------------------------------------------------------

  function fmtDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayStr() {
    return fmtDate(new Date());
  }

  // Sensible defaults: one year of history ending yesterday (a valid range
  // the user can just run as-is).
  function setDefaultDates() {
    var end = new Date();
    end.setDate(end.getDate() - 1);
    var start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    if (startEl && !startEl.value) startEl.value = fmtDate(start);
    if (endEl && !endEl.value) endEl.value = fmtDate(end);
  }

  // Collect { yahoo, label } for the simulation: selected watchlist rows first,
  // then custom symbols. De-duplicated by (upper-cased) Yahoo symbol; values
  // containing a comma are skipped — assets/labels serialise as a bare CSV and a
  // comma would desync the two parallel lists (valid tickers never contain one).
  function selectedAssets() {
    var out = [];
    var seen = {};
    function push(yahoo, label) {
      if (!yahoo) return;
      label = label || yahoo;
      if (yahoo.indexOf(',') !== -1 || label.indexOf(',') !== -1) return;
      var key = yahoo.toUpperCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({ yahoo: yahoo, label: label });
    }
    if (watchlistList) {
      watchlistList.querySelectorAll('.asset-row.selected').forEach(function (r) {
        push(r.getAttribute('data-yahoo'), r.getAttribute('data-label'));
      });
    }
    customSet.forEach(function (sym) { push(sym, sym); });
    return out;
  }

  // Find a watchlist row whose symbol (yahoo or label) matches `key` (uppercased).
  function findWatchlistRow(key) {
    var match = null;
    if (watchlistList) {
      watchlistList.querySelectorAll('.asset-row').forEach(function (r) {
        if ((r.getAttribute('data-yahoo') || '').toUpperCase() === key ||
            (r.getAttribute('data-label') || '').toUpperCase() === key) match = r;
      });
    }
    return match;
  }

  // Render the always-visible "selected" strip (watchlist picks + custom), each
  // chip removable. Keeps the empty-state placeholder node in place.
  function renderSelectedSummary() {
    if (!summaryEl) return;
    summaryEl.querySelectorAll('.selected-chip').forEach(function (c) { c.remove(); });

    var items = [];
    if (watchlistList) {
      watchlistList.querySelectorAll('.asset-row.selected').forEach(function (r) {
        items.push({ label: r.getAttribute('data-label'), kind: 'wl', row: r });
      });
    }
    customSet.forEach(function (sym) { items.push({ label: sym, kind: 'custom' }); });

    if (summaryEmptyEl) summaryEmptyEl.style.display = items.length ? 'none' : '';

    items.forEach(function (it) {
      var chip = document.createElement('span');
      chip.className = 'selected-chip' + (it.kind === 'custom' ? ' selected-chip-custom' : '');

      var txt = document.createElement('span');
      txt.textContent = it.label;
      chip.appendChild(txt);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'selected-chip-x';
      x.setAttribute('aria-label', 'Remove ' + it.label);
      x.innerHTML = '&times;';
      x.addEventListener('click', function () {
        if (it.kind === 'wl' && it.row) {
          it.row.classList.remove('selected');
        } else {
          customSet = customSet.filter(function (s) { return s !== it.label; });
        }
        refresh();
      });
      chip.appendChild(x);
      summaryEl.appendChild(chip);
    });
  }

  function updateCount() {
    if (countEl) countEl.textContent = selectedAssets().length + ' selected';
  }

  // Re-render the selection strip and the count together.
  function refresh() {
    renderSelectedSummary();
    updateCount();
  }

  function showIdle(mainMsg, detailMsg) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    if (idleEl) idleEl.style.display = 'block';
    if (idleMain) idleMain.textContent = mainMsg || 'Select assets and run the simulation';
    if (idleDetail) idleDetail.textContent = detailMsg || '';
  }

  // --- watchlist selection --------------------------------------------

  if (watchlistList) {
    watchlistList.addEventListener('click', function (e) {
      var row = e.target.closest('.asset-row');
      if (!row) return;
      row.classList.toggle('selected');
      refresh();
    });
  }

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function () {
      if (!watchlistList) return;
      // Only affect rows currently visible (respects an active filter).
      watchlistList.querySelectorAll('.asset-row').forEach(function (r) {
        if (r.style.display !== 'none') r.classList.add('selected');
      });
      refresh();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (watchlistList) {
        watchlistList.querySelectorAll('.asset-row.selected').forEach(function (r) {
          r.classList.remove('selected');
        });
      }
      customSet = [];
      refresh();
    });
  }

  // --- expand / collapse + filter the watchlist list ------------------

  if (listToggle && listPanel) {
    listToggle.addEventListener('click', function () {
      var collapsed = listPanel.hasAttribute('hidden');
      if (collapsed) {
        listPanel.removeAttribute('hidden');
        listToggle.classList.add('open');
        listToggle.setAttribute('aria-expanded', 'true');
        if (listFilter) listFilter.focus();
      } else {
        listPanel.setAttribute('hidden', '');
        listToggle.classList.remove('open');
        listToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (listFilter && watchlistList) {
    listFilter.addEventListener('input', function () {
      var q = listFilter.value.trim().toLowerCase();
      watchlistList.querySelectorAll('.asset-row').forEach(function (r) {
        var hay = ((r.getAttribute('data-label') || '') + ' ' + (r.getAttribute('data-name') || '')).toLowerCase();
        r.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
      });
    });
  }

  // --- custom ("Other") symbols --------------------------------------

  function addCustomSymbol() {
    if (!customInput) return;
    var sym = (customInput.value || '').trim().toUpperCase();
    if (!sym) return;

    // Basic ticker sanity: letters/digits/. ^ - (e.g. BRK-B, MC.PA, ^SPX), and at
    // least one alphanumeric char so punctuation-only junk ('...', '^^^') is rejected.
    if (!/^[A-Z0-9.^\-]{1,15}$/.test(sym) || !/[A-Z0-9]/.test(sym)) {
      customInput.classList.add('invalid');
      return;
    }
    customInput.classList.remove('invalid');

    // If the symbol is already in the watchlist, select that row instead of
    // silently swallowing the add (avoids a confusing no-op for unselected rows).
    var row = findWatchlistRow(sym);
    if (row) {
      row.classList.add('selected');
      customInput.value = '';
      refresh();
      return;
    }

    if (customSet.indexOf(sym) === -1) customSet.push(sym);
    customInput.value = '';
    refresh();
  }

  if (customAddBtn) customAddBtn.addEventListener('click', addCustomSymbol);
  if (customInput) {
    customInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustomSymbol(); }
    });
    customInput.addEventListener('input', function () { customInput.classList.remove('invalid'); });
  }

  // --- Chart.js scatter config ---------------------------------------

  function scatterConfig(apidata) {
    return {
      type: 'scatter',
      data: {
        datasets: [{
          data: apidata.data1,
          pointBackgroundColor: apidata.colorList,
          pointBorderColor: '#1e293b',
          pointBorderWidth: 0.5,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1,
        plugins: {
          title: {
            display: true,
            text: 'VOLATILITY vs RETURN',
            color: '#1e293b',
            font: { family: 'Exo', weight: '600', size: 13 }
          },
          legend: { display: false },
          tooltip: {
            mode: 'nearest',
            intersect: true,
            displayColors: true,
            backgroundColor: '#ffffff',
            titleColor: '#1b263a',
            borderWidth: 1,
            borderColor: '#e2e5ea',
            bodyColor: '#1e293b',
            padding: 10,
            cornerRadius: 6,
            bodyFont: { size: 12, weight: 'bold', family: 'Exo' },
            callbacks: {
              title: function () { return; },
              label: function (item) {
                var volatility = parseFloat(item.parsed.x);
                var ret = parseFloat(item.parsed.y);
                var weights = apidata.data3[item.dataIndex] || [];
                var sharpe = (ret / volatility).toFixed(2);

                var stockLines = [];
                for (var j = 0; j < weights.length; j++) {
                  var name = apidata.importedHeaderValuesList[j + 1] || ('Asset ' + (j + 1));
                  stockLines.push(name + ': ' + ((weights[j] * 100).toFixed(2)) + '%');
                }

                var mainLines = [
                  'Sharpe ratio: ' + sharpe,
                  'Return: ' + ret.toFixed(3),
                  'Volatility: ' + volatility.toFixed(3)
                ];

                if (mainValuesBox) {
                  mainValuesBox.innerHTML = '';
                  mainLines.forEach(function (line) {
                    var d = document.createElement('div');
                    d.textContent = line;
                    mainValuesBox.appendChild(d);
                  });
                }
                if (weightsBox) {
                  weightsBox.classList.remove('muted');
                  weightsBox.innerHTML = '';
                  stockLines.forEach(function (line) {
                    var d = document.createElement('div');
                    d.textContent = line;
                    weightsBox.appendChild(d);
                  });
                }

                return mainLines.concat(stockLines);
              }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'RETURN', color: '#1e293b', font: { size: 12, family: 'Exo' } },
            grid: { color: '#e2e5ea' },
            ticks: { color: '#64748b' }
          },
          x: {
            type: 'linear',
            position: 'bottom',
            title: { display: true, text: 'VOLATILITY', color: '#1e293b', font: { size: 12, family: 'Exo' } },
            grid: { color: '#e2e5ea' },
            ticks: { color: '#64748b' }
          }
        }
      }
    };
  }

  function renderChart(apidata) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (idleEl) idleEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'grid';

    if (mainValuesBox) mainValuesBox.innerHTML = '';
    if (weightsBox) {
      weightsBox.classList.add('muted');
      weightsBox.textContent = 'Hover a point on the chart to inspect a portfolio.';
    }

    if (typeof Chart === 'undefined') {
      showIdle('Chart library failed to load', 'Please reload the page and try again.');
      return;
    }
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(canvas.getContext('2d'), scatterConfig(apidata));
  }

  // --- run the simulation --------------------------------------------

  function runSimulation() {
    var assets = selectedAssets();
    var errors = [];

    // reset invalid marks
    [iterationsEl, startEl, endEl].forEach(function (el) { el && el.classList.remove('invalid'); });

    if (assets.length < 2) {
      errors.push('Select at least two assets (watchlist or custom).');
    }

    var iterations = parseInt(iterationsEl && iterationsEl.value, 10);
    if (!iterations || iterations < 500 || iterations > 100000) {
      if (iterationsEl) iterationsEl.classList.add('invalid');
      errors.push('Iterations must be between 500 and 100000.');
    }

    var startVal = startEl && startEl.value;
    var endVal = endEl && endEl.value;
    var startMs = Date.parse(startVal);
    var endMs = Date.parse(endVal);
    var today = todayStr();
    if (!startVal || !endVal || isNaN(startMs) || isNaN(endMs) ||
        endMs <= startMs || startVal === today || endVal === today || startVal === endVal) {
      if (startEl) startEl.classList.add('invalid');
      if (endEl) endEl.classList.add('invalid');
      errors.push('Pick a valid start/end range (end after start, not today).');
    }

    if (errors.length > 0) {
      showIdle('Please fix the parameters', errors[0]);
      return;
    }

    // show loader
    if (idleEl) idleEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'block';

    var assetType = (assetTypeEl && assetTypeEl.value === 'crypto') ? 'crypto' : 'stocks';
    var yahoo = assets.map(function (a) { return a.yahoo; });
    var labels = assets.map(function (a) { return a.label; });

    var url = '/api/sharpe-data'
      + '?assetType=' + encodeURIComponent(assetType)
      + '&iterations=' + encodeURIComponent(iterations)
      + '&start=' + encodeURIComponent(startMs)
      + '&end=' + encodeURIComponent(endMs)
      + '&assets=' + encodeURIComponent(yahoo.join(','))
      + '&labels=' + encodeURIComponent(labels.join(','));

    fetch(url, { headers: { 'X-Requested-With': 'fetch' } })
      .then(function (res) { return res.json(); })
      .then(function (apidata) {
        if (!apidata || (apidata.errorResponse && apidata.errorResponse.length > 0)) {
          var msg = apidata && apidata.errorResponse ? apidata.errorResponse[0] : 'Unknown error';
          showIdle('Simulation could not run', msg);
          return;
        }
        if (!apidata.data1 || !apidata.data1.length) {
          showIdle('Simulation returned no data', 'Try a different asset set or date range.');
          return;
        }
        renderChart(apidata);
      })
      .catch(function () {
        showIdle('The simulation request failed', 'Check your parameters and try again.');
      });
  }

  if (runBtn) runBtn.addEventListener('click', runSimulation);

  // --- init -----------------------------------------------------------
  setDefaultDates();
  refresh();
})();
