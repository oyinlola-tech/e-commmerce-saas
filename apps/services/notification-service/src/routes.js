const nodemailer = require('nodemailer');
const { body } = require('express-validator');
const {
  requireInternalRequest,
  asyncHandler,
  createHttpError,
  validate,
  allowBodyFields,
  commonRules,
  sanitizeEmail,
  sanitizeJsonObject,
  sanitizePlainText
} = require('../../../../packages/shared');
const { listEmailTemplates } = require('./template-catalog');
const { renderEmailTemplate } = require('./template-renderer');

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

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const registerRoutes = async ({ app, db, config }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/emails/templates', requireInternal, asyncHandler(async (req, res) => {
    return res.json({
      templates: listEmailTemplates()
    });
  }));

  app.post('/emails/send', requireInternal, validate([
    allowBodyFields(['to', 'subject', 'text', 'html', 'metadata', 'template_key', 'template_data', 'brand', 'store_id']),
    body('to').isEmail().customSanitizer((value) => sanitizeEmail(value)),
    commonRules.optionalPlainText('subject', 190),
    body('text').optional().isString(),
    body('html').optional().isString(),
    commonRules.jsonObject('metadata'),
    commonRules.optionalPlainText('template_key', 120),
    commonRules.jsonObject('template_data'),
    commonRules.jsonObject('brand'),
    body('store_id').optional().isInt({ min: 1 }).toInt()
  ]), asyncHandler(async (req, res) => {
    const smtpConfig = resolveSmtpConfig();
    const templateKey = sanitizePlainText(req.body.template_key || '', { maxLength: 120 });
    let subject = sanitizePlainText(req.body.subject || 'Aisle notification', { maxLength: 190 }) || 'Aisle notification';
    let text = String(req.body.text || '').trim();
    let html = String(req.body.html || '').trim();
    let resolvedTemplate = null;

    if (templateKey) {
      try {
        resolvedTemplate = await renderEmailTemplate({
          config,
          smtpConfig,
          requestId: req.requestId || req.authContext.requestId,
          templateKey,
          templateData: req.body.template_data || {},
          brand: req.body.brand || {},
          storeId: req.body.store_id || null
        });
      } catch (error) {
        throw createHttpError(Number(error.status) || 422, error.message || 'Unable to render the email template.', null, {
          expose: true
        });
      }

      subject = sanitizePlainText(resolvedTemplate.subject || subject, { maxLength: 190 }) || subject;
      text = String(resolvedTemplate.text || '').trim();
      html = String(resolvedTemplate.html || '').trim();
    }

    if (!text && !html) {
      throw createHttpError(400, 'Either text or html email content is required.', null, { expose: true });
    }

    const metadata = sanitizeJsonObject(req.body.metadata || {});
    if (templateKey) {
      metadata.template_key = templateKey;
      metadata.audience = resolvedTemplate?.definition?.audience || metadata.audience || '';
      metadata.brand_mode = resolvedTemplate?.definition?.brand_mode || metadata.brand_mode || '';
      if (req.body.store_id) {
        metadata.store_id = Number(req.body.store_id);
      }
    }

    const result = await db.execute(
      `
        INSERT INTO outbound_emails (
          recipient_email, subject, status, metadata, payload
        ) VALUES (?, ?, 'pending', ?, ?)
      `,
      [
        req.body.to,
        subject,
        JSON.stringify(metadata),
        JSON.stringify({
          template_key: templateKey || null,
          template_data: sanitizeJsonObject(req.body.template_data || {}),
          brand: sanitizeJsonObject(req.body.brand || {}),
          store_id: req.body.store_id || null,
          text,
          html
        })
      ]
    );

    try {
      const transporter = await ensureTransporter();
      const info = await transporter.sendMail({
        from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
        to: req.body.to,
        subject,
        text: text || undefined,
        html: html || undefined
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

    return res.status(201).json({
      id: result.insertId,
      status: 'sent'
    });
  }));
};

module.exports = {
  registerRoutes
};
