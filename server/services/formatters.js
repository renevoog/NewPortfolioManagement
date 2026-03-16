// Shared formatting utilities for the dashboard
// Follows the CRYPTO_API helper_services.js convention

// Format market cap in compact form: "2.0 B$", "200.0 M€", etc.
const formatMarketCap = (value, currency) => {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const unit = getCurrencyUnit(currency);
  const abs = Math.abs(value);

  if (abs >= 1e12) {
    return (value / 1e12).toFixed(1) + 'T ' + unit;
  }
  if (abs >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B ' + unit;
  }
  if (abs >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M ' + unit;
  }
  if (abs >= 1e3) {
    // Format with space thousands: "200 000 €"
    return Math.round(value).toLocaleString('fr-FR').replace(/\u202F/g, ' ') + ' ' + unit;
  }

  return value.toFixed(1) + ' ' + unit;
};

// Smart price formatting: 2 decimals normally, more for tiny prices
const formatPrice = (value, currency) => {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const unit = getCurrencyUnit(currency);
  const formatted = smartDecimals(value);
  return formatted + ' ' + unit;
};

// Format daily change with currency
const formatDailyChange = (value, currency) => {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const unit = getCurrencyUnit(currency);
  const sign = value >= 0 ? '+' : '';
  const formatted = smartDecimals(value);
  return sign + formatted + ' ' + unit;
};

// Format percent change: "+1.23%" or "-0.45%"
const formatPercent = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(2) + '%';
};

// Format beta: 2 decimals
const formatBeta = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return value.toFixed(2);
};

// Format target price with currency
const formatTargetPrice = (value, currency) => {
  if (value === null || value === undefined || isNaN(value)) return '-';

  const unit = getCurrencyUnit(currency);
  return value.toFixed(2) + ' ' + unit;
};

// Format Estonia timezone timestamp: "16.03.26 11:48"
const formatEstoniaTime = (date) => {
  if (!date) return '-';

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '-';

  const options = {
    timeZone: 'Europe/Tallinn',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
  const p = {};
  parts.forEach((part) => { p[part.type] = part.value; });

  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};

// Smart decimal formatting: show enough decimals so 2 non-zero trailing digits appear
const smartDecimals = (value) => {
  if (value === 0) return '0.00';

  const abs = Math.abs(value);

  // Normal prices: 2 decimals
  if (abs >= 0.01) {
    return value.toFixed(2);
  }

  // Tiny prices: find first 2 significant digits after decimal
  const str = abs.toExponential();
  const exp = parseInt(str.split('e')[1]);
  const decimals = Math.min(Math.abs(exp) + 1, 10);
  return value.toFixed(decimals);
};

// Get currency unit symbol
const getCurrencyUnit = (currency) => {
  if (!currency) return '$';

  // Check original case first (Yahoo uses "GBp" for pence vs "GBP" for pounds)
  const raw = String(currency);
  if (raw === 'GBp' || raw === 'GBX' || raw === 'GBx') return 'p';

  const c = raw.toUpperCase();
  switch (c) {
    case 'EUR': return '€';
    case 'USD': return '$';
    case 'GBP': return '£';
    case 'GBX': return 'p';
    case 'SEK': return 'kr';
    case 'NOK': return 'kr';
    case 'DKK': return 'kr';
    case 'CHF': return 'CHF';
    case 'JPY': return '¥';
    case 'INR': return '₹';
    default: return c;
  }
};

exports.formatMarketCap = formatMarketCap;
exports.formatPrice = formatPrice;
exports.formatDailyChange = formatDailyChange;
exports.formatPercent = formatPercent;
exports.formatBeta = formatBeta;
exports.formatTargetPrice = formatTargetPrice;
exports.formatEstoniaTime = formatEstoniaTime;
exports.smartDecimals = smartDecimals;
exports.getCurrencyUnit = getCurrencyUnit;
