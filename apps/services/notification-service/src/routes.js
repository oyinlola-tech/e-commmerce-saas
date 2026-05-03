const { body, param } = require('express-validator');
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
const {
  renderTemplatedEmail,
  deliverOutboundEmail,
  listFailedOutboundEmails,
  summarizeFailedOutboundEmails,
  requeueOutboundEmail
} = require('./outbound-email');
const { sanitizeStructuredData } = require('./structured-data');
const {
  isPlatformOperationsUser,
  normalizeAsyncFailureLimit,
  listEventFailures,
  replayEventFailure
} = require('./async-operations');

const buildRequireInternal = (config) => {
  return requireInternalRequest(config.internalSharedSecret, {
    maxAgeMs: config.internalRequestMaxAgeMs,
    nonceTtlMs: config.internalRequestNonceTtlMs
  });
};

const validateTemplateRequest = ({ requireRecipient = false } = {}) => {
  const chains = [
    allowBodyFields(requireRecipient
      ? ['to', 'subject', 'text', 'html', 'metadata', 'template_key', 'template_data', 'brand', 'store_id']
      : ['template_key', 'template_data', 'brand', 'store_id']),
    commonRules.optionalPlainText('template_key', 120),
    body('template_data').optional().isObject().withMessage('template_data must be an object.'),
    body('brand').optional().isObject().withMessage('brand must be an object.'),
    body('store_id').optional().isInt({ min: 1 }).toInt()
  ];

  if (requireRecipient) {
    chains.splice(1, 0, body('to').isEmail().customSanitizer((value) => sanitizeEmail(value)));
    chains.splice(2, 0, commonRules.optionalPlainText('subject', 190));
    chains.splice(3, 0, body('text').optional().isString());
    chains.splice(4, 0, body('html').optional().isString());
    chains.splice(5, 0, commonRules.jsonObject('metadata'));
  }

  return chains;
};

const requirePlatformOperationsUser = (req, res, next) => {
  if (isPlatformOperationsUser(req.authContext)) {
    return next();
  }

  return res.status(403).json({
    error: 'Platform operations access is required.'
  });
};

const validateAsyncOpsReplayRequest = validate([
  allowBodyFields(['transport', 'queue_name', 'message_id']),
  body('transport').isIn(['rabbitmq', 'redis']).withMessage('Choose RabbitMQ or Redis for event replay.'),
  commonRules.optionalPlainText('queue_name', 160),
  commonRules.optionalPlainText('message_id', 120)
]);

const validateReplayEmailRequest = validate([
  param('emailId').isInt({ min: 1 }).toInt()
]);

const registerRoutes = async ({ app, db, config, logger }) => {
  const requireInternal = buildRequireInternal(config);

  app.get('/emails/templates', requireInternal, asyncHandler(async (req, res) => {
    return res.json({
      templates: listEmailTemplates()
    });
  }));

  app.post('/emails/render', requireInternal, validate(validateTemplateRequest()), asyncHandler(async (req, res) => {
    const templateKey = sanitizePlainText(req.body.template_key || '', { maxLength: 120 });
    if (!templateKey) {
      throw createHttpError(400, 'template_key is required for template rendering.', null, { expose: true });
    }

    const rendered = await renderTemplatedEmail({
      config,
      requestId: req.requestId || req.authContext.requestId,
      templateKey,
      templateData: sanitizeStructuredData(req.body.template_data || {}) || {},
      brand: sanitizeStructuredData(req.body.brand || {}) || {},
      storeId: req.body.store_id || null
    });

    return res.json({
      template: rendered.definition,
      brand: rendered.brand,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });
  }));

  app.post('/emails/send', requireInternal, validate(validateTemplateRequest({ requireRecipient: true })), asyncHandler(async (req, res) => {
    const templateKey = sanitizePlainText(req.body.template_key || '', { maxLength: 120 });
    const metadata = sanitizeJsonObject(req.body.metadata || {});
    let subject = sanitizePlainText(req.body.subject || 'Aisle notification', { maxLength: 190 }) || 'Aisle notification';
    let text = String(req.body.text || '').trim();
    let html = String(req.body.html || '').trim();
    let rendered = null;

    if (templateKey) {
      try {
        rendered = await renderTemplatedEmail({
          config,
          requestId: req.requestId || req.authContext.requestId,
          templateKey,
          templateData: sanitizeStructuredData(req.body.template_data || {}) || {},
          brand: sanitizeStructuredData(req.body.brand || {}) || {},
          storeId: req.body.store_id || null
        });
      } catch (error) {
        throw createHttpError(Number(error.status) || 422, error.message || 'Unable to render the email template.', null, {
          expose: true
        });
      }

      subject = sanitizePlainText(rendered.subject || subject, { maxLength: 190 }) || subject;
      text = String(rendered.text || '').trim();
      html = String(rendered.html || '').trim();
      metadata.template_key = templateKey;
      metadata.audience = rendered.definition?.audience || metadata.audience || '';
      metadata.brand_mode = rendered.definition?.brand_mode || metadata.brand_mode || '';
      if (req.body.store_id) {
        metadata.store_id = Number(req.body.store_id);
      }
    }

    const delivery = await deliverOutboundEmail({
      db,
      to: req.body.to,
      subject,
      text,
      html,
      metadata,
      payload: templateKey
        ? {
            template_key: templateKey,
            template_data: rendered?.templateData || sanitizeStructuredData(req.body.template_data || {}) || {},
            brand: rendered?.brandData || sanitizeStructuredData(req.body.brand || {}) || {},
            store_id: req.body.store_id || null
          }
        : {}
    });

    return res.status(201).json(delivery);
  }));

  app.get('/ops/async-failures', requireInternal, requirePlatformOperationsUser, asyncHandler(async (req, res) => {
    const limit = normalizeAsyncFailureLimit(req.query.limit);
    const [emailSummary, emailItems, eventFailures] = await Promise.all([
      summarizeFailedOutboundEmails(db),
      listFailedOutboundEmails(db, limit),
      listEventFailures({
        config,
        logger,
        limit
      })
    ]);

    return res.json({
      generated_at: new Date().toISOString(),
      email_failures: {
        summary: emailSummary,
        items: emailItems
      },
      event_failures: eventFailures
    });
  }));

  app.post('/ops/async-failures/emails/:emailId/replay', requireInternal, requirePlatformOperationsUser, validateReplayEmailRequest, asyncHandler(async (req, res) => {
    const email = await requeueOutboundEmail({
      db,
      emailId: Number(req.params.emailId),
      actor: {
        userId: req.authContext.userId,
        actorRole: req.authContext.actorRole
      }
    });

    return res.json({
      email: {
        id: Number(email.id),
        status: email.status,
        next_attempt_at: email.next_attempt_at || null
      }
    });
  }));

  app.post('/ops/async-failures/events/replay', requireInternal, requirePlatformOperationsUser, validateAsyncOpsReplayRequest, asyncHandler(async (req, res) => {
    if (!req.body.queue_name || !req.body.message_id) {
      throw createHttpError(422, 'queue_name and message_id are required for event replay.', null, { expose: true });
    }

    const replay = await replayEventFailure({
      config,
      queueName: req.body.queue_name,
      messageId: req.body.message_id,
      transport: req.body.transport,
      actor: {
        userId: req.authContext.userId,
        actorRole: req.authContext.actorRole
      }
    });

    return res.json({
      replay
    });
  }));
};

module.exports = {
  registerRoutes
};
