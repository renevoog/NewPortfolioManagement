(function () {
  'use strict';
  var rows = [];
  var loaded = false;
  var loading = false;
  var mutating = false;
  var version = 0;
  var sort = { key: null, direction: 1 };
  var tbody = document.getElementById('watchlist-tbody');
  var search = document.getElementById('watchlist-search');
  var form = document.getElementById('watchlist-add-form');
  var input = document.getElementById('watchlist-symbol');
  var error = document.getElementById('watchlist-error');
  var message = document.getElementById('watchlist-message');
  var refreshButton = document.getElementById('watchlist-refresh');

  function showError(err) {
    error.textContent = err.message || 'Could not update your watchlist. Please try again.';
    error.hidden = false;
  }

  function controls() {
    form.querySelector('button').disabled = mutating;
    input.disabled = mutating;
    refreshButton.disabled = loading || mutating;
    tbody.querySelectorAll('.btn-favourite').forEach(function (button) { button.disabled = mutating; });
    document.getElementById('watchlist-card').setAttribute('aria-busy', String(loading));
  }

  function cell(row, text, className) {
    var td = document.createElement('td');
    td.className = className || '';
    td.textContent = text === undefined || text === null || text === '-' ? '\u2014' : text;
    row.appendChild(td);
    return td;
  }

  function changeClass(value) {
    return value > 0 ? 'change-pos' : value < 0 ? 'change-neg' : '';
  }

  function render() {
    var query = search.value.trim().toLowerCase();
    var filtered = rows.filter(function (row) {
      return row.symbol.toLowerCase().includes(query) || (row.companyName || '').toLowerCase().includes(query);
    });
    if (sort.key) filtered.sort(function (a, b) {
      var left = a[sort.key], right = b[sort.key];
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return sort.direction * (sort.key === 'symbol' ? left.localeCompare(right) : left - right);
    });
    tbody.replaceChildren();
    if (!filtered.length) {
      var emptyRow = document.createElement('tr');
      var empty = cell(emptyRow, '', 'no-data');
      empty.colSpan = 8;
      empty.textContent = !loaded ? (loading ? 'Loading your watchlist...' : 'Use Refresh to load your watchlist.')
        : rows.length ? 'No matching favourites.' : 'Your watchlist is empty. Add a symbol above or star one on the Dashboard.';
      tbody.appendChild(emptyRow);
    }
    filtered.forEach(function (row) {
      var tr = document.createElement('tr');
      var favouriteCell = cell(tr, '');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-favourite is-favourite';
      button.dataset.symbol = row.symbol;
      button.title = 'Remove from favourites: ' + row.symbol;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', 'true');
      button.innerHTML = '<i class="bi bi-star-fill" aria-hidden="true"></i>';
      favouriteCell.appendChild(button);

      var nameCell = cell(tr, '', 'col-sym');
      var link = document.createElement('a');
      link.className = 'sym-link';
      link.href = 'https://www.tradingview.com/symbols/' + encodeURIComponent(row.symbol) + '/';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = row.symbol;
      nameCell.appendChild(link);
      var name = document.createElement('span');
      name.className = 'watchlist-company';
      name.textContent = row.companyName || row.symbol;
      nameCell.appendChild(name);
      var priceCell = cell(tr, row.lastPrice, 'col-num');
      if (row.priceTime) priceCell.title = 'Last price: ' + new Date(row.priceTime).toLocaleString();
      var changeCell = cell(tr, row.change, 'col-num ' + changeClass(row.change24h));
      var percentCell = cell(tr, row.changePct, 'col-num ' + changeClass(row.change24hPct));
      if (row.comparisonTime) {
        changeCell.title = percentCell.title = 'Compared with price at ' + new Date(row.comparisonTime).toLocaleString();
      }
      cell(tr, row.change7d, 'col-num ' + changeClass(row.change7dPct));
      cell(tr, row.change1mo, 'col-num ' + changeClass(row.change1moPct));
      cell(tr, row.change6mo, 'col-num ' + changeClass(row.change6moPct));
      tbody.appendChild(tr);
    });
    document.getElementById('watchlist-count').textContent = (query ? filtered.length + ' of ' : '')
      + rows.length + ' favourite' + (rows.length === 1 ? '' : 's');
    controls();
  }

  async function load() {
    var requestVersion = ++version;
    loading = true;
    controls();
    try {
      var data = await window.WatchlistAPI.list();
      if (requestVersion !== version) return;
      rows = data.rows;
      loaded = true;
      error.hidden = true;
      document.getElementById('watchlist-updated').textContent = 'Updated ' + data.refreshTime + ' \u00b7 Every minute';
      render();
    } catch (err) {
      if (requestVersion !== version) return;
      showError(err);
      if (!loaded) render();
    } finally {
      if (requestVersion === version) {
        loading = false;
        controls();
      }
    }
  }

  function startMutation() {
    mutating = true;
    ++version; // Ignore any read started before this mutation.
    loading = false;
    error.hidden = true;
    message.textContent = '';
    controls();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var symbol = input.value.trim();
    if (!symbol || mutating) return;
    startMutation();
    try {
      var result = await window.WatchlistAPI.add(symbol);
      input.value = '';
      message.textContent = result.symbol + (result.alreadyAdded ? ' is already in your favourites.' : ' added to favourites.');
      if (!rows.some(function (row) { return row.symbol === result.symbol; })) rows.push({ symbol: result.symbol });
      search.value = '';
      loaded = true;
      render();
      await load();
    } catch (err) { showError(err); }
    finally { mutating = false; if (!loaded) render(); controls(); input.focus(); }
  });

  tbody.addEventListener('click', async function (event) {
    var button = event.target.closest('.btn-favourite');
    if (!button || mutating) return;
    var symbol = button.dataset.symbol;
    startMutation();
    try {
      await window.WatchlistAPI.remove(symbol);
      rows = rows.filter(function (row) { return row.symbol !== symbol; });
      message.textContent = symbol + ' removed from favourites.';
      render();
      input.focus();
    } catch (err) { showError(err); }
    finally { mutating = false; controls(); }
  });

  search.addEventListener('input', render);
  refreshButton.addEventListener('click', load);
  document.querySelectorAll('.watchlist-sort').forEach(function (button) {
    button.addEventListener('click', function () {
      sort.direction = sort.key === button.dataset.sort ? -sort.direction : 1;
      sort.key = button.dataset.sort;
      document.querySelectorAll('.watchlist-sort').forEach(function (other) {
        other.parentElement.setAttribute('aria-sort', other === button ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none');
        other.querySelector('i').className = 'bi bi-' + (other === button ? (sort.direction === 1 ? 'arrow-up' : 'arrow-down') : 'arrow-down-up');
      });
      render();
    });
  });
  function refreshWhenVisible() { if (!document.hidden && !loading && !mutating) load(); }
  setInterval(refreshWhenVisible, 60000);
  document.addEventListener('visibilitychange', refreshWhenVisible);
  load();
})();
