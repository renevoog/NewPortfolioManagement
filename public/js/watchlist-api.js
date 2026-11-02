(function () {
  'use strict';

  async function request(url, options) {
    var response = await fetch(url, options);
    if (response.redirected) throw new Error('Your session has expired. Please log in again.');
    var data;
    try { data = await response.json(); } catch (err) {
      throw new Error('Could not read the server response. Please try again.');
    }
    if (!response.ok || data.error || data.success === false) {
      throw new Error(data.error || 'Could not update your watchlist. Please try again.');
    }
    return data;
  }

  window.WatchlistAPI = {
    list: function () { return request('/api/watchlist'); },
    add: function (symbol) {
      return request('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol })
      });
    },
    remove: function (symbol) {
      return request('/api/watchlist/' + encodeURIComponent(symbol), { method: 'DELETE' });
    }
  };
})();
