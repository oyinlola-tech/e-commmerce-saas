const net = require('net');

const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME_PATTERN = new RegExp(`^(?=.{1,253}$)${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})*$`, 'i');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const takeBeforeFirstDelimiter = (value = '', delimiters = []) => {
  let endIndex = value.length;

  for (const delimiter of delimiters) {
    const index = value.indexOf(delimiter);
    if (index !== -1 && index < endIndex) {
      endIndex = index;
    }
  }

  return endIndex === value.length
    ? value
    : value.slice(0, endIndex);
};

const stripPort = (value = '') => {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('[')) {
    const closingIndex = normalized.indexOf(']');
    return closingIndex >= 0
      ? normalized.slice(1, closingIndex)
      : normalized;
  }

  const lastColonIndex = normalized.lastIndexOf(':');
  const hasSingleColon = lastColonIndex > -1 && normalized.indexOf(':') === lastColonIndex;

  if (hasSingleColon) {
    return normalized.slice(0, lastColonIndex);
  }

  return normalized;
};

const normalizeHostname = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const withoutProtocol = raw.includes('://')
    ? (() => {
      try {
        return new URL(raw).hostname;
      } catch {
        return raw;
      }
    })()
    : raw;

  const firstSegment = takeBeforeFirstDelimiter(withoutProtocol.trim(), [',', '/', '?', '#']).trim();

  const hostname = stripPort(firstSegment).toLowerCase();
  if (!hostname) {
    return '';
  }

  if (LOCAL_HOSTS.has(hostname) || net.isIP(hostname)) {
    return hostname;
  }

  return HOSTNAME_PATTERN.test(hostname)
    ? hostname
    : '';
};

const normalizeOrigin = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname) {
      return null;
    }

    return {
      protocol: parsed.protocol,
      origin: parsed.origin,
      hostname
    };
  } catch {
    return null;
  }
};

const isValidHostname = (value = '') => {
  return Boolean(normalizeHostname(value));
};

const isSubdomainOf = (hostname, rootDomain) => {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedRoot = normalizeHostname(rootDomain);

  if (!normalizedHost || !normalizedRoot) {
    return false;
  }

  return normalizedHost === normalizedRoot
    || normalizedHost.endsWith(`.${normalizedRoot}`);
};

const isPlatformHost = (hostname, rootDomain) => {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedRoot = normalizeHostname(rootDomain);

  if (!normalizedHost) {
    return false;
  }

  return LOCAL_HOSTS.has(normalizedHost)
    || normalizedHost === normalizedRoot
    || normalizedHost === `www.${normalizedRoot}`;
};

const isAllowedHost = (hostname, allowedHosts = []) => {
  const normalizedHost = normalizeHostname(hostname);
  if (!normalizedHost) {
    return false;
  }

  return allowedHosts.some((entry) => {
    const normalizedEntry = normalizeHostname(entry.replace(/^\./, ''));
    if (!normalizedEntry) {
      return false;
    }

    if (entry.startsWith('.')) {
      return normalizedHost === normalizedEntry
        || normalizedHost.endsWith(`.${normalizedEntry}`);
    }

    return normalizedHost === normalizedEntry;
  });
};

const isSecureRequest = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  return Boolean(req.secure || forwardedProto === 'https');
};

const resolveSafeRedirect = (target, options = {}) => {
  const fallback = options.fallback || '/';
  const value = String(target || '').trim();

  if (!value) {
    return fallback;
  }

  if (options.allowRelative !== false && value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }

  try {
    const parsed = options.baseUrl
      ? new URL(value, options.baseUrl)
      : new URL(value);

    const hostname = normalizeHostname(parsed.hostname);
    if (!hostname) {
      return fallback;
    }

    const isSameOriginRelative = options.baseUrl && !/^[a-z]+:\/\//i.test(value);
    if (isSameOriginRelative && options.allowRelative !== false) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    const allowedHosts = Array.isArray(options.allowedHosts)
      ? options.allowedHosts
      : [];

    if (!isAllowedHost(hostname, allowedHosts)) {
      return fallback;
    }

    if (options.preferRelative && options.baseUrl) {
      const base = new URL(options.baseUrl);
      if (normalizeHostname(base.hostname) === hostname) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    }

    return parsed.toString();
  } catch {
    return fallback;
  }
};

module.exports = {
  normalizeHostname,
  normalizeOrigin,
  isValidHostname,
  isSubdomainOf,
  isPlatformHost,
  isAllowedHost,
  isSecureRequest,
  resolveSafeRedirect
};
