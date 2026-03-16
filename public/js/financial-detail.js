/* ============================================================
   Financial detail panel — expand/collapse, lazy fetch, Chart.js
   Loaded AFTER dashboard.js on the home page.
   ============================================================ */

(function () {
  'use strict';

  // ---- Client-side cache: symbol -> response data -----------
  var cache = {};

  // ---- Chart instances: symbol -> Chart object ---------------
  var charts = {};

  // ---- Currently active view per symbol: symbol -> 'quarterly'|'yearly'
  var activeView = {};

  // ---- Compact value formatter for chart axes ----------------
  function compactValue(val) {
    if (val === null || val === undefined) return '-';
    var abs = Math.abs(val);
    if (abs >= 1e12) return (val / 1e12).toFixed(1) + 'T';
    if (abs >= 1e9) return (val / 1e9).toFixed(1) + 'B';
    if (abs >= 1e6) return (val / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (val / 1e3).toFixed(0) + 'K';
    return val.toFixed(0);
  }

  // ---- Full value formatter for tooltips ---------------------
  function fullValue(val) {
    if (val === null || val === undefined) return 'N/A';
    var abs = Math.abs(val);
    var sign = val < 0 ? '-' : '';
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + ' T';
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + ' B';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + ' M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + ' K';
    return val.toLocaleString();
  }

  // ---- Loading spinner HTML (same design language) -----------
  function loaderHTML() {
    return '<div class="detail-loader">'
      + '<div class="loader-dots loader-dots-sm">'
      + '<span></span><span></span><span></span><span></span>'
      + '</div>'
      + '<p class="detail-loader-text">Loading financial history\u2026</p>'
      + '</div>';
  }

  // ---- Empty state HTML --------------------------------------
  function emptyHTML() {
    return '<div class="detail-empty">'
      + '<i class="bi bi-bar-chart"></i>'
      + '<p>No financial history available for this asset.</p>'
      + '</div>';
  }

  // ---- Error state HTML --------------------------------------
  function errorHTML(msg) {
    return '<div class="detail-empty detail-error">'
      + '<i class="bi bi-exclamation-triangle"></i>'
      + '<p>' + (msg || 'Failed to load financial data.') + '</p>'
      + '</div>';
  }

  // ---- Build chart panel HTML --------------------------------
  function panelHTML(symbol, data) {
    var hasQ = data.availability && data.availability.quarterly;
    var hasY = data.availability && data.availability.yearly;

    if (!hasQ && !hasY) return emptyHTML();

    var html = '<div class="detail-header">'
      + '<div class="detail-title">'
      + '<span class="detail-title-text">Financial performance</span>'
      + '<span class="detail-source">Source: ' + (data.source || 'Yahoo Finance') + '</span>'
      + '</div>';

    // Toggle only if both views available
    if (hasQ && hasY) {
      html += '<div class="detail-toggle">'
        + '<button class="toggle-btn toggle-active" data-view="quarterly" data-symbol="' + symbol + '">Quarterly</button>'
        + '<button class="toggle-btn" data-view="yearly" data-symbol="' + symbol + '">Yearly</button>'
        + '</div>';
    }

    html += '</div>'
      + '<div class="detail-chart-wrap">'
      + '<canvas id="chart-' + symbol + '"></canvas>'
      + '</div>';

    return html;
  }

  // ---- Render or update chart --------------------------------
  function renderChart(symbol, data, view) {
    var canvas = document.getElementById('chart-' + symbol);
    if (!canvas) return;

    var periods = (view === 'yearly' && data.yearly)
      ? data.yearly.periods
      : data.quarterly.periods;

    if (!periods || !periods.length) return;

    var labels = periods.map(function (p) { return p.label; });
    var revenueData = periods.map(function (p) { return p.revenue; });
    var netIncomeData = periods.map(function (p) { return p.netIncome; });

    // Destroy existing chart for this symbol
    if (charts[symbol]) {
      charts[symbol].destroy();
      charts[symbol] = null;
    }

    var ctx = canvas.getContext('2d');
    charts[symbol] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Revenue',
            data: revenueData,
            backgroundColor: 'rgba(27, 38, 58, 0.82)',
            borderColor: 'rgba(27, 38, 58, 1)',
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.7,
            categoryPercentage: 0.75
          },
          {
            label: 'Net Income',
            data: netIncomeData,
            backgroundColor: 'rgba(59, 130, 246, 0.72)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.7,
            categoryPercentage: 0.75
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              font: { family: "'Exo', sans-serif", size: 12 },
              boxWidth: 14,
              boxHeight: 14,
              padding: 16,
              usePointStyle: false
            }
          },
          tooltip: {
            backgroundColor: 'rgba(27, 38, 58, 0.95)',
            titleFont: { family: "'Exo', sans-serif", size: 13 },
            bodyFont: { family: "'Exo', sans-serif", size: 12 },
            cornerRadius: 6,
            padding: 12,
            callbacks: {
              title: function (items) {
                if (!items.length) return '';
                var idx = items[0].dataIndex;
                var period = periods[idx];
                var title = period.label;
                if (period.date) title += '  (' + period.date + ')';
                return title;
              },
              label: function (item) {
                var val = item.raw;
                return ' ' + item.dataset.label + ': ' + fullValue(val);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: "'Exo', sans-serif", size: 11 },
              color: '#64748b'
            }
          },
          y: {
            grid: { color: 'rgba(226, 229, 234, 0.6)' },
            ticks: {
              font: { family: "'Exo', sans-serif", size: 11 },
              color: '#64748b',
              callback: function (value) { return compactValue(value); }
            }
          }
        }
      }
    });
  }

  // ---- Toggle quarterly / yearly -----------------------------
  function handleToggle(e) {
    var btn = e.target.closest('.toggle-btn');
    if (!btn) return;

    var symbol = btn.getAttribute('data-symbol');
    var view = btn.getAttribute('data-view');
    if (!symbol || !view) return;

    // Update active class
    var parent = btn.parentElement;
    var buttons = parent.querySelectorAll('.toggle-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.remove('toggle-active');
    }
    btn.classList.add('toggle-active');

    activeView[symbol] = view;

    // Re-render chart with cached data
    if (cache[symbol]) {
      renderChart(symbol, cache[symbol], view);
    }
  }

  // ---- Expand / collapse a row -------------------------------
  function toggleRow(symbol) {
    var detailRow = document.getElementById('detail-' + symbol);
    var panel = document.getElementById('panel-' + symbol);
    var expandBtn = document.querySelector('.btn-expand[data-symbol="' + symbol + '"]');

    if (!detailRow || !panel) return;

    var isOpen = detailRow.style.display !== 'none';

    if (isOpen) {
      // Collapse
      detailRow.style.display = 'none';
      if (expandBtn) expandBtn.classList.remove('expanded');
      return;
    }

    // Expand
    detailRow.style.display = '';
    if (expandBtn) expandBtn.classList.add('expanded');

    // If data is cached, render immediately
    if (cache[symbol]) {
      panel.innerHTML = panelHTML(symbol, cache[symbol]);
      var view = activeView[symbol] || 'quarterly';
      renderChart(symbol, cache[symbol], view);
      attachToggleListeners(panel);
      return;
    }

    // Show loader and fetch
    panel.innerHTML = loaderHTML();

    fetch('/api/assets/' + encodeURIComponent(symbol) + '/financial-history')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        cache[symbol] = data;

        var hasQ = data.availability && data.availability.quarterly;
        var hasY = data.availability && data.availability.yearly;

        // No financial data available (ETFs, indices, etc.)
        if (!hasQ && !hasY) {
          panel.innerHTML = emptyHTML();
          return;
        }

        activeView[symbol] = 'quarterly';
        panel.innerHTML = panelHTML(symbol, data);
        renderChart(symbol, data, 'quarterly');
        attachToggleListeners(panel);
      })
      .catch(function () {
        panel.innerHTML = errorHTML('Failed to load financial data.');
      });
  }

  // ---- Attach toggle listeners inside a panel ----------------
  function attachToggleListeners(panel) {
    var toggleBtns = panel.querySelectorAll('.toggle-btn');
    for (var i = 0; i < toggleBtns.length; i++) {
      toggleBtns[i].addEventListener('click', handleToggle);
    }
  }

  // ---- Event delegation on tbody for expand buttons ----------
  var tbody = document.getElementById('stock-tbody');
  if (tbody) {
    tbody.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-expand');
      if (!btn) return;
      e.stopPropagation();
      var symbol = btn.getAttribute('data-symbol');
      if (symbol) toggleRow(symbol);
    });
  }

})();
