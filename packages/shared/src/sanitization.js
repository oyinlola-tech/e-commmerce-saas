const sanitizeHtml = require('sanitize-html');

const plainTextOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard'
};

const richTextOptions = {
  allowedTags: ['b', 'strong', 'i', 'em', 'u', 'p', 'ul', 'ol', 'li', 'br'],
  allowedAttributes: {}
};

const sanitizePlainText = (value, options = {}) => {
  const sanitized = sanitizeHtml(String(value || ''), plainTextOptions)
    .replace(/\s+/g, ' ')
    .trim();

  if (options.maxLength) {
    return sanitized.slice(0, options.maxLength);
  }

  return sanitized;
};

const sanitizeRichText = (value, options = {}) => {
  const sanitized = sanitizeHtml(String(value || ''), richTextOptions).trim();
  if (options.maxLength) {
    return sanitized.slice(0, options.maxLength);
  }

  return sanitized;
};

const sanitizeEmail = (value) => {
  return sanitizePlainText(value, { maxLength: 190 }).toLowerCase();
};

const sanitizePhone = (value) => {
  return sanitizePlainText(value, { maxLength: 50 });
};

const sanitizeSlug = (value) => {
  return sanitizePlainText(value, { maxLength: 180 })
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const sanitizeUrl = (value) => {
  const sanitized = sanitizePlainText(value, { maxLength: 255 });
  if (!sanitized) {
    return '';
  }

  try {
    const parsed = new URL(sanitized);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch (error) {
    return '';
  }
};

const sanitizeStringArray = (items, sanitizer = sanitizePlainText, options = {}) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => sanitizer(item, options))
    .filter(Boolean);
};

const sanitizeJsonObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    if (typeof entry === 'string') {
      accumulator[sanitizePlainText(key, { maxLength: 120 })] = sanitizePlainText(entry, { maxLength: 1000 });
      return accumulator;
    }

    if (Array.isArray(entry)) {
      accumulator[sanitizePlainText(key, { maxLength: 120 })] = entry
        .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
        .slice(0, 25)
        .map((item) => (typeof item === 'string' ? sanitizePlainText(item, { maxLength: 250 }) : item));
      return accumulator;
    }

    if (entry && typeof entry === 'object') {
      accumulator[sanitizePlainText(key, { maxLength: 120 })] = sanitizeJsonObject(entry);
      return accumulator;
    }

    accumulator[sanitizePlainText(key, { maxLength: 120 })] = entry;
    return accumulator;
  }, {});
};

module.exports = {
  sanitizePlainText,
  sanitizeRichText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeSlug,
  sanitizeUrl,
  sanitizeStringArray,
  sanitizeJsonObject
};
