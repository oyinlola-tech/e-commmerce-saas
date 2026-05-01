const createGatewayOpenApiSpec = (config) => {
  const parsedGatewayUrl = new URL(config.gatewayUrl);
  const localPortSuffix = parsedGatewayUrl.port ? `:${parsedGatewayUrl.port}` : '';
  const servers = config.isProduction
    ? [
        {
          url: `https://${config.rootDomain}`,
          description: 'Platform gateway',
          x-aisleAudience: 'platform'
        },
        {
          url: `https://{storeSubdomain}.${config.rootDomain}`,
          description: 'Storefront gateway',
          x-aisleAudience: 'storefront',
          variables: {
            storeSubdomain: {
              default: 'aisle',
              description: 'Store subdomain used for tenant-aware storefront requests.'
            }
          }
        }
      ]
    : [
        {
          url: `http://localhost${localPortSuffix}`,
          description: 'Local platform gateway',
          x-aisleAudience: 'platform'
        },
        {
          url: `http://{storeSubdomain}.localhost${localPortSuffix}`,
          description: 'Local storefront gateway',
          x-aisleAudience: 'storefront',
          variables: {
            storeSubdomain: {
              default: 'aisle',
              description: 'Local store subdomain used for tenant-aware storefront requests.'
            }
          }
        }
      ];

  return {
    openapi: '3.1.0',
    info: {
      title: 'Aisle Commerce Gateway API',
      version: '1.0.0',
      description: 'Gateway-level API contract for platform auth, tenant operations, storefront flows, and billing subscriptions.'
    },
    servers,
    tags: [
      { name: 'Health', description: 'Operational health and metrics endpoints.' },
      { name: 'Security', description: 'Browser security helpers such as CSRF token bootstrap.' },
      { name: 'Platform Auth', description: 'Platform owner and staff authentication.' },
      { name: 'Storefront Auth', description: 'Customer registration and login.' },
      { name: 'Owner Stores', description: 'Owner-scoped store management endpoints.' },
      { name: 'Products', description: 'Storefront product browsing.' },
      { name: 'Cart', description: 'Customer cart lifecycle.' },
      { name: 'Orders', description: 'Checkout and order management.' },
      { name: 'Billing', description: 'Owner subscription plans, checkout, and invoices.' },
      { name: 'Payments', description: 'Store payment-provider configuration.' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        platformTokenCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'platform_token'
        },
        customerTokenCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'customer_token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'object', additionalProperties: true }
          }
        },
        PlatformUser: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string' },
            status: { type: 'string' }
          }
        },
        Customer: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            store_id: { type: 'integer' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string', nullable: true }
          }
        },
        Product: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            store_id: { type: 'integer' },
            title: { type: 'string' },
            slug: { type: 'string' },
            category: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            price: { type: 'number' },
            compare_at_price: { type: 'number', nullable: true },
            sku: { type: 'string', nullable: true },
            inventory_count: { type: 'integer' },
            reserved_count: { type: 'integer' },
            available_inventory: { type: 'integer' },
            images: {
              type: 'array',
              items: { type: 'string', format: 'uri' }
            },
            status: { type: 'string' }
          }
        },
        CartItem: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            product_id: { type: 'integer' },
            quantity: { type: 'integer' },
            price: { type: 'number' },
            name: { type: 'string' },
            image: { type: 'string', nullable: true }
          }
        },
        Cart: {
          type: 'object',
          properties: {
            id: { type: 'integer', nullable: true },
            store_id: { type: 'integer' },
            customer_id: { type: 'integer', nullable: true },
            session_id: { type: 'string' },
            status: { type: 'string' },
            total: { type: 'number' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/CartItem' }
            }
          }
        },
        Order: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            store_id: { type: 'integer' },
            customer_id: { type: 'integer' },
            status: { type: 'string' },
            payment_status: { type: 'string' },
            subtotal: { type: 'number' },
            total: { type: 'number' },
            currency: { type: 'string' }
          }
        },
        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            owner_id: { type: 'integer' },
            plan: { type: 'string' },
            status: { type: 'string' },
            billing_cycle: { type: 'string', nullable: true },
            currency: { type: 'string', nullable: true },
            current_period_end: { type: 'string', format: 'date-time', nullable: true },
            trial_ends_at: { type: 'string', format: 'date-time', nullable: true }
          }
        },
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            owner_id: { type: 'integer' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            status: { type: 'string' },
            provider_reference: { type: 'string', nullable: true },
            payment_reference: { type: 'string', nullable: true }
          }
        },
        PaymentProviderOption: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            inline: { type: 'boolean' },
            public_key: { type: 'string', nullable: true },
            checkout_url: { type: 'string', format: 'uri' }
          }
        }
      }
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Gateway health check',
          responses: {
            '200': {
              description: 'Gateway status payload'
            }
          }
        }
      },
      '/metrics': {
        get: {
          tags: ['Health'],
          summary: 'Prometheus metrics',
          responses: {
            '200': {
              description: 'Prometheus text exposition format'
            }
          }
        }
      },
      '/api/csrf-token': {
        get: {
          tags: ['Security'],
          summary: 'Generate a gateway CSRF token',
          description: 'Use this before state-changing browser API requests that rely on cookies, then send the returned token in `X-CSRF-Token` or `_csrf`.',
          responses: {
            '200': {
              description: 'CSRF bootstrap payload',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      csrfToken: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/platform/auth/register': {
        post: {
          tags: ['Platform Auth'],
          summary: 'Register a platform user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'password'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    role: { type: 'string', default: 'store_owner' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Platform user created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      user: { $ref: '#/components/schemas/PlatformUser' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/platform/auth/login': {
        post: {
          tags: ['Platform Auth'],
          summary: 'Log in a platform user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Authenticated platform user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      user: { $ref: '#/components/schemas/PlatformUser' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/platform/auth/logout': {
        post: {
          tags: ['Platform Auth'],
          summary: 'Clear platform auth cookies',
          responses: {
            '204': {
              description: 'Platform session cleared'
            }
          }
        }
      },
      '/api/customers/register': {
        post: {
          tags: ['Storefront Auth'],
          summary: 'Register a storefront customer',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'email', 'password'],
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    phone: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Customer created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      customer: { $ref: '#/components/schemas/Customer' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/customers/login': {
        post: {
          tags: ['Storefront Auth'],
          summary: 'Log in a storefront customer',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Authenticated customer',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      customer: { $ref: '#/components/schemas/Customer' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/customers/logout': {
        post: {
          tags: ['Storefront Auth'],
          summary: 'Clear storefront auth cookies',
          responses: {
            '204': {
              description: 'Customer session cleared'
            }
          }
        }
      },
      '/api/owner/stores/{storeId}/logo': {
        post: {
          tags: ['Owner Stores'],
          summary: 'Upload a store logo',
          description: 'Accepts a PNG, JPEG, or WebP file up to 2 MB and stores the resulting public URL on the store record.',
          security: [
            { bearerAuth: [] },
            { platformTokenCookie: [] }
          ],
          parameters: [
            {
              name: 'storeId',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['logo'],
                  properties: {
                    logo: {
                      type: 'string',
                      format: 'binary'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Store logo updated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      logo_url: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/products': {
        get: {
          tags: ['Products'],
          summary: 'Browse storefront products',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'min_price', in: 'query', schema: { type: 'number' } },
            { name: 'max_price', in: 'query', schema: { type: 'number' } }
          ],
          responses: {
            '200': {
              description: 'Paginated product list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                      total: { type: 'integer' },
                      products: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Product' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/products/{slug}': {
        get: {
          tags: ['Products'],
          summary: 'Get one product by slug',
          parameters: [
            {
              name: 'slug',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'Product detail',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      product: { $ref: '#/components/schemas/Product' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/cart': {
        get: {
          tags: ['Cart'],
          summary: 'Fetch the active cart',
          responses: {
            '200': {
              description: 'Active cart',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      cart: { $ref: '#/components/schemas/Cart' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/cart/items': {
        post: {
          tags: ['Cart'],
          summary: 'Add an item to the cart',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['product_id'],
                  properties: {
                    product_id: { type: 'integer' },
                    quantity: { type: 'integer', default: 1 }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Updated cart',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      cart: { $ref: '#/components/schemas/Cart' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/cart/items/{productId}': {
        patch: {
          tags: ['Cart'],
          summary: 'Change item quantity',
          parameters: [
            {
              name: 'productId',
              in: 'path',
              required: true,
              schema: { type: 'integer' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['quantity'],
                  properties: {
                    quantity: { type: 'integer', minimum: 0 }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Updated cart',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      cart: { $ref: '#/components/schemas/Cart' }
                    }
                  }
                }
              }
            }
          }
        },
        delete: {
          tags: ['Cart'],
          summary: 'Remove an item from the cart',
          parameters: [
            {
              name: 'productId',
              in: 'path',
              required: true,
              schema: { type: 'integer' }
            }
          ],
          responses: {
            '200': {
              description: 'Updated cart',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      cart: { $ref: '#/components/schemas/Cart' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/cart/clear': {
        post: {
          tags: ['Cart'],
          summary: 'Clear the current cart',
          responses: {
            '200': {
              description: 'Cleared cart'
            }
          }
        }
      },
      '/api/checkout': {
        post: {
          tags: ['Orders'],
          summary: 'Create an order and payment session from the active cart',
          security: [
            { customerTokenCookie: [] },
            { bearerAuth: [] }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    currency: { type: 'string', example: 'NGN' },
                    email: { type: 'string', format: 'email' },
                    shipping_address: {
                      type: 'object',
                      additionalProperties: true
                    },
                    customer: {
                      type: 'object',
                      additionalProperties: true
                    }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Order and payment session created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      order: { $ref: '#/components/schemas/Order' },
                      providers: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PaymentProviderOption' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/orders': {
        get: {
          tags: ['Orders'],
          summary: 'List orders for the signed customer',
          security: [
            { customerTokenCookie: [] },
            { bearerAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Paginated orders'
            }
          }
        }
      },
      '/api/platform/billing/plans': {
        get: {
          tags: ['Billing'],
          summary: 'List available platform subscription plans',
          responses: {
            '200': {
              description: 'Subscription plan catalog'
            }
          }
        }
      },
      '/api/platform/billing/subscriptions/me': {
        get: {
          tags: ['Billing'],
          summary: 'Get the signed owner subscription',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Current owner subscription',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      subscription: { $ref: '#/components/schemas/Subscription' },
                      latest_invoice: { $ref: '#/components/schemas/Invoice' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/platform/billing/subscriptions/checkout-session': {
        post: {
          tags: ['Billing'],
          summary: 'Create a subscription checkout session',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['plan', 'billing_cycle'],
                  properties: {
                    plan: { type: 'string', example: 'growth' },
                    billing_cycle: { type: 'string', enum: ['monthly', 'yearly'] },
                    currency: { type: 'string', example: 'NGN' },
                    provider: { type: 'string', example: 'paystack' },
                    email: { type: 'string', format: 'email' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Invoice and provider checkout session created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      subscription: { $ref: '#/components/schemas/Subscription' },
                      invoice: { $ref: '#/components/schemas/Invoice' },
                      payment: {
                        type: 'object',
                        additionalProperties: true
                      },
                      providers: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PaymentProviderOption' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/platform/billing/subscriptions/cancel': {
        post: {
          tags: ['Billing'],
          summary: 'Cancel the signed owner subscription',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Updated subscription state'
            }
          }
        }
      },
      '/api/platform/billing/subscriptions/invoices': {
        get: {
          tags: ['Billing'],
          summary: 'List subscription invoices for the signed owner',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          responses: {
            '200': {
              description: 'Owner invoices'
            }
          }
        }
      },
      '/api/owner/stores/{storeId}/payments/config': {
        get: {
          tags: ['Payments'],
          summary: 'List store payment provider configuration',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          parameters: [
            {
              name: 'storeId',
              in: 'path',
              required: true,
              schema: { type: 'integer' }
            }
          ],
          responses: {
            '200': {
              description: 'Provider configuration rows'
            }
          }
        },
        post: {
          tags: ['Payments'],
          summary: 'Upsert store payment provider configuration',
          security: [
            { platformTokenCookie: [] },
            { bearerAuth: [] }
          ],
          parameters: [
            {
              name: 'storeId',
              in: 'path',
              required: true,
              schema: { type: 'integer' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['provider'],
                  properties: {
                    provider: { type: 'string', enum: ['paystack', 'flutterwave'] },
                    public_key: { type: 'string' },
                    secret_key: { type: 'string' },
                    status: { type: 'string', example: 'active' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Provider configuration saved'
            }
          }
        }
      }
    }
  };
};

module.exports = {
  createGatewayOpenApiSpec
};
