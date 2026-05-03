const { sanitizePlainText } = require('../../../../packages/shared/src/sanitization');

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;

const sanitizeStructuredData = (value, depth = 0) => {
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return sanitizePlainText(value, { maxLength: 1000 });
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeStructuredData(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return Object.entries(value)
    .slice(0, MAX_OBJECT_KEYS)
    .reduce((accumulator, [key, entry]) => {
      const safeKey = sanitizePlainText(key, { maxLength: 120 });
      if (!safeKey) {
        return accumulator;
      }

      const safeValue = sanitizeStructuredData(entry, depth + 1);
      if (safeValue === undefined) {
        return accumulator;
      }

      accumulator[safeKey] = safeValue;
      return accumulator;
    }, {});
};

module.exports = {
  sanitizeStructuredData
};
