(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.getElementById('risk-page');
    if (!page) return;
    var DAY = 86400000;
    var asset = 'BTC';
    var data = null;
    var chart = null;
    var request = null;
    var requestId = 0;
    var chartRows = [];
    var selectedComponents = new Set();
    var colors = ['#7c3aed', '#0284c7', '#d97706', '#059669', '#db2777', '#64748b', '#4f46e5', '#b45309', '#0891b2'];
    var numberFormat = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 2 });
    var scoreFormat = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 1 });
    var moneyFormat = new Intl.NumberFormat('et-EE', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    var dateFormat = new Intl.DateTimeFormat('et-EE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
    var timeFormat = new Intl.DateTimeFormat('et-EE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    var technicalComponents = [
      { key: 'trend', name: 'Pikaajaline hinnatrend', description: 'ln(hind / SMA730) mõõdab kaugust 730 päeva keskmisest. Suurem ajalooline protsentiil viitab kõrgemale ülekuumenemisele; trend võib kaua keskmisest eemal püsida.' },
      { key: 'momentum', name: '14 nädala RSI', description: 'Wilderi RSI lõpetatud UTC nädalate sulgemishindadest. Tugev tõusumomentum suurendab skoori, kuid kõrge RSI ei ennusta iseseisvalt turutipuga seotud pöörde aega.' },
      { key: 'valuation', name: 'MVRV väärtustamine', description: 'Turukapitalisatsiooni ja realiseeritud kapitalisatsiooni suhe. Suurem ajalooline protsentiil viitab kallimale väärtustamisele. Ahelasisene liikumine ei pruugi olla ost või müük; puuduvate andmete korral skoori ei asendata.' }
    ];

    function el(id) { return document.getElementById(id); }
    function text(id, value) { el(id).textContent = value; }
    function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
    function number(value) { return finite(value) ? numberFormat.format(value) : '—'; }
    function score(value) { return finite(value) ? scoreFormat.format(value) : '—'; }
    function money(value) { return finite(value) ? moneyFormat.format(value) : '—'; }
    function date(value) { var parsed = Date.parse(value); return Number.isFinite(parsed) ? dateFormat.format(parsed) : '—'; }
    function time(value) { var parsed = Date.parse(value); return Number.isFinite(parsed) ? timeFormat.format(parsed) + ' UTC' : '—'; }
    function dateKey(value) { return new Date(value).toISOString().slice(0, 10); }
    function empty() { return { asset: asset, quote: {}, technical: { history: [], latest: null }, cbbi: null, sources: [], limitations: [] }; }
    function isOld(day) { return !day || Date.now() - Date.parse(day) > 3 * DAY; }
    function state(id, label, kind) { text(id, label); el(id).dataset.state = kind || ''; }
    function model() { return el('risk-model').value; }
    function technicalName(point) { return point && point.variant === 'price-only' ? 'Price-only Technical Risk' : 'Technical Risk'; }
    function weightText(weights) {
      if (!weights) return 'Kaalud puuduvad';
      return technicalComponents.filter(function (component) { return finite(weights[component.key]) && weights[component.key] > 0; }).map(function (component) {
        return ({ trend: 'trend', momentum: 'RSI', valuation: 'MVRV' })[component.key] + ' ' + number(weights[component.key] * 100) + '%';
      }).join(' · ') || 'Kaalud puuduvad';
    }
    function append(parent, tag, value, className) {
      var node = document.createElement(tag);
      if (value != null) node.textContent = String(value);
      if (className) node.className = className;
      parent.appendChild(node);
      return node;
    }
    function safeLink(parent, label, url) {
      try {
        var parsed = new URL(url);
        if (parsed.protocol !== 'https:') throw new Error('Unsupported URL');
        var link = append(parent, 'a', label);
        link.href = parsed.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
      } catch (_) { return append(parent, 'span', label); }
    }

    function renderSummary() {
      var technical = data.technical || {};
      var latest = technical.latest;
      var primary = asset === 'BTC' ? data.cbbi && data.cbbi.latest : latest;
      var primaryScore = primary && primary.score;
      var quote = data.quote || {};
      var technicalSource = (data.sources || []).find(function (source) { return source.id === 'cm:' + asset; });
      var technicalStale = latest && (isOld(latest.date) || technicalSource && technicalSource.status !== 'ok');
      var primaryStale = asset === 'BTC' ? primary && (isOld(primary.date) || data.cbbi.status !== 'ok') : technicalStale;
      text('risk-primary-label', asset === 'BTC' ? 'BTC · CBBI' : 'ETH · ' + technicalName(latest));
      text('risk-primary-score', score(primaryScore));
      text('risk-primary-date', 'Andmete kuupäev: ' + date(primary && primary.date) + ' UTC');
      text('risk-primary-description', asset === 'BTC' ? 'Ametlik avaldatud CBBI · Technical Risk on eraldi mõõdik.' : !latest || !finite(latest.score) ? 'Skoori jaoks ei ole veel piisavalt hinnatrendi ja RSI ajalugu. MVRV kaasatakse vaid kehtivate algandmete olemasolul.' : latest.variant === 'price-only' ? 'Ainult hinna ja RSI mudel. MVRV puudub; täismudeliga ei ole samaväärne.' : 'Pikaajaline trend, momentum ja MVRV väärtustamine.');
      state('risk-primary-state', !finite(primaryScore) ? 'Andmed puuduvad' : primaryStale ? 'Aegunud' : primaryScore < 30 ? 'Madal' : primaryScore < 70 ? 'Mõõdukas' : 'Kõrge', !finite(primaryScore) ? 'unavailable' : primaryStale ? 'stale' : '');
      var marker = el('risk-meter-marker');
      marker.hidden = !finite(primaryScore);
      if (finite(primaryScore)) marker.style.left = Math.max(0, Math.min(100, primaryScore)) + '%';
      text('risk-price-label', asset + ' hind');
      text('risk-price', money(quote.price));
      text('risk-price-source', 'Hinna allikas: ' + (quote.source || '—'));
      text('risk-price-time', 'Hinna aeg: ' + time(quote.time));
      state('risk-price-state', !finite(quote.price) ? 'Puudub' : quote.stale ? 'Aegunud' : 'Viimane hind', !finite(quote.price) ? 'unavailable' : quote.stale ? 'stale' : 'ok');
      text('risk-technical-label', technicalName(latest));
      text('risk-technical-score', score(latest && latest.score));
      text('risk-technical-description', !latest || !finite(latest.score) ? 'Skoor vajab piisavat hinnatrendi ja RSI ajalugu. Puuduvaid sisendeid ei asendata.' : latest.variant === 'price-only' ? 'MVRV sisend puudub. Hinnatrend ja RSI moodustavad eraldi hinnapõhise mudeli.' : 'Iseseisev hinnatrendi, momentumi ja MVRV mudel; CBBI-ga ei liideta.');
      text('risk-technical-date', 'Andmete kuupäev: ' + date(latest && latest.date) + ' UTC');
      text('risk-technical-weights', 'Kaalud: ' + weightText(latest && latest.weights));
      state('risk-technical-state', !latest || !finite(latest.score) ? 'Ebapiisavad andmed' : technicalStale ? 'Aegunud' : latest.variant === 'price-only' ? 'Hinnapõhine' : 'Täismudel', !latest || !finite(latest.score) ? 'unavailable' : technicalStale ? 'stale' : '');
    }

    function componentDefinitions() {
      return model() === 'cbbi' ? (data.cbbi && data.cbbi.components || []) : technicalComponents;
    }
    function renderComponents() {
      var cbbiMode = model() === 'cbbi';
      var snapshotMode = el('risk-history').value === 'snapshots';
      var latest = cbbiMode ? snapshotMode ? chartRows[chartRows.length - 1] : data.cbbi && data.cbbi.latest : data.technical && data.technical.latest;
      var body = el('risk-components-body');
      var picks = el('risk-component-picks');
      body.closest('table').dataset.mode = cbbiMode ? 'cbbi' : 'technical';
      body.replaceChildren();
      picks.replaceChildren();
      text('risk-components-title', cbbiMode ? 'CBBI üheksa komponenti' : 'Technical Riski komponendid');
      text('risk-components-date', latest ? snapshotMode && cbbiMode && latest.observedAt ? 'Esimest korda salvestatud: ' + time(latest.observedAt) : 'Viimane vaatlus: ' + date(latest.date) : 'Vaatlused puuduvad');
      componentDefinitions().forEach(function (component, index) {
        var value = latest && latest.components && latest.components[component.key];
        var componentScore = cbbiMode ? value : value && value.score;
        var weight = !cbbiMode && latest && latest.weights && latest.weights[component.key];
        var row = append(body, 'tr');
        var heading = append(row, 'td');
        append(heading, 'strong', component.name);
        append(heading, 'span', component.description || '', 'risk-component-help');
        append(row, 'td', cbbiMode ? '—' : number(value && value.raw));
        append(row, 'td', score(componentScore));
        append(row, 'td', cbbiMode ? '1/9' : finite(weight) ? number(weight * 100) + '%' : '—');
        var label = append(picks, 'label', null, 'risk-check');
        var input = append(label, 'input');
        input.type = 'checkbox';
        input.value = component.key;
        input.checked = selectedComponents.has(component.key);
        input.addEventListener('change', function () {
          if (input.checked) selectedComponents.add(component.key);
          else selectedComponents.delete(component.key);
          drawChart(false);
        });
        var swatch = append(label, 'span', null, 'risk-check-swatch');
        swatch.style.backgroundColor = colors[index % colors.length];
        append(label, 'span', component.name);
      });
      if (!body.children.length) {
        var cell = append(append(body, 'tr'), 'td', 'Komponentide andmed ei ole veel saadaval.');
        cell.colSpan = 4;
      }
      text('risk-components-note', cbbiMode ? 'CBBI avaldatud komponendid on normaliseeritud skoorid. Algindikaatorite toorväärtusi andmevoog ei sisalda. Puuduvate komponentide keskmist ei esitata CBBI-na.' : 'Skoor on komponendi ajalooline protsentiil. Hinnatrend ja RSI normaliseeritakse eraldi; hindamata komponent jääb tühjaks. Kaalud on näidatud viimase päeva mudeli järgi.');
    }

    function getRows() {
      if (model() !== 'cbbi') return data.technical && data.technical.history || [];
      if (!data.cbbi) return [];
      return el('risk-history').value === 'snapshots' ? data.cbbi.snapshots || [] : data.cbbi.history || [];
    }
    function bounds() {
      if (!chartRows.length) return null;
      return [Date.parse(chartRows[0].date), Date.parse(chartRows[chartRows.length - 1].date)];
    }
    function setRange(start, end) {
      el('risk-date-start').value = dateKey(start);
      el('risk-date-end').value = dateKey(end);
    }
    function setPeriod(period) {
      var limits = bounds();
      if (limits) {
        var start = limits[0];
        if (period !== 'all') { var d = new Date(limits[1]); d.setUTCFullYear(d.getUTCFullYear() - Number(period)); start = Math.max(start, d.getTime()); }
        setRange(start, limits[1]);
      }
      document.querySelectorAll('[data-risk-period]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.riskPeriod === period)); });
      drawChart(false);
    }
    function clearPeriod() { document.querySelectorAll('[data-risk-period]').forEach(function (button) { button.setAttribute('aria-pressed', 'false'); }); }
    function switchChart(preserveRange) {
      var oldStart = Date.parse(el('risk-date-start').value);
      var oldEnd = Date.parse(el('risk-date-end').value);
      var selectedPeriod = document.querySelector('[data-risk-period][aria-pressed="true"]');
      var observations = getRows().filter(function (row) { return row && Number.isFinite(Date.parse(row.date)); }).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
      chartRows = [];
      observations.forEach(function (row, index) {
        // A null break is a display marker, never an interpolated observation.
        if (index && Date.parse(row.date) - Date.parse(observations[index - 1].date) > DAY) chartRows.push({ date: dateKey(Date.parse(observations[index - 1].date) + DAY), gap: true });
        chartRows.push(row);
      });
      el('risk-history-label').hidden = model() !== 'cbbi';
      text('risk-history-note', model() !== 'cbbi' ? 'Iga ajalooline Technical Risk kasutab ainult selleks päevaks teada olevaid vaatlusi.' : el('risk-history').value === 'snapshots' ? 'Muutumatud esimesena salvestatud päevaskoorid. Varasemat avaldamisajalugu ei taastata tagantjärele.' : 'Ametlik ajalugu tänase kalibreeringuga; see võib erineda minevikus avaldatud skooridest.');
      renderComponents();
      var limits = bounds();
      if (limits) {
        ['risk-date-start', 'risk-date-end'].forEach(function (id) { el(id).min = dateKey(limits[0]); el(id).max = dateKey(limits[1]); });
      } else { el('risk-date-start').value = ''; el('risk-date-end').value = ''; }
      if (preserveRange && limits && finite(oldStart) && finite(oldEnd)) {
        if (selectedPeriod) setPeriod(selectedPeriod.dataset.riskPeriod);
        else {
          setRange(Math.min(limits[1], Math.max(limits[0], oldStart)), Math.max(limits[0], Math.min(limits[1], oldEnd)));
          drawChart(false);
        }
      } else setPeriod('all');
    }

    function drawChart() {
      var start = Date.parse(el('risk-date-start').value);
      var end = Date.parse(el('risk-date-end').value);
      var rangeError = finite(start) && finite(end) && start > end;
      el('risk-chart-error').hidden = !rangeError;
      text('risk-chart-error', rangeError ? 'Alguskuupäev peab olema lõppkuupäevast varasem või sellega sama.' : '');
      if (rangeError) return;
      if (typeof window.Chart !== 'function') {
        text('risk-chart-empty', 'Graafikute teek ei laaditud. Arvväärtused on nähtavad tabelis; proovi leht uuesti laadida.');
        el('risk-chart-empty').hidden = false;
        return;
      }
      var rows = chartRows.filter(function (row) { var t = Date.parse(row.date); return (!finite(start) || t >= start) && (!finite(end) || t <= end); });
      var cbbiMode = model() === 'cbbi';
      var technicalHistory = new Map((data.technical && data.technical.history || []).map(function (row) { return [row.date, row.price]; }));
      function series(getValue) { return rows.map(function (row) { var value = getValue(row); return { x: Date.parse(row.date), y: finite(value) ? value : null }; }); }
      function dataset(label, values, color, extra) {
        return Object.assign({ label: label, data: values, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: rows.length < 3 ? 4 : 0, pointHoverRadius: 4, spanGaps: false, yAxisID: 'risk', tension: 0, parsing: false }, extra || {});
      }
      var datasets = [];
      if (cbbiMode) datasets.push(dataset('CBBI', series(function (r) { return r.score; }), '#1b263a', { borderWidth: 2.5 }));
      else {
        datasets.push(dataset('Technical Risk · täismudel', series(function (r) { return r.fullScore; }), '#1b263a', { borderWidth: 2.5, riskModel: 'full' }));
        datasets.push(dataset('Price-only Technical Risk', series(function (r) { return r.priceOnlyScore; }), '#0284c7', { borderDash: [5, 4], riskModel: 'priceOnly' }));
      }
      datasets.push(dataset(asset + ' hind (USD)', series(function (r) { return r.gap ? null : finite(r.price) ? r.price : technicalHistory.get(r.date); }), '#94a3b8', { yAxisID: 'price', borderWidth: 1.5 }));
      componentDefinitions().forEach(function (component, index) {
        if (!selectedComponents.has(component.key)) return;
        datasets.push(dataset(component.name, series(function (r) { var value = r.components && r.components[component.key]; return cbbiMode ? value : value && value.score; }), colors[index % colors.length], { borderWidth: 1.2 }));
      });
      var hasScores = datasets.some(function (d) { return d.yAxisID === 'risk' && d.data.some(function (point) { return finite(point.y); }); });
      text('risk-chart-empty', rows.length ? 'Selles perioodis riskiskoor puudub; vajalik ajalugu või allikas pole saadaval.' : model() === 'cbbi' && el('risk-history').value === 'snapshots' ? 'Salvestatud päevaskoorid kogunevad alates andmekogumise käivitamisest.' : 'Selle perioodi andmed puuduvad.');
      el('risk-chart-empty').hidden = hasScores;
      var options = {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { type: 'linear', min: finite(start) ? start : undefined, max: finite(end) && start === end ? end + DAY : finite(end) ? end : undefined, grid: { display: false }, ticks: { maxTicksLimit: window.innerWidth < 360 ? 2 : window.innerWidth < 600 ? 3 : 7, maxRotation: 0, callback: function (value) { return date(new Date(value).toISOString()); }, font: { size: 10 } } },
          risk: { type: 'linear', position: 'left', min: 0, max: 100, title: { display: true, text: 'Risk / 100', font: { size: 10 } }, grid: { color: '#eef1f5' }, ticks: { stepSize: 25, font: { size: 10 } } },
          price: { type: 'logarithmic', position: 'right', title: { display: true, text: 'USD · log', font: { size: 10 } }, grid: { drawOnChartArea: false }, ticks: { maxTicksLimit: 6, callback: function (value) { return new Intl.NumberFormat('et-EE', { notation: 'compact', maximumFractionDigits: 1 }).format(value); }, font: { size: 10 } } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 20, font: { size: 11 }, padding: 15 } },
          tooltip: { callbacks: {
            title: function (items) { return items.length ? date(new Date(items[0].parsed.x).toISOString()) + ' UTC' : ''; },
            label: function (item) { return item.dataset.label + ': ' + (item.dataset.yAxisID === 'price' ? money(item.parsed.y) : score(item.parsed.y) + ' / 100'); },
            footer: function (items) {
              if (!items.length) return '';
              var point = rows[items[0].dataIndex];
              if (!point) return '';
              if (cbbiMode) return point.observedAt ? 'Esimene salvestus: ' + time(point.observedAt) : 'Ajalugu praeguse kalibreeringuga';
              var lines = [];
              items.filter(function (item) { return item.dataset.riskModel; }).forEach(function (item) {
                var key = item.dataset.riskModel;
                var weights = data.technical && data.technical.weights && data.technical.weights[key];
                if (!weights) weights = key === 'full' ? { trend: 0.4, momentum: 0.25, valuation: 0.35 } : { trend: 40 / 65, momentum: 25 / 65 };
                lines.push((key === 'full' ? 'Täismudel: ' : 'Price-only: ') + weightText(weights));
                var sensitivity = point.sensitivity && point.sensitivity[key];
                if (sensitivity && finite(sensitivity.min) && finite(sensitivity.max)) lines.push('Kaalutundlikkus: ' + score(sensitivity.min) + '–' + score(sensitivity.max));
              });
              technicalComponents.forEach(function (component) {
                var value = point.components && point.components[component.key];
                if (value && finite(value.raw)) lines.push(component.name + ': ' + number(value.raw) + ' · protsentiil ' + score(value.score));
              });
              return lines;
            }
          } }
        }
      };
      if (chart) { chart.data.datasets = datasets; chart.options = options; chart.update('none'); }
      else chart = new window.Chart(el('risk-chart'), { type: 'line', data: { datasets: datasets }, options: options });
      var disabled = !chartRows.length;
      ['risk-zoom-in', 'risk-zoom-out', 'risk-zoom-reset', 'risk-date-start', 'risk-date-end'].forEach(function (id) { el(id).disabled = disabled; });
    }

    function renderMethods() {
      var technical = data.technical || {};
      var latest = technical.latest || {};
      var facts = el('risk-method-facts');
      facts.replaceChildren();
      [
        ['730 päeva keskmine', money(latest.sma730)], ['200 nädala keskmine', money(latest.sma200w)],
        ['14 nädala RSI', number(latest.rsi14w)], ['MVRV', number(latest.mvrv)], ['MVRV Z-Score', number(latest.mvrvZ)],
        ['Technical Riski mudel', technical.modelVersion || '—'], ['Andmeversioon', technical.dataVersion || '—'],
        ['Viimase skoori kaalud', weightText(latest.weights)]
      ].forEach(function (fact) { append(facts, 'dt', fact[0]); append(facts, 'dd', fact[1]); });
      text('risk-normalization', 'Normaliseerimine: laienev ajalooline protsentiil ainult varasemate kehtivate vaatluste seas. Trendi ja MVRV jaoks on vaja vähemalt 365 varasemat päevaväärtust, RSI jaoks 52 varasemat nädalaväärtust. Võrdsete väärtuste puhul kasutatakse keskmist järku; andmelünki ei täideta sünteetiliselt.');
      var sensitivity = latest.sensitivity && (latest.variant === 'full' ? latest.sensitivity.full : latest.sensitivity.priceOnly) || {};
      var sensitivityText = finite(sensitivity.min) && finite(sensitivity.max) ? 'Viimase päeva skoor alternatiivsete kaaludega: ' + score(sensitivity.min) + '–' + score(sensitivity.max) + '.' : 'Alternatiivsete kaalude mõju on kontrollitav sama ajaloolise andmeversiooni põhjal; see ei tõenda parimaid kaalusid.';
      text('risk-sensitivity', 'Kaalude tundlikkus: ' + sensitivityText);
      var historySensitivity = technical.sensitivity || {};
      var historySummary = ['full', 'priceOnly'].map(function (key) {
        var summary = historySensitivity[key];
        var scenarios = historySensitivity.scenarios && historySensitivity.scenarios[key] || [];
        if (!summary || !summary.observations) return '';
        return (key === 'full' ? 'Täismudel' : 'Price-only') + ': ' + summary.observations + ' hinnatud päeva, suurim erinevus baaskaaludest ' + score(summary.maxAbsoluteDelta) + ' punkti; keskmine päevane suurim erinevus ' + score(summary.meanMaximumAbsoluteDelta) + ' punkti. Alternatiivid: ' + scenarios.map(function (scenario) { return weightText(scenario.weights); }).join('; ') + '.';
      }).filter(Boolean).join(' ');
      text('risk-sensitivity-history', historySummary);
      var comparison = data.cbbi && data.cbbi.comparison;
      var precise = new Intl.NumberFormat('et-EE', { maximumFractionDigits: 6 });
      text('risk-comparison', comparison ? 'CBBI andmete kontroll: ' + (comparison.comparedDays || 0) + ' päeva, avaldatud skoori ja üheksa avaldatud komponendi keskmise suurim erinevus ' + precise.format(comparison.maxDifference) + ' punkti (tolerants ' + precise.format(comparison.tolerance) + '). ' + (comparison.withinTolerance ? 'Tulemus vastab tolerantsile.' : 'Erinevus ületab tolerantsi või täielikud võrdlusandmed puuduvad.') + ' See on andmevoo kontroll, mitte CBBI sõltumatu kohalik arvutus.' : asset === 'BTC' ? 'CBBI sõltumatut kohalikku ümberarvutust ei tehta; kasutatakse ametlikke avaldatud andmeid.' : '');
      var limitations = el('risk-limitations');
      limitations.replaceChildren();
      (data.limitations || []).forEach(function (value) { append(limitations, 'li', value); });
    }

    function renderSources() {
      var container = el('risk-sources');
      container.replaceChildren();
      (data.sources || []).forEach(function (source) {
        var card = append(container, 'div', null, 'risk-source');
        var head = append(card, 'div', null, 'risk-source-head');
        safeLink(head, source.name || source.id || 'Andmeallikas', source.url);
        var labels = { ok: 'Korras', stale: 'Aegunud', unavailable: 'Puudub', disabled: 'Välja lülitatud' };
        var badge = append(head, 'span', labels[source.status] || source.status || 'Teadmata', 'risk-tag');
        badge.dataset.state = source.status || '';
        append(card, 'p', 'Andmed kuni: ' + (source.dataThrough ? date(source.dataThrough) + ' UTC' : '—'));
        append(card, 'p', 'Allalaaditud: ' + time(source.fetchedAt));
        if (source.message) append(card, 'p', source.message);
      });
      if (!container.children.length) append(container, 'p', 'Andmeallikate olek ei ole veel saadaval.', 'risk-muted');
      var refresh = data.refresh || {};
      text('risk-next-update', refresh.running ? 'Server uuendab andmeid…' : refresh.nextUpdateAt ? 'Järgmine kontroll: ' + time(refresh.nextUpdateAt) : 'Perioodiline serveripoolne uuendamine');
    }
    function render(preserveRange) { renderSummary(); renderMethods(); renderSources(); switchChart(preserveRange); }

    async function load() {
      if (request) request.abort();
      request = new AbortController();
      var id = ++requestId;
      var currentAsset = asset;
      page.setAttribute('aria-busy', 'true');
      el('risk-reload').disabled = true;
      el('risk-error').hidden = true;
      text('risk-message', 'Laadin ' + asset + ' riskianalüüsi…');
      var timeout = setTimeout(function () { if (id === requestId) request.abort(); }, 30000);
      try {
        var response = await fetch('/api/risk-data?asset=' + encodeURIComponent(currentAsset), { signal: request.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.redirected || response.status === 401 || response.status === 403) throw new Error('Sessioon on lõppenud. Logi uuesti sisse.');
        if (!response.ok) throw new Error('Riskianalüüsi laadimine ebaõnnestus. Proovi mõne aja pärast uuesti.');
        var result = await response.json();
        if (id !== requestId || currentAsset !== asset) return;
        if (!result || result.asset !== currentAsset) throw new Error('Vara andmed ei vasta valikule. Proovi vaadet uuendada.');
        data = result;
        render(true);
        text('risk-message', result.refresh && result.refresh.running ? 'Andmekogumine käib. Olemasolevad andmed on nähtavad; vaade kontrollib uuendusi automaatselt.' : 'Viimane vaate uuendus: ' + time(result.generatedAt || new Date().toISOString()));
      } catch (error) {
        if (id !== requestId) return;
        el('risk-error').hidden = false;
        text('risk-error', error.name === 'AbortError' ? 'Laadimine võttis liiga kaua. Proovi vaadet uuendada.' : error.message || 'Andmeid ei õnnestunud laadida.');
        text('risk-message', data && data.generatedAt ? 'Kuvatud andmed pärinevad viimasest õnnestunud laadimisest.' : 'Andmed ei ole saadaval.');
      } finally {
        clearTimeout(timeout);
        if (id === requestId) { page.setAttribute('aria-busy', 'false'); el('risk-reload').disabled = false; }
      }
    }

    document.querySelectorAll('[data-risk-asset]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (asset === button.dataset.riskAsset) return;
        asset = button.dataset.riskAsset;
        document.querySelectorAll('[data-risk-asset]').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
        el('risk-model').value = asset === 'BTC' ? 'cbbi' : 'technical';
        el('risk-model-label').hidden = asset !== 'BTC';
        selectedComponents.clear();
        data = empty();
        render();
        load();
      });
    });
    el('risk-reload').addEventListener('click', load);
    el('risk-model').addEventListener('change', function () { selectedComponents.clear(); switchChart(); });
    el('risk-history').addEventListener('change', function () { switchChart(); });
    document.querySelectorAll('[data-risk-period]').forEach(function (button) { button.addEventListener('click', function () { setPeriod(button.dataset.riskPeriod); }); });
    ['risk-date-start', 'risk-date-end'].forEach(function (id) { el(id).addEventListener('change', function () { clearPeriod(); drawChart(false); }); });
    function zoom(factor) {
      var limits = bounds();
      if (!limits) return;
      var start = Date.parse(el('risk-date-start').value);
      var end = Date.parse(el('risk-date-end').value);
      var center = (start + end) / 2;
      var range = Math.max(7 * DAY, (end - start) * factor);
      var from = Math.max(limits[0], center - range / 2);
      var to = Math.min(limits[1], center + range / 2);
      if (!finite(from) || !finite(to)) return;
      setRange(from, to);
      clearPeriod();
      drawChart(false);
    }
    el('risk-zoom-in').addEventListener('click', function () { zoom(0.5); });
    el('risk-zoom-out').addEventListener('click', function () { zoom(2); });
    el('risk-zoom-reset').addEventListener('click', function () { setPeriod('all'); });
    data = empty();
    render();
    load();
    var refreshTimer = setInterval(function () { if (!document.hidden && page.getAttribute('aria-busy') !== 'true') load(); }, 60000);
    window.addEventListener('pagehide', function () { clearInterval(refreshTimer); if (request) request.abort(); if (chart) chart.destroy(); });
  });
}());
