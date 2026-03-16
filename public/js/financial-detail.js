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

  // ---- Format a percentage change for display ----------------
  function fmtChange(val) {
    if (val === null || val === undefined) return null;
    var sign = val > 0 ? '+' : '';
    return sign + val.toFixed(1) + '%';
  }

  // ---- CSS class for a change value --------------------------
  function changeColorClass(val) {
    if (val === null || val === undefined) return '';
    if (val > 0.05) return 'chg-pos';
    if (val < -0.05) return 'chg-neg';
    return 'chg-neutral';
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

  // ---- Get the active periods for a view ---------------------
  function getPeriods(data, view) {
    return (view === 'yearly' && data.yearly)
      ? data.yearly.periods
      : data.quarterly.periods;
  }

  // ---- Build latest-period summary HTML ----------------------
  function latestSummaryHTML(periods) {
    if (!periods || periods.length < 2) return '';

    var latest = periods[periods.length - 1];
    var revChg = fmtChange(latest.revenueChange);
    var niChg = fmtChange(latest.netIncomeChange);

    // Only show if at least one change value exists
    if (!revChg && !niChg) return '';

    var html = '<div class="detail-summary">';
    html += '<span class="detail-summary-label">' + esc(latest.label) + ' vs prev:</span>';

    if (revChg) {
      html += '<span class="detail-summary-item">'
        + '<span class="detail-summary-metric">Revenue</span> '
        + '<span class="' + changeColorClass(latest.revenueChange) + '">' + revChg + '</span>'
        + '</span>';
    }

    if (niChg) {
      html += '<span class="detail-summary-item">'
        + '<span class="detail-summary-metric">Net income</span> '
        + '<span class="' + changeColorClass(latest.netIncomeChange) + '">' + niChg + '</span>'
        + '</span>';
    }

    html += '</div>';
    return html;
  }

  // ---- Format currency value for analyst card -----------------
  function fmtPrice(val) {
    if (val === null || val === undefined) return '-';
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ---- Determine rating color class ---------------------------
  function ratingColorClass(rating) {
    if (!rating) return 'analyst-rating-neutral';
    var r = rating.toLowerCase();
    if (r.indexOf('buy') !== -1 || r.indexOf('outperform') !== -1 || r.indexOf('overweight') !== -1) return 'analyst-rating-buy';
    if (r.indexOf('sell') !== -1 || r.indexOf('underperform') !== -1 || r.indexOf('underweight') !== -1) return 'analyst-rating-sell';
    if (r.indexOf('hold') !== -1 || r.indexOf('neutral') !== -1) return 'analyst-rating-hold';
    return 'analyst-rating-neutral';
  }

  // ---- Build analyst sentiment card HTML ----------------------
  function analystCardHTML(a) {
    if (!a || !a.available) return '';

    var html = '<div class="analyst-card">';
    html += '<div class="analyst-card-header">'
      + '<span class="analyst-card-title">Analyst consensus</span>';
    if (a.analystCount !== null) {
      html += '<span class="analyst-card-count">' + a.analystCount + ' analyst' + (a.analystCount !== 1 ? 's' : '') + '</span>';
    }
    html += '</div>';

    html += '<div class="analyst-grid">';

    // Consensus rating
    if (a.consensusRating) {
      html += '<span class="analyst-label">Rating</span>'
        + '<span class="analyst-value analyst-rating ' + ratingColorClass(a.consensusRating) + '">' + esc(a.consensusRating) + '</span>';
    }

    // Target price + implied upside
    if (a.averageTargetPrice !== null) {
      var upsideStr = '';
      if (a.impliedUpsidePct !== null) {
        var sign = a.impliedUpsidePct > 0 ? '+' : '';
        var upsideClass = a.impliedUpsidePct >= 0 ? 'analyst-upside-pos' : 'analyst-upside-neg';
        upsideStr = ' <span class="' + upsideClass + '">(' + sign + a.impliedUpsidePct.toFixed(1) + '%)</span>';
      }
      html += '<span class="analyst-label">Avg target</span>'
        + '<span class="analyst-value">' + fmtPrice(a.averageTargetPrice) + upsideStr + '</span>';
    }

    // Target range
    if (a.targetLow !== null && a.targetHigh !== null) {
      html += '<span class="analyst-label">Range</span>'
        + '<span class="analyst-value analyst-target-range">' + fmtPrice(a.targetLow) + ' — ' + fmtPrice(a.targetHigh) + '</span>';
    }

    // Current price
    if (a.currentPrice !== null) {
      html += '<span class="analyst-label">Current</span>'
        + '<span class="analyst-value">' + fmtPrice(a.currentPrice) + '</span>';
    }

    // Buy / Hold / Sell distribution
    if (a.buyCount !== null || a.holdCount !== null || a.sellCount !== null) {
      var buy = a.buyCount || 0;
      var hold = a.holdCount || 0;
      var sell = a.sellCount || 0;
      var total = buy + hold + sell;

      if (total > 0) {
        var buyPct = (buy / total * 100).toFixed(1);
        var holdPct = (hold / total * 100).toFixed(1);
        var sellPct = (sell / total * 100).toFixed(1);

        html += '<div class="analyst-grid-wide">'
          + '<div class="analyst-dist">'
          + '<div class="analyst-dist-bar">'
          + '<div class="analyst-dist-buy" style="width:' + buyPct + '%"></div>'
          + '<div class="analyst-dist-hold" style="width:' + holdPct + '%"></div>'
          + '<div class="analyst-dist-sell" style="width:' + sellPct + '%"></div>'
          + '</div>'
          + '<div class="analyst-dist-labels">'
          + '<span><span class="analyst-dist-dot" style="background:#16a34a"></span> Buy ' + buy + '</span>'
          + '<span><span class="analyst-dist-dot" style="background:#ca8a04"></span> Hold ' + hold + '</span>'
          + '<span><span class="analyst-dist-dot" style="background:#dc2626"></span> Sell ' + sell + '</span>'
          + '</div>'
          + '</div>'
          + '</div>';
      }
    }

    html += '</div></div>';
    return html;
  }

  // ---- Build chart panel HTML --------------------------------
  function panelHTML(symbol, data, view) {
    var hasQ = data.availability && data.availability.quarterly;
    var hasY = data.availability && data.availability.yearly;
    var hasAnalyst = data.analystSummary && data.analystSummary.available;

    if (!hasQ && !hasY && !hasAnalyst) return emptyHTML();

    var html = '';

    // Financial performance chart (if available)
    if (hasQ || hasY) {
      var periods = getPeriods(data, view);

      html += '<div class="detail-header">'
        + '<div class="detail-title">'
        + '<span class="detail-title-text">Financial performance</span>'
        + '<span class="detail-source">Source: ' + (data.source || 'Yahoo Finance') + '</span>'
        + '</div>';

      // Toggle only if both views available
      if (hasQ && hasY) {
        var qActive = view !== 'yearly' ? ' toggle-active' : '';
        var yActive = view === 'yearly' ? ' toggle-active' : '';
        html += '<div class="detail-toggle">'
          + '<button class="toggle-btn' + qActive + '" data-view="quarterly" data-symbol="' + symbol + '">Quarterly</button>'
          + '<button class="toggle-btn' + yActive + '" data-view="yearly" data-symbol="' + symbol + '">Yearly</button>'
          + '</div>';
      }

      html += '</div>';

      // Compact latest-period summary
      html += latestSummaryHTML(periods);

      html += '<div class="detail-chart-wrap">'
        + '<canvas id="chart-' + symbol + '"></canvas>'
        + '</div>';
    }

    // Analyst sentiment card
    html += analystCardHTML(data.analystSummary);

    return html;
  }

  function esc(s) {
    if (s === null || s === undefined) return '-';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- Render or update chart --------------------------------
  function renderChart(symbol, data, view) {
    var canvas = document.getElementById('chart-' + symbol);
    if (!canvas) return;

    var periods = getPeriods(data, view);
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
            boxPadding: 4,
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
                var idx = item.dataIndex;
                var period = periods[idx];
                var val = item.raw;
                var line = ' ' + item.dataset.label + ': ' + fullValue(val);
                return line;
              },
              afterLabel: function (item) {
                var idx = item.dataIndex;
                var period = periods[idx];

                // Determine which change field to show
                var change = null;
                if (item.datasetIndex === 0) {
                  change = period.revenueChange;
                } else if (item.datasetIndex === 1) {
                  change = period.netIncomeChange;
                }

                var formatted = fmtChange(change);
                if (!formatted) return '';
                return '    vs prev: ' + formatted;
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

    activeView[symbol] = view;

    // Re-render entire panel (including updated summary) with cached data
    if (cache[symbol]) {
      var panel = document.getElementById('panel-' + symbol);
      if (panel) {
        panel.innerHTML = panelHTML(symbol, cache[symbol], view);
        renderChart(symbol, cache[symbol], view);
        attachToggleListeners(panel);
      }
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
      var view = activeView[symbol] || 'quarterly';
      panel.innerHTML = panelHTML(symbol, cache[symbol], view);
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
        var hasAnalyst = data.analystSummary && data.analystSummary.available;

        // No data at all (ETFs, indices, etc.)
        if (!hasQ && !hasY && !hasAnalyst) {
          panel.innerHTML = emptyHTML();
          return;
        }

        activeView[symbol] = 'quarterly';
        panel.innerHTML = panelHTML(symbol, data, 'quarterly');
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
