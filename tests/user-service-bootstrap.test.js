const {
  resolveBootstrapAdminConfig,
  isDefaultPlatformAdminPassword,
  isPlaceholderPlatformAdminEmail
} = require('../apps/services/user-service/src/bootstrap-admin');

describe('user-service platform admin bootstrap config', () => {
  test('allows development fallback credentials outside production', () => {
    const config = resolveBootstrapAdminConfig({
      env: {},
      rootDomain: 'localhost',
      isProduction: false
    });

    expect(config.configuredEmail).toBe('platform-admin@example.com');
    expect(isDefaultPlatformAdminPassword(config.configuredPassword)).toBe(true);
    expect(isPlaceholderPlatformAdminEmail(config.configuredEmail)).toBe(true);
  });

  test('requires explicit non-placeholder production email', () => {
    expect(() => resolveBootstrapAdminConfig({
      env: {
        PLATFORM_ADMIN_PASSWORD: 'SuperSecurePassword123!'
      },
      rootDomain: 'aisle.so',
      isProduction: true
    })).toThrow('PLATFORM_ADMIN_EMAIL must be explicitly set to a real, non-placeholder email in production.');
  });

  test('rejects the default development password in production', () => {
    expect(() => resolveBootstrapAdminConfig({
      env: {
        PLATFORM_ADMIN_EMAIL: 'ops@aisle.so',
        PLATFORM_ADMIN_PASSWORD: 'ChangeMe123!'
      },
      rootDomain: 'aisle.so',
      isProduction: true
    })).toThrow('PLATFORM_ADMIN_PASSWORD must be changed from the development default in production.');
  });
});
