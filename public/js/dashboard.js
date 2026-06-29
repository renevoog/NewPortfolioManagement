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
      case 'dailyChangePct':
      case 'change7d':
      case 'change1mo':
      case 'change3mo':
      case 'change6mo':
      case 'change1y':
      case 'range52w':
      case 'vs200d':
      case 'divYield':
      case 'payout':
      case 'upside':
        return parsePercent;
      case 'forwardPE':
      case 'peg':
        return parseNumeric;
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
    if (!rating || rating === '-') return '<td class="col-rating" data-col-key="rating"><span class="rating-none">-</span></td>';

    var r = rating.toLowerCase();
    var cls = 'rating-neutral';
    if (r.indexOf('buy') !== -1 || r.indexOf('outperform') !== -1 || r.indexOf('overweight') !== -1) {
      cls = 'rating-buy';
    } else if (r.indexOf('sell') !== -1 || r.indexOf('underperform') !== -1 || r.indexOf('underweight') !== -1) {
      cls = 'rating-sell';
    } else if (r.indexOf('hold') !== -1 || r.indexOf('neutral') !== -1) {
      cls = 'rating-hold';
    }

    return '<td class="col-rating" data-col-key="rating"><span class="rating-badge ' + cls + '">' + esc(rating) + '</span></td>';
  }

  // ---- Build event cell HTML --------------------------------
  function eventCell(ev) {
    if (!ev) return '<td class="col-event" data-col-key="events"><span class="event-none">-</span></td>';

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

    return '<td class="col-event" data-col-key="events">'
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
      tbody.innerHTML = '<tr><td colspan="24" class="no-data">'
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
      tbody.innerHTML = '<tr><td colspan="24" class="no-data">No matching assets</td></tr>';
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
        + '<td data-col-key="company">' + esc(r.companyName) + '</td>'
        + '<td class="col-num" data-col-key="marketCap">' + esc(r.marketCap) + '</td>'
        + '<td class="col-num" data-col-key="price">' + esc(r.lastPrice) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChange) + '" data-col-key="dailyChange">' + esc(r.dailyChange) + '</td>'
        + '<td class="col-num ' + changeClass(r.dailyChangePct) + '" data-col-key="dailyChangePct">' + esc(r.dailyChangePct) + '</td>'
        + '<td class="col-num ' + changeClass(r.change7d) + '" data-col-key="change7d">' + esc(r.change7d) + '</td>'
        + '<td class="col-num ' + changeClass(r.change1mo) + '" data-col-key="change1mo">' + esc(r.change1mo) + '</td>'
        + '<td class="col-num ' + changeClass(r.change3mo) + '" data-col-key="change3mo">' + esc(r.change3mo) + '</td>'
        + '<td class="col-num ' + changeClass(r.change6mo) + '" data-col-key="change6mo">' + esc(r.change6mo) + '</td>'
        + '<td class="col-num ' + changeClass(r.change1y) + '" data-col-key="change1y">' + esc(r.change1y) + '</td>'
        + '<td class="col-num" data-col-key="range52w">' + esc(r.range52w) + '</td>'
        + '<td class="col-num ' + changeClass(r.vs200d) + '" data-col-key="vs200d">' + esc(r.vs200d) + '</td>'
        + '<td class="col-num" data-col-key="forwardPE">' + esc(r.forwardPE) + '</td>'
        + '<td class="col-num" data-col-key="peg">' + esc(r.peg) + '</td>'
        + '<td class="col-num" data-col-key="divYield">' + esc(r.divYield) + '</td>'
        + '<td class="col-num" data-col-key="payout">' + esc(r.payout) + '</td>'
        + '<td class="col-num" data-col-key="beta">' + esc(r.beta) + '</td>'
        + '<td class="col-num" data-col-key="target">' + esc(r.targetPrice) + '</td>'
        + '<td class="col-num ' + changeClass(r.upside) + '" data-col-key="upside">' + esc(r.upside) + '</td>'
        + ratingCell(r.rating)
        + eventCell(r.event)
        + '<td><button class="btn-delete" title="Remove ' + safeSymbol + '" onclick="window.__deleteSymbol(\'' + esc(r.symbol) + '\')"><i class="bi bi-trash3"></i></button></td>'
        + '</tr>'
        + '<tr class="detail-row" id="detail-' + safeSymbol + '" style="' + detailDisplay + '">'
        + '<td colspan="24"><div class="detail-panel" id="panel-' + safeSymbol + '"></div></td>'
        + '</tr>';
    }
    tbody.innerHTML = html;
    if (countEl) countEl.textContent = data.length + ' asset' + (data.length !== 1 ? 's' : '');

    // Apply column show/hide to the freshly rendered cells
    applyColumnVisibility();

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
                rows.push({ symbol: symbol, companyName: 'Loading...', marketCap: '-', lastPrice: '-', dailyChange: '-', dailyChangePct: '-', change7d: '-', change1mo: '-', change3mo: '-', change6mo: '-', change1y: '-', range52w: '-', vs200d: '-', forwardPE: '-', peg: '-', divYield: '-', payout: '-', beta: '-', targetPrice: '-', upside: '-', rating: '-', event: null });
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

  // ---- Column show/hide -------------------------------------
  var COL_STORE_KEY = 'pmt_hidden_cols';

  function getHiddenCols() {
    try {
      var raw = localStorage.getItem(COL_STORE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function setHiddenCols(arr) {
    try { localStorage.setItem(COL_STORE_KEY, JSON.stringify(arr)); } catch (e) { /* ignore */ }
  }

  // Show/hide every header + body cell tagged with a hidden column key
  function applyColumnVisibility() {
    var hidden = getHiddenCols();
    var els = document.querySelectorAll('.stock-table [data-col-key]');
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute('data-col-key');
      els[i].style.display = hidden.indexOf(key) !== -1 ? 'none' : '';
    }
  }

  // Build the checkbox menu from the table headers (single source of truth)
  function buildColumnMenu() {
    var list = document.getElementById('col-toggle-list');
    if (!list) return;
    var ths = document.querySelectorAll('.stock-table th[data-col-key]');
    var hidden = getHiddenCols();
    var html = '';
    for (var i = 0; i < ths.length; i++) {
      var key = ths[i].getAttribute('data-col-key');
      var label = ths[i].getAttribute('data-col-label') || (ths[i].textContent || '').trim() || key;
      var checked = hidden.indexOf(key) === -1 ? ' checked' : '';
      html += '<label class="col-toggle-item">'
        + '<input type="checkbox" data-col-key="' + esc(key) + '"' + checked + '>'
        + '<span>' + esc(label) + '</span>'
        + '</label>';
    }
    list.innerHTML = html;
  }

  (function initColumnToggle() {
    var btn = document.getElementById('col-toggle-btn');
    var menu = document.getElementById('col-toggle-menu');
    var list = document.getElementById('col-toggle-list');
    var resetBtn = document.getElementById('col-toggle-reset');
    var saveBtn = document.getElementById('col-toggle-save');
    var statusEl = document.getElementById('col-toggle-status');
    if (!btn || !menu || !list) return;

    // If the server provided a saved layout (from the DB), it is authoritative
    // on load — seed the local working copy from it.
    if (window.__savedColumns && Object.prototype.toString.call(window.__savedColumns) === '[object Array]') {
      setHiddenCols(window.__savedColumns);
    }

    function setStatus(text, cls) {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.className = 'col-toggle-status' + (cls ? ' ' + cls : '');
    }
    function markDirty() { setStatus('Unsaved changes', 'dirty'); }

    buildColumnMenu();
    applyColumnVisibility();

    // Toggle a single column on checkbox change
    list.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      var key = cb.getAttribute('data-col-key');
      var hidden = getHiddenCols();
      var idx = hidden.indexOf(key);
      if (cb.checked && idx !== -1) hidden.splice(idx, 1);
      else if (!cb.checked && idx === -1) hidden.push(key);
      setHiddenCols(hidden);
      applyColumnVisibility();
      markDirty();
    });

    // Show all
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        setHiddenCols([]);
        buildColumnMenu();
        applyColumnVisibility();
        markDirty();
      });
    }

    // Save the current layout to the database (persists across devices/sessions)
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var hidden = getHiddenCols();
        saveBtn.disabled = true;
        setStatus('Saving…', '');
        fetch('/api/column-preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
          body: JSON.stringify({ hidden: hidden })
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            saveBtn.disabled = false;
            if (data && data.success) setStatus('Saved ✓', 'saved');
            else setStatus((data && data.error) || 'Save failed', 'error');
          })
          .catch(function () {
            saveBtn.disabled = false;
            setStatus('Network error', 'error');
          });
      });
    }

    // Open / close the dropdown
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = menu.style.display !== 'none';
      menu.style.display = isOpen ? 'none' : '';
      btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    // Close when clicking outside
    document.addEventListener('click', function (e) {
      if (menu.style.display !== 'none' && !menu.contains(e.target) && e.target !== btn) {
        menu.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  })();

  // ---- Header explanation tooltips --------------------------
  // Big, readable tooltips explaining each metric. Appended to <body> so the
  // table's overflow containers can't clip them.
  (function initHeaderTips() {
    var ths = document.querySelectorAll('.stock-table th[data-tip]');
    if (!ths.length) return;

    var tip = document.createElement('div');
    tip.className = 'col-tip';
    tip.style.display = 'none';
    document.body.appendChild(tip);

    function showTip(th) {
      var title = th.getAttribute('data-col-label') || (th.textContent || '').trim();
      var body = th.getAttribute('data-tip') || '';
      tip.innerHTML = '<strong>' + esc(title) + '</strong>' + esc(body);
      tip.style.display = 'block';
      var r = th.getBoundingClientRect();
      var tw = tip.offsetWidth;
      var left = r.left;
      if (left + tw > window.innerWidth - 12) left = window.innerWidth - tw - 12;
      if (left < 8) left = 8;
      tip.style.left = left + 'px';
      tip.style.top = (r.bottom + 8) + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }

    for (var i = 0; i < ths.length; i++) {
      (function (el) {
        el.addEventListener('mouseenter', function () { showTip(el); });
        el.addEventListener('mouseleave', hideTip);
      })(ths[i]);
    }
    // Avoid stale positioning when the page moves
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
  })();

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
