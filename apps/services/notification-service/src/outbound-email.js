const nodemailer = require('nodemailer');
const {
  createHttpError,
  sanitizeEmail,
  sanitizeJsonObject,
  sanitizePlainText
} = require('../../../../packages/shared');
const { renderEmailTemplate } = require('./template-renderer');
const { sanitizeStructuredData } = require('./structured-data');

let transporterPromise = null;

const resolveSmtpConfig = () => {
  const host = String(process.env.NOTIFICATION_SERVICE_SMTP_HOST || process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.NOTIFICATION_SERVICE_SMTP_PORT || process.env.SMTP_PORT || 587);
  const user = String(process.env.NOTIFICATION_SERVICE_SMTP_USER || process.env.SMTP_USER || '').trim();
  const pass = String(process.env.NOTIFICATION_SERVICE_SMTP_PASSWORD || process.env.SMTP_PASSWORD || '').trim();
  const secure = ['1', 'true', 'yes', 'on'].includes(String(process.env.NOTIFICATION_SERVICE_SMTP_SECURE || process.env.SMTP_SECURE || '').trim().toLowerCase());
  const fromEmail = String(process.env.NOTIFICATION_SERVICE_FROM_EMAIL || process.env.SMTP_FROM_EMAIL || '').trim();
  const fromName = String(process.env.NOTIFICATION_SERVICE_FROM_NAME || process.env.SMTP_FROM_NAME || 'Aisle').trim() || 'Aisle';

  return {
    host,
    port,
    user,
    pass,
    secure,
    fromEmail,
    fromName
  };
};

const ensureTransporter = async () => {
  if (transporterPromise) {
    return transporterPromise;
  }

  const smtpConfig = resolveSmtpConfig();
  if (!smtpConfig.host || !smtpConfig.fromEmail) {
    throw createHttpError(503, 'SMTP is not configured for the notification service.', null, { expose: true });
  }

  transporterPromise = Promise.resolve(nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.user
      ? {
          user: smtpConfig.user,
          pass: smtpConfig.pass
        }
      : undefined
  }));

  return transporterPromise;
};

const renderTemplatedEmail = async ({
  config,
  requestId,
  templateKey,
  templateData = {},
  brand = {},
  storeId = null
}) => {
  const smtpConfig = resolveSmtpConfig();
  const safeTemplateData = sanitizeStructuredData(templateData) || {};
  const safeBrand = sanitizeStructuredData(brand) || {};
  const renderedTemplate = await renderEmailTemplate({
    config,
    smtpConfig,
    requestId,
    templateKey,
    templateData: safeTemplateData,
    brand: safeBrand,
    storeId
  });

  return {
    ...renderedTemplate,
    templateData: safeTemplateData,
    brandData: safeBrand
  };
};

const deliverOutboundEmail = async ({
  db,
  to,
  subject,
  text,
  html,
  metadata = {},
  payload = {}
}) => {
  const smtpConfig = resolveSmtpConfig();
  const recipientEmail = sanitizeEmail(to);
  const safeSubject = sanitizePlainText(subject || 'Aisle notification', { maxLength: 190 }) || 'Aisle notification';
  const safeText = String(text || '').trim();
  const safeHtml = String(html || '').trim();

  if (!safeText && !safeHtml) {
    throw createHttpError(400, 'Either text or html email content is required.', null, { expose: true });
  }

  const result = await db.execute(
    `
      INSERT INTO outbound_emails (
        recipient_email, subject, status, metadata, payload
      ) VALUES (?, ?, 'pending', ?, ?)
    `,
    [
      recipientEmail,
      safeSubject,
      JSON.stringify(sanitizeJsonObject(metadata || {})),
      JSON.stringify({
        ...sanitizeStructuredData(payload),
        text: safeText,
        html: safeHtml
      })
    ]
  );

  try {
    const transporter = await ensureTransporter();
    const info = await transporter.sendMail({
      from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      to: recipientEmail,
      subject: safeSubject,
      text: safeText || undefined,
      html: safeHtml || undefined
    });

    await db.execute(
      'UPDATE outbound_emails SET status = ?, provider_response = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        'sent',
        JSON.stringify({
          messageId: info.messageId || null,
          accepted: Array.isArray(info.accepted) ? info.accepted : []
        }),
        result.insertId
      ]
    );

    return {
      id: result.insertId,
      status: 'sent'
    };
  } catch (error) {
    await db.execute(
      'UPDATE outbound_emails SET status = ?, provider_response = ?, failed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        'failed',
        JSON.stringify({
          message: error.message
        }),
        result.insertId
      ]
    );
    throw error;
  }
};

const sendTemplatedEmail = async ({
  db,
  config,
  requestId,
  to,
  templateKey,
  templateData = {},
  brand = {},
  storeId = null,
  metadata = {}
}) => {
  const rendered = await renderTemplatedEmail({
    config,
    requestId,
    templateKey,
    templateData,
    brand,
    storeId
  });

  return deliverOutboundEmail({
    db,
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    metadata: {
      ...metadata,
      template_key: templateKey,
      audience: rendered.definition?.audience || '',
      brand_mode: rendered.definition?.brand_mode || '',
      ...(storeId ? { store_id: Number(storeId) } : {})
    },
    payload: {
      template_key: templateKey,
      template_data: rendered.templateData,
      brand: rendered.brandData,
      store_id: storeId || null
    }
  });
};

module.exports = {
  resolveSmtpConfig,
  renderTemplatedEmail,
  deliverOutboundEmail,
  sendTemplatedEmail
};
