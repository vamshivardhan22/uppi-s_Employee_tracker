function headerMap_(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const key = String(header == null ? '' : header).trim();
    if (key) result[key] = index;
  });
  return result;
}

function safeText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Date-only task fields are rendered as yyyy-MM-dd in the source spreadsheet timezone.
 * This avoids browser UTC conversion shifting a date into the previous/next day.
 */
function dateOnlyForClient_(value, timeZone) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone || APP.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  if (!text) return '';
  // Preserve a source date-only string as-is; don't parse ambiguous locale strings.
  return text;
}

function valueByCanonicalField_(row, headers, mapping, canonicalField) {
  const sourceHeader = mapping[canonicalField];
  if (!sourceHeader) return '';
  const index = findHeaderIndex_(headers, sourceHeader);
  return index < 0 ? '' : row[index];
}
