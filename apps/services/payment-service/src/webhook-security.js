const crypto = require('crypto');
const { createHttpError } = require('../../../../packages/shared');

const safeCompare = (expected, actual, encoding = 'utf8') => {
  const left = Buffer.from(String(expected || ''), encoding);
  const right = Buffer.from(String(actual || ''), encoding);

  if (!left.length || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
};

const getRawBody = (req) => {
  if (typeof req.rawBody === 'string' && req.rawBody.length) {
    return req.rawBody;
  }

  return JSON.stringify(req.body || {});
};

const verifyPaystackSignature = (req, secretKey) => {
  if (!secretKey) {
    throw createHttpError(401, 'Paystack secret key not configured.');
  }

  const signature = String(req.headers['x-paystack-signature'] || '').trim();
  if (!signature) {
    return false;
  }

  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(getRawBody(req))
    .digest('hex');

  return safeCompare(hash, signature, 'hex');
};

const verifyFlutterwaveSignature = (req, secretHash) => {
  if (!secretHash) {
    throw createHttpError(401, 'Flutterwave webhook secret hash not configured.');
  }

  const hmacSignature = String(req.headers['flutterwave-signature'] || '').trim();
  if (hmacSignature) {
    const hash = crypto
      .createHmac('sha256', secretHash)
      .update(getRawBody(req))
      .digest('base64');

    return safeCompare(hash, hmacSignature);
  }

  const legacySignature = String(req.headers['verif-hash'] || '').trim();
  if (legacySignature) {
    return safeCompare(secretHash, legacySignature);
  }

  return false;
};

const verifyWebhookSignature = ({ provider, req, secretKey, secretHash }) => {
  const normalizedProvider = String(provider || '').trim().toLowerCase();

  if (normalizedProvider === 'paystack') {
    return verifyPaystackSignature(req, secretKey);
  }

  if (normalizedProvider === 'flutterwave') {
    return verifyFlutterwaveSignature(req, secretHash);
  }

  throw createHttpError(400, `Unsupported provider: ${provider}`);
};

module.exports = {
  verifyPaystackSignature,
  verifyFlutterwaveSignature,
  verifyWebhookSignature
};
