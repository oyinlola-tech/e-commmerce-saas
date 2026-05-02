const crypto = require('crypto');
const { createHttpError } = require('../../../../packages/shared');

/**
 * Webhook Signature Verification
 * Supports: Paystack, Flutterwave, Stripe
 * Usage: Verify incoming payment provider webhooks before processing
 */

const verifyPaystackSignature = (req, secretKey) => {
  if (!secretKey) {
    throw createHttpError(401, 'Paystack secret key not configured.');
  }

  const signature = req.headers['x-paystack-signature'];
  if (!signature) {
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha512', secretKey)
      .update(JSON.stringify(req.body))
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch (error) {
    return false;
  }
};

const verifyFlutterwaveSignature = (req, secretKey) => {
  if (!secretKey) {
    throw createHttpError(401, 'Flutterwave secret key not configured.');
  }

  const signature = req.headers['verif-hash'];
  if (!signature) {
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha256', secretKey)
      .update(JSON.stringify(req.body))
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch (error) {
    return false;
  }
};

const verifyStripeSignature = (req, secretKey, rawBody) => {
  if (!secretKey) {
    throw createHttpError(401, 'Stripe secret key not configured.');
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return false;
  }

  try {
    // Stripe expects raw body, not JSON
    const hash = crypto
      .createHmac('sha256', secretKey)
      .update(rawBody)
      .digest('hex');

    const [timestamp, computedSig] = signature.split(',')[0].split('=')[1];
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(computedSig));
  } catch (error) {
    return false;
  }
};

const verifyWebhookSignature = ({ provider, req, secretKey, rawBody }) => {
  const normalizedProvider = String(provider || '').toLowerCase();

  if (normalizedProvider === 'paystack') {
    return verifyPaystackSignature(req, secretKey);
  }

  if (normalizedProvider === 'flutterwave') {
    return verifyFlutterwaveSignature(req, secretKey);
  }

  if (normalizedProvider === 'stripe') {
    return verifyStripeSignature(req, secretKey, rawBody);
  }

  throw createHttpError(400, `Unsupported provider: ${provider}`);
};

module.exports = {
  verifyPaystackSignature,
  verifyFlutterwaveSignature,
  verifyStripeSignature,
  verifyWebhookSignature
};
