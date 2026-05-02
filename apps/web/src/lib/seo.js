const cleanStructuredData = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => cleanStructuredData(entry))
      .filter((entry) => {
        if (entry === null || entry === undefined || entry === '') {
          return false;
        }

        if (Array.isArray(entry)) {
          return entry.length > 0;
        }

        if (typeof entry === 'object') {
          return Object.keys(entry).length > 0;
        }

        return true;
      });
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      const cleaned = cleanStructuredData(entry);
      if (cleaned === null || cleaned === undefined || cleaned === '') {
        return accumulator;
      }

      if (Array.isArray(cleaned) && !cleaned.length) {
        return accumulator;
      }

      if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && !Object.keys(cleaned).length) {
        return accumulator;
      }

      accumulator[key] = cleaned;
      return accumulator;
    }, {});
  }

  return value;
};

const escapeXml = (value = '') => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const toIsoDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString();
};

const buildSitemapXml = (entries = []) => {
  const rows = entries
    .filter((entry) => entry && entry.loc)
    .map((entry) => {
      const tags = [
        `<loc>${escapeXml(entry.loc)}</loc>`
      ];

      if (entry.lastmod) {
        tags.push(`<lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      }

      if (entry.changefreq) {
        tags.push(`<changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
      }

      if (entry.priority !== undefined && entry.priority !== null && entry.priority !== '') {
        tags.push(`<priority>${escapeXml(entry.priority)}</priority>`);
      }

      return `  <url>\n    ${tags.join('\n    ')}\n  </url>`;
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    rows.join('\n'),
    '</urlset>'
  ].join('\n');
};

const buildRobotsTxt = ({ lines = [], sitemapUrl = '' } = {}) => {
  const output = [
    'User-agent: *',
    ...lines.filter(Boolean)
  ];

  if (sitemapUrl) {
    output.push(`Sitemap: ${sitemapUrl}`);
  }

  return `${output.join('\n')}\n`;
};

const buildBreadcrumbStructuredData = (items = []) => {
  return cleanStructuredData({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item
    }))
  });
};

const buildItemListStructuredData = (items = [], options = {}) => {
  return cleanStructuredData({
    '@context': 'https://schema.org',
    '@type': options.type || 'ItemList',
    name: options.name,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: item.url,
      name: item.name,
      image: item.image
    }))
  });
};

const buildFaqStructuredData = (items = []) => {
  return cleanStructuredData({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer
      }
    }))
  });
};

module.exports = {
  cleanStructuredData,
  escapeXml,
  toIsoDate,
  buildSitemapXml,
  buildRobotsTxt,
  buildBreadcrumbStructuredData,
  buildItemListStructuredData,
  buildFaqStructuredData
};
