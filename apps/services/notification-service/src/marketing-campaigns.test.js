const {
  buildNextMonthlySendAt,
  buildMonthlyMarketingTemplateData
} = require('./marketing-campaigns');

describe('notification marketing campaign helpers', () => {
  test('schedules the next send one month after the reference date', () => {
    expect(buildNextMonthlySendAt('2026-01-15T10:30:00.000Z').toISOString()).toBe('2026-02-15T10:30:00.000Z');
  });

  test('builds monthly template data with storefront product and unsubscribe links', () => {
    const templateData = buildMonthlyMarketingTemplateData({
      config: {
        webAppUrl: 'https://app.aisle.test',
        internalSharedSecret: 'notification-secret'
      },
      store: {
        id: 3,
        name: 'Verde Atelier',
        storefront_url: 'https://verde.example.com'
      },
      customer: {
        id: 9,
        name: 'Ava',
        email: 'ava@example.com'
      },
      products: [
        {
          id: 11,
          title: 'Barrier Repair Serum',
          slug: 'barrier-repair-serum',
          category: 'Skincare',
          description: 'A light serum for calm, hydrated skin.',
          price: 38,
          compare_at_price: 48,
          discount_label: 'Launch price',
          images: ['/media/barrier-serum.jpg']
        }
      ],
      currency: 'USD'
    });

    expect(templateData.products_count).toBe(1);
    expect(templateData.discounted_products_count).toBe(1);
    expect(templateData.category_count).toBe(1);
    expect(templateData.catalog_url).toBe('https://verde.example.com/products');
    expect(templateData.products[0].product_url).toBe('https://verde.example.com/products/barrier-repair-serum');
    expect(templateData.products[0].image_url).toBe('https://verde.example.com/media/barrier-serum.jpg');
    expect(templateData.unsubscribe_url).toMatch(/^https:\/\/app\.aisle\.test\/email\/unsubscribe\?token=/);
  });
});
