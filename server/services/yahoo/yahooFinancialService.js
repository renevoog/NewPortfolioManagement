// Yahoo Finance — expanded detail service
// Fetches financial history + analyst consensus in a SINGLE quoteSummary call.
// Modules: incomeStatementHistory, incomeStatementHistoryQuarterly,
//          financialData, recommendationTrend

const { quoteSummary, insights } = require('./yahooFinanceClient');
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
  const month = d.getMonth() + 1;
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

// Normalize one income statement entry
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

// Add period-over-period % changes
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

const safePercentChange = (current, previous) => {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined) return null;
  if (Math.abs(previous) < 1000) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

// ---- Rating key normalization ----
const RATING_MAP = {
  'strongBuy': 'Strong Buy',
  'strong_buy': 'Strong Buy',
  'buy': 'Buy',
  'overweight': 'Overweight',
  'outperform': 'Outperform',
  'hold': 'Hold',
  'neutral': 'Neutral',
  'underperform': 'Underperform',
  'underweight': 'Underweight',
  'sell': 'Sell',
  'strongSell': 'Strong Sell',
  'strong_sell': 'Strong Sell'
};

const formatRating = (key) => {
  if (!key || key === 'none') return null;
  return RATING_MAP[key] || key;
};

// ---- Extract analyst summary from financialData + recommendationTrend ----
const extractAnalystSummary = (fd, rt) => {
  if (!fd) fd = {};
  if (!rt) rt = {};

  const targetMean = rawVal(fd.targetMeanPrice);
  const targetHigh = rawVal(fd.targetHighPrice);
  const targetLow = rawVal(fd.targetLowPrice);
  const currentPrice = rawVal(fd.currentPrice);
  const analystCount = rawVal(fd.numberOfAnalystOpinions);
  const rating = formatRating(fd.recommendationKey);

  // Implied upside: ((target - current) / current) * 100
  let impliedUpsidePct = null;
  if (targetMean !== null && currentPrice !== null && currentPrice > 0) {
    impliedUpsidePct = ((targetMean - currentPrice) / currentPrice) * 100;
  }

  // Buy / Hold / Sell counts from recommendationTrend (current month = period "0m")
  let buyCount = null;
  let holdCount = null;
  let sellCount = null;
  const trend = Array.isArray(rt.trend) ? rt.trend : [];
  const current = trend.find((t) => t.period === '0m');
  if (current) {
    buyCount = (current.strongBuy || 0) + (current.buy || 0);
    holdCount = current.hold || 0;
    sellCount = (current.sell || 0) + (current.strongSell || 0);
  }

  // Determine if there is any meaningful data
  const available = rating !== null || targetMean !== null || analystCount !== null;

  return {
    source: 'yahoo',
    available: available,
    consensusRating: rating,
    averageTargetPrice: targetMean,
    targetHigh: targetHigh,
    targetLow: targetLow,
    currentPrice: currentPrice,
    impliedUpsidePct: impliedUpsidePct,
    analystCount: analystCount,
    buyCount: buyCount,
    holdCount: holdCount,
    sellCount: sellCount
  };
};

// Extract significant developments from insights response
const extractSigDevs = (insightsData) => {
  if (!insightsData || !insightsData.sigDevs) return [];

  const devs = Array.isArray(insightsData.sigDevs) ? insightsData.sigDevs : [];
  return devs.slice(0, 5).map((d) => ({
    headline: d.headline || '',
    date: d.date || null
  })).filter((d) => d.headline);
};

/**
 * Fetch full expanded-row detail for a single TradingView symbol.
 * Returns financial history + analyst summary + significant developments.
 */
const getFinancialHistory = async (tvSymbol) => {
  const yahooSymbol = getYahooSymbol(tvSymbol) || tvSymbol;

  // Fetch quoteSummary and insights in parallel
  const [summary, insightsData] = await Promise.all([
    quoteSummary(yahooSymbol, {
      modules: [
        'incomeStatementHistory',
        'incomeStatementHistoryQuarterly',
        'financialData',
        'recommendationTrend'
      ]
    }),
    insights(yahooSymbol).catch(() => null) // Non-critical, don't fail on insights error
  ]);

  // ---- Financial history ----
  const annualRaw = summary.incomeStatementHistory
    && summary.incomeStatementHistory.incomeStatementHistory;
  const annualStatements = Array.isArray(annualRaw) ? annualRaw : [];

  const quarterlyRaw = summary.incomeStatementHistoryQuarterly
    && summary.incomeStatementHistoryQuarterly.incomeStatementHistory;
  const quarterlyStatements = Array.isArray(quarterlyRaw) ? quarterlyRaw : [];

  const quarterlyPeriods = addPeriodChanges(sortPeriods(
    quarterlyStatements.map((e) => normalizeEntry(e, quarterLabel))
  ));
  const yearlyPeriods = addPeriodChanges(sortPeriods(
    annualStatements.map((e) => normalizeEntry(e, yearLabel))
  ));

  const hasQuarterly = quarterlyPeriods.some((p) => p.revenue !== null);
  const hasYearly = yearlyPeriods.some((p) => p.revenue !== null);

  // ---- Analyst summary ----
  const analystSummary = extractAnalystSummary(
    summary.financialData,
    summary.recommendationTrend
  );

  // ---- Significant developments ----
  const sigDevs = extractSigDevs(insightsData);

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
    },
    analystSummary: analystSummary,
    sigDevs: sigDevs
  };
};

exports.getFinancialHistory = getFinancialHistory;
