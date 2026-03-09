/**
 * Parse Coda date labels to YYYY-MM-DD.
 * Supports formats:
 *   - Fri 2/27/26, Tues 2/24/26
 *   - Tuesday 3.3.2026, Friday 28.2.2026
 *   - 10/21/2025, 06/29/2024
 *   - 9/19/2025, 9/12/2025
 * Labels may have trailing text (e.g. "Fri 12/9/25 Memory Dump", "Tuesday 17.2.2026 - DIRTY 30")
 * @param {string} label - Coda date label
 * @returns {string|null} YYYY-MM-DD or null if unparseable
 */
function parseCodaDate(label) {
  if (!label || typeof label !== 'string') return null;
  const s = label.trim();

  // Strip trailing non-date text (e.g. "Memory Dump", "- DIRTY 30")
  const datePart = s.replace(/\s+[-–—].*$/, '').replace(/\s+[A-Za-z].*$/, '').trim();
  if (!datePart) return null;

  // 10/21/2025, 06/29/2024, 9/19/2025 (M/D/YYYY or MM/DD/YYYY)
  let m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000; // 25 -> 2025
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDate(year, month, day);
    }
  }

  // Fri 2/27/26, Tues 2/24/26 (DayName M/D/YY)
  m = datePart.match(/^\w+\s+(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDate(year, month, day);
    }
  }

  // Tuesday 3.3.2026, Friday 28.2.2026 (DayName D.M.YYYY)
  m = datePart.match(/^\w+\s+(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDate(year, month, day);
    }
  }

  // Tuesday 3.3.26, Friday 28.2.26 (DayName D.M.YY)
  m = datePart.match(/^\w+\s+(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDate(year, month, day);
    }
  }

  // 3.3.2026, 28.2.2026 (D.M.YYYY)
  m = datePart.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return formatDate(year, month, day);
    }
  }

  return null;
}

function formatDate(year, month, day) {
  const y = String(year);
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { parseCodaDate };
