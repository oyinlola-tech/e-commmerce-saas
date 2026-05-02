const { jest: jestApi, afterEach } = require('@jest/globals');
const {
  createMarketingUnsubscribeToken
} = require('../../../../packages/shared/src/marketing-emails');
const {
  parseMarketingUnsubscribeToken
} = require('./marketing');

describe('customer marketing helpers', () => {
  const secret = 'customer-marketing-secret';

  afterEach(() => {
    jestApi.useRealTimers();
  });

  test('parses a valid marketing unsubscribe token', () => {
    const now = new Date('2026-05-02T09:00:00.000Z');
    jestApi.useFakeTimers().setSystemTime(now);

    const token = createMarketingUnsubscribeToken({
      customerId: 14,
      storeId: 7,
      email: 'SHOPPER@example.com',
      secret,
      now: now.getTime()
    });

    expect(parseMarketingUnsubscribeToken(token, secret)).toEqual({
      customerId: 14,
      storeId: 7,
      email: 'shopper@example.com'
    });
  });

  test('rejects an expired marketing unsubscribe token', () => {
    const issuedAt = new Date('2026-05-02T09:00:00.000Z');
    const expiredAt = new Date('2026-05-04T09:00:01.000Z');

    const token = createMarketingUnsubscribeToken({
      customerId: 14,
      storeId: 7,
      email: 'shopper@example.com',
      secret,
      now: issuedAt.getTime(),
      ttlMs: 24 * 60 * 60 * 1000
    });

    jestApi.useFakeTimers().setSystemTime(expiredAt);

    expect(() => parseMarketingUnsubscribeToken(token, secret)).toThrow('This unsubscribe link is no longer valid.');
  });
});
