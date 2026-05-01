const { validationResult } = require('express-validator');

const buildFieldErrors = (req) => {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return null;
  }

  return result.array().reduce((accumulator, entry) => {
    if (!accumulator[entry.path]) {
      accumulator[entry.path] = [];
    }

    accumulator[entry.path].push(entry.msg);
    return accumulator;
  }, {});
};

const handleFormValidation = (renderer) => {
  return (req, res, next) => {
    const errors = buildFieldErrors(req);
    if (!errors) {
      return next();
    }

    return renderer(req, res, errors);
  };
};

module.exports = {
  buildFieldErrors,
  handleFormValidation
};
