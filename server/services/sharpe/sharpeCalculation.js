// Sharpe-ratio Monte Carlo simulation — pure-JS port of the CRYPTO_API
// simulation (originally built on mathjs + javascript-color-gradient). The
// methodology is identical; only the linear-algebra helpers are reimplemented
// with plain arrays so this project needs no extra dependencies.
//
// Methodology (annualised via `marketDays`, risk-free rate = 0):
//   log return   r_t      = ln(P_t / P_{t-1})
//   port. return R        = Σ_i  mean(r_i) · w_i · marketDays
//   covariance   Σ_ij     = Σ_t (r_i,t - r̄_i)(r_j,t - r̄_j) / (N - 1)
//   port. vol    σ        = sqrt( wᵀ · (Σ · marketDays) · w )
//   Sharpe                = R / σ
//
// Input:
//   numberOfIterations — Monte Carlo runs (random weight vectors)
//   marketDays         — 252 (stocks) or 365 (crypto)
//   importedHeaderValuesList — ['date', label0, label1, ...] (returned as-is)
//   rawDataArray       — [datesArray, asset0Closes, asset1Closes, ...]
//                        every close array must be the same length (aligned).
//
// Returns 0 when the close arrays are not aligned (mirrors the original
// contract so the controller can surface a data-integrity error). Otherwise:
//   { data1, data3, sharpeList, importedHeaderValuesList, colorList }

'use strict';

// --- small linear-algebra helpers ---------------------------------------

const mean = (arr) => {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
};

// Sample covariance of two equal-length series (divisor N - 1)
const covariance = (a, b) => {
  const ma = mean(a);
  const mb = mean(b);
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc += (a[i] - ma) * (b[i] - mb);
  }
  return acc / (a.length - 1);
};

// Uniform(0,1) weights normalised to sum 1
const randomWeights = (n) => {
  const w = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    w[i] = Math.random();
    sum += w[i];
  }
  for (let i = 0; i < n; i++) w[i] /= sum;
  return w;
};

// 101-stop red→green gradient (low Sharpe = red, high Sharpe = green),
// matching the original javascript-color-gradient(#FF3333 → #86FF33) output.
const buildGradient = () => {
  const from = [0xff, 0x33, 0x33]; // red
  const to = [0x86, 0xff, 0x33];   // green
  const stops = [];
  const toHex = (v) => {
    const h = Math.round(v).toString(16);
    return h.length === 1 ? '0' + h : h;
  };
  for (let k = 0; k <= 100; k++) {
    const t = k / 100;
    const r = from[0] + (to[0] - from[0]) * t;
    const g = from[1] + (to[1] - from[1]) * t;
    const b = from[2] + (to[2] - from[2]) * t;
    stops.push('#' + toHex(r) + toHex(g) + toHex(b));
  }
  return stops;
};

// Map every Sharpe value to a gradient colour by its position in [min, max].
const assignColors = (sharpeList) => {
  const palette = buildGradient();

  // Loop (not Math.max.apply/spread) — apply throws RangeError on very large
  // arrays, and sharpeList length == iteration count.
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < sharpeList.length; i++) {
    const v = sharpeList[i];
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const range = max - min;

  // All Sharpe values equal (single point, or perfectly-correlated assets where
  // the spread is only float noise) → uniform mid-gradient colour. Use a
  // relative epsilon so ~1e-13 rounding noise doesn't paint the full spectrum.
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (!isFinite(range) || range <= 1e-9 * (scale || 1)) {
    return sharpeList.map(() => palette[50]);
  }

  const delta = range / 100;
  return sharpeList.map((v) => {
    let idx = Math.round((v - min) / delta);
    if (idx < 0) idx = 0;
    if (idx > 100) idx = 100;
    return palette[idx];
  });
};

// --- core simulation ----------------------------------------------------

// Build the log-return series for every asset (skips the leading dates row).
// Returns a 2D array: returns[assetIndex] = [r_1, r_2, ...] (length N-1).
const buildReturnSeries = (rawDataArray) => {
  const series = [];
  for (let a = 0; a < rawDataArray.length; a++) {
    const col = rawDataArray[a];
    // The first element of each close array is a string only for the dates
    // row; skip that row entirely.
    if (typeof col[0] === 'string') continue;
    const r = new Array(col.length - 1);
    for (let i = 1; i < col.length; i++) {
      r[i - 1] = Math.log(col[i] / col[i - 1]);
    }
    series.push(r);
  }
  return series;
};

// Verify every close array shares the same length (data-integrity check).
const closeArraysAligned = (rawDataArray) => {
  for (let i = 1; i < rawDataArray.length; i++) {
    if (rawDataArray[i].length !== rawDataArray[i - 1].length) return false;
  }
  return true;
};

const sharpeRatioSimulation = (numberOfIterations, marketDays, importedHeaderValuesList, rawDataArray) => {
  if (!closeArraysAligned(rawDataArray)) {
    return 0;
  }

  // Per-asset log-return series (assets × time)
  const returnSeries = buildReturnSeries(rawDataArray);
  const numAssets = returnSeries.length;
  if (numAssets === 0) return 0;

  // Pre-compute the pieces that don't depend on the random weights:
  //   annualised mean return per asset, and the annualised covariance matrix.
  const meanReturns = returnSeries.map((r) => mean(r));

  const covMatrix = [];
  for (let i = 0; i < numAssets; i++) {
    covMatrix.push(new Array(numAssets));
  }
  for (let i = 0; i < numAssets; i++) {
    for (let j = i; j < numAssets; j++) {
      const c = covariance(returnSeries[i], returnSeries[j]);
      covMatrix[i][j] = c;
      covMatrix[j][i] = c; // symmetric
    }
  }

  const data1 = [];      // [{ x: volatility, y: return }]
  const weights = [];    // [[w0, w1, ...]]
  const sharpeList = [];

  for (let iter = 0; iter < numberOfIterations; iter++) {
    const w = randomWeights(numAssets);

    // Portfolio return: Σ_i mean_i · w_i · marketDays
    let portfolioReturn = 0;
    for (let i = 0; i < numAssets; i++) {
      portfolioReturn += meanReturns[i] * w[i] * marketDays;
    }

    // Portfolio variance: wᵀ · (Σ · marketDays) · w
    let variance = 0;
    for (let i = 0; i < numAssets; i++) {
      let rowDot = 0;
      for (let j = 0; j < numAssets; j++) {
        rowDot += covMatrix[i][j] * marketDays * w[j];
      }
      variance += w[i] * rowDot;
    }
    const volatility = Math.sqrt(variance);
    const sharpe = portfolioReturn / volatility;

    data1.push({ x: volatility, y: portfolioReturn });
    weights.push(w);
    sharpeList.push(sharpe);
  }

  const colorList = assignColors(sharpeList);

  return {
    data1: data1,
    data3: weights,
    sharpeList: sharpeList,
    importedHeaderValuesList: importedHeaderValuesList,
    colorList: colorList
  };
};

exports.sharpeRatioSimulation = sharpeRatioSimulation;
