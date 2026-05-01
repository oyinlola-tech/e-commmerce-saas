const crypto = require('crypto');

const replayWindows = new Map();

const cleanupReplayState = (secret) => {
  const entries = replayWindows.get(secret);
  if (!entries) {
    return;
  }

  const timestamp = Date.now();
  for (const [nonce, expiresAt] of entries.entries()) {
    if (expiresAt <= timestamp) {
      entries.delete(nonce);
    }
  }
};

const rememberNonce = (secret, nonce, ttlMs) => {
  cleanupReplayState(secret);
  const entries = replayWindows.get(secret) || new Map();
  replayWindows.set(secret, entries);
  if (entries.has(nonce)) {
    return false;
  }

  entries.set(nonce, Date.now() + ttlMs);
  return true;
};

const getSignaturePayload = (headers = {}) => {
  return {
    requestId: headers['x-request-id'] || '',
    timestamp: headers['x-internal-timestamp'] || '',
    nonce: headers['x-internal-nonce'] || '',
    forwardedHost: headers['x-forwarded-host'] || '',
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
  forwardedHost,
  storeId,
  userId,
  actorRole,
  customerId,
  actorType,
  secret
}) => {
  const headers = {
    'x-request-id': requestId || '',
    'x-internal-timestamp': String(Date.now()),
    'x-internal-nonce': crypto.randomUUID(),
    'x-forwarded-host': forwardedHost || '',
    'x-store-id': storeId ? String(storeId) : '',
    'x-user-id': userId ? String(userId) : '',
    'x-actor-role': actorRole || '',
    'x-customer-id': customerId ? String(customerId) : '',
    'x-actor-type': actorType || ''
  };

  headers['x-internal-signature'] = createInternalSignature(getSignaturePayload(headers), secret);
  return headers;
};

const isValidHexDigest = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''));

const verifySignedInternalHeaders = (headers, secret, options = {}) => {
  const actualSignature = headers['x-internal-signature'] || headers['X-Internal-Signature'];
  if (!actualSignature) {
    return false;
  }

  if (!isValidHexDigest(actualSignature)) {
    return false;
  }

  const timestamp = Number(headers['x-internal-timestamp']);
  const nonce = String(headers['x-internal-nonce'] || '').trim();
  const maxAgeMs = Number(options.maxAgeMs || 5 * 60 * 1000);
  const nonceTtlMs = Number(options.nonceTtlMs || maxAgeMs);

  if (!timestamp || !nonce) {
    return false;
  }

  if (Math.abs(Date.now() - timestamp) > maxAgeMs) {
    return false;
  }

  const expectedSignature = createInternalSignature(getSignaturePayload(headers), secret);
  if (actualSignature.length !== expectedSignature.length) {
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(actualSignature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );

  if (!isValid) {
    return false;
  }

  return rememberNonce(secret, nonce, nonceTtlMs);
};

const requireInternalRequest = (secret, options = {}) => {
  return (req, res, next) => {
    if (!verifySignedInternalHeaders(req.headers, secret, options)) {
      return res.status(401).json({ error: 'Invalid internal signature.' });
    }

    req.authContext = {
      requestId: req.headers['x-request-id'] || '',
      forwardedHost: req.headers['x-forwarded-host'] || '',
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
