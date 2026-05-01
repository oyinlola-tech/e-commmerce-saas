const jwt = require('jsonwebtoken');

const signPlatformToken = (user, secret, expiresIn = process.env.JWT_ACCESS_TTL || '1h') => {
  return jwt.sign({
    sub: String(user.id),
    user_id: String(user.id),
    role: user.role,
    actor_type: 'platform_user',
    token_type: 'access'
  }, secret, { expiresIn });
};

const signCustomerToken = (customer, secret, expiresIn = process.env.JWT_ACCESS_TTL || '1h') => {
  return jwt.sign({
    sub: String(customer.id),
    customer_id: String(customer.id),
    store_id: String(customer.store_id),
    actor_type: 'customer',
    token_type: 'access'
  }, secret, { expiresIn });
};

const verifyToken = (token, secret) => {
  return jwt.verify(token, secret);
};

module.exports = {
  signPlatformToken,
  signCustomerToken,
  verifyToken
};
