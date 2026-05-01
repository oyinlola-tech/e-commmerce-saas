const { body, header, param, query, validationResult } = require('express-validator');
const { createHttpError } = require('./errors');
const {
  sanitizeEmail,
  sanitizePhone,
  sanitizePlainText,
  sanitizeRichText,
  sanitizeSlug,
  sanitizeStringArray,
  sanitizeUrl,
  sanitizeJsonObject
} = require('./sanitization');

const collectValidationErrors = (req) => {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return null;
  }

  return result.array().map((entry) => ({
    field: entry.path,
    message: entry.msg
  }));
};

const validate = (chains) => {
  return [
    ...chains,
    (req, res, next) => {
      const errors = collectValidationErrors(req);
      if (!errors) {
        return next();
      }

      return next(createHttpError(422, 'Validation failed.', { fields: errors }, { expose: true }));
    }
  ];
};

const storeIdRule = (locations = ['body', 'query', 'headers']) => {
  const chains = [];
  if (locations.includes('body')) {
    chains.push(body('store_id').optional().isInt({ min: 1 }).toInt());
  }
  if (locations.includes('query')) {
    chains.push(query('store_id').optional().isInt({ min: 1 }).toInt());
  }
  if (locations.includes('headers')) {
    chains.push(header('x-store-id').optional().isInt({ min: 1 }).toInt());
  }
  return chains;
};

const paginationRules = () => ([
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt()
]);

const commonRules = {
  email: (field = 'email') => body(field)
    .isEmail()
    .withMessage('A valid email is required.')
    .bail()
    .customSanitizer((value) => sanitizeEmail(value)),
  password: (field = 'password') => body(field)
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters.'),
  name: (field = 'name', maxLength = 120) => body(field)
    .trim()
    .notEmpty()
    .withMessage(`${field} is required.`)
    .bail()
    .customSanitizer((value) => sanitizePlainText(value, { maxLength })),
  optionalName: (field = 'name', maxLength = 120) => body(field)
    .optional()
    .customSanitizer((value) => sanitizePlainText(value, { maxLength })),
  phone: (field = 'phone') => body(field)
    .optional()
    .customSanitizer((value) => sanitizePhone(value)),
  slug: (field = 'slug') => body(field)
    .optional()
    .customSanitizer((value) => sanitizeSlug(value)),
  plainText: (field, maxLength = 255) => body(field)
    .trim()
    .notEmpty()
    .withMessage(`${field} is required.`)
    .bail()
    .customSanitizer((value) => sanitizePlainText(value, { maxLength })),
  optionalPlainText: (field, maxLength = 255) => body(field)
    .optional()
    .customSanitizer((value) => sanitizePlainText(value, { maxLength })),
  richText: (field, maxLength = 5000) => body(field)
    .optional()
    .customSanitizer((value) => sanitizeRichText(value, { maxLength })),
  url: (field) => body(field)
    .optional()
    .customSanitizer((value) => sanitizeUrl(value)),
  int: (field, options = {}) => body(field)
    .isInt({
      min: options.min === undefined ? 0 : options.min,
      max: options.max
    })
    .withMessage(`${field} must be a whole number.`)
    .toInt(),
  optionalInt: (field, options = {}) => body(field)
    .optional()
    .isInt({
      min: options.min === undefined ? 0 : options.min,
      max: options.max
    })
    .withMessage(`${field} must be a whole number.`)
    .toInt(),
  amount: (field) => body(field)
    .isFloat({ min: 0 })
    .withMessage(`${field} must be a positive amount.`)
    .toFloat(),
  optionalAmount: (field) => body(field)
    .optional({ values: 'null' })
    .isFloat({ min: 0 })
    .withMessage(`${field} must be a positive amount.`)
    .toFloat(),
  stringArray: (field, maxItems = 10) => body(field)
    .optional()
    .customSanitizer((value) => sanitizeStringArray(Array.isArray(value) ? value.slice(0, maxItems) : [value], sanitizePlainText, { maxLength: 255 })),
  urlArray: (field, maxItems = 10) => body(field)
    .optional()
    .customSanitizer((value) => sanitizeStringArray(Array.isArray(value) ? value.slice(0, maxItems) : [value], sanitizeUrl)),
  jsonObject: (field) => body(field)
    .optional()
    .customSanitizer((value) => sanitizeJsonObject(value)),
  paramId: (field = 'id') => param(field).isInt({ min: 1 }).withMessage(`${field} must be a numeric identifier.`).toInt(),
  querySearch: (field = 'search') => query(field)
    .optional()
    .customSanitizer((value) => sanitizePlainText(value, { maxLength: 120 })),
  queryEnum: (field, values) => query(field)
    .optional()
    .isIn(values)
    .withMessage(`${field} must be one of: ${values.join(', ')}.`)
};

module.exports = {
  validate,
  collectValidationErrors,
  storeIdRule,
  paginationRules,
  commonRules
};
