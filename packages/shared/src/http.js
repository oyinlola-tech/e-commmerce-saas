const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const isRetryableStatus = (status) => {
  return status === 408 || status === 425 || status === 429 || status >= 500;
};

const isRetryableError = (error) => {
  return error && (
    error.name === 'AbortError'
    || error.code === 'ECONNRESET'
    || error.code === 'ECONNREFUSED'
    || error.code === 'ETIMEDOUT'
    || error.code === 'UND_ERR_CONNECT_TIMEOUT'
  );
};

const requestJson = async (url, options = {}) => {
  const method = String(options.method || 'GET').toUpperCase();
  const retries = Number(options.retries === undefined ? (method === 'GET' ? 1 : 0) : options.retries);
  const timeoutMs = Number(options.timeoutMs || 5000);
  const retryDelayMs = Number(options.retryDelayMs || 250);
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        error.status = response.status;
        error.payload = payload;

        if (attempt < retries && isRetryableStatus(response.status)) {
          attempt += 1;
          await sleep(retryDelayMs * attempt);
          continue;
        }

        throw error;
      }

      return payload;
    } catch (error) {
      if (attempt < retries && isRetryableError(error)) {
        attempt += 1;
        await sleep(retryDelayMs * attempt);
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
};

module.exports = {
  requestJson
};
