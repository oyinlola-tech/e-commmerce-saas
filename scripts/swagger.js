const fs = require('fs');
const path = require('path');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { createServiceConfig } = require('../packages/shared/src/env');
const { createGatewayOpenApiSpec } = require('../apps/gateway/src/openapi');

const gatewayAppRoot = path.join(__dirname, '..', 'apps', 'gateway');
const outputDirectory = path.join(__dirname, '..', 'docs', 'swagger');
const outputPath = path.join(outputDirectory, 'gateway.openapi.json');

const gatewayConfig = createServiceConfig({
  appRoot: gatewayAppRoot,
  serviceName: 'gateway',
  defaultPort: 4000,
  defaultDatabase: 'gateway_db'
});

const openApiSpec = createGatewayOpenApiSpec(gatewayConfig);

const ensureOutputDirectory = () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
};

const writeSpecToDisk = () => {
  ensureOutputDirectory();
  fs.writeFileSync(outputPath, `${JSON.stringify(openApiSpec, null, 2)}\n`);
  return outputPath;
};

const startSwaggerServer = () => {
  const app = express();
  const swaggerPort = Number(process.env.SWAGGER_PORT || 4015);
  const exportedPath = writeSpecToDisk();

  app.get('/health', (req, res) => {
    return res.json({
      service: 'swagger-preview',
      status: 'ok',
      exportedSpec: exportedPath
    });
  });

  app.get('/openapi.json', (req, res) => {
    return res.json(openApiSpec);
  });

  app.use('/', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    explorer: true,
    customSiteTitle: 'Aisle Swagger Playground',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      tryItOutEnabled: true
    },
    customCss: `
      .swagger-ui .topbar { display: none; }
      .swagger-ui .scheme-container { box-shadow: none; border-bottom: 1px solid #e2e8f0; }
      .swagger-ui .information-container { padding-top: 8px; }
    `
  }));

  app.listen(swaggerPort, () => {
    console.log(`Swagger playground available at http://127.0.0.1:${swaggerPort}`);
    console.log(`OpenAPI spec exported to ${exportedPath}`);
    console.log('Use the server selector in Swagger UI:');
    console.log('- Platform APIs: http://localhost:4000');
    console.log('- Storefront APIs: http://{storeSubdomain}.localhost:4000');
    console.log('For direct request samples, open tests/aisle-api.http in your editor.');
  });
};

if (process.argv.includes('--export-only')) {
  const exportedPath = writeSpecToDisk();
  console.log(`OpenAPI spec exported to ${exportedPath}`);
  process.exit(0);
}

startSwaggerServer();
