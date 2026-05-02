const { URL } = require('url');
const {
  buildSignedInternalHeaders,
  requestJson,
  PLATFORM_ROLES,
  sanitizeEmail,
  sanitizePlainText,
  sanitizeUrl
} = require('../../../../packages/shared');
const { getEmailTemplateDefinition, TEMPLATE_STATUS } = require('./template-catalog');

const DEFAULT_PLATFORM_COLOR = '#0F766E';
const DEFAULT_PLATFORM_NAME = 'Aisle';
const DEFAULT_TEXT_COLOR = '#0F172A';
const DEFAULT_MUTED_TEXT_COLOR = '#475569';
const DEFAULT_BACKGROUND_COLOR = '#F8FAFC';

const isValidHexColor = (value = '') => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value || '').trim());

const normalizeColor = (value, fallback = DEFAULT_PLATFORM_COLOR) => {
  const candidate = String(value || '').trim();
  if (!isValidHexColor(candidate)) {
    return fallback;
  }

  if (candidate.length === 4) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toUpperCase();
  }

  return candidate.toUpperCase();
};

const hexToRgb = (value) => {
  const normalized = normalizeColor(value);
  const hex = normalized.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
};

const withAlpha = (value, alpha) => {
  const rgb = hexToRgb(value);
  const safeAlpha = Math.max(0, Math.min(Number(alpha) || 0, 1));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`;
};

const sanitizeDisplayValue = (value, maxLength = 160, fallback = '') => {
  const sanitized = sanitizePlainText(value || '', { maxLength });
  return sanitized || fallback;
};

const sanitizeOptionalUrl = (value = '') => {
  const sanitized = sanitizeUrl(value || '');
  return sanitized || '';
};

const joinUrl = (baseUrl, relativePath) => {
  try {
    return new URL(relativePath, baseUrl).toString();
  } catch {
    return '';
  }
};

const toAbsoluteUrl = (config, value = '') => {
  const sanitized = sanitizePlainText(value || '', { maxLength: 255 });
  if (!sanitized) {
    return '';
  }

  if (/^https?:\/\//i.test(sanitized)) {
    return sanitizeOptionalUrl(sanitized);
  }

  if (sanitized.startsWith('/')) {
    return joinUrl(config.webAppUrl, sanitized);
  }

  return '';
};

const buildStorefrontUrl = (config, store = {}) => {
  const customDomain = sanitizeDisplayValue(store.custom_domain || '', 190);
  if (customDomain) {
    return `${config.isProduction ? 'https' : 'http'}://${customDomain}`;
  }

  const subdomain = sanitizeDisplayValue(store.subdomain || '', 120);
  if (subdomain && config.rootDomain) {
    return `${config.isProduction ? 'https' : 'http'}://${subdomain}.${config.rootDomain}`;
  }

  return sanitizeOptionalUrl(config.webAppUrl) || '';
};

const fetchStoreBrand = async ({ config, requestId, storeId }) => {
  if (!storeId) {
    return null;
  }

  try {
    const response = await requestJson(`${config.serviceUrls.store}/stores/${encodeURIComponent(storeId)}`, {
      headers: buildSignedInternalHeaders({
        requestId,
        actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
        actorType: 'platform_user',
        secret: config.internalSharedSecret
      }),
      timeoutMs: config.requestTimeoutMs
    });

    return response?.store || null;
  } catch {
    return null;
  }
};

const resolvePlatformBrand = ({ config, smtpConfig, brand = {}, templateData = {} }) => {
  const platformName = sanitizeDisplayValue(
    brand.platform_name || brand.platformName || smtpConfig.fromName || DEFAULT_PLATFORM_NAME,
    120,
    DEFAULT_PLATFORM_NAME
  );
  const storeName = sanitizeDisplayValue(
    brand.store_name || brand.storeName || templateData.store_name || '',
    150
  );
  const primaryColor = normalizeColor(
    brand.primary_color || brand.primaryColor || DEFAULT_PLATFORM_COLOR,
    DEFAULT_PLATFORM_COLOR
  );
  const supportEmail = sanitizeEmail(
    brand.support_email || brand.supportEmail || smtpConfig.fromEmail || `support@${config.rootDomain}`
  );
  const websiteUrl = sanitizeOptionalUrl(brand.website_url || brand.websiteUrl || config.webAppUrl);
  const logoUrl = toAbsoluteUrl(config, brand.logo_url || brand.logoUrl || '');

  return {
    mode: 'platform',
    displayName: platformName,
    platformName,
    storeName,
    primaryColor,
    supportEmail,
    websiteUrl,
    logoUrl,
    footerTagline: storeName ? `${storeName} on ${platformName}` : platformName
  };
};

const resolveStoreBrand = async ({ config, requestId, smtpConfig, storeId, brand = {} }) => {
  const store = await fetchStoreBrand({ config, requestId, storeId });
  const explicitStoreName = sanitizeDisplayValue(brand.store_name || brand.storeName || '', 150);
  if (!store && !explicitStoreName) {
    const error = new Error('A store-branded email requires a valid store_id or an explicit storeName.');
    error.status = 422;
    throw error;
  }

  const storeName = sanitizeDisplayValue(
    explicitStoreName || store?.name || DEFAULT_PLATFORM_NAME,
    150,
    DEFAULT_PLATFORM_NAME
  );
  const primaryColor = normalizeColor(
    brand.primary_color || brand.primaryColor || store?.theme_color || DEFAULT_PLATFORM_COLOR,
    DEFAULT_PLATFORM_COLOR
  );
  const supportEmail = sanitizeEmail(
    brand.support_email || brand.supportEmail || store?.support_email || smtpConfig.fromEmail || `support@${config.rootDomain}`
  );
  const websiteUrl = sanitizeOptionalUrl(
    brand.website_url || brand.websiteUrl || buildStorefrontUrl(config, store || {})
  );
  const logoUrl = toAbsoluteUrl(config, brand.logo_url || brand.logoUrl || store?.logo_url || '');
  const platformName = sanitizeDisplayValue(
    brand.platform_name || brand.platformName || smtpConfig.fromName || DEFAULT_PLATFORM_NAME,
    120,
    DEFAULT_PLATFORM_NAME
  );

  return {
    mode: 'store',
    displayName: storeName,
    platformName,
    storeName,
    primaryColor,
    supportEmail,
    websiteUrl,
    logoUrl,
    footerTagline: `Powered by ${platformName}`
  };
};

const buildTextBlock = (lines = []) => {
  return lines
    .filter((line) => line !== undefined && line !== null)
    .join('\n');
};

const renderBrandMark = (brand) => {
  if (brand.logoUrl) {
    return `
      <img
        src="${brand.logoUrl}"
        alt="${brand.displayName} logo"
        width="48"
        height="48"
        style="display:block;width:48px;height:48px;border-radius:16px;object-fit:cover;border:0"
      >
    `.trim();
  }

  const initials = brand.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('') || 'A';

  return `
    <div
      style="width:48px;height:48px;border-radius:16px;background:${withAlpha(brand.primaryColor, 0.16)};color:${brand.primaryColor};font-size:18px;font-weight:700;line-height:48px;text-align:center"
    >${initials}</div>
  `.trim();
};

const renderShell = ({ brand, preheader, eyebrow, title, intro, bodyHtml, footerNote }) => {
  const safePreheader = sanitizeDisplayValue(preheader, 180);
  const safeEyebrow = sanitizeDisplayValue(eyebrow, 80);
  const safeTitle = sanitizeDisplayValue(title, 140);
  const safeIntro = sanitizeDisplayValue(intro, 280);
  const safeFooterNote = sanitizeDisplayValue(footerNote, 220);

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${safeTitle}</title>
      </head>
      <body style="margin:0;padding:0;background:${DEFAULT_BACKGROUND_COLOR};font-family:Arial,sans-serif;color:${DEFAULT_TEXT_COLOR}">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0">${safePreheader}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:${DEFAULT_BACKGROUND_COLOR}">
          <tr>
            <td align="center" style="padding:32px 16px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding-bottom:16px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
                      <tr>
                        <td align="left" style="vertical-align:middle">
                          ${renderBrandMark(brand)}
                        </td>
                        <td align="left" style="padding-left:14px;vertical-align:middle">
                          <p style="margin:0;font-size:14px;font-weight:700;color:${DEFAULT_TEXT_COLOR}">${brand.displayName}</p>
                          <p style="margin:4px 0 0;font-size:12px;color:${DEFAULT_MUTED_TEXT_COLOR}">${brand.footerTagline}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#ffffff;border-radius:28px;padding:32px;border:1px solid ${withAlpha(brand.primaryColor, 0.12)};box-shadow:0 18px 48px rgba(15,23,42,0.08)">
                    <p style="margin:0 0 16px;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;font-weight:700;color:${brand.primaryColor}">${safeEyebrow}</p>
                    <h1 style="margin:0 0 12px;font-size:30px;line-height:1.2;color:${DEFAULT_TEXT_COLOR}">${safeTitle}</h1>
                    <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:${DEFAULT_MUTED_TEXT_COLOR}">${safeIntro}</p>
                    ${bodyHtml}
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 8px 0">
                    <p style="margin:0;font-size:12px;line-height:1.7;color:${DEFAULT_MUTED_TEXT_COLOR}">
                      ${safeFooterNote}
                    </p>
                    <p style="margin:10px 0 0;font-size:12px;line-height:1.7;color:${DEFAULT_MUTED_TEXT_COLOR}">
                      Need help? Reply to this email or contact ${brand.supportEmail}.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
};

const renderOtpCallout = ({ brand, otp, expiresInMinutes, audienceLabel }) => {
  const safeOtp = sanitizeDisplayValue(otp, 12);
  const safeAudienceLabel = sanitizeDisplayValue(audienceLabel, 60);
  const safeWindow = Math.max(1, Number(expiresInMinutes) || 0);
  const resetWindow = `${safeWindow} minute${safeWindow === 1 ? '' : 's'}`;

  const bodyHtml = `
    <div style="border-radius:24px;background:${withAlpha(brand.primaryColor, 0.08)};padding:24px;border:1px solid ${withAlpha(brand.primaryColor, 0.18)}">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${brand.primaryColor}">${safeAudienceLabel}</p>
      <p style="margin:0;font-size:40px;line-height:1.1;font-weight:700;letter-spacing:0.28em;color:${brand.primaryColor}">${safeOtp}</p>
    </div>
    <p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:${DEFAULT_MUTED_TEXT_COLOR}">
      This code expires in ${resetWindow}. If you did not request this, you can ignore this email.
    </p>
  `.trim();

  const textLines = [
    `${safeAudienceLabel}: ${safeOtp}`,
    '',
    `This code expires in ${resetWindow}.`,
    'If you did not request this, you can ignore this email.'
  ];

  return {
    bodyHtml,
    textLines
  };
};

const templateRenderers = {
  'platform.password_reset_otp': async ({ brand, templateData }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const otp = sanitizeDisplayValue(templateData.otp || '', 12);
    const expiresInMinutes = Math.max(1, Number(templateData.expires_in_minutes) || 15);
    const otpBlock = renderOtpCallout({
      brand,
      otp,
      expiresInMinutes,
      audienceLabel: 'Password reset code'
    });

    return {
      subject: `Your ${brand.platformName} password reset OTP`,
      html: renderShell({
        brand,
        preheader: `Use this OTP to reset your ${brand.platformName} password.`,
        eyebrow: 'Account security',
        title: 'Reset your password',
        intro: `Hi ${name}, use the code below to reset your ${brand.platformName} password.`,
        bodyHtml: otpBlock.bodyHtml,
        footerNote: 'This transactional email was sent because a password reset was requested for your account.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Use this OTP to reset your ${brand.platformName} password.`,
        '',
        ...otpBlock.textLines
      ])
    };
  },
  'store.customer_password_reset_otp': async ({ brand, templateData }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const otp = sanitizeDisplayValue(templateData.otp || '', 12);
    const expiresInMinutes = Math.max(1, Number(templateData.expires_in_minutes) || 15);
    const otpBlock = renderOtpCallout({
      brand,
      otp,
      expiresInMinutes,
      audienceLabel: 'Password reset code'
    });

    return {
      subject: `Your ${brand.storeName} password reset OTP`,
      html: renderShell({
        brand,
        preheader: `Use this OTP to reset your ${brand.storeName} account password.`,
        eyebrow: `${brand.storeName} account`,
        title: 'Reset your password',
        intro: `Hi ${name}, use the code below to reset your password for ${brand.storeName}.`,
        bodyHtml: otpBlock.bodyHtml,
        footerNote: 'This transactional email was sent because a password reset was requested for your customer account.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Use this OTP to reset your ${brand.storeName} password.`,
        '',
        ...otpBlock.textLines
      ])
    };
  }
};

const renderEmailTemplate = async ({
  config,
  smtpConfig,
  requestId,
  templateKey,
  templateData = {},
  brand = {},
  storeId = null
}) => {
  const definition = getEmailTemplateDefinition(templateKey);
  if (!definition) {
    const error = new Error(`Unknown email template: ${templateKey}`);
    error.status = 404;
    throw error;
  }

  if (definition.status !== TEMPLATE_STATUS.IMPLEMENTED) {
    const error = new Error(`Email template ${templateKey} is cataloged but not implemented yet.`);
    error.status = 501;
    throw error;
  }

  const renderer = templateRenderers[definition.key];
  if (!renderer) {
    const error = new Error(`Email template ${templateKey} does not have a renderer.`);
    error.status = 501;
    throw error;
  }

  const resolvedBrand = definition.brand_mode === 'store'
    ? await resolveStoreBrand({ config, requestId, smtpConfig, storeId, brand })
    : resolvePlatformBrand({ config, smtpConfig, brand, templateData });

  const rendered = await renderer({
    definition,
    templateData,
    brand: resolvedBrand,
    config
  });

  return {
    ...rendered,
    definition,
    brand: resolvedBrand
  };
};

module.exports = {
  renderEmailTemplate
};
