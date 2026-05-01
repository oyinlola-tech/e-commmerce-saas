const crypto = require('crypto');

const getSignaturePayload = (headers = {}) => {
  return {
    requestId: headers['x-request-id'] || '',
    timestamp: headers['x-internal-timestamp'] || '',
    storeId: headers['x-store-id'] || '',
    userId: headers['x-user-id'] || '',
    actorRole: headers['x-actor-role'] || '',
    customerId: headers['x-customer-id'] || '',
    actorType: headers['x-actor-type'] || ''
  };
};

const createInternalSignature = (payload, secret) => {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
};

const buildSignedInternalHeaders = ({
  requestId,
  storeId,
  userId,
  actorRole,
  customerId,
  actorType,
  secret
}) => {
  const headers = {
    'x-request-id': requestId || '',
    'x-internal-timestamp': new Date().toISOString(),
    'x-store-id': storeId ? String(storeId) : '',
    'x-user-id': userId ? String(userId) : '',
    'x-actor-role': actorRole || '',
    'x-customer-id': customerId ? String(customerId) : '',
    'x-actor-type': actorType || ''
  };

  headers['x-internal-signature'] = createInternalSignature(getSignaturePayload(headers), secret);
  return headers;
};

const verifySignedInternalHeaders = (headers, secret) => {
  const actualSignature = headers['x-internal-signature'] || headers['X-Internal-Signature'];
  if (!actualSignature) {
    return false;
  }

  const expectedSignature = createInternalSignature(getSignaturePayload(headers), secret);
  return crypto.timingSafeEqual(Buffer.from(actualSignature), Buffer.from(expectedSignature));
};

const requireInternalRequest = (secret) => {
  return (req, res, next) => {
    if (!verifySignedInternalHeaders(req.headers, secret)) {
      return res.status(401).json({ error: 'Invalid internal signature.' });
    }

    req.authContext = {
      requestId: req.headers['x-request-id'] || '',
      storeId: req.headers['x-store-id'] || null,
      userId: req.headers['x-user-id'] || null,
      actorRole: req.headers['x-actor-role'] || null,
      customerId: req.headers['x-customer-id'] || null,
      actorType: req.headers['x-actor-type'] || null
    };
    return next();
  };
};

module.exports = {
  buildSignedInternalHeaders,
  verifySignedInternalHeaders,
  requireInternalRequest
};
