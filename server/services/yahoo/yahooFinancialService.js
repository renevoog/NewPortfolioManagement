// Yahoo Finance — financial history service (income statements)
// Fetches quarterly and annual revenue + net income via quoteSummary.
// Uses modules: incomeStatementHistory, incomeStatementHistoryQuarterly

const { quoteSummary } = require('./yahooFinanceClient');
const { getYahooSymbol } = require('../symbolMap');

// Extract raw value from Yahoo's nested {raw, fmt} format
const rawVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'raw' in v) return v.raw;
  if (typeof v === 'number') return v;
  return null;
};

// Convert epoch seconds to ISO date string
const epochToDate = (v) => {
  const raw = rawVal(v);
  if (!raw) return null;
  return new Date(raw * 1000).toISOString().split('T')[0];
};

// Derive a human-readable quarter label from a date string: "Q4 2024"
const quarterLabel = (dateStr) => {
  if (!dateStr) return '?';
  const d = new Date(dateStr);
  const month = d.getMonth() + 1; // 1–12
  let q;
  if (month <= 3) q = 1;
  else if (month <= 6) q = 2;
  else if (month <= 9) q = 3;
  else q = 4;
  return 'Q' + q + ' ' + d.getFullYear();
};

// Derive a year label from a date string: "2024"
const yearLabel = (dateStr) => {
  if (!dateStr) return '?';
  return String(new Date(dateStr).getFullYear());
};

// Normalize one income statement entry into our standard shape
const normalizeEntry = (entry, labelFn) => {
  const date = epochToDate(entry.endDate);
  return {
    label: labelFn(date),
    date: date,
    revenue: rawVal(entry.totalRevenue),
    netIncome: rawVal(entry.netIncome)
  };
};

// Sort periods chronologically (oldest first)
const sortPeriods = (periods) => {
  return periods.slice().sort((a, b) => {
    if (!a.date || !b.date) return 0;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
};

/**
 * Fetch financial history for a single TradingView symbol.
 * Returns a normalized JSON payload with quarterly + yearly data.
 *
 * @param {string} tvSymbol — canonical TradingView symbol (e.g. 'AAPL', 'BRK.B', 'RMS')
 * @returns {object} normalized financial history
 */
const getFinancialHistory = async (tvSymbol) => {
  // Resolve to Yahoo symbol
  const yahooSymbol = getYahooSymbol(tvSymbol) || tvSymbol;

  const summary = await quoteSummary(yahooSymbol, {
    modules: [
      'incomeStatementHistory',
      'incomeStatementHistoryQuarterly'
    ]
  });

  // Extract annual statements
  const annualRaw = summary.incomeStatementHistory
    && summary.incomeStatementHistory.incomeStatementHistory;
  const annualStatements = Array.isArray(annualRaw) ? annualRaw : [];

  // Extract quarterly statements
  const quarterlyRaw = summary.incomeStatementHistoryQuarterly
    && summary.incomeStatementHistoryQuarterly.incomeStatementHistory;
  const quarterlyStatements = Array.isArray(quarterlyRaw) ? quarterlyRaw : [];

  // Normalize
  const quarterlyPeriods = sortPeriods(
    quarterlyStatements.map((e) => normalizeEntry(e, quarterLabel))
  );
  const yearlyPeriods = sortPeriods(
    annualStatements.map((e) => normalizeEntry(e, yearLabel))
  );

  // Determine availability — must have at least 1 period with revenue data
  const hasQuarterly = quarterlyPeriods.some((p) => p.revenue !== null);
  const hasYearly = yearlyPeriods.some((p) => p.revenue !== null);

  return {
    symbol: tvSymbol,
    source: 'yahoo',
    availability: {
      quarterly: hasQuarterly,
      yearly: hasYearly
    },
    quarterly: {
      periods: hasQuarterly ? quarterlyPeriods : []
    },
    yearly: {
      periods: hasYearly ? yearlyPeriods : []
    }
  };
};

exports.getFinancialHistory = getFinancialHistory;
