const { createHttpError, sanitizePlainText } = require('../../../../packages/shared');

const normalizeProviderText = (value, maxLength) => {
  return sanitizePlainText(value || '', { maxLength }) || null;
};

const buildComplianceProvider = (config, logger) => {
  const providerConfig = config.complianceProvider || {};
  const enabled = Boolean(providerConfig.enabled);
  const name = normalizeProviderText(providerConfig.name, 120) || 'manual-review';
  const mode = normalizeProviderText(providerConfig.mode, 40) || 'sandbox';
  const baseUrl = normalizeProviderText(providerConfig.baseUrl, 255);
  const timeoutMs = Number(providerConfig.timeoutMs || config.requestTimeoutMs || 5000);
  const endpoints = {
    kyc: normalizeProviderText(providerConfig.kycPath, 180) || '/kyc',
    kyb: normalizeProviderText(providerConfig.kybPath, 180) || '/kyb',
    document: normalizeProviderText(providerConfig.documentPath, 180) || '/documents'
  };
  const hasApiKey = Boolean(normalizeProviderText(providerConfig.apiKey, 500));
  const hasWebhookSecret = Boolean(normalizeProviderText(providerConfig.webhookSecret, 500));
  const configured = Boolean(enabled && baseUrl && hasApiKey);

  if (enabled && !configured && logger) {
    logger.warn('Compliance provider integration is enabled but incomplete', {
      providerName: name,
      hasBaseUrl: Boolean(baseUrl),
      hasApiKey,
      hasWebhookSecret
    });
  }

  return {
    enabled,
    configured,
    name,
    mode,
    baseUrl,
    timeoutMs,
    endpoints,
    hasApiKey,
    hasWebhookSecret,
    describe() {
      return {
        enabled,
        configured,
        name,
        mode,
        base_url: baseUrl,
        timeout_ms: timeoutMs,
        endpoints,
        has_api_key: hasApiKey,
        has_webhook_secret: hasWebhookSecret
      };
    },
    createNotConfiguredError(capability = 'compliance processing') {
      return createHttpError(
        503,
        `Compliance provider integration is not configured for ${capability}. Update COMPLIANCE_PROVIDER_* env settings and restart the compliance service.`,
        null,
        { expose: true }
      );
    }
  };
};

module.exports = {
  buildComplianceProvider
};
