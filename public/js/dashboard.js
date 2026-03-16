/* ============================================================
   Dashboard client-side: fetch data, sort, filter, delete, add
   Works on an in-memory dataset — NO API re-fetches after load.
   ============================================================ */

(function () {
  'use strict';

  var rows = [];
  var tbody = document.getElementById('stock-tbody');
  var searchInput = document.getElementById('search-input');
  var countEl = document.getElementById('row-count');
  var overlay = document.getElementById('loading-overlay');
  var content = document.getElementById('dashboard-content');
  var errorMsg = document.getElementById('error-msg');
  var addForm = document.getElementById('add-form');

  var currentSort = { col: null, dir: null };

  // ---- Helpers: parse formatted numbers ---------------------

  function parseMarketCap(str) {
    if (!str || str === '-') return -Infinity;
    var cleaned = str.replace(/[^0-9.\-KMBT]/gi, '');
    var num = parseFloat(cleaned);
    if (isNaN(num)) return -Infinity;
    var upper = str.toUpperCase();
    if (upper.indexOf('T') !== -1) return num * 1e12;
    if (upper.indexOf('B') !== -1) return num * 1e9;
    if (upper.indexOf('M') !== -1) return num * 1e6;
    if (upper.indexOf('K') !== -1) return num * 1e3;
    return num;
  }

  function parseNumeric(str) {
    if (!str || str === '-') return -Infinity;
    var num = parseFloat(str.replace(/[^0-9.\-+]/g, ''));
    return isNaN(num) ? -Infinity : num;
  }

  function parsePercent(str) {
    if (!str || str === '-') return -Infinity;
    var num = parseFloat(str.replace(/[^0-9.\-+]/g, ''));
    return isNaN(num) ? -Infinity : num;
  }

  function getParser(col) {
    switch (col) {
      case 'marketCap': return parseMarketCap;
      case 'beta': return parseNumeric;
      case 'dailyChange': return parseNumeric;
      case 'dailyChangePct': return parsePercent;
      default: return null;
    }
  }

  // ---- Change color class -----------------------------------
  function changeClass(val) {
    if (!val || val === '-') return '';
    if (val.indexOf('+') !== -1) return 'change-pos';
    if (val.indexOf('-') !== -1 && val !== '-') return 'change-neg';
    return '';
  }

  // ---- Build TradingView URL --------------------------------
  function tvUrl(symbol) {
    return 'https://www.tradingview.com/symbols/' + encodeURIComponent(symbol) + '/';
  }

  // ---- Render rows ------------------------------------------
  function render(data) {
    if (!tbody) return;

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="no-data">No matching assets</td></tr>';
      if (countEl) countEl.textContent = '0 assets';
      return;
    }

    var html = '';
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var safeSymbol = esc(r.symbol);
      html += '<tr class="asset-row" data-symbol="' + safeSymbol + '">'
        + '<td class="col-expand"><button class="btn-expand" data-symbol="' + safeSymbol + '" title="Show financial details"><i class="bi bi-chevron-right"></i></button></td>'
        + '<td class="col-sym"><a class="sym-link" href="' + tvUrl(r.symbol) + '" target="_blank" rel="noopener">' + safeSymbol + '</a></td>'
        + '<td>' + esc(r.companyName) + '</td>'
        + '<td class="col-num">' + esc(r.marketCap) + '</td>'
        + '<td class="col-num">' + esc(r.lastPrice) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChange) + '">' + esc(r.dailyChange) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChangePct) + '">' + esc(r.dailyChangePct) + '</td>'
        + '<td class="col-num">' + esc(r.beta) + '</td>'
        + '<td class="col-num">' + esc(r.targetPrice) + '</td>'
        + '<td>' + esc(r.rating) + '</td>'
        + '<td>' + esc(r.updateTime) + '</td>'
        + '<td><button class="btn-delete" title="Remove ' + safeSymbol + '" onclick="window.__deleteSymbol(\'' + esc(r.symbol) + '\')"><i class="bi bi-trash3"></i></button></td>'
        + '</tr>'
        + '<tr class="detail-row" id="detail-' + safeSymbol + '" style="display:none;">'
        + '<td colspan="12"><div class="detail-panel" id="panel-' + safeSymbol + '"></div></td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    if (countEl) countEl.textContent = data.length + ' asset' + (data.length !== 1 ? 's' : '');
  }

  function esc(s) {
    if (s === null || s === undefined) return '-';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Filter -----------------------------------------------
  function getFilteredRows() {
    var q = (searchInput ? searchInput.value : '').toLowerCase().trim();
    if (!q) return rows.slice();
    return rows.filter(function (r) {
      return (r.symbol && r.symbol.toLowerCase().indexOf(q) !== -1)
        || (r.companyName && r.companyName.toLowerCase().indexOf(q) !== -1);
    });
  }

  // ---- Sort -------------------------------------------------
  function sortRows(data, col, dir) {
    var parser = getParser(col);
    if (!parser) return data;

    var sorted = data.slice();
    var mult = dir === 'asc' ? 1 : -1;

    sorted.sort(function (a, b) {
      var va = parser(a[col]);
      var vb = parser(b[col]);
      if (va === vb) return 0;
      return (va < vb ? -1 : 1) * mult;
    });

    return sorted;
  }

  function refresh() {
    var data = getFilteredRows();
    if (currentSort.col) {
      data = sortRows(data, currentSort.col, currentSort.dir);
    }
    render(data);
  }

  // ---- Show error banner ------------------------------------
  function showError(msg) {
    if (!errorMsg) return;
    errorMsg.textContent = msg;
    errorMsg.style.display = '';
    setTimeout(function () { errorMsg.style.display = 'none'; }, 5000);
  }

  // ---- Dismiss loader, show content -------------------------
  function dismissLoader() {
    if (content) content.style.display = '';
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(function () { overlay.remove(); }, 400);
    }
  }

  // ---- Event: search input ----------------------------------
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      refresh();
    });
  }

  // ---- Event: sortable headers ------------------------------
  var headers = document.querySelectorAll('.stock-table th.sortable');
  for (var i = 0; i < headers.length; i++) {
    headers[i].addEventListener('click', function () {
      var col = this.getAttribute('data-col');

      for (var j = 0; j < headers.length; j++) {
        headers[j].classList.remove('sort-asc', 'sort-desc');
      }

      if (currentSort.col !== col) {
        currentSort = { col: col, dir: 'desc' };
      } else if (currentSort.dir === 'desc') {
        currentSort.dir = 'asc';
      } else {
        currentSort = { col: null, dir: null };
      }

      if (currentSort.col) {
        this.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }

      refresh();
    });
  }

  // ---- Delete -----------------------------------------------
  window.__deleteSymbol = function (symbol) {
    if (!confirm('Remove ' + symbol + ' from your list?')) return;

    rows = rows.filter(function (r) { return r.symbol !== symbol; });
    refresh();

    var form = new FormData();
    form.append('symbol', symbol);
    fetch('/delete-symbol', {
      method: 'POST',
      body: form,
      headers: { 'X-Requested-With': 'fetch' }
    }).catch(function () { /* best-effort */ });
  };

  // ---- Add symbol -------------------------------------------
  if (addForm) {
    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('add-symbol-input');
      var symbol = (input.value || '').trim().toUpperCase();
      if (!symbol) return;

      fetch('/add-symbol', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch'
        },
        body: JSON.stringify({ symbol: symbol })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.success) {
            input.value = '';
            // Reload to get fresh data with the new symbol
            window.location.reload();
          } else {
            showError(data.error || 'Failed to add symbol.');
          }
        })
        .catch(function () {
          showError('Network error — could not add symbol.');
        });
    });
  }

  // ---- Check for ?error= query param -----------------------
  var urlParams = new URLSearchParams(window.location.search);
  var urlError = urlParams.get('error');
  if (urlError) {
    // Clean the URL
    window.history.replaceState({}, '', window.location.pathname);
    showError(urlError);
  }

  // ---- Fetch data from API and boot dashboard ---------------
  fetch('/api/dashboard-data')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      rows = data.rows || [];
      if (data.error) {
        showError(data.error);
      }
      refresh();
      dismissLoader();
    })
    .catch(function () {
      showError('Failed to load dashboard data.');
      dismissLoader();
    });
})();
