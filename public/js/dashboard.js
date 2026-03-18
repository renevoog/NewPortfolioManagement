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
  var refreshTimeEl = document.getElementById('refresh-time');

  var currentSort = { col: null, dir: null };

  // Track which rows are expanded (survives rerender)
  var expandedSymbols = {};

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

  // ---- Build rating badge HTML --------------------------------
  function ratingCell(rating) {
    if (!rating || rating === '-') return '<td class="col-rating"><span class="rating-none">-</span></td>';

    var r = rating.toLowerCase();
    var cls = 'rating-neutral';
    if (r.indexOf('buy') !== -1 || r.indexOf('outperform') !== -1 || r.indexOf('overweight') !== -1) {
      cls = 'rating-buy';
    } else if (r.indexOf('sell') !== -1 || r.indexOf('underperform') !== -1 || r.indexOf('underweight') !== -1) {
      cls = 'rating-sell';
    } else if (r.indexOf('hold') !== -1 || r.indexOf('neutral') !== -1) {
      cls = 'rating-hold';
    }

    return '<td class="col-rating"><span class="rating-badge ' + cls + '">' + esc(rating) + '</span></td>';
  }

  // ---- Build event cell HTML --------------------------------
  function eventCell(ev) {
    if (!ev) return '<td class="col-event"><span class="event-none">-</span></td>';

    var icon, badgeClass, typeLabel, tooltip;

    if (ev.type === 'earnings') {
      if (ev.isPast) {
        icon = 'bi-calendar-check';
        badgeClass = 'event-past';
        typeLabel = 'Reported';
      } else if (ev.daysUntil <= 7) {
        icon = 'bi-calendar-event-fill';
        badgeClass = 'event-soon';
        typeLabel = 'Earnings';
      } else {
        icon = 'bi-calendar-event';
        badgeClass = 'event-upcoming';
        typeLabel = 'Earnings';
      }
    } else if (ev.type === 'abnormal_move') {
      icon = 'bi-graph-up-arrow';
      badgeClass = 'event-alert';
      typeLabel = 'Move';
    } else if (ev.type === 'sigdev') {
      icon = 'bi-lightning';
      badgeClass = 'event-sigdev';
      typeLabel = 'Signal';
    } else {
      icon = 'bi-calendar';
      badgeClass = 'event-upcoming';
      typeLabel = 'Event';
    }

    // Build tooltip
    tooltip = typeLabel + ': ' + esc(ev.tooltipDate || ev.displayDate || ev.label || '');
    if (ev.isEstimate) tooltip += ' (est.)';

    return '<td class="col-event">'
      + '<span class="event-badge ' + badgeClass + '" title="' + esc(tooltip) + '">'
      + '<i class="bi ' + icon + '"></i> '
      + esc(ev.label)
      + '</span>'
      + '</td>';
  }

  // ---- Render rows ------------------------------------------
  function render(data) {
    if (!tbody) return;

    // True empty state: user has no assets at all (not just search miss)
    if (!data.length && rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="12" class="no-data">'
        + '<div class="empty-watchlist">'
        + '<i class="bi bi-plus-circle" style="font-size:1.6rem;opacity:0.4;"></i>'
        + '<p>Your watchlist is empty</p>'
        + '<p class="empty-watchlist-hint">Add your first symbol using the input above.</p>'
        + '</div>'
        + '</td></tr>';
      if (countEl) countEl.textContent = '0 assets';
      return;
    }

    // Search returned no results
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="no-data">No matching assets</td></tr>';
      if (countEl) countEl.textContent = '0 assets';
      return;
    }

    var html = '';
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var safeSymbol = esc(r.symbol);
      var isExpanded = expandedSymbols[r.symbol] || false;
      var expandedClass = isExpanded ? ' expanded' : '';
      var detailDisplay = isExpanded ? '' : 'display:none;';

      html += '<tr class="asset-row" data-symbol="' + safeSymbol + '">'
        + '<td class="col-expand"><button class="btn-expand' + expandedClass + '" data-symbol="' + safeSymbol + '" title="Show financial details"><i class="bi bi-chevron-right"></i></button></td>'
        + '<td class="col-sym"><a class="sym-link" href="' + tvUrl(r.symbol) + '" target="_blank" rel="noopener">' + safeSymbol + '</a></td>'
        + '<td>' + esc(r.companyName) + '</td>'
        + '<td class="col-num">' + esc(r.marketCap) + '</td>'
        + '<td class="col-num">' + esc(r.lastPrice) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChange) + '">' + esc(r.dailyChange) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChangePct) + '">' + esc(r.dailyChangePct) + '</td>'
        + '<td class="col-num">' + esc(r.beta) + '</td>'
        + '<td class="col-num">' + esc(r.targetPrice) + '</td>'
        + ratingCell(r.rating)
        + eventCell(r.event)
        + '<td><button class="btn-delete" title="Remove ' + safeSymbol + '" onclick="window.__deleteSymbol(\'' + esc(r.symbol) + '\')"><i class="bi bi-trash3"></i></button></td>'
        + '</tr>'
        + '<tr class="detail-row" id="detail-' + safeSymbol + '" style="' + detailDisplay + '">'
        + '<td colspan="12"><div class="detail-panel" id="panel-' + safeSymbol + '"></div></td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    if (countEl) countEl.textContent = data.length + ' asset' + (data.length !== 1 ? 's' : '');

    // Re-trigger detail rendering for expanded rows (financial-detail.js handles this via event)
    Object.keys(expandedSymbols).forEach(function (sym) {
      if (expandedSymbols[sym]) {
        var evt = new CustomEvent('detail-reopen', { detail: { symbol: sym } });
        document.dispatchEvent(evt);
      }
    });
  }

  function esc(s) {
    if (s === null || s === undefined) return '-';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Expose expanded state to financial-detail.js ---------
  window.__expandedSymbols = expandedSymbols;

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

  // ---- Delete (with server error rollback) ------------------
  window.__deleteSymbol = function (symbol) {
    if (!confirm('Remove ' + symbol + ' from your list?')) return;

    // Optimistic removal
    var removedRow = null;
    var removedIndex = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].symbol === symbol) {
        removedRow = rows[i];
        removedIndex = i;
        break;
      }
    }
    rows = rows.filter(function (r) { return r.symbol !== symbol; });
    delete expandedSymbols[symbol];
    refresh();

    var form = new FormData();
    form.append('symbol', symbol);
    fetch('/delete-symbol', {
      method: 'POST',
      body: form,
      headers: { 'X-Requested-With': 'fetch' }
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          // Rollback on server failure
          if (removedRow && removedIndex >= 0) {
            rows.splice(removedIndex, 0, removedRow);
            refresh();
          }
          showError('Failed to delete ' + symbol + '. Restored.');
        }
      })
      .catch(function () {
        // Rollback on network failure
        if (removedRow && removedIndex >= 0) {
          rows.splice(removedIndex, 0, removedRow);
          refresh();
        }
        showError('Network error — could not delete ' + symbol + '. Restored.');
      });
  };

  // ---- Expose expand toggle for financial-detail.js ---------
  window.__setExpanded = function (symbol, isExpanded) {
    if (isExpanded) {
      expandedSymbols[symbol] = true;
    } else {
      delete expandedSymbols[symbol];
    }
  };

  // ---- Add symbol (AJAX, insert row without full reload) ----
  if (addForm) {
    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('add-symbol-input');
      var symbol = (input.value || '').trim().toUpperCase();
      if (!symbol) return;

      var btn = addForm.querySelector('.btn-add');
      if (btn) btn.disabled = true;

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
          if (btn) btn.disabled = false;
          if (data.success) {
            input.value = '';
            // Re-fetch dashboard data to get the new symbol's full row
            fetch('/api/dashboard-data')
              .then(function (res) { return res.json(); })
              .then(function (freshData) {
                rows = freshData.rows || [];
                if (freshData.refreshTime && refreshTimeEl) {
                  refreshTimeEl.textContent = 'Last refreshed: ' + freshData.refreshTime;
                }
                refresh();
              })
              .catch(function () {
                // Fallback: add a placeholder row
                rows.push({ symbol: symbol, companyName: 'Loading...', marketCap: '-', lastPrice: '-', dailyChange: '-', dailyChangePct: '-', beta: '-', targetPrice: '-', rating: '-', event: null });
                refresh();
              });
          } else {
            showError(data.error || 'Failed to add symbol.');
          }
        })
        .catch(function () {
          if (btn) btn.disabled = false;
          showError('Network error — could not add symbol.');
        });
    });
  }

  // ---- Share watchlist (admin only) -------------------------
  var shareForm = document.getElementById('share-form');
  if (shareForm) {
    shareForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = document.getElementById('share-email-input');
      var msgEl = document.getElementById('share-msg');
      var email = (emailInput.value || '').trim();
      if (!email) return;

      fetch('/api/share-watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch'
        },
        body: JSON.stringify({ email: email })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (msgEl) {
            msgEl.textContent = data.message || data.error || 'Done.';
            msgEl.className = 'share-msg ' + (data.success ? 'share-success' : 'share-error');
            msgEl.style.display = '';
            setTimeout(function () { msgEl.style.display = 'none'; }, 4000);
          }
          if (data.success) emailInput.value = '';
        })
        .catch(function () {
          if (msgEl) {
            msgEl.textContent = 'Network error.';
            msgEl.className = 'share-msg share-error';
            msgEl.style.display = '';
            setTimeout(function () { msgEl.style.display = 'none'; }, 4000);
          }
        });
    });
  }

  // ---- Check for ?error= query param -----------------------
  var urlParams = new URLSearchParams(window.location.search);
  var urlError = urlParams.get('error');
  if (urlError) {
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
      // Show global refresh timestamp in status bar
      if (data.refreshTime && refreshTimeEl) {
        refreshTimeEl.textContent = 'Last refreshed: ' + data.refreshTime;
      }
      refresh();
      dismissLoader();
    })
    .catch(function () {
      showError('Failed to load dashboard data.');
      dismissLoader();
    });
})();
