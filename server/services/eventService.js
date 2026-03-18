// Event formatting service
// Normalizes earnings/event data from Yahoo Finance quote response
// into a clean internal event object for the dashboard Events column.
// Only surfaces events within a useful window to reduce noise.

const { formatEstoniaTime } = require('./formatters');

// Thresholds
const EARNINGS_SOON_DAYS = 7;       // Show earnings if within 7 days
const EARNINGS_AFTERMATH_DAYS = 3;  // Show "just reported" for 3 days after
const ABNORMAL_MOVE_PCT = 5.0;      // Flag daily moves >= 5%

/**
 * Build a normalized event object from Yahoo quote earnings fields.
 * Returns null for events outside the attention window.
 */
const buildEarningsEvent = (yQuote, now) => {
  if (!yQuote) return null;

  const tsStart = yQuote.earningsTimestampStart;
  const tsEnd = yQuote.earningsTimestampEnd;
  const tsMain = yQuote.earningsTimestamp;
  const isEstimate = yQuote.isEarningsDateEstimate === true;

  const nowMs = now.getTime();

  // Pick the best timestamp: prefer upcoming start, fall back to main
  let epochSec = null;
  let isRange = false;
  let isPast = false;

  if (tsStart && (tsStart * 1000) > nowMs) {
    epochSec = tsStart;
    isRange = tsEnd && tsEnd !== tsStart;
  } else if (tsMain && (tsMain * 1000) > nowMs) {
    epochSec = tsMain;
  } else if (tsMain) {
    // Past earnings
    epochSec = tsMain;
    isPast = true;
  }

  if (!epochSec) return null;

  const eventDate = new Date(epochSec * 1000);
  const diffMs = eventDate.getTime() - nowMs;
  const daysUntil = Math.ceil(diffMs / 86400000);

  // Filter: only show if within attention window
  if (!isPast && daysUntil > EARNINGS_SOON_DAYS) return null;
  if (isPast && Math.abs(daysUntil) > EARNINGS_AFTERMATH_DAYS) return null;

  return {
    type: 'earnings',
    exactDate: eventDate.toISOString(),
    tooltipDate: formatEstoniaTime(eventDate),
    daysUntil: daysUntil,
    isPast: isPast,
    isEstimate: isEstimate,
    isRange: isRange,
    label: buildLabel(daysUntil, eventDate, isPast),
    displayDate: formatCompactDate(eventDate)
  };
};

/**
 * Detect abnormal daily move from quote data.
 * Returns an event object if the daily change % exceeds threshold.
 */
const buildAbnormalMoveEvent = (yQuote) => {
  if (!yQuote) return null;

  const changePct = yQuote.regularMarketChangePercent;
  if (typeof changePct !== 'number') return null;
  if (Math.abs(changePct) < ABNORMAL_MOVE_PCT) return null;

  const sign = changePct > 0 ? '+' : '';
  const label = sign + changePct.toFixed(1) + '% today';

  return {
    type: 'abnormal_move',
    label: label,
    tooltipDate: 'Abnormal daily move: ' + label,
    changePct: changePct,
    isPast: false,
    isEstimate: false
  };
};

/**
 * Build the best single event for the Events column.
 * Priority: earnings within window > abnormal move > nothing.
 */
const buildEvent = (yQuote, now) => {
  // Earnings takes priority
  const earningsEvent = buildEarningsEvent(yQuote, now);
  if (earningsEvent) return earningsEvent;

  // Abnormal move
  const moveEvent = buildAbnormalMoveEvent(yQuote);
  if (moveEvent) return moveEvent;

  return null;
};

/**
 * Build the main cell label text.
 */
const buildLabel = (daysUntil, date, isPast) => {
  if (isPast) {
    return 'Reported ' + formatCompactDate(date);
  }

  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil <= 14) return 'In ' + daysUntil + ' days';

  return formatCompactDate(date);
};

/**
 * Format a date as compact: "26 Mar"
 */
const formatCompactDate = (date) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getDate() + ' ' + months[date.getMonth()];
};

exports.buildEarningsEvent = buildEarningsEvent;
exports.buildAbnormalMoveEvent = buildAbnormalMoveEvent;
exports.buildEvent = buildEvent;
