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
const DEFAULT_PANEL_BACKGROUND = '#FFFFFF';

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

const hasContent = (value) => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'boolean') {
    return true;
  }

  return Boolean(String(value).trim());
};

const sanitizeDisplayValue = (value, maxLength = 160, fallback = '') => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : fallback;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

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

const normalizeArray = (value) => {
  return Array.isArray(value) ? value : [];
};

const titleCase = (value = '') => {
  return sanitizeDisplayValue(value, 120)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(' ');
};

const formatMoney = (amount, currency = 'USD') => {
  const safeAmount = Number(amount || 0);
  const safeCurrency = sanitizeDisplayValue(currency || 'USD', 10, 'USD').toUpperCase();

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2
    }).format(safeAmount);
  } catch {
    return `${safeCurrency} ${safeAmount.toFixed(2)}`;
  }
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'TBD';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

const formatDateOnly = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'TBD';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long'
  }).format(date);
};

const formatAddress = (value) => {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return sanitizeDisplayValue(value, 320);
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }

  return [
    value.name,
    value.line1 || value.address_line_1,
    value.line2 || value.address_line_2,
    [value.city, value.state || value.region].filter(Boolean).join(', '),
    value.postal_code || value.zip || value.zip_code,
    value.country
  ]
    .map((entry) => sanitizeDisplayValue(entry, 120))
    .filter(Boolean)
    .join(', ');
};

const normalizeLineItems = (items = []) => {
  return normalizeArray(items)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const quantity = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Number(item.unit_price ?? item.price ?? item.price_at_time ?? 0);
      const total = Number(item.total ?? item.line_total ?? unitPrice * quantity);
      const name = sanitizeDisplayValue(item.name || item.title || item.product_name || 'Item', 180, 'Item');
      const variant = sanitizeDisplayValue(item.variant || item.sku || item.note || '', 160);

      return {
        name,
        variant,
        quantity,
        unitPrice,
        total
      };
    })
    .filter(Boolean);
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

const defaultPlatformPath = (config, path = '/dashboard') => {
  return joinUrl(config.webAppUrl, path);
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

const renderActionButtons = (actions = [], brand) => {
  const safeActions = normalizeArray(actions)
    .map((action) => {
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        return null;
      }

      const label = sanitizeDisplayValue(action.label || '', 60);
      const href = sanitizeOptionalUrl(action.href || '');
      const tone = sanitizeDisplayValue(action.tone || 'primary', 20, 'primary').toLowerCase();
      if (!label || !href) {
        return null;
      }

      return { label, href, tone };
    })
    .filter(Boolean);

  if (!safeActions.length) {
    return '';
  }

  return `
    <div style="margin:0 0 24px">
      ${safeActions.map((action) => {
        const isPrimary = action.tone !== 'secondary';
        return `
          <a
            href="${action.href}"
            style="display:inline-block;margin:0 12px 12px 0;padding:13px 18px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:700;color:${isPrimary ? '#ffffff' : brand.primaryColor};background:${isPrimary ? brand.primaryColor : withAlpha(brand.primaryColor, 0.08)};border:1px solid ${withAlpha(brand.primaryColor, isPrimary ? 0.18 : 0.22)}"
          >${action.label}</a>
        `.trim();
      }).join('')}
    </div>
  `.trim();
};

const renderNotice = ({ brand, title, body, tone = 'primary' }) => {
  const safeTitle = sanitizeDisplayValue(title, 90);
  const safeBody = sanitizeDisplayValue(body, 420);
  const noticeColor = tone === 'warning'
    ? '#B45309'
    : tone === 'danger'
      ? '#BE123C'
      : tone === 'success'
        ? '#15803D'
        : brand.primaryColor;

  return `
    <div style="margin:24px 0 0;border-radius:22px;background:${withAlpha(noticeColor, 0.08)};border:1px solid ${withAlpha(noticeColor, 0.18)};padding:18px 20px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${noticeColor}">${safeTitle}</p>
      <p style="margin:0;font-size:15px;line-height:1.7;color:${DEFAULT_TEXT_COLOR}">${safeBody}</p>
    </div>
  `.trim();
};

const renderKeyValueRows = (items = []) => {
  const safeItems = normalizeArray(items)
    .map((item) => {
      const label = sanitizeDisplayValue(item?.label || '', 80);
      const value = sanitizeDisplayValue(item?.value || item?.value === 0 ? item.value : '', 240);
      if (!label || !value) {
        return null;
      }

      return { label, value };
    })
    .filter(Boolean);

  if (!safeItems.length) {
    return '';
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
      ${safeItems.map((item, index) => `
        <tr>
          <td style="padding:${index === 0 ? '0' : '14px 0 0'}">
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${DEFAULT_MUTED_TEXT_COLOR}">${item.label}</p>
            <p style="margin:0;font-size:15px;line-height:1.65;color:${DEFAULT_TEXT_COLOR};font-weight:600">${item.value}</p>
          </td>
        </tr>
      `).join('')}
    </table>
  `.trim();
};

const renderPanel = ({ brand, title, bodyHtml, eyebrow = '' }) => {
  const safeTitle = sanitizeDisplayValue(title, 120);
  const safeEyebrow = sanitizeDisplayValue(eyebrow, 60);
  if (!bodyHtml) {
    return '';
  }

  return `
    <div style="margin:24px 0 0;border-radius:24px;background:${DEFAULT_PANEL_BACKGROUND};border:1px solid ${withAlpha(brand.primaryColor, 0.12)};padding:22px">
      ${safeEyebrow ? `<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${brand.primaryColor};font-weight:700">${safeEyebrow}</p>` : ''}
      ${safeTitle ? `<h2 style="margin:0 0 14px;font-size:18px;line-height:1.35;color:${DEFAULT_TEXT_COLOR}">${safeTitle}</h2>` : ''}
      ${bodyHtml}
    </div>
  `.trim();
};

const renderBulletList = (items = []) => {
  const safeItems = normalizeArray(items)
    .map((item) => sanitizeDisplayValue(item, 220))
    .filter(Boolean);

  if (!safeItems.length) {
    return '';
  }

  return `
    <ul style="margin:0;padding:0 0 0 20px">
      ${safeItems.map((item) => `
        <li style="margin:0 0 12px;font-size:15px;line-height:1.7;color:${DEFAULT_TEXT_COLOR}">${item}</li>
      `).join('')}
    </ul>
  `.trim();
};

const renderHighlightCards = (cards = [], brand) => {
  const safeCards = normalizeArray(cards)
    .map((card) => {
      if (!card || typeof card !== 'object' || Array.isArray(card)) {
        return null;
      }

      const label = sanitizeDisplayValue(card.label || '', 60);
      const value = sanitizeDisplayValue(card.value || card.value === 0 ? card.value : '', 160);
      const note = sanitizeDisplayValue(card.note || '', 220);
      if (!label || !value) {
        return null;
      }

      return { label, value, note };
    })
    .filter(Boolean);

  if (!safeCards.length) {
    return '';
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0 12px">
      <tr>
        ${safeCards.map((card) => `
          <td style="vertical-align:top;width:${Math.floor(100 / safeCards.length)}%;padding-right:12px">
            <div style="border-radius:22px;background:${withAlpha(brand.primaryColor, 0.08)};border:1px solid ${withAlpha(brand.primaryColor, 0.16)};padding:18px;min-height:110px">
              <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${brand.primaryColor}">${card.label}</p>
              <p style="margin:0;font-size:20px;line-height:1.3;color:${DEFAULT_TEXT_COLOR};font-weight:700">${card.value}</p>
              ${card.note ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:${DEFAULT_MUTED_TEXT_COLOR}">${card.note}</p>` : ''}
            </div>
          </td>
        `).join('')}
      </tr>
    </table>
  `.trim();
};

const renderLineItems = (items = [], currency = 'USD', brand) => {
  const safeItems = normalizeLineItems(items);
  if (!safeItems.length) {
    return '';
  }

  return renderPanel({
    brand,
    title: 'Items in this email',
    eyebrow: 'Order summary',
    bodyHtml: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
        ${safeItems.map((item, index) => `
          <tr>
            <td style="padding:${index === 0 ? '0 0 14px' : '14px 0'};border-top:${index === 0 ? '0' : `1px solid ${withAlpha(brand.primaryColor, 0.12)}`}">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="vertical-align:top;padding-right:12px">
                    <p style="margin:0;font-size:15px;line-height:1.6;color:${DEFAULT_TEXT_COLOR};font-weight:700">${item.name}</p>
                    ${item.variant ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.6;color:${DEFAULT_MUTED_TEXT_COLOR}">${item.variant}</p>` : ''}
                    <p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${DEFAULT_MUTED_TEXT_COLOR}">Qty ${item.quantity} at ${formatMoney(item.unitPrice, currency)}</p>
                  </td>
                  <td align="right" style="vertical-align:top">
                    <p style="margin:0;font-size:15px;line-height:1.6;color:${DEFAULT_TEXT_COLOR};font-weight:700">${formatMoney(item.total, currency)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        `).join('')}
      </table>
    `
  });
};

const renderAddressPanel = ({ brand, address, title }) => {
  const formattedAddress = formatAddress(address);
  if (!formattedAddress) {
    return '';
  }

  return renderPanel({
    brand,
    title: title || 'Delivery details',
    eyebrow: 'Address',
    bodyHtml: `<p style="margin:0;font-size:15px;line-height:1.8;color:${DEFAULT_TEXT_COLOR}">${formattedAddress}</p>`
  });
};

const normalizeCouponSummary = (coupon = null) => {
  if (!coupon || typeof coupon !== 'object' || Array.isArray(coupon)) {
    return null;
  }

  const code = sanitizeDisplayValue(coupon.code || '', 40);
  const description = sanitizeDisplayValue(coupon.description || '', 180);
  if (!code && !description) {
    return null;
  }

  return {
    code,
    description
  };
};

const buildOrderTotalsRows = (templateData = {}) => {
  const currency = templateData.currency || 'USD';
  const rows = [];
  const coupon = normalizeCouponSummary(
    templateData.coupon || (templateData.coupon_code ? { code: templateData.coupon_code } : null)
  );
  const discountTotal = Number(templateData.discount_total || 0);

  if (hasContent(templateData.subtotal)) {
    rows.push({
      label: 'Subtotal',
      value: formatMoney(templateData.subtotal || 0, currency)
    });
  }

  if (discountTotal > 0) {
    rows.push({
      label: coupon?.code ? `Discount (${coupon.code})` : 'Discount',
      value: `-${formatMoney(discountTotal, currency)}`
    });
  }

  rows.push({
    label: 'Total',
    value: formatMoney(templateData.amount ?? templateData.total ?? 0, currency)
  });

  return {
    rows,
    coupon
  };
};

const renderOrderTotalsPanel = ({ brand, templateData, title = 'Pricing summary', eyebrow = 'Totals' }) => {
  const { rows, coupon } = buildOrderTotalsRows(templateData);
  if (!rows.length) {
    return '';
  }

  return renderPanel({
    brand,
    title,
    eyebrow,
    bodyHtml: `
      ${renderKeyValueRows(rows)}
      ${coupon?.description ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:${DEFAULT_MUTED_TEXT_COLOR}">${coupon.description}</p>` : ''}
    `
  });
};

const buildOrderTotalsTextLines = (templateData = {}) => {
  const { rows, coupon } = buildOrderTotalsRows(templateData);
  return rows.map((row) => `${row.label}: ${row.value}`)
    .concat(coupon?.description ? [`Coupon note: ${coupon.description}`] : []);
};

const renderCustomerSummaryPanel = ({ brand, customer, title = 'Customer details', eyebrow = 'Customer' }) => {
  if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
    return '';
  }

  const rows = [
    { label: 'Name', value: sanitizeDisplayValue(customer.name || '', 140) },
    { label: 'Email', value: sanitizeDisplayValue(customer.email || '', 180) },
    { label: 'Phone', value: sanitizeDisplayValue(customer.phone || '', 60) }
  ].filter((entry) => entry.value);

  if (!rows.length) {
    return '';
  }

  return renderPanel({
    brand,
    title,
    eyebrow,
    bodyHtml: renderKeyValueRows(rows)
  });
};

const renderShell = ({ brand, preheader, eyebrow, title, intro, bodyHtml, footerNote, actions = [] }) => {
  const safePreheader = sanitizeDisplayValue(preheader, 180);
  const safeEyebrow = sanitizeDisplayValue(eyebrow, 80);
  const safeTitle = sanitizeDisplayValue(title, 140);
  const safeIntro = sanitizeDisplayValue(intro, 320);
  const safeFooterNote = sanitizeDisplayValue(footerNote, 260);

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
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;border-collapse:collapse">
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
                    <p style="margin:0 0 24px;font-size:16px;line-height:1.75;color:${DEFAULT_MUTED_TEXT_COLOR}">${safeIntro}</p>
                    ${renderActionButtons(actions, brand)}
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

const renderOtpEmail = ({
  brand,
  templateData,
  subject,
  preheader,
  eyebrow,
  intro,
  footerNote
}) => {
  const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
  const otp = sanitizeDisplayValue(templateData.otp || '', 12);
  const expiresInMinutes = Math.max(1, Number(templateData.expires_in_minutes) || 15);
  const codeLabel = sanitizeDisplayValue(templateData.code_label || 'Verification code', 40, 'Verification code');
  const codePanel = `
    <div style="border-radius:24px;background:${withAlpha(brand.primaryColor, 0.08)};padding:24px;border:1px solid ${withAlpha(brand.primaryColor, 0.18)}">
      <p style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${brand.primaryColor}">${codeLabel}</p>
      <p style="margin:0;font-size:40px;line-height:1.1;font-weight:700;letter-spacing:0.28em;color:${brand.primaryColor}">${otp}</p>
    </div>
  `.trim();

  return {
    subject,
    html: renderShell({
      brand,
      preheader,
      eyebrow,
      title: 'Use this code to continue',
      intro: `Hi ${name}, ${intro}`,
      bodyHtml: `
        ${codePanel}
        ${renderNotice({
          brand,
          title: 'Expires soon',
          body: `This code expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? '' : 's'}. If you did not request it, you can safely ignore this email.`,
          tone: 'warning'
        })}
      `,
      footerNote
    }),
    text: buildTextBlock([
      `Hi ${name},`,
      '',
      intro,
      '',
      `${codeLabel}: ${otp}`,
      '',
      `This code expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? '' : 's'}.`,
      'If you did not request it, you can safely ignore this email.'
    ])
  };
};

const renderLoginAlertEmail = ({
  brand,
  templateData,
  subject,
  eyebrow,
  intro,
  audienceLabel,
  resetUrl
}) => {
  const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
  const signedInAt = formatDateTime(templateData.signed_in_at);
  const details = [
    { label: 'Account', value: audienceLabel },
    { label: 'Device', value: sanitizeDisplayValue(templateData.device || 'Unknown device', 120, 'Unknown device') },
    { label: 'Location', value: sanitizeDisplayValue(templateData.location || 'Unknown location', 120, 'Unknown location') },
    { label: 'IP address', value: sanitizeDisplayValue(templateData.ip_address || 'Unknown IP', 80, 'Unknown IP') },
    { label: 'Signed in at', value: signedInAt }
  ];

  return {
    subject,
    html: renderShell({
      brand,
      preheader: `We noticed a recent sign-in to your ${audienceLabel.toLowerCase()}.`,
      eyebrow,
      title: 'New sign-in detected',
      intro: `Hi ${name}, ${intro}`,
      actions: [{
        label: 'Secure my account',
        href: sanitizeOptionalUrl(resetUrl),
        tone: 'primary'
      }],
      bodyHtml: `
        ${renderPanel({
          brand,
          title: 'What we saw',
          eyebrow: 'Security details',
          bodyHtml: renderKeyValueRows(details)
        })}
        ${renderNotice({
          brand,
          title: 'If this was you',
          body: 'You do not need to do anything. If you do not recognize this activity, reset your password right away and review recent account changes.',
          tone: 'danger'
        })}
      `,
      footerNote: 'This security email is part of our effort to keep your account safe.'
    }),
    text: buildTextBlock([
      `Hi ${name},`,
      '',
      intro,
      '',
      ...details.map((entry) => `${entry.label}: ${entry.value}`),
      '',
      'If this was you, no action is needed.',
      `If it was not, secure your account now: ${resetUrl}`
    ])
  };
};

const renderWelcomeEmail = ({
  brand,
  templateData,
  subject,
  eyebrow,
  title,
  intro,
  actions,
  highlights,
  checklist,
  footerNote
}) => {
  const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
  return {
    subject,
    html: renderShell({
      brand,
      preheader: title,
      eyebrow,
      title,
      intro: `Hi ${name}, ${intro}`,
      actions,
      bodyHtml: `
        ${renderHighlightCards(highlights, brand)}
        ${renderPanel({
          brand,
          title: 'What to do next',
          eyebrow: 'Suggested next steps',
          bodyHtml: renderBulletList(checklist)
        })}
      `,
      footerNote
    }),
    text: buildTextBlock([
      `Hi ${name},`,
      '',
      intro,
      '',
      ...highlights.map((entry) => `${entry.label}: ${entry.value}${entry.note ? ` - ${entry.note}` : ''}`),
      '',
      'Next steps:',
      ...checklist.map((item, index) => `${index + 1}. ${item}`)
    ])
  };
};

const templateRenderers = {
  'platform.password_reset_otp': async ({ brand, templateData }) => {
    return renderOtpEmail({
      brand,
      templateData,
      subject: `Your ${brand.platformName} password reset OTP`,
      preheader: `Use this OTP to reset your ${brand.platformName} password.`,
      eyebrow: 'Account security',
      intro: `use the code below to reset your ${brand.platformName} password.`,
      footerNote: 'This transactional email was sent because a password reset was requested for your account.'
    });
  },
  'platform.owner_email_verification_otp': async ({ brand, templateData }) => {
    return renderOtpEmail({
      brand,
      templateData: {
        ...templateData,
        code_label: 'Email verification code'
      },
      subject: `Verify your ${brand.platformName} email address`,
      preheader: `Use this code to verify your ${brand.platformName} account email.`,
      eyebrow: 'Email verification',
      intro: `use the code below to confirm the email address connected to your ${brand.platformName} owner account.`,
      footerNote: 'Verifying your email helps protect sensitive billing and store management actions.'
    });
  },
  'platform.owner_welcome': async ({ brand, templateData, config }) => {
    const dashboardUrl = sanitizeOptionalUrl(templateData.dashboard_url || defaultPlatformPath(config, '/dashboard'));
    const createStoreUrl = sanitizeOptionalUrl(templateData.create_store_url || defaultPlatformPath(config, '/dashboard'));
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const storeName = sanitizeDisplayValue(templateData.store_name || brand.storeName || '', 150);

    return renderWelcomeEmail({
      brand,
      templateData,
      subject: `Welcome to ${brand.platformName}`,
      eyebrow: 'Owner onboarding',
      title: 'Your commerce workspace is ready',
      intro: `your owner account is active and you can now set up billing, create your first store, and prepare your brand for launch${storeName ? ` with ${storeName}` : ''}.`,
      actions: [
        { label: 'Open dashboard', href: dashboardUrl, tone: 'primary' },
        { label: 'Create a store', href: createStoreUrl, tone: 'secondary' }
      ],
      highlights: [
        { label: 'Workspace', value: brand.platformName, note: 'Your operations home for stores, billing, and growth.' },
        { label: 'Launch goal', value: storeName || 'Create your first store', note: 'Start with branding, catalog, and storefront setup.' },
        { label: 'Billing', value: 'Trial-first onboarding', note: 'Add a payment method so billing and store creation stay unblocked.' }
      ],
      checklist: [
        'Add a payment method and activate the trial workflow.',
        'Create your first store and upload its logo, color, and theme.',
        'Review compliance details early so operations stay smooth as you grow.'
      ],
      footerNote: `You can return to ${brand.platformName} at any time from ${dashboardUrl || brand.websiteUrl || billingUrl}.`
    });
  },
  'platform.owner_login_alert': async ({ brand, templateData, config }) => {
    const resetUrl = sanitizeOptionalUrl(templateData.reset_password_url || defaultPlatformPath(config, '/forgot-password'));
    return renderLoginAlertEmail({
      brand,
      templateData,
      subject: `New sign-in to your ${brand.platformName} account`,
      eyebrow: 'Security alert',
      intro: `we noticed a recent sign-in to your ${brand.platformName} owner workspace.`,
      audienceLabel: `${brand.platformName} owner account`,
      resetUrl
    });
  },
  'platform.store_created': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const storeName = sanitizeDisplayValue(templateData.store_name || brand.storeName || 'Your store', 150, 'Your store');
    const storeUrl = sanitizeOptionalUrl(templateData.store_url || '');
    const adminUrl = sanitizeOptionalUrl(templateData.admin_url || defaultPlatformPath(config, '/dashboard'));
    const domain = sanitizeDisplayValue(templateData.custom_domain || templateData.subdomain || '', 160);

    return {
      subject: `${storeName} is live in ${brand.platformName}`,
      html: renderShell({
        brand,
        preheader: `${storeName} has been created successfully.`,
        eyebrow: 'Store launch',
        title: 'Your store has been created',
        intro: `Hi ${name}, ${storeName} is now set up inside ${brand.platformName}. You can move straight into branding, catalog work, checkout setup, and launch preparation.`,
        actions: [
          { label: 'Manage store', href: adminUrl, tone: 'primary' },
          ...(storeUrl ? [{ label: 'Preview storefront', href: storeUrl, tone: 'secondary' }] : [])
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Store name', value: storeName, note: 'This is the storefront identity customers will see.' },
            { label: 'Public URL', value: storeUrl || domain || 'Configured in dashboard', note: 'Use this link to preview the customer experience.' },
            { label: 'Workspace', value: brand.platformName, note: 'Manage products, orders, settings, and brand presentation here.' }
          ], brand)}
          ${renderPanel({
            brand,
            title: 'Recommended setup sequence',
            eyebrow: 'Next actions',
            bodyHtml: renderBulletList([
              'Upload your final logo and confirm your theme color.',
              'Add products, pricing, and inventory before sharing the storefront.',
              'Review support email, domain settings, and payment configuration.'
            ])
          })}
        `,
        footerNote: 'This message confirms the store provisioning workflow completed successfully.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `${storeName} has been created successfully in ${brand.platformName}.`,
        '',
        `Manage store: ${adminUrl}`,
        ...(storeUrl ? [`Preview storefront: ${storeUrl}`] : []),
        '',
        'Recommended next steps:',
        '1. Upload your logo and confirm store colors.',
        '2. Add products and inventory.',
        '3. Review support, domain, and payment settings.'
      ])
    };
  },
  'platform.subscription_trial_started': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const planName = sanitizeDisplayValue(templateData.plan_name || templateData.plan || 'Launch plan', 80, 'Launch plan');
    const trialEndsAt = formatDateOnly(templateData.trial_ends_at);
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const amount = hasContent(templateData.amount) ? formatMoney(templateData.amount, templateData.currency || 'USD') : '';

    return {
      subject: `Your ${brand.platformName} trial has started`,
      html: renderShell({
        brand,
        preheader: `Your free trial for ${planName} is active.`,
        eyebrow: 'Trial activated',
        title: 'Your free trial is now active',
        intro: `Hi ${name}, your ${planName} trial is active and your workspace is ready for store setup, product onboarding, and launch preparation.`,
        actions: [
          { label: 'Open billing', href: billingUrl, tone: 'primary' },
          { label: 'Open dashboard', href: billingUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Plan', value: planName, note: 'You can review or change it from billing later.' },
            { label: 'Trial ends', value: trialEndsAt, note: 'We will remind you before billing begins.' },
            { label: 'Next charge', value: amount || 'Based on your selected plan', note: amount ? 'This is the amount that will apply after the trial.' : 'Your selected plan amount will apply after the trial.' }
          ], brand)}
          ${renderNotice({
            brand,
            title: 'What happens next',
            body: 'Use the trial window to create your store, finalize branding, and test checkout flows. If you decide to continue, billing will begin automatically at the end of the trial.',
            tone: 'success'
          })}
        `,
        footerNote: 'This email confirms your payment method was verified successfully for the trial setup.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your ${planName} trial is now active in ${brand.platformName}.`,
        `Trial ends: ${trialEndsAt}`,
        ...(amount ? [`Next charge: ${amount}`] : []),
        '',
        `Open billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_trial_ending': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const planName = sanitizeDisplayValue(templateData.plan_name || 'Your plan', 80, 'Your plan');
    const trialEndsAt = formatDateOnly(templateData.trial_ends_at);
    const amount = formatMoney(templateData.amount || 0, templateData.currency || 'USD');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));

    return {
      subject: `Your ${brand.platformName} trial ends on ${trialEndsAt}`,
      html: renderShell({
        brand,
        preheader: `Your ${planName} trial is ending soon.`,
        eyebrow: 'Trial reminder',
        title: 'Your free trial is ending soon',
        intro: `Hi ${name}, your ${planName} trial is scheduled to end on ${trialEndsAt}. If you continue, billing will begin automatically using your saved payment method.`,
        actions: [
          { label: 'Review billing', href: billingUrl, tone: 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Upcoming billing details',
            eyebrow: 'Billing summary',
            bodyHtml: renderKeyValueRows([
              { label: 'Plan', value: planName },
              { label: 'Trial ends', value: trialEndsAt },
              { label: 'Upcoming charge', value: amount }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Before the trial ends',
            body: 'Now is a good time to review your plan, update payment details if needed, and confirm the store setup you want to keep active after the trial window closes.',
            tone: 'warning'
          })}
        `,
        footerNote: 'We are sending this reminder early so billing never feels surprising.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your ${planName} trial ends on ${trialEndsAt}.`,
        `Upcoming charge: ${amount}`,
        '',
        `Review billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_trial_ended': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const statusLabel = titleCase(templateData.status || 'ended');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));

    return {
      subject: `Your ${brand.platformName} trial has ended`,
      html: renderShell({
        brand,
        preheader: `Your trial period has ended.`,
        eyebrow: 'Trial ended',
        title: 'Your trial has ended',
        intro: `Hi ${name}, your trial period has ended and your subscription is now marked as ${statusLabel.toLowerCase()}. Review billing to decide the next step for your workspace.`,
        actions: [
          { label: 'Open billing', href: billingUrl, tone: 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Current state',
            eyebrow: 'Subscription status',
            bodyHtml: renderKeyValueRows([
              { label: 'Status', value: statusLabel },
              { label: 'Workspace', value: brand.platformName }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'What to do now',
            body: 'If you want to keep using the platform without interruption, review your billing settings and complete the next payment step as soon as possible.',
            tone: 'warning'
          })}
        `,
        footerNote: 'This email is meant to keep you ahead of any access or billing surprises.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your trial has ended and your subscription is now ${statusLabel.toLowerCase()}.`,
        `Open billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_invoice_created': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const invoiceId = sanitizeDisplayValue(templateData.invoice_id || 'Pending', 60, 'Pending');
    const description = sanitizeDisplayValue(templateData.description || 'Subscription invoice', 180, 'Subscription invoice');

    return {
      subject: `New ${brand.platformName} subscription invoice ${invoiceId}`,
      html: renderShell({
        brand,
        preheader: `A new subscription invoice is available.`,
        eyebrow: 'Billing invoice',
        title: 'A new invoice is ready',
        intro: `Hi ${name}, a new subscription invoice has been created for your workspace. Review the details below and complete payment if action is needed.`,
        actions: [
          { label: 'Open billing', href: billingUrl, tone: 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: description,
            eyebrow: 'Invoice summary',
            bodyHtml: renderKeyValueRows([
              { label: 'Invoice ID', value: invoiceId },
              { label: 'Amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD') },
              { label: 'Due date', value: formatDateOnly(templateData.due_at || templateData.period_end) },
              { label: 'Plan', value: sanitizeDisplayValue(templateData.plan_name || templateData.plan || '', 80) || 'Subscription plan' }
            ])
          })}
        `,
        footerNote: 'Use the billing workspace to review invoice history and payment status.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        'A new subscription invoice is ready.',
        `Invoice ID: ${invoiceId}`,
        `Amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        `Due date: ${formatDateOnly(templateData.due_at || templateData.period_end)}`,
        '',
        `Open billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_invoice_paid': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const invoiceId = sanitizeDisplayValue(templateData.invoice_id || 'Paid invoice', 60, 'Paid invoice');
    const stage = sanitizeDisplayValue(templateData.stage || '', 80).toLowerCase();
    const title = stage.includes('renewal')
      ? 'Your renewal payment succeeded'
      : stage.includes('trial')
        ? 'Your post-trial payment succeeded'
        : 'Your payment receipt is ready';

    return {
      subject: `${brand.platformName} payment received for invoice ${invoiceId}`,
      html: renderShell({
        brand,
        preheader: `We received payment for invoice ${invoiceId}.`,
        eyebrow: 'Payment receipt',
        title,
        intro: `Hi ${name}, we received your payment and updated the invoice record for your workspace.`,
        actions: [
          { label: 'View billing', href: billingUrl, tone: 'primary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Amount paid', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD'), note: 'Processed successfully.' },
            { label: 'Invoice ID', value: invoiceId, note: sanitizeDisplayValue(templateData.plan_name || templateData.plan || 'Subscription invoice', 80) },
            { label: 'Paid at', value: formatDateTime(templateData.paid_at), note: sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Payment reference available in billing.' }
          ], brand)}
          ${renderPanel({
            brand,
            title: 'What this means',
            eyebrow: 'Account status',
            bodyHtml: renderBulletList([
              'Your billing record has been updated successfully.',
              'You can review invoice history and current subscription details in the dashboard.',
              'If this was a renewal payment, your next billing cycle has already been advanced.'
            ])
          })}
        `,
        footerNote: 'Keep this email for your records if you reconcile subscription charges manually.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Payment received for invoice ${invoiceId}.`,
        `Amount paid: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        `Paid at: ${formatDateTime(templateData.paid_at)}`,
        `Reference: ${sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Available in billing'}`,
        '',
        `View billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_payment_failed': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const stage = sanitizeDisplayValue(templateData.stage || '', 80).toLowerCase();
    const failureTitle = stage.includes('trial')
      ? 'We could not verify your payment method'
      : 'We could not process your subscription payment';

    return {
      subject: `Action needed: ${brand.platformName} payment failed`,
      html: renderShell({
        brand,
        preheader: failureTitle,
        eyebrow: 'Billing issue',
        title: failureTitle,
        intro: `Hi ${name}, we attempted to process a billing step for your workspace but the payment did not go through.`,
        actions: [
          { label: 'Update billing', href: billingUrl, tone: 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Payment details',
            eyebrow: 'Attempt summary',
            bodyHtml: renderKeyValueRows([
              { label: 'Amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD') },
              { label: 'Invoice ID', value: sanitizeDisplayValue(templateData.invoice_id || '', 60) || 'Not available yet' },
              { label: 'Reference', value: sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Not available yet' },
              { label: 'Plan', value: sanitizeDisplayValue(templateData.plan_name || templateData.plan || '', 80) || 'Subscription plan' }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Next step',
            body: 'Review your billing details, confirm the payment method is still valid, and retry as soon as possible so your workspace remains uninterrupted.',
            tone: 'danger'
          })}
        `,
        footerNote: 'We send this alert immediately because failed subscription billing can affect store operations.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `${failureTitle}.`,
        `Amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        `Invoice ID: ${sanitizeDisplayValue(templateData.invoice_id || '', 60) || 'Not available yet'}`,
        '',
        `Update billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_renewed': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));
    const planName = sanitizeDisplayValue(templateData.plan_name || 'Subscription', 80, 'Subscription');

    return {
      subject: `Your ${brand.platformName} subscription renewed successfully`,
      html: renderShell({
        brand,
        preheader: `${planName} renewed successfully.`,
        eyebrow: 'Renewal confirmed',
        title: 'Your subscription has renewed',
        intro: `Hi ${name}, your ${planName} subscription renewed successfully and your next service period is already active.`,
        actions: [{ label: 'Open billing', href: billingUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Plan', value: planName, note: 'Still active and ready to use.' },
            { label: 'Next period ends', value: formatDateOnly(templateData.current_period_end), note: 'This is the next billing boundary we have on file.' },
            { label: 'Amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD'), note: 'Recorded in your invoice history.' }
          ], brand)}
        `,
        footerNote: 'You can review invoice history and plan details from the billing area at any time.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your ${planName} subscription renewed successfully.`,
        `Next period ends: ${formatDateOnly(templateData.current_period_end)}`,
        '',
        `Open billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_cancellation_scheduled': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));

    return {
      subject: `${brand.platformName} cancellation scheduled`,
      html: renderShell({
        brand,
        preheader: `Your subscription will end at the close of the current period.`,
        eyebrow: 'Cancellation scheduled',
        title: 'Cancellation has been scheduled',
        intro: `Hi ${name}, we have recorded your cancellation request. Your workspace will remain active until the current billing period ends.`,
        actions: [{ label: 'Review billing', href: billingUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Cancellation timing',
            eyebrow: 'Billing timeline',
            bodyHtml: renderKeyValueRows([
              { label: 'Current access through', value: formatDateOnly(templateData.current_period_end) },
              { label: 'Plan', value: sanitizeDisplayValue(templateData.plan_name || templateData.plan || '', 80) || 'Subscription plan' }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Need to stay active?',
            body: 'If you change your mind before the current period ends, review your billing workspace and update the subscription state before access expires.',
            tone: 'warning'
          })}
        `,
        footerNote: 'This message confirms we received the cancellation request for your subscription.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        'Your subscription cancellation has been scheduled.',
        `Current access through: ${formatDateOnly(templateData.current_period_end)}`,
        '',
        `Review billing: ${billingUrl}`
      ])
    };
  },
  'platform.subscription_cancelled': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const billingUrl = sanitizeOptionalUrl(templateData.billing_url || defaultPlatformPath(config, '/dashboard'));

    return {
      subject: `Your ${brand.platformName} subscription is cancelled`,
      html: renderShell({
        brand,
        preheader: `Your subscription is now cancelled.`,
        eyebrow: 'Subscription closed',
        title: 'Your subscription is cancelled',
        intro: `Hi ${name}, your subscription is now cancelled and billing for that plan has stopped.`,
        actions: [{ label: 'View billing history', href: billingUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Cancellation record',
            eyebrow: 'Status summary',
            bodyHtml: renderKeyValueRows([
              { label: 'Cancelled at', value: formatDateTime(templateData.cancelled_at) },
              { label: 'Plan', value: sanitizeDisplayValue(templateData.plan_name || templateData.plan || '', 80) || 'Subscription plan' }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Need access again later?',
            body: `You can return to ${brand.platformName} in the future and reactivate a plan when you're ready.`,
            tone: 'primary'
          })}
        `,
        footerNote: 'We recommend keeping this email if you reconcile billing or cancellations manually.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your ${brand.platformName} subscription is now cancelled.`,
        `Cancelled at: ${formatDateTime(templateData.cancelled_at)}`,
        '',
        `Billing history: ${billingUrl}`
      ])
    };
  },
  'platform.compliance_status_changed': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const statusLabel = titleCase(templateData.status || 'pending');
    const targetType = titleCase(templateData.target_type || 'compliance');
    const complianceUrl = sanitizeOptionalUrl(templateData.compliance_url || defaultPlatformPath(config, '/dashboard'));

    return {
      subject: `${brand.platformName} compliance update: ${statusLabel}`,
      html: renderShell({
        brand,
        preheader: `Your compliance status changed to ${statusLabel.toLowerCase()}.`,
        eyebrow: 'Compliance review',
        title: 'There is a compliance status update',
        intro: `Hi ${name}, your ${targetType} review status is now ${statusLabel.toLowerCase()}. Please review the update and take any follow-up action if required.`,
        actions: [{ label: 'Review dashboard', href: complianceUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: `${targetType} review`,
            eyebrow: 'Review outcome',
            bodyHtml: renderKeyValueRows([
              { label: 'Status', value: statusLabel },
              { label: 'Target', value: targetType },
              { label: 'Store', value: sanitizeDisplayValue(templateData.store_name || '', 150) || 'Owner-level review' }
            ])
          })}
          ${templateData.review_notes ? renderNotice({
            brand,
            title: 'Reviewer note',
            body: sanitizeDisplayValue(templateData.review_notes, 420),
            tone: statusLabel.toLowerCase() === 'approved' ? 'success' : 'warning'
          }) : ''}
        `,
        footerNote: 'Compliance outcomes can affect onboarding and platform access, so we send them immediately.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your ${targetType} review status is now ${statusLabel}.`,
        ...(templateData.review_notes ? [`Reviewer note: ${sanitizeDisplayValue(templateData.review_notes, 420)}`] : []),
        '',
        `Review dashboard: ${complianceUrl}`
      ])
    };
  },
  'store.owner_order_pending': async ({ brand, templateData, config }) => {
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Pending', 60, 'Pending');
    const customerName = sanitizeDisplayValue(templateData.customer?.name || templateData.name || 'Customer', 140, 'Customer');
    const adminOrderUrl = sanitizeOptionalUrl(templateData.admin_order_url || joinUrl(config.webAppUrl, '/dashboard'));
    const adminOrdersUrl = sanitizeOptionalUrl(templateData.admin_orders_url || joinUrl(config.webAppUrl, '/dashboard'));
    const lineItems = normalizeLineItems(templateData.items);

    return {
      subject: `New pending order at ${brand.storeName}: ${orderId}`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} needs review in the store workspace.`,
        eyebrow: 'Order alert',
        title: 'A new order just came in',
        intro: `A customer placed a new order at ${brand.storeName}. Review the order details, confirm the payment state, and keep fulfillment moving while purchase intent is fresh.`,
        actions: [
          { label: 'Open order', href: adminOrderUrl, tone: 'primary' },
          { label: 'All orders', href: adminOrdersUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Order', value: `#${orderId}`, note: 'New order record created.' },
            { label: 'Customer', value: customerName, note: sanitizeDisplayValue(templateData.customer?.email || '', 180) || 'Customer contact is on file.' },
            { label: 'Placed', value: formatDateTime(templateData.placed_at || templateData.created_at), note: 'Review payment and fulfillment timing next.' }
          ], brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Order totals' })}
          ${renderCustomerSummaryPanel({ brand, customer: templateData.customer })}
          ${renderAddressPanel({
            brand,
            address: templateData.shipping_address,
            title: 'Delivery address'
          })}
          ${renderLineItems(lineItems, templateData.currency || 'USD', brand)}
          ${renderNotice({
            brand,
            title: 'Recommended next step',
            body: 'Confirm whether payment is still pending or already settled, then keep the order visible in your fulfillment queue so the customer gets a fast follow-through.',
            tone: 'warning'
          })}
        `,
        footerNote: 'This alert is sent as soon as the order record is created so store operators can respond quickly.'
      }),
      text: buildTextBlock([
        `New order at ${brand.storeName}.`,
        '',
        `Order: #${orderId}`,
        `Customer: ${customerName}`,
        `Placed: ${formatDateTime(templateData.placed_at || templateData.created_at)}`,
        ...buildOrderTotalsTextLines(templateData),
        '',
        ...lineItems.map((item) => `- ${item.name} x${item.quantity}: ${formatMoney(item.total, templateData.currency || 'USD')}`),
        ...(formatAddress(templateData.shipping_address) ? ['', `Delivery address: ${formatAddress(templateData.shipping_address)}`] : []),
        '',
        `Open order: ${adminOrderUrl}`,
        `All orders: ${adminOrdersUrl}`
      ])
    };
  },
  'store.owner_order_paid': async ({ brand, templateData, config }) => {
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Paid order', 60, 'Paid order');
    const customerName = sanitizeDisplayValue(templateData.customer?.name || templateData.name || 'Customer', 140, 'Customer');
    const adminOrderUrl = sanitizeOptionalUrl(templateData.admin_order_url || joinUrl(config.webAppUrl, '/dashboard'));
    const adminOrdersUrl = sanitizeOptionalUrl(templateData.admin_orders_url || joinUrl(config.webAppUrl, '/dashboard'));
    const paymentReference = sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 140);
    const lineItems = normalizeLineItems(templateData.items);

    return {
      subject: `Paid order at ${brand.storeName}: ${orderId}`,
      html: renderShell({
        brand,
        preheader: `Payment cleared for order ${orderId}.`,
        eyebrow: 'Payment cleared',
        title: 'Payment was received successfully',
        intro: `Order ${orderId} is now paid and ready for the next fulfillment step. This is a good time to pick, pack, or hand off the order so the customer experience stays strong.`,
        actions: [
          { label: 'Open order', href: adminOrderUrl, tone: 'primary' },
          { label: 'All orders', href: adminOrdersUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Order', value: `#${orderId}`, note: 'Payment confirmed.' },
            { label: 'Amount paid', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD'), note: paymentReference || 'Reference available in the payment record.' },
            { label: 'Customer', value: customerName, note: sanitizeDisplayValue(templateData.customer?.email || '', 180) || 'Customer contact is on file.' }
          ], brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Paid totals' })}
          ${renderCustomerSummaryPanel({ brand, customer: templateData.customer })}
          ${renderAddressPanel({
            brand,
            address: templateData.shipping_address,
            title: 'Delivery address'
          })}
          ${renderLineItems(lineItems, templateData.currency || 'USD', brand)}
          ${renderNotice({
            brand,
            title: 'Fulfillment cue',
            body: 'Inventory is already reserved for this order, so the main job now is moving it into packing and shipment without delay.',
            tone: 'success'
          })}
        `,
        footerNote: 'This email confirms the checkout payment event succeeded for a store order.'
      }),
      text: buildTextBlock([
        `Payment received for ${brand.storeName} order #${orderId}.`,
        `Customer: ${customerName}`,
        `Paid at: ${formatDateTime(templateData.paid_at)}`,
        ...(paymentReference ? [`Reference: ${paymentReference}`] : []),
        ...buildOrderTotalsTextLines(templateData),
        '',
        ...lineItems.map((item) => `- ${item.name} x${item.quantity}: ${formatMoney(item.total, templateData.currency || 'USD')}`),
        '',
        `Open order: ${adminOrderUrl}`,
        `All orders: ${adminOrdersUrl}`
      ])
    };
  },
  'store.owner_order_payment_failed': async ({ brand, templateData, config }) => {
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Pending order', 60, 'Pending order');
    const customerName = sanitizeDisplayValue(templateData.customer?.name || templateData.name || 'Customer', 140, 'Customer');
    const adminOrderUrl = sanitizeOptionalUrl(templateData.admin_order_url || joinUrl(config.webAppUrl, '/dashboard'));
    const adminOrdersUrl = sanitizeOptionalUrl(templateData.admin_orders_url || joinUrl(config.webAppUrl, '/dashboard'));
    const lineItems = normalizeLineItems(templateData.items);

    return {
      subject: `Payment failed for ${brand.storeName} order ${orderId}`,
      html: renderShell({
        brand,
        preheader: `Payment failed for order ${orderId}.`,
        eyebrow: 'Payment issue',
        title: 'An order needs payment follow-up',
        intro: `Payment did not complete for order ${orderId}. Review the order, decide whether outreach is needed, and keep the customer from slipping away if recovery is possible.`,
        actions: [
          { label: 'Open order', href: adminOrderUrl, tone: 'primary' },
          { label: 'All orders', href: adminOrdersUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Order', value: `#${orderId}`, note: 'Payment did not go through.' },
            { label: 'Attempted amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD'), note: sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 140) || 'Reference may be available from the payment service.' },
            { label: 'Customer', value: customerName, note: sanitizeDisplayValue(templateData.customer?.email || '', 180) || 'Customer contact is on file.' }
          ], brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Attempted totals' })}
          ${renderCustomerSummaryPanel({ brand, customer: templateData.customer })}
          ${renderLineItems(lineItems, templateData.currency || 'USD', brand)}
          ${renderNotice({
            brand,
            title: 'Recovery suggestion',
            body: 'If the customer is important to the store, consider following up with a payment reminder or alternate payment instructions while the order intent is still recent.',
            tone: 'danger'
          })}
        `,
        footerNote: 'This alert is sent immediately after the payment failure event for order recovery visibility.'
      }),
      text: buildTextBlock([
        `Payment failed for ${brand.storeName} order #${orderId}.`,
        `Customer: ${customerName}`,
        `Attempted amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        ...buildOrderTotalsTextLines(templateData),
        '',
        ...lineItems.map((item) => `- ${item.name} x${item.quantity}: ${formatMoney(item.total, templateData.currency || 'USD')}`),
        '',
        `Open order: ${adminOrderUrl}`,
        `All orders: ${adminOrdersUrl}`
      ])
    };
  },
  'store.owner_order_status_changed': async ({ brand, templateData, config }) => {
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const statusLabel = titleCase(templateData.status || 'updated');
    const adminOrderUrl = sanitizeOptionalUrl(templateData.admin_order_url || joinUrl(config.webAppUrl, '/dashboard'));
    const adminOrdersUrl = sanitizeOptionalUrl(templateData.admin_orders_url || joinUrl(config.webAppUrl, '/dashboard'));
    const customerName = sanitizeDisplayValue(templateData.customer?.name || templateData.name || 'Customer', 140, 'Customer');

    return {
      subject: `${brand.storeName} order ${orderId} is now ${statusLabel.toLowerCase()}`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} status changed to ${statusLabel.toLowerCase()}.`,
        eyebrow: 'Status update',
        title: 'An order status changed',
        intro: `Order ${orderId} was updated to ${statusLabel.toLowerCase()}. This notification helps keep store leadership and support inboxes aligned on fulfillment progress.`,
        actions: [
          { label: 'Open order', href: adminOrderUrl, tone: 'primary' },
          { label: 'All orders', href: adminOrdersUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Order', value: `#${orderId}`, note: 'Status changed in the admin workspace.' },
            { label: 'Status', value: statusLabel, note: `Payment: ${titleCase(templateData.payment_status || 'pending')}` },
            { label: 'Customer', value: customerName, note: sanitizeDisplayValue(templateData.customer?.email || '', 180) || 'Customer contact is on file.' }
          ], brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Order totals' })}
          ${renderNotice({
            brand,
            title: 'Keep momentum',
            body: 'Use this update to confirm the next operational handoff is clear, especially when support, fulfillment, and ownership do not share the same inbox.',
            tone: 'primary'
          })}
        `,
        footerNote: 'This email tracks non-payment order status changes for store operators.'
      }),
      text: buildTextBlock([
        `${brand.storeName} order #${orderId} is now ${statusLabel.toLowerCase()}.`,
        `Customer: ${customerName}`,
        `Updated at: ${formatDateTime(templateData.updated_at)}`,
        `Payment status: ${titleCase(templateData.payment_status || 'pending')}`,
        ...buildOrderTotalsTextLines(templateData),
        '',
        `Open order: ${adminOrderUrl}`,
        `All orders: ${adminOrdersUrl}`
      ])
    };
  },
  'store.customer_password_reset_otp': async ({ brand, templateData }) => {
    return renderOtpEmail({
      brand,
      templateData,
      subject: `Your ${brand.storeName} password reset OTP`,
      preheader: `Use this OTP to reset your ${brand.storeName} account password.`,
      eyebrow: `${brand.storeName} account`,
      intro: `use the code below to reset your password for ${brand.storeName}.`,
      footerNote: 'This transactional email was sent because a password reset was requested for your customer account.'
    });
  },
  'store.customer_email_verification_otp': async ({ brand, templateData }) => {
    return renderOtpEmail({
      brand,
      templateData: {
        ...templateData,
        code_label: 'Email verification code'
      },
      subject: `Verify your ${brand.storeName} email address`,
      preheader: `Use this code to verify your email for ${brand.storeName}.`,
      eyebrow: `${brand.storeName} verification`,
      intro: `use the code below to confirm the email address connected to your customer account with ${brand.storeName}.`,
      footerNote: 'Verifying your email helps protect order history, saved addresses, and future account changes.'
    });
  },
  'store.customer_welcome': async ({ brand, templateData, config }) => {
    const accountUrl = sanitizeOptionalUrl(templateData.account_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/account'));
    const ordersUrl = sanitizeOptionalUrl(templateData.orders_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));
    const wishlistUrl = sanitizeOptionalUrl(templateData.wishlist_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/wishlist'));

    return renderWelcomeEmail({
      brand,
      templateData,
      subject: `Welcome to ${brand.storeName}`,
      eyebrow: 'Customer account',
      title: 'Your account is ready',
      intro: `your customer account with ${brand.storeName} is now active. You can track orders, check out faster, and return to favorites with less friction next time.`,
      actions: [
        { label: 'Open account', href: accountUrl, tone: 'primary' },
        { label: 'View orders', href: ordersUrl, tone: 'secondary' }
      ],
      highlights: [
        { label: 'Orders', value: 'Track purchases easily', note: 'Review order history and delivery progress in one place.' },
        { label: 'Checkout', value: 'Faster on return visits', note: 'Saved details make repeat purchases smoother.' },
        { label: 'Favorites', value: wishlistUrl ? 'Keep a saved shortlist' : 'Save products for later', note: 'Come back to items you are still considering.' }
      ],
      checklist: [
        'Review your account details and saved addresses.',
        'Track new and past orders from the account area.',
        'Save favorite products so it is easier to return later.'
      ],
      footerNote: `You can sign back in to ${brand.storeName} whenever you want to manage orders or revisit saved products.`
    });
  },
  'store.customer_login_alert': async ({ brand, templateData, config }) => {
    const resetUrl = sanitizeOptionalUrl(templateData.reset_password_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/forgot-password'));
    return renderLoginAlertEmail({
      brand,
      templateData,
      subject: `New sign-in to your ${brand.storeName} account`,
      eyebrow: `${brand.storeName} security`,
      intro: `we noticed a recent sign-in to your customer account with ${brand.storeName}.`,
      audienceLabel: `${brand.storeName} customer account`,
      resetUrl
    });
  },
  'store.order_confirmation': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Pending', 60, 'Pending');
    const orderUrl = sanitizeOptionalUrl(templateData.order_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));
    const continueShoppingUrl = sanitizeOptionalUrl(templateData.continue_shopping_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/products'));
    const amountLabel = formatMoney(templateData.amount || 0, templateData.currency || 'USD');
    const lineItems = normalizeLineItems(templateData.items);

    return {
      subject: `We received your ${brand.storeName} order ${orderId}`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} has been created successfully.`,
        eyebrow: 'Order received',
        title: 'Your order is in',
        intro: `Hi ${name}, we have received your order and started preparing the next steps. You will get another email as payment and fulfillment progress move forward.`,
        actions: [
          { label: 'View my orders', href: orderUrl, tone: 'primary' },
          { label: 'Continue shopping', href: continueShoppingUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Order', value: `#${orderId}`, note: 'Keep this number for support requests.' },
            { label: 'Total', value: amountLabel, note: 'Final payment updates will follow separately if needed.' },
            { label: 'Placed', value: formatDateTime(templateData.placed_at || templateData.created_at), note: 'Recorded in your order history.' }
          ], brand)}
          ${renderLineItems(lineItems, templateData.currency || 'USD', brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Order totals' })}
          ${renderAddressPanel({
            brand,
            address: templateData.shipping_address,
            title: 'Delivery details'
          })}
          ${renderNotice({
            brand,
            title: 'What happens next',
            body: 'We will keep you updated as payment completes and fulfillment moves forward. If anything needs your attention, we will let you know quickly.',
            tone: 'primary'
          })}
        `,
        footerNote: 'This email confirms your order record was created successfully.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `We received your order #${orderId}.`,
        `Total: ${amountLabel}`,
        `Placed: ${formatDateTime(templateData.placed_at || templateData.created_at)}`,
        '',
        ...lineItems.map((item) => `- ${item.name} x${item.quantity}: ${formatMoney(item.total, templateData.currency || 'USD')}`),
        ...buildOrderTotalsTextLines(templateData),
        ...(formatAddress(templateData.shipping_address) ? ['', `Delivery details: ${formatAddress(templateData.shipping_address)}`] : []),
        '',
        `View orders: ${orderUrl}`
      ])
    };
  },
  'store.payment_receipt': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Paid order', 60, 'Paid order');
    const orderUrl = sanitizeOptionalUrl(templateData.order_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));
    const amount = formatMoney(templateData.amount || 0, templateData.currency || 'USD');
    const items = normalizeLineItems(templateData.items);

    return {
      subject: `${brand.storeName} payment receipt for order ${orderId}`,
      html: renderShell({
        brand,
        preheader: `We received your payment for order ${orderId}.`,
        eyebrow: 'Payment receipt',
        title: 'Payment received',
        intro: `Hi ${name}, your payment was received successfully and your order is now moving through the next fulfillment steps.`,
        actions: [{ label: 'View my orders', href: orderUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Amount paid', value: amount, note: 'Processed successfully.' },
            { label: 'Order', value: `#${orderId}`, note: 'Saved in your order history.' },
            { label: 'Paid at', value: formatDateTime(templateData.paid_at), note: sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Payment reference available on request.' }
          ], brand)}
          ${renderLineItems(items, templateData.currency || 'USD', brand)}
          ${renderOrderTotalsPanel({ brand, templateData, title: 'Payment totals' })}
        `,
        footerNote: 'Keep this receipt for your records if you track purchases manually.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Payment received for order #${orderId}.`,
        `Amount paid: ${amount}`,
        `Paid at: ${formatDateTime(templateData.paid_at)}`,
        `Reference: ${sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Available on request'}`,
        '',
        ...items.map((item) => `- ${item.name} x${item.quantity}: ${formatMoney(item.total, templateData.currency || 'USD')}`),
        ...buildOrderTotalsTextLines(templateData),
        '',
        `View orders: ${orderUrl}`
      ])
    };
  },
  'store.payment_failed': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Pending order', 60, 'Pending order');
    const retryUrl = sanitizeOptionalUrl(templateData.retry_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/checkout'));
    const cartUrl = sanitizeOptionalUrl(templateData.cart_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/cart'));

    return {
      subject: `Payment issue with your ${brand.storeName} order ${orderId}`,
      html: renderShell({
        brand,
        preheader: `We could not complete payment for order ${orderId}.`,
        eyebrow: 'Payment issue',
        title: 'Your payment did not go through',
        intro: `Hi ${name}, we were not able to complete payment for your order. Your cart or order may need attention before checkout can finish successfully.`,
        actions: [
          { label: 'Retry checkout', href: retryUrl, tone: 'primary' },
          { label: 'Review cart', href: cartUrl, tone: 'secondary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Attempt details',
            eyebrow: 'Payment summary',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Attempted amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD') },
              { label: 'Reference', value: sanitizeDisplayValue(templateData.payment_reference || templateData.reference || '', 120) || 'Not available' }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'What to try next',
            body: 'Confirm the payment method, make sure enough funds are available, and restart checkout if needed. If the issue keeps happening, contact support and include the order reference.',
            tone: 'danger'
          })}
        `,
        footerNote: 'We send payment-failure alerts quickly so you can recover the order before momentum is lost.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `We could not complete payment for order #${orderId}.`,
        `Attempted amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        '',
        `Retry checkout: ${retryUrl}`,
        `Review cart: ${cartUrl}`
      ])
    };
  },
  'store.invoice_issued': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const invoiceId = sanitizeDisplayValue(templateData.invoice_id || 'Invoice', 60, 'Invoice');
    const invoiceUrl = sanitizeOptionalUrl(templateData.invoice_url || brand.websiteUrl || buildStorefrontUrl(config));

    return {
      subject: `${brand.storeName} invoice ${invoiceId}`,
      html: renderShell({
        brand,
        preheader: `A new invoice from ${brand.storeName} is ready.`,
        eyebrow: 'Invoice issued',
        title: 'Your invoice is ready',
        intro: `Hi ${name}, ${brand.storeName} has issued a new invoice for your review. You can use the summary below to confirm amounts and due timing.`,
        actions: [{ label: 'Review invoice', href: invoiceUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: sanitizeDisplayValue(templateData.description || 'Invoice summary', 120, 'Invoice summary'),
            eyebrow: 'Billing details',
            bodyHtml: renderKeyValueRows([
              { label: 'Invoice ID', value: invoiceId },
              { label: 'Amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD') },
              { label: 'Due date', value: formatDateOnly(templateData.due_at) }
            ])
          })}
        `,
        footerNote: 'If you need a revised invoice or additional references, reply to this email and our team will help.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Invoice ${invoiceId} is ready from ${brand.storeName}.`,
        `Amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        `Due date: ${formatDateOnly(templateData.due_at)}`,
        '',
        `Review invoice: ${invoiceUrl}`
      ])
    };
  },
  'store.order_status_processing': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const orderUrl = sanitizeOptionalUrl(templateData.order_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));
    const statusLabel = titleCase(templateData.status || 'processing');

    return {
      subject: `${brand.storeName} update: order ${orderId} is ${statusLabel.toLowerCase()}`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} is now ${statusLabel.toLowerCase()}.`,
        eyebrow: 'Order update',
        title: 'Your order is moving forward',
        intro: `Hi ${name}, your order is now marked as ${statusLabel.toLowerCase()}. Our team is actively working through the next fulfillment step.`,
        actions: [{ label: 'View my orders', href: orderUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Status summary',
            eyebrow: 'Current state',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Status', value: statusLabel },
              { label: 'Updated at', value: formatDateTime(templateData.updated_at) }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'What this means',
            body: 'We have accepted the order into the next stage of processing. You will receive another email when shipping or delivery details become available.',
            tone: 'success'
          })}
        `,
        footerNote: 'Order updates are sent automatically so you do not need to keep checking manually.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your order #${orderId} is now ${statusLabel.toLowerCase()}.`,
        `Updated at: ${formatDateTime(templateData.updated_at)}`,
        '',
        `View orders: ${orderUrl}`
      ])
    };
  },
  'store.order_status_shipped': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const trackingUrl = sanitizeOptionalUrl(templateData.tracking_url || '');
    const orderUrl = sanitizeOptionalUrl(templateData.order_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));

    return {
      subject: `${brand.storeName} update: order ${orderId} has shipped`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} is on the way.`,
        eyebrow: 'Shipment update',
        title: 'Your order has shipped',
        intro: `Hi ${name}, your order is on the way. Review the shipping details below and keep this email nearby if you want to track progress.`,
        actions: [
          ...(trackingUrl ? [{ label: 'Track package', href: trackingUrl, tone: 'primary' }] : []),
          { label: 'View my orders', href: orderUrl, tone: trackingUrl ? 'secondary' : 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Shipping details',
            eyebrow: 'Fulfillment',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Carrier', value: sanitizeDisplayValue(templateData.carrier || 'Shipping partner', 80, 'Shipping partner') },
              { label: 'Tracking number', value: sanitizeDisplayValue(templateData.tracking_number || '', 120) || 'Will appear in your order history when available' },
              { label: 'Shipped at', value: formatDateTime(templateData.shipped_at || templateData.updated_at) }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Delivery reminder',
            body: 'Shipping timelines can vary by carrier and destination. If tracking changes or stalls unexpectedly, reply to this email and our team will help.',
            tone: 'primary'
          })}
        `,
        footerNote: 'We send shipment emails as soon as the order reaches the shipping stage.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your order #${orderId} has shipped.`,
        `Carrier: ${sanitizeDisplayValue(templateData.carrier || 'Shipping partner', 80, 'Shipping partner')}`,
        `Tracking number: ${sanitizeDisplayValue(templateData.tracking_number || '', 120) || 'Available in order history when ready'}`,
        '',
        ...(trackingUrl ? [`Track package: ${trackingUrl}`] : []),
        `View orders: ${orderUrl}`
      ])
    };
  },
  'store.order_status_delivered': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const orderUrl = sanitizeOptionalUrl(templateData.order_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));
    const reviewUrl = sanitizeOptionalUrl(templateData.review_url || '');

    return {
      subject: `${brand.storeName} update: order ${orderId} was delivered`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} has been delivered.`,
        eyebrow: 'Delivery confirmed',
        title: 'Your order has been delivered',
        intro: `Hi ${name}, we have marked your order as delivered. We hope everything arrived exactly the way you expected.`,
        actions: [
          ...(reviewUrl ? [{ label: 'Leave feedback', href: reviewUrl, tone: 'primary' }] : []),
          { label: 'View my orders', href: orderUrl, tone: reviewUrl ? 'secondary' : 'primary' }
        ],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Delivery details',
            eyebrow: 'Order completion',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Delivered at', value: formatDateTime(templateData.delivered_at || templateData.updated_at) }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'Need help after delivery?',
            body: 'If something is missing, damaged, or not as expected, reply to this email with the order number and we will help you quickly.',
            tone: 'success'
          })}
        `,
        footerNote: 'Thank you for shopping with us. Post-delivery support remains available if you need it.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your order #${orderId} has been delivered.`,
        `Delivered at: ${formatDateTime(templateData.delivered_at || templateData.updated_at)}`,
        '',
        ...(reviewUrl ? [`Leave feedback: ${reviewUrl}`] : []),
        `View orders: ${orderUrl}`
      ])
    };
  },
  'store.order_cancelled': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const supportUrl = sanitizeOptionalUrl(templateData.support_url || brand.websiteUrl || buildStorefrontUrl(config));
    const reason = sanitizeDisplayValue(templateData.reason || '', 220);

    return {
      subject: `${brand.storeName} update: order ${orderId} was cancelled`,
      html: renderShell({
        brand,
        preheader: `Order ${orderId} was cancelled.`,
        eyebrow: 'Order cancelled',
        title: 'Your order has been cancelled',
        intro: `Hi ${name}, your order has been cancelled and is no longer moving through fulfillment.`,
        actions: [{ label: 'Contact support', href: supportUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Cancellation summary',
            eyebrow: 'Order details',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Cancelled at', value: formatDateTime(templateData.cancelled_at || templateData.updated_at) },
              ...(reason ? [{ label: 'Reason', value: reason }] : [])
            ])
          })}
        `,
        footerNote: 'If you did not expect this cancellation, contact support and include your order number.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your order #${orderId} was cancelled.`,
        ...(reason ? [`Reason: ${reason}`] : []),
        '',
        `Contact support: ${supportUrl}`
      ])
    };
  },
  'store.refund_issued': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const supportUrl = sanitizeOptionalUrl(templateData.support_url || brand.websiteUrl || buildStorefrontUrl(config));

    return {
      subject: `${brand.storeName} refund issued for order ${orderId}`,
      html: renderShell({
        brand,
        preheader: `A refund has been issued for order ${orderId}.`,
        eyebrow: 'Refund issued',
        title: 'Your refund is on the way',
        intro: `Hi ${name}, we issued a refund for your order. Banks and payment providers can take additional time before the funds appear on your statement.`,
        actions: [{ label: 'Contact support', href: supportUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Refund summary',
            eyebrow: 'Payment details',
            bodyHtml: renderKeyValueRows([
              { label: 'Order', value: `#${orderId}` },
              { label: 'Refund amount', value: formatMoney(templateData.amount || 0, templateData.currency || 'USD') },
              { label: 'Issued at', value: formatDateTime(templateData.refunded_at) },
              { label: 'Reference', value: sanitizeDisplayValue(templateData.refund_reference || '', 120) || 'Available from support' }
            ])
          })}
          ${renderNotice({
            brand,
            title: 'When funds arrive',
            body: 'Most banks post the refunded amount within a few business days, but exact timing depends on your payment provider.',
            tone: 'primary'
          })}
        `,
        footerNote: 'Keep this email in case you need to reference the refund later.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `A refund has been issued for order #${orderId}.`,
        `Refund amount: ${formatMoney(templateData.amount || 0, templateData.currency || 'USD')}`,
        `Issued at: ${formatDateTime(templateData.refunded_at)}`,
        '',
        `Support: ${supportUrl}`
      ])
    };
  },
  'store.abandoned_cart_reminder': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const cartUrl = sanitizeOptionalUrl(templateData.cart_url || templateData.checkout_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/cart'));
    const items = normalizeLineItems(templateData.items);

    return {
      subject: `You left something behind at ${brand.storeName}`,
      html: renderShell({
        brand,
        preheader: 'Your cart is still waiting.',
        eyebrow: 'Cart reminder',
        title: 'Your cart is still waiting',
        intro: `Hi ${name}, you left products behind at ${brand.storeName}. If you were interrupted, you can pick up where you stopped.`,
        actions: [{ label: 'Return to cart', href: cartUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderLineItems(items, templateData.currency || 'USD', brand)}
          ${renderNotice({
            brand,
            title: 'Before the cart changes',
            body: 'Availability and pricing can change over time. If you still want these items, it is best to complete checkout soon.',
            tone: 'warning'
          })}
        `,
        footerNote: 'This reminder is only meant to help you continue a checkout you already started.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `Your cart at ${brand.storeName} is still waiting.`,
        '',
        ...items.map((item) => `- ${item.name} x${item.quantity}`),
        '',
        `Return to cart: ${cartUrl}`
      ])
    };
  },
  'store.wishlist_back_in_stock': async ({ brand, templateData }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const productName = sanitizeDisplayValue(templateData.product_name || 'Saved item', 160, 'Saved item');
    const productUrl = sanitizeOptionalUrl(templateData.product_url || brand.websiteUrl || '');

    return {
      subject: `${productName} is back in stock at ${brand.storeName}`,
      html: renderShell({
        brand,
        preheader: `${productName} is available again.`,
        eyebrow: 'Wishlist alert',
        title: 'A saved item is back in stock',
        intro: `Hi ${name}, the item you saved, ${productName}, is back in stock at ${brand.storeName}.`,
        actions: [{ label: 'View product', href: productUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Product', value: productName, note: sanitizeDisplayValue(templateData.variant || '', 120) || 'Wishlist item' },
            ...(hasContent(templateData.price) ? [{ label: 'Current price', value: formatMoney(templateData.price, templateData.currency || 'USD'), note: 'Available now while stock lasts.' }] : [])
          ], brand)}
          ${renderNotice({
            brand,
            title: 'Availability can move quickly',
            body: 'Popular items can sell through again once they return, so review the product soon if you still want it.',
            tone: 'primary'
          })}
        `,
        footerNote: 'You received this because the item was previously saved or watched in your account.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `${productName} is back in stock at ${brand.storeName}.`,
        '',
        `View product: ${productUrl}`
      ])
    };
  },
  'store.wishlist_price_drop': async ({ brand, templateData }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const productName = sanitizeDisplayValue(templateData.product_name || 'Saved item', 160, 'Saved item');
    const productUrl = sanitizeOptionalUrl(templateData.product_url || brand.websiteUrl || '');
    const newPrice = formatMoney(templateData.new_price || 0, templateData.currency || 'USD');
    const oldPrice = hasContent(templateData.old_price) ? formatMoney(templateData.old_price, templateData.currency || 'USD') : '';

    return {
      subject: `${productName} just dropped in price at ${brand.storeName}`,
      html: renderShell({
        brand,
        preheader: `${productName} is now ${newPrice}.`,
        eyebrow: 'Wishlist alert',
        title: 'A saved item is now cheaper',
        intro: `Hi ${name}, one of the items you saved, ${productName}, just dropped in price.`,
        actions: [{ label: 'View product', href: productUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderHighlightCards([
            { label: 'Product', value: productName, note: sanitizeDisplayValue(templateData.variant || '', 120) || 'Wishlist item' },
            ...(oldPrice ? [{ label: 'Previous price', value: oldPrice, note: 'Earlier saved price.' }] : []),
            { label: 'Current price', value: newPrice, note: 'Live on the storefront now.' }
          ], brand)}
        `,
        footerNote: 'You received this price alert because the product was saved or watched in your account.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `${productName} just dropped in price at ${brand.storeName}.`,
        ...(oldPrice ? [`Previous price: ${oldPrice}`] : []),
        `Current price: ${newPrice}`,
        '',
        `View product: ${productUrl}`
      ])
    };
  },
  'store.review_request': async ({ brand, templateData, config }) => {
    const name = sanitizeDisplayValue(templateData.name || 'there', 120, 'there');
    const orderId = sanitizeDisplayValue(templateData.order_id || 'Order', 60, 'Order');
    const reviewUrl = sanitizeOptionalUrl(templateData.review_url || joinUrl(brand.websiteUrl || buildStorefrontUrl(config), '/orders'));

    return {
      subject: `How was your ${brand.storeName} order ${orderId}?`,
      html: renderShell({
        brand,
        preheader: 'Share feedback on your recent order.',
        eyebrow: 'Feedback request',
        title: 'Tell us how your order went',
        intro: `Hi ${name}, if your order has arrived and you have had time with it, we would love to hear what you think.`,
        actions: [{ label: 'Leave a review', href: reviewUrl, tone: 'primary' }],
        bodyHtml: `
          ${renderPanel({
            brand,
            title: 'Why feedback helps',
            eyebrow: 'Customer voice',
            bodyHtml: renderBulletList([
              'It helps future customers shop with more confidence.',
              'It shows our team what is working well and what needs attention.',
              'It gives us a better view of the product and delivery experience end to end.'
            ])
          })}
        `,
        footerNote: 'Thanks again for choosing us. Your feedback genuinely helps improve the experience.'
      }),
      text: buildTextBlock([
        `Hi ${name},`,
        '',
        `How was your order #${orderId}?`,
        `Leave a review: ${reviewUrl}`
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
