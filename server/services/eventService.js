// Event formatting service
// Normalizes earnings/event data from Yahoo Finance quote response
// into a clean internal event object for the dashboard Events column.

const { formatEstoniaTime } = require('./formatters');

/**
 * Build a normalized event object from Yahoo quote earnings fields.
 *
 * Yahoo v7/finance/quote provides:
 *   earningsTimestamp        — most recent or confirmed next earnings (epoch seconds)
 *   earningsTimestampStart   — next upcoming earnings window start (epoch seconds)
 *   earningsTimestampEnd     — next upcoming earnings window end (epoch seconds)
 *   isEarningsDateEstimate   — boolean, true if date is estimated
 *
 * Strategy:
 *   1. If earningsTimestampStart is in the future → use it (next upcoming)
 *   2. Else if earningsTimestamp is in the future → use it
 *   3. Else if earningsTimestamp is in the past    → show as past event
 *   4. Else → no event available
 *
 * @param {object} yQuote — raw Yahoo v7 quote object
 * @param {Date}   now    — reference time
 * @returns {object|null} normalized event object or null
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

  if (tsStart && (tsStart * 1000) > nowMs) {
    epochSec = tsStart;
    isRange = tsEnd && tsEnd !== tsStart;
  } else if (tsMain && (tsMain * 1000) > nowMs) {
    epochSec = tsMain;
  } else if (tsMain) {
    // All in the past — show most recent earnings
    epochSec = tsMain;
  }

  if (!epochSec) return null;

  const eventDate = new Date(epochSec * 1000);
  const diffMs = eventDate.getTime() - nowMs;
  const daysUntil = Math.ceil(diffMs / 86400000);
  const isPast = daysUntil < 0;

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
 * Build the main cell label text.
 *   Within 14 days future: relative ("In 10 days", "Tomorrow", "Today")
 *   Past: "Reported" + compact date
 *   Beyond 14 days: compact date
 */
const buildLabel = (daysUntil, date, isPast) => {
  if (isPast) {
    return formatCompactDate(date);
  }

  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil <= 14) return 'In ' + daysUntil + ' days';

  return formatCompactDate(date);
};

/**
 * Format a date as compact: "26 Mar 2026"
 */
const formatCompactDate = (date) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
};

exports.buildEarningsEvent = buildEarningsEvent;
