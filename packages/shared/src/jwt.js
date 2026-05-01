const jwt = require('jsonwebtoken');

const signPlatformToken = (user, secret, expiresIn = '7d') => {
  return jwt.sign({
    sub: String(user.id),
    user_id: String(user.id),
    role: user.role,
    actor_type: 'platform_user'
  }, secret, { expiresIn });
};

const signCustomerToken = (customer, secret, expiresIn = '7d') => {
  return jwt.sign({
    sub: String(customer.id),
    customer_id: String(customer.id),
    store_id: String(customer.store_id),
    actor_type: 'customer'
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
