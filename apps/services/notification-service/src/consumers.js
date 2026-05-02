const { URL } = require('url');
const {
  EVENT_NAMES,
  PLATFORM_ROLES,
  buildSignedInternalHeaders,
  requestJson,
  sanitizeEmail,
  sanitizePlainText
} = require('../../../../packages/shared');
const { sendTemplatedEmail } = require('./outbound-email');

const OWNER_STATUS_NOTIFICATION_STATUSES = new Set([
  'processing',
  'packed',
  'shipped',
  'fulfilled',
  'delivered',
  'completed',
  'cancelled'
]);

const joinUrl = (baseUrl, relativePath) => {
  try {
    return new URL(relativePath, baseUrl).toString();
  } catch {
    return '';
  }
};

const buildStorefrontUrl = (config, store = {}) => {
  const customDomain = sanitizePlainText(store.custom_domain || '', { maxLength: 190 }).toLowerCase();
  if (customDomain) {
    return `${config.isProduction ? 'https' : 'http'}://${customDomain}`;
  }

  const subdomain = sanitizePlainText(store.subdomain || '', { maxLength: 120 }).toLowerCase();
  if (subdomain && config.rootDomain) {
    return `${config.isProduction ? 'https' : 'http'}://${subdomain}.${config.rootDomain}`;
  }

  return config.webAppUrl;
};

const buildHeaders = ({
  config,
  requestId,
  storeId,
  userId,
  customerId,
  actorRole,
  actorType
}) => {
  return buildSignedInternalHeaders({
    requestId,
    storeId,
    userId,
    customerId,
    actorRole,
    actorType,
    secret: config.internalSharedSecret
  });
};

const safeRequestJson = async (url, options = {}) => {
  try {
    return await requestJson(url, options);
  } catch {
    return null;
  }
};

const getPlatformUser = async ({ config, ownerId, requestId }) => {
  const response = await safeRequestJson(`${config.serviceUrls.user}/auth/me`, {
    headers: buildHeaders({
      config,
      requestId,
      userId: ownerId,
      actorRole: PLATFORM_ROLES.STORE_OWNER,
      actorType: 'platform_user'
    }),
    timeoutMs: config.requestTimeoutMs
  });

  return response?.user || null;
};

const getStoreById = async ({ config, storeId, requestId }) => {
  const response = await safeRequestJson(`${config.serviceUrls.store}/stores/${encodeURIComponent(storeId)}`, {
    headers: buildHeaders({
      config,
      requestId,
      actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
      actorType: 'platform_user'
    }),
    timeoutMs: config.requestTimeoutMs
  });

  return response?.store || null;
};

const getCustomer = async ({ config, storeId, customerId, requestId }) => {
  const response = await safeRequestJson(`${config.serviceUrls.customer}/customers/me`, {
    headers: buildHeaders({
      config,
      requestId,
      storeId,
      customerId,
      actorType: 'customer'
    }),
    timeoutMs: config.requestTimeoutMs
  });

  return response?.customer || null;
};

const getOrder = async ({ config, storeId, orderId, requestId }) => {
  const response = await safeRequestJson(`${config.serviceUrls.order}/orders/${encodeURIComponent(orderId)}`, {
    headers: buildHeaders({
      config,
      requestId,
      storeId,
      actorRole: PLATFORM_ROLES.STORE_OWNER,
      actorType: 'platform_user'
    }),
    timeoutMs: config.requestTimeoutMs
  });

  return response?.order || null;
};

const getOwnerBilling = async ({ config, ownerId, requestId }) => {
  return safeRequestJson(`${config.serviceUrls.billing}/subscriptions/${encodeURIComponent(ownerId)}`, {
    headers: buildHeaders({
      config,
      requestId,
      actorRole: PLATFORM_ROLES.PLATFORM_OWNER,
      actorType: 'platform_user'
    }),
    timeoutMs: config.requestTimeoutMs
  });
};

const maybeSend = async ({ db, config, logger, requestId, to, templateKey, templateData, metadata, storeId }) => {
  const recipient = sanitizeEmail(to || '');
  if (!recipient) {
    return;
  }

  try {
    await sendTemplatedEmail({
      db,
      config,
      requestId,
      to: recipient,
      templateKey,
      templateData,
      metadata,
      storeId
    });
  } catch (error) {
    logger.error('Failed to send templated notification email', {
      templateKey,
      to: recipient,
      requestId,
      error: error.message
    });
  }
};

const maybeSendMany = async ({ recipients = [], ...options }) => {
  for (const recipient of recipients) {
    await maybeSend({
      ...options,
      to: recipient
    });
  }
};

const buildAdminOrdersUrl = (config, storeId) => {
  if (!storeId) {
    return joinUrl(config.webAppUrl, '/dashboard');
  }

  return joinUrl(config.webAppUrl, `/admin/orders?store=${encodeURIComponent(storeId)}`);
};

const buildAdminOrderUrl = (config, storeId, orderId) => {
  if (!storeId || !orderId) {
    return buildAdminOrdersUrl(config, storeId);
  }

  return joinUrl(config.webAppUrl, `/admin/orders/${encodeURIComponent(orderId)}?store=${encodeURIComponent(storeId)}`);
};

const listStoreNotificationRecipients = ({ user, store }) => {
  const recipients = [
    sanitizeEmail(user?.email || ''),
    sanitizeEmail(store?.support_email || '')
  ].filter(Boolean);

  return Array.from(new Set(recipients));
};

const buildOwnerContext = async ({ config, ownerId, requestId, explicitStoreId = null }) => {
  const [user, store] = await Promise.all([
    getPlatformUser({ config, ownerId, requestId }),
    explicitStoreId
      ? getStoreById({ config, storeId: explicitStoreId, requestId })
      : Promise.resolve(null)
  ]);

  return {
    user,
    store
  };
};

const registerConsumers = async ({ bus, db, config, logger }) => {
  await bus.subscribe({
    queueName: 'notification-service.lifecycle',
    events: [EVENT_NAMES.USER_REGISTERED, EVENT_NAMES.CUSTOMER_REGISTERED, EVENT_NAMES.STORE_CREATED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const requestId = `notification-${payload.event}-${Date.now()}`;

      if (payload.event === EVENT_NAMES.USER_REGISTERED && data.role === PLATFORM_ROLES.STORE_OWNER) {
        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: data.email,
          templateKey: 'platform.owner_welcome',
          templateData: {
            name: data.name || 'there',
            dashboard_url: joinUrl(config.webAppUrl, '/dashboard'),
            create_store_url: joinUrl(config.webAppUrl, '/dashboard'),
            billing_url: joinUrl(config.webAppUrl, '/dashboard')
          },
          metadata: {
            kind: 'owner_welcome',
            event: payload.event,
            owner_id: Number(data.user_id || 0)
          }
        });
        return;
      }

      if (payload.event === EVENT_NAMES.CUSTOMER_REGISTERED) {
        const customer = await getCustomer({
          config,
          storeId: Number(data.store_id),
          customerId: Number(data.customer_id),
          requestId
        });

        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: customer?.email || data.email,
          templateKey: 'store.customer_welcome',
          templateData: {
            name: customer?.name || 'there'
          },
          metadata: {
            kind: 'customer_welcome',
            event: payload.event,
            customer_id: Number(data.customer_id || 0)
          },
          storeId: Number(data.store_id)
        });
        return;
      }

      if (payload.event === EVENT_NAMES.STORE_CREATED) {
        const { user, store } = await buildOwnerContext({
          config,
          ownerId: Number(data.owner_id),
          requestId,
          explicitStoreId: Number(data.store_id)
        });
        if (!store) {
          return;
        }

        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: user?.email,
          templateKey: 'platform.store_created',
          templateData: {
            name: user?.name || 'there',
            store_name: store.name,
            store_url: buildStorefrontUrl(config, store),
            admin_url: joinUrl(config.webAppUrl, `/stores/${store.id}/manage`),
            custom_domain: store.custom_domain || '',
            subdomain: store.subdomain || ''
          },
          metadata: {
            kind: 'store_created',
            event: payload.event,
            owner_id: Number(data.owner_id || 0),
            store_id: Number(data.store_id || 0)
          }
        });
      }
    }
  });

  await bus.subscribe({
    queueName: 'notification-service.orders',
    events: [EVENT_NAMES.ORDER_CREATED, EVENT_NAMES.ORDER_STATUS_CHANGED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const requestId = `notification-${payload.event}-${Date.now()}`;
      const storeId = Number(data.store_id);
      const orderId = Number(data.order_id);
      if (!storeId || !orderId) {
        return;
      }

      const [order, store] = await Promise.all([
        getOrder({ config, storeId, orderId, requestId }),
        getStoreById({ config, storeId, requestId })
      ]);
      if (!order) {
        return;
      }

      const customerSnapshot = order.customer_snapshot || {};
      const orderUrl = joinUrl(buildStorefrontUrl(config, store || {}), '/orders');
      const adminOrdersUrl = buildAdminOrdersUrl(config, storeId);
      const adminOrderUrl = buildAdminOrderUrl(config, storeId, order.id);
      const baseData = {
        name: customerSnapshot.name || 'there',
        order_id: order.id,
        amount: Number(order.total || 0),
        currency: order.currency || 'USD',
        subtotal: Number(order.subtotal || 0),
        discount_total: Number(order.discount_total || 0),
        total: Number(order.total || 0),
        coupon_code: order.coupon_code || '',
        coupon: order.coupon || null,
        items: Array.isArray(order.items) ? order.items : [],
        shipping_address: order.shipping_address || null,
        payment_status: order.payment_status || 'pending',
        customer: customerSnapshot,
        created_at: order.created_at || null,
        updated_at: payload.timestamp || order.updated_at || null,
        order_url: orderUrl,
        admin_orders_url: adminOrdersUrl,
        admin_order_url: adminOrderUrl
      };

      if (payload.event === EVENT_NAMES.ORDER_CREATED) {
        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: customerSnapshot.email,
          templateKey: 'store.order_confirmation',
          templateData: {
            ...baseData,
            placed_at: order.created_at || payload.timestamp,
            continue_shopping_url: joinUrl(buildStorefrontUrl(config, store || {}), '/products')
          },
          metadata: {
            kind: 'order_confirmation',
            event: payload.event,
            order_id: order.id,
            customer_id: Number(order.customer_id || 0)
          },
          storeId
        });

        const ownerUser = store?.owner_id
          ? await getPlatformUser({
            config,
            ownerId: Number(store.owner_id),
            requestId
          })
          : null;
        const recipients = listStoreNotificationRecipients({ user: ownerUser, store });
        await maybeSendMany({
          recipients,
          db,
          config,
          logger,
          requestId,
          templateKey: 'store.owner_order_pending',
          templateData: {
            ...baseData,
            placed_at: order.created_at || payload.timestamp
          },
          metadata: {
            kind: 'owner_order_pending',
            event: payload.event,
            order_id: order.id,
            store_id: storeId
          },
          storeId
        });
        return;
      }

      const status = sanitizePlainText(data.status || order.status || '', { maxLength: 40 }).toLowerCase();
      const statusTemplateMap = {
        confirmed: 'store.order_status_processing',
        processing: 'store.order_status_processing',
        packed: 'store.order_status_processing',
        shipped: 'store.order_status_shipped',
        fulfilled: 'store.order_status_shipped',
        delivered: 'store.order_status_delivered',
        completed: 'store.order_status_delivered',
        cancelled: 'store.order_cancelled'
      };
      const templateKey = statusTemplateMap[status];
      if (!templateKey) {
        return;
      }

      await maybeSend({
        db,
        config,
        logger,
        requestId,
        to: customerSnapshot.email,
        templateKey,
        templateData: {
          ...baseData,
          status,
          shipped_at: payload.timestamp,
          delivered_at: payload.timestamp,
          cancelled_at: payload.timestamp
        },
        metadata: {
          kind: 'order_status_update',
          event: payload.event,
          order_id: order.id,
          status
        },
        storeId
      });

      if (!OWNER_STATUS_NOTIFICATION_STATUSES.has(status)) {
        return;
      }

      const ownerUser = store?.owner_id
        ? await getPlatformUser({
          config,
          ownerId: Number(store.owner_id),
          requestId
        })
        : null;
      const recipients = listStoreNotificationRecipients({ user: ownerUser, store });
      await maybeSendMany({
        recipients,
        db,
        config,
        logger,
        requestId,
        templateKey: 'store.owner_order_status_changed',
        templateData: {
          ...baseData,
          status
        },
        metadata: {
          kind: 'owner_order_status_changed',
          event: payload.event,
          order_id: order.id,
          store_id: storeId,
          status
        },
        storeId
      });
    }
  });

  await bus.subscribe({
    queueName: 'notification-service.payments',
    events: [EVENT_NAMES.PAYMENT_SUCCEEDED, EVENT_NAMES.PAYMENT_FAILED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const requestId = `notification-${payload.event}-${Date.now()}`;

      if (data.entity_type === 'order' && data.order_id && data.store_id) {
        const [order, store] = await Promise.all([
          getOrder({
            config,
            storeId: Number(data.store_id),
            orderId: Number(data.order_id),
            requestId
          }),
          getStoreById({
            config,
            storeId: Number(data.store_id),
            requestId
          })
        ]);
        if (!order) {
          return;
        }

        const customerSnapshot = order.customer_snapshot || {};
        const adminOrdersUrl = buildAdminOrdersUrl(config, Number(data.store_id));
        const adminOrderUrl = buildAdminOrderUrl(config, Number(data.store_id), order.id);
        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: customerSnapshot.email || data.metadata?.email,
          templateKey: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
            ? 'store.payment_receipt'
            : 'store.payment_failed',
          templateData: {
            name: customerSnapshot.name || 'there',
            order_id: order.id,
            amount: Number(data.amount || order.total || 0),
            currency: data.currency || order.currency || 'USD',
            subtotal: Number(order.subtotal || 0),
            discount_total: Number(order.discount_total || 0),
            total: Number(order.total || 0),
            coupon_code: order.coupon_code || '',
            coupon: order.coupon || null,
            items: Array.isArray(order.items) ? order.items : [],
            customer: customerSnapshot,
            shipping_address: order.shipping_address || null,
            payment_status: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED ? 'paid' : 'failed',
            payment_reference: data.reference || '',
            reference: data.reference || '',
            paid_at: payload.timestamp,
            retry_url: joinUrl(buildStorefrontUrl(config, store || {}), '/checkout'),
            cart_url: joinUrl(buildStorefrontUrl(config, store || {}), '/cart'),
            order_url: joinUrl(buildStorefrontUrl(config, store || {}), '/orders'),
            admin_orders_url: adminOrdersUrl,
            admin_order_url: adminOrderUrl
          },
          metadata: {
            kind: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED ? 'payment_receipt' : 'payment_failed',
            event: payload.event,
            order_id: Number(data.order_id || 0),
            payment_id: Number(data.payment_id || 0)
          },
          storeId: Number(data.store_id)
        });

        const ownerUser = store?.owner_id
          ? await getPlatformUser({
            config,
            ownerId: Number(store.owner_id),
            requestId
          })
          : null;
        const recipients = listStoreNotificationRecipients({ user: ownerUser, store });
        await maybeSendMany({
          recipients,
          db,
          config,
          logger,
          requestId,
          templateKey: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
            ? 'store.owner_order_paid'
            : 'store.owner_order_payment_failed',
          templateData: {
            name: customerSnapshot.name || 'there',
            order_id: order.id,
            amount: Number(data.amount || order.total || 0),
            currency: data.currency || order.currency || 'USD',
            subtotal: Number(order.subtotal || 0),
            discount_total: Number(order.discount_total || 0),
            total: Number(order.total || 0),
            coupon_code: order.coupon_code || '',
            coupon: order.coupon || null,
            items: Array.isArray(order.items) ? order.items : [],
            customer: customerSnapshot,
            shipping_address: order.shipping_address || null,
            payment_status: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED ? 'paid' : 'failed',
            payment_reference: data.reference || '',
            reference: data.reference || '',
            paid_at: payload.timestamp,
            created_at: order.created_at || null,
            updated_at: payload.timestamp || order.updated_at || null,
            admin_orders_url: adminOrdersUrl,
            admin_order_url: adminOrderUrl
          },
          metadata: {
            kind: payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED ? 'owner_order_paid' : 'owner_order_payment_failed',
            event: payload.event,
            order_id: Number(data.order_id || 0),
            payment_id: Number(data.payment_id || 0),
            store_id: Number(data.store_id || 0)
          },
          storeId: Number(data.store_id)
        });
        return;
      }

      if (!data.owner_id || !['invoice', 'subscription'].includes(String(data.entity_type || '').trim().toLowerCase())) {
        return;
      }

      const [{ user, store }, billing] = await Promise.all([
        buildOwnerContext({
          config,
          ownerId: Number(data.owner_id),
          requestId,
          explicitStoreId: Number(data.store_id || 0) || null
        }),
        getOwnerBilling({
          config,
          ownerId: Number(data.owner_id),
          requestId
        })
      ]);

      const subscription = billing?.subscription || null;
      const latestInvoice = billing?.latest_invoice || null;
      const targetTemplate = payload.event === EVENT_NAMES.PAYMENT_SUCCEEDED
        ? (String(data.entity_type).toLowerCase() === 'subscription'
          ? 'platform.subscription_trial_started'
          : 'platform.subscription_invoice_paid')
        : 'platform.subscription_payment_failed';

      await maybeSend({
        db,
        config,
        logger,
        requestId,
        to: user?.email,
        templateKey: targetTemplate,
        templateData: {
          name: user?.name || 'there',
          store_name: store?.name || '',
          plan_name: subscription?.plan || latestInvoice?.metadata?.plan || '',
          plan: subscription?.plan || latestInvoice?.metadata?.plan || '',
          amount: Number(data.amount || latestInvoice?.amount || subscription?.plan_amount || 0),
          currency: data.currency || latestInvoice?.currency || subscription?.currency || 'USD',
          invoice_id: latestInvoice?.id || data.entity_id || '',
          payment_reference: data.reference || latestInvoice?.payment_reference || '',
          reference: data.reference || '',
          paid_at: payload.timestamp,
          stage: data.metadata?.stage || latestInvoice?.metadata?.stage || '',
          trial_ends_at: subscription?.trial_ends_at || '',
          current_period_end: subscription?.current_period_end || latestInvoice?.period_end || '',
          billing_url: joinUrl(config.webAppUrl, '/dashboard')
        },
        metadata: {
          kind: targetTemplate,
          event: payload.event,
          owner_id: Number(data.owner_id || 0),
          invoice_id: Number(latestInvoice?.id || 0),
          subscription_id: Number(subscription?.id || 0)
        }
      });
    }
  });

  await bus.subscribe({
    queueName: 'notification-service.subscription-state',
    events: [EVENT_NAMES.SUBSCRIPTION_CHANGED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const requestId = `notification-${payload.event}-${Date.now()}`;
      const ownerId = Number(data.owner_id);
      if (!ownerId) {
        return;
      }

      const [{ user, store }, billing] = await Promise.all([
        buildOwnerContext({
          config,
          ownerId,
          requestId,
          explicitStoreId: Number(data.store_id || 0) || null
        }),
        getOwnerBilling({
          config,
          ownerId,
          requestId
        })
      ]);

      const subscription = billing?.subscription || null;
      if (!subscription) {
        return;
      }

      if (subscription.cancel_at_period_end && ['active', 'trialing'].includes(String(subscription.status || '').toLowerCase())) {
        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: user?.email,
          templateKey: 'platform.subscription_cancellation_scheduled',
          templateData: {
            name: user?.name || 'there',
            store_name: store?.name || '',
            plan_name: subscription.plan || '',
            plan: subscription.plan || '',
            current_period_end: subscription.current_period_end || '',
            billing_url: joinUrl(config.webAppUrl, '/dashboard')
          },
          metadata: {
            kind: 'subscription_cancellation_scheduled',
            event: payload.event,
            owner_id: ownerId,
            subscription_id: Number(subscription.id || 0)
          }
        });
        return;
      }

      if (String(subscription.status || '').toLowerCase() === 'cancelled') {
        await maybeSend({
          db,
          config,
          logger,
          requestId,
          to: user?.email,
          templateKey: 'platform.subscription_cancelled',
          templateData: {
            name: user?.name || 'there',
            store_name: store?.name || '',
            plan_name: subscription.plan || '',
            plan: subscription.plan || '',
            cancelled_at: subscription.cancelled_at || payload.timestamp,
            billing_url: joinUrl(config.webAppUrl, '/dashboard')
          },
          metadata: {
            kind: 'subscription_cancelled',
            event: payload.event,
            owner_id: ownerId,
            subscription_id: Number(subscription.id || 0)
          }
        });
      }
    }
  });

  await bus.subscribe({
    queueName: 'notification-service.compliance',
    events: [EVENT_NAMES.COMPLIANCE_STATUS_CHANGED],
    onMessage: async (payload) => {
      const data = payload.data || {};
      const requestId = `notification-${payload.event}-${Date.now()}`;
      const ownerId = Number(data.owner_id);
      if (!ownerId) {
        return;
      }

      const { user, store } = await buildOwnerContext({
        config,
        ownerId,
        requestId,
        explicitStoreId: Number(data.store_id || 0) || null
      });

      await maybeSend({
        db,
        config,
        logger,
        requestId,
        to: user?.email,
        templateKey: 'platform.compliance_status_changed',
        templateData: {
          name: user?.name || 'there',
          store_name: store?.name || '',
          target_type: data.target_type || 'compliance',
          status: data.status || 'pending',
          compliance_url: joinUrl(config.webAppUrl, '/dashboard')
        },
        metadata: {
          kind: 'compliance_status_changed',
          event: payload.event,
          owner_id: ownerId,
          target_type: data.target_type || 'compliance'
        }
      });
    }
  });
};

module.exports = {
  registerConsumers
};
