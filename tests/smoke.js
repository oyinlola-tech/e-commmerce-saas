const { spawn } = require('child_process');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '..');
const shouldStartProcesses = String(process.env.SMOKE_START_PROCESSES || '0') === '1';
const processStartupDelayMs = Number(process.env.SMOKE_STARTUP_DELAY_MS || 5000);

const services = [
  { name: 'web', script: 'start:web', url: 'http://127.0.0.1:3000' },
  { name: 'gateway', script: 'start:gateway', url: 'http://127.0.0.1:4000' },
  { name: 'user-service', script: 'start:user-service', url: 'http://127.0.0.1:4101' },
  { name: 'store-service', script: 'start:store-service', url: 'http://127.0.0.1:4102' },
  { name: 'compliance-service', script: 'start:compliance-service', url: 'http://127.0.0.1:4103' },
  { name: 'customer-service', script: 'start:customer-service', url: 'http://127.0.0.1:4104' },
  { name: 'product-service', script: 'start:product-service', url: 'http://127.0.0.1:4105' },
  { name: 'cart-service', script: 'start:cart-service', url: 'http://127.0.0.1:4106' },
  { name: 'order-service', script: 'start:order-service', url: 'http://127.0.0.1:4107' },
  { name: 'payment-service', script: 'start:payment-service', url: 'http://127.0.0.1:4108' },
  { name: 'billing-service', script: 'start:billing-service', url: 'http://127.0.0.1:4109' }
];

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
};

const startService = (service) => {
  const child = spawn('npm', ['run', service.script], {
    cwd: workspaceRoot,
    shell: true,
    stdio: 'inherit'
  });

  return child;
};

const run = async () => {
  const children = [];

  try {
    if (shouldStartProcesses) {
      console.log('Starting configured services for smoke test...');
      services.forEach((service) => {
        children.push(startService(service));
      });
      await sleep(processStartupDelayMs);
    } else {
      console.log('SMOKE_START_PROCESSES=1 was not set, so the smoke test will probe running services only.');
    }

    for (const service of services) {
      const result = await fetchJson(`${service.url}/health`).catch((error) => ({
        ok: false,
        status: 0,
        payload: error.message
      }));

      console.log(`[health] ${service.name} -> ${result.status}`, result.payload);
    }

    const gatewayDocs = await fetchJson('http://127.0.0.1:4000/openapi.json').catch((error) => ({
      ok: false,
      status: 0,
      payload: error.message
    }));
    console.log('[gateway-docs]', gatewayDocs.status, gatewayDocs.ok ? 'openapi loaded' : gatewayDocs.payload);

    const storefront = await fetch('http://127.0.0.1:3000/', {
      headers: {
        Accept: 'text/html'
      }
    }).then((response) => ({
      status: response.status,
      ok: response.ok
    })).catch((error) => ({
      status: 0,
      ok: false,
      payload: error.message
    }));
    console.log('[storefront-home]', storefront.status, storefront.ok ? 'ok' : storefront.payload);
  } finally {
    children.forEach((child) => {
      if (!child.killed) {
        child.kill();
      }
    });
  }
};

run().catch((error) => {
  console.error('Smoke test failed', error);
  process.exitCode = 1;
});
