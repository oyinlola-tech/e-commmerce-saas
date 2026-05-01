const bcrypt = require('bcryptjs');

const hashPassword = async (password) => {
  return bcrypt.hash(String(password || ''), 10);
};

const comparePassword = async (password, hash) => {
  return bcrypt.compare(String(password || ''), String(hash || ''));
};

module.exports = {
  hashPassword,
  comparePassword
};
