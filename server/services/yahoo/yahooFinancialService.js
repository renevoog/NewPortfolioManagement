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
 * Calculate period-over-period % change for revenue and netIncome.
 * Mutates the array in-place, adding revenueChange and netIncomeChange fields.
 *
 * Rules:
 *   - First period: null (no previous to compare)
 *   - Previous value is null: null
 *   - Previous value is 0: null (avoid division by zero)
 *   - Net income sign crossover (prev negative, current positive or vice versa):
 *     still calculate, but if previous is very close to zero (abs < 1000),
 *     return null to avoid misleading huge percentages
 */
const addPeriodChanges = (periods) => {
  for (let i = 0; i < periods.length; i++) {
    if (i === 0) {
      periods[i].revenueChange = null;
      periods[i].netIncomeChange = null;
      continue;
    }

    periods[i].revenueChange = safePercentChange(
      periods[i].revenue, periods[i - 1].revenue
    );
    periods[i].netIncomeChange = safePercentChange(
      periods[i].netIncome, periods[i - 1].netIncome
    );
  }
  return periods;
};

/**
 * Safe percentage change: ((current - previous) / |previous|) * 100
 * Uses absolute value of previous to keep sign direction meaningful
 * even when previous is negative.
 *
 * Returns null for:
 *   - missing values
 *   - previous is zero or near-zero (abs < 1000)
 */
const safePercentChange = (current, previous) => {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  if (Math.abs(previous) < 1000) return null; // near-zero guard

  return ((current - previous) / Math.abs(previous)) * 100;
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

  // Normalize, sort chronologically, then compute period-over-period changes
  const quarterlyPeriods = addPeriodChanges(sortPeriods(
    quarterlyStatements.map((e) => normalizeEntry(e, quarterLabel))
  ));
  const yearlyPeriods = addPeriodChanges(sortPeriods(
    annualStatements.map((e) => normalizeEntry(e, yearLabel))
  ));

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
