const {
  normalizeHostname,
  normalizeOrigin,
  resolveSafeRedirect
} = require('./security');

describe('shared security helpers', () => {
  test('normalizeHostname strips path, query, fragment, and proxy suffixes without regex cleanup', () => {
    expect(normalizeHostname(' Example.com/path/to/file?x=1#section , proxy.local ')).toBe('example.com');
    expect(normalizeHostname('example.com?x=1')).toBe('example.com');
    expect(normalizeHostname('example.com#section')).toBe('example.com');
  });

  test('normalizeHostname keeps URL parsing behavior for absolute URLs', () => {
    expect(normalizeHostname('https://Store.Example.com/catalog?x=1')).toBe('store.example.com');
  });

  test('normalizeHostname rejects slash-only input quickly and safely', () => {
    expect(normalizeHostname('////////////////////')).toBe('');
  });

  test('normalizeOrigin still returns normalized host metadata', () => {
    expect(normalizeOrigin('https://Store.Example.com:443/path?x=1')).toEqual({
      protocol: 'https:',
      origin: 'https://store.example.com',
      hostname: 'store.example.com'
    });
  });

  test('resolveSafeRedirect still allows same-origin relative paths', () => {
    expect(resolveSafeRedirect('/account?tab=security', {
      baseUrl: 'https://store.example.com',
      allowedHosts: ['store.example.com']
    })).toBe('/account?tab=security');
  });
});
