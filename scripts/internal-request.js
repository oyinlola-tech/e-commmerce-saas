const path = require('path');
const { createServiceConfig } = require('../packages/shared/src/env');
const { buildSignedInternalHeaders } = require('../packages/shared/src/internal-auth');
const { requestJson } = require('../packages/shared/src/http');

const gatewayAppRoot = path.join(__dirname, '..', 'apps', 'gateway');
const config = createServiceConfig({
  appRoot: gatewayAppRoot,
  serviceName: 'gateway',
  defaultPort: 4000,
  defaultDatabase: 'gateway_db'
});

const serviceAliases = {
  user: 'user',
  'user-service': 'user',
  store: 'store',
  'store-service': 'store',
  compliance: 'compliance',
  'compliance-service': 'compliance',
  customer: 'customer',
  'customer-service': 'customer',
  product: 'product',
  'product-service': 'product',
  cart: 'cart',
  'cart-service': 'cart',
  order: 'order',
  'order-service': 'order',
  payment: 'payment',
  'payment-service': 'payment',
  billing: 'billing',
  'billing-service': 'billing',
  support: 'support',
  'support-service': 'support',
  chat: 'chat',
  'chat-service': 'chat',
  notification: 'notification',
  'notification-service': 'notification'
};

const parseArgs = (argv) => {
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = entry.slice(2).split('=');
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];
    const value = inlineValue !== undefined || nextValue === undefined || nextValue.startsWith('--')
      ? inlineValue ?? 'true'
      : nextValue;

    flags[rawKey] = value;

    if (inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith('--')) {
      index += 1;
    }
  }

  return flags;
};

const printUsage = () => {
  console.log(`Usage:
  npm run api:request -- --service product --method GET --path /products --store-id 12
  npm run api:request -- --service order --method POST --path /checkout --store-id 12 --customer-id 44 --actor-type customer --body '{"currency":"USD"}'

Options:
  --service <name>        Service alias such as product, order, billing, store, payment
  --url <absoluteUrl>     Override the full target URL instead of resolving from --service
  --method <verb>         HTTP method, defaults to GET
  --path <pathname>       Path on the target service, required when using --service
  --body <json>           Inline JSON request body
  --body-file <path>      Path to a JSON file for the request body
  --store-id <value>      x-store-id context used for signed internal headers
  --user-id <value>       x-user-id context used for signed internal headers
  --customer-id <value>   x-customer-id context used for signed internal headers
  --actor-role <value>    x-actor-role context used for signed internal headers
  --actor-type <value>    x-actor-type context used for signed internal headers
  --forwarded-host <host> x-forwarded-host value included in the signature
  --timeout-ms <number>   Request timeout in milliseconds
  --help                  Show this message
`);
};

const loadJsonFile = (targetPath) => {
  const resolvedPath = path.resolve(process.cwd(), targetPath);
  return require(resolvedPath);
};

const toAbsoluteUrl = (flags) => {
  if (flags.url) {
    return String(flags.url).trim();
  }

  const alias = serviceAliases[String(flags.service || '').trim().toLowerCase()];
  if (!alias) {
    throw new Error('Provide --service with a supported alias or pass --url directly.');
  }

  const pathname = String(flags.path || '').trim();
  if (!pathname.startsWith('/')) {
    throw new Error('When using --service, --path must start with "/".');
  }

  return `${config.serviceUrls[alias]}${pathname}`;
};

const parseBody = (flags) => {
  const bodyFile = flags.bodyFile || flags['body-file'];
  if (bodyFile) {
    return loadJsonFile(bodyFile);
  }

  if (flags.body) {
    return JSON.parse(String(flags.body));
  }

  return undefined;
};

const buildHeaders = (flags) => {
  const headers = buildSignedInternalHeaders({
    requestId: String(flags.requestId || `cli-${Date.now()}`),
    forwardedHost: String(flags.forwardedHost || flags['forwarded-host'] || '127.0.0.1'),
    storeId: flags.storeId || flags['store-id'] || '',
    userId: flags.userId || flags['user-id'] || '',
    actorRole: flags.actorRole || flags['actor-role'] || '',
    customerId: flags.customerId || flags['customer-id'] || '',
    actorType: flags.actorType || flags['actor-type'] || '',
    secret: config.internalSharedSecret
  });

  if (flags.header) {
    const headerEntries = Array.isArray(flags.header) ? flags.header : [flags.header];
    headerEntries.forEach((entry) => {
      const separatorIndex = String(entry).indexOf(':');
      if (separatorIndex <= 0) {
        return;
      }

      const key = String(entry).slice(0, separatorIndex).trim();
      const value = String(entry).slice(separatorIndex + 1).trim();
      if (key) {
        headers[key] = value;
      }
    });
  }

  return headers;
};

const run = async () => {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h || process.argv.length <= 2) {
    printUsage();
    return;
  }

  const method = String(flags.method || 'GET').trim().toUpperCase();
  const url = toAbsoluteUrl(flags);
  const body = parseBody(flags);
  const headers = buildHeaders(flags);

  const response = await requestJson(url, {
    method,
    headers,
    body,
    timeoutMs: Number(flags.timeoutMs || flags['timeout-ms'] || config.requestTimeoutMs)
  });

  console.log(JSON.stringify(response, null, 2));
};

run().catch((error) => {
  const status = error?.status ? ` (${error.status})` : '';
  console.error(`Request failed${status}: ${error.message}`);
  if (error?.payload !== undefined) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exitCode = 1;
});
