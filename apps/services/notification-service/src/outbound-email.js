const nodemailer = require('nodemailer');
const { createHttpError } = require('../../../../packages/shared/src/errors');
const {
  sanitizeEmail,
  sanitizeJsonObject,
  sanitizePlainText
} = require('../../../../packages/shared/src/sanitization');
const { renderEmailTemplate } = require('./template-renderer');
const { sanitizeStructuredData } = require('./structured-data');

const EMAIL_QUEUE_RETRY_LIMIT = Math.max(1, Number(process.env.EMAIL_QUEUE_RETRY_LIMIT || 5));
const EMAIL_QUEUE_RETRY_DELAY_MS = Math.max(1000, Number(process.env.EMAIL_QUEUE_RETRY_DELAY_MS || 60 * 1000));
const EMAIL_QUEUE_RETRY_MAX_DELAY_MS = Math.max(
  EMAIL_QUEUE_RETRY_DELAY_MS,
  Number(process.env.EMAIL_QUEUE_RETRY_MAX_DELAY_MS || 30 * 60 * 1000)
);
const EMAIL_QUEUE_LOCK_TIMEOUT_SECONDS = Math.max(
  30,
  Math.ceil(Number(process.env.EMAIL_QUEUE_LOCK_TIMEOUT_MS || 10 * 60 * 1000) / 1000)
);

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

const sanitizeEmailPayload = ({ to, subject, text, html, metadata = {}, payload = {} }) => {
  const recipientEmail = sanitizeEmail(to);
  const safeSubject = sanitizePlainText(subject || 'Aisle notification', { maxLength: 190 }) || 'Aisle notification';
  const safeText = String(text || '').trim();
  const safeHtml = String(html || '').trim();

  if (!recipientEmail) {
    throw createHttpError(400, 'A valid recipient email is required.', null, { expose: true });
  }

  if (!safeText && !safeHtml) {
    throw createHttpError(400, 'Either text or html email content is required.', null, { expose: true });
  }

  return {
    recipientEmail,
    safeSubject,
    safeText,
    safeHtml,
    safeMetadata: sanitizeJsonObject(metadata || {}),
    safePayload: {
      ...(sanitizeStructuredData(payload) || {}),
      text: safeText,
      html: safeHtml
    }
  };
};

const calculateRetryDelayMs = (attemptCount) => {
  const safeAttempt = Math.max(1, Number(attemptCount || 1));
  return Math.min(EMAIL_QUEUE_RETRY_MAX_DELAY_MS, EMAIL_QUEUE_RETRY_DELAY_MS * Math.pow(2, safeAttempt - 1));
};

const getSafeErrorMessage = (error, fallback = 'Email delivery failed.') => {
  return sanitizePlainText(error?.message || fallback, { maxLength: 500 }) || fallback;
};

const parseStoredPayload = (payload) => {
  if (!payload) {
    return {};
  }

  if (typeof payload === 'object') {
    return payload;
  }

  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const parseStoredJson = (value) => {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const getOutboundEmailById = async (db, emailId) => {
  return (await db.query('SELECT * FROM outbound_emails WHERE id = ?', [emailId]))[0] || null;
};

const listFailedOutboundEmails = async (db, limit = 25) => {
  const rows = await db.query(
    `
      SELECT id, recipient_email, subject, status, attempt_count, last_error, next_attempt_at,
             failed_at, dead_lettered_at, created_at, updated_at, metadata, provider_response
      FROM outbound_emails
      WHERE status IN ('retrying', 'dead_lettered')
      ORDER BY
        CASE status WHEN 'dead_lettered' THEN 0 ELSE 1 END,
        COALESCE(dead_lettered_at, failed_at, updated_at, created_at) DESC,
        id DESC
      LIMIT ?
    `,
    [limit]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    recipient_email: row.recipient_email || '',
    subject: row.subject || '',
    status: row.status || 'queued',
    attempt_count: Number(row.attempt_count || 0),
    last_error: row.last_error || null,
    next_attempt_at: row.next_attempt_at || null,
    failed_at: row.failed_at || null,
    dead_lettered_at: row.dead_lettered_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    metadata: parseStoredJson(row.metadata),
    provider_response: parseStoredJson(row.provider_response)
  }));
};

const summarizeFailedOutboundEmails = async (db) => {
  const rows = await db.query(
    `
      SELECT status, COUNT(*) AS count
      FROM outbound_emails
      WHERE status IN ('retrying', 'dead_lettered')
      GROUP BY status
    `
  );

  return rows.reduce((summary, row) => {
    const status = String(row.status || '').trim().toLowerCase();
    const count = Number(row.count || 0);
    if (status === 'retrying') {
      summary.retrying_count = count;
    }
    if (status === 'dead_lettered') {
      summary.dead_lettered_count = count;
    }
    summary.total_count += count;
    return summary;
  }, {
    retrying_count: 0,
    dead_lettered_count: 0,
    total_count: 0
  });
};

const buildOperatorReplayMetadata = (metadata = {}, actor = {}) => {
  const existingReplay = metadata && typeof metadata.operator_replay === 'object'
    ? metadata.operator_replay
    : {};

  return {
    ...metadata,
    operator_replay: {
      replay_count: Number(existingReplay.replay_count || 0) + 1,
      last_replayed_at: new Date().toISOString(),
      last_replayed_by: actor.userId ? String(actor.userId) : null,
      last_replayed_role: actor.actorRole || null
    }
  };
};

const queueOutboundEmail = async ({
  db,
  to,
  subject,
  text,
  html,
  metadata = {},
  payload = {}
}) => {
  const {
    recipientEmail,
    safeSubject,
    safeMetadata,
    safePayload
  } = sanitizeEmailPayload({
    to,
    subject,
    text,
    html,
    metadata,
    payload
  });

  const result = await db.execute(
    `
      INSERT INTO outbound_emails (
        recipient_email, subject, status, attempt_count, last_error, next_attempt_at, locked_at,
        metadata, payload, provider_response, sent_at, failed_at, dead_lettered_at
      )
      VALUES (?, ?, 'queued', 0, NULL, CURRENT_TIMESTAMP, NULL, ?, ?, NULL, NULL, NULL, NULL)
    `,
    [
      recipientEmail,
      safeSubject,
      JSON.stringify(safeMetadata),
      JSON.stringify(safePayload)
    ]
  );

  return {
    id: result.insertId,
    status: 'queued'
  };
};

const deliverOutboundEmail = async (options) => {
  return queueOutboundEmail(options);
};

const listDueOutboundEmailIds = async (db, limit) => {
  return db.query(
    `
      SELECT id
      FROM outbound_emails
      WHERE (
        status IN ('queued', 'retrying', 'pending')
        AND next_attempt_at <= CURRENT_TIMESTAMP
      )
      OR (
        status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${EMAIL_QUEUE_LOCK_TIMEOUT_SECONDS} SECOND)
      )
      ORDER BY COALESCE(next_attempt_at, created_at) ASC, id ASC
      LIMIT ?
    `,
    [limit]
  );
};

const claimOutboundEmail = async (db, emailId) => {
  const result = await db.execute(
    `
      UPDATE outbound_emails
      SET status = 'processing',
          locked_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND (
          (
            status IN ('queued', 'retrying', 'pending')
            AND next_attempt_at <= CURRENT_TIMESTAMP
          )
          OR (
            status = 'processing'
            AND locked_at IS NOT NULL
            AND locked_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${EMAIL_QUEUE_LOCK_TIMEOUT_SECONDS} SECOND)
          )
        )
    `,
    [emailId]
  );

  return Number(result.affectedRows || 0) > 0;
};

const markOutboundEmailSent = async (db, email, info) => {
  const attemptCount = Number(email.attempt_count || 0) + 1;
  await db.execute(
    `
      UPDATE outbound_emails
      SET status = 'sent',
          attempt_count = ?,
          last_error = NULL,
          provider_response = ?,
          next_attempt_at = CURRENT_TIMESTAMP,
          locked_at = NULL,
          sent_at = CURRENT_TIMESTAMP,
          failed_at = NULL,
          dead_lettered_at = NULL
      WHERE id = ?
    `,
    [
      attemptCount,
      JSON.stringify({
        messageId: info.messageId || null,
        accepted: Array.isArray(info.accepted) ? info.accepted : [],
        rejected: Array.isArray(info.rejected) ? info.rejected : []
      }),
      email.id
    ]
  );

  return {
    id: email.id,
    status: 'sent'
  };
};

const markOutboundEmailFailure = async (db, email, error) => {
  const attemptCount = Number(email.attempt_count || 0) + 1;
  const shouldRetry = attemptCount < EMAIL_QUEUE_RETRY_LIMIT;
  const nextAttemptAt = new Date(Date.now() + calculateRetryDelayMs(attemptCount));

  await db.execute(
    `
      UPDATE outbound_emails
      SET status = ?,
          attempt_count = ?,
          last_error = ?,
          provider_response = ?,
          next_attempt_at = ?,
          locked_at = NULL,
          failed_at = CURRENT_TIMESTAMP,
          dead_lettered_at = ?
      WHERE id = ?
    `,
    [
      shouldRetry ? 'retrying' : 'dead_lettered',
      attemptCount,
      getSafeErrorMessage(error),
      JSON.stringify({
        message: error.message
      }),
      nextAttemptAt,
      shouldRetry ? null : new Date(),
      email.id
    ]
  );

  return {
    id: email.id,
    status: shouldRetry ? 'retrying' : 'dead_lettered',
    next_attempt_at: shouldRetry ? nextAttemptAt.toISOString() : null
  };
};

const processQueuedOutboundEmail = async ({ db, emailId, logger = null }) => {
  const claimed = await claimOutboundEmail(db, emailId);
  if (!claimed) {
    return null;
  }

  const email = await getOutboundEmailById(db, emailId);
  if (!email) {
    return null;
  }

  const smtpConfig = resolveSmtpConfig();
  const payload = parseStoredPayload(email.payload);

  try {
    const transporter = await ensureTransporter();
    const info = await transporter.sendMail({
      from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      to: sanitizeEmail(email.recipient_email),
      subject: sanitizePlainText(email.subject || 'Aisle notification', { maxLength: 190 }) || 'Aisle notification',
      text: String(payload.text || '').trim() || undefined,
      html: String(payload.html || '').trim() || undefined
    });

    const result = await markOutboundEmailSent(db, email, info);
    logger?.info?.('notification_email_sent', {
      emailId,
      recipient: email.recipient_email,
      status: result.status
    });
    return result;
  } catch (error) {
    const result = await markOutboundEmailFailure(db, email, error);
    logger?.error?.('notification_email_delivery_failed', {
      emailId,
      recipient: email.recipient_email,
      status: result.status,
      error: error.message
    });
    return result;
  }
};

const requeueOutboundEmail = async ({ db, emailId, actor = {} }) => {
  const email = await getOutboundEmailById(db, emailId);
  if (!email) {
    throw createHttpError(404, 'Outbound email not found.', null, { expose: true });
  }

  const status = String(email.status || '').trim().toLowerCase();
  if (!['retrying', 'dead_lettered'].includes(status)) {
    throw createHttpError(409, 'Only retrying or dead-lettered emails can be replayed.', null, { expose: true });
  }

  const nextMetadata = buildOperatorReplayMetadata(parseStoredJson(email.metadata), actor);
  await db.execute(
    `
      UPDATE outbound_emails
      SET status = 'queued',
          next_attempt_at = CURRENT_TIMESTAMP,
          locked_at = NULL,
          dead_lettered_at = NULL,
          metadata = ?
      WHERE id = ?
    `,
    [
      JSON.stringify(nextMetadata),
      emailId
    ]
  );

  return getOutboundEmailById(db, emailId);
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

  return queueOutboundEmail({
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
  queueOutboundEmail,
  deliverOutboundEmail,
  listFailedOutboundEmails,
  summarizeFailedOutboundEmails,
  listDueOutboundEmailIds,
  processQueuedOutboundEmail,
  requeueOutboundEmail,
  buildOperatorReplayMetadata,
  sendTemplatedEmail
};
