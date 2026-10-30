const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

export const TVEC_MAX_ATTEMPTS = DEFAULT_MAX_ATTEMPTS;
export const TVEC_RETRYABLE_STATUSES = Object.freeze([429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511]);

export function isRetryableTvecStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

const RETRYABLE_TVEC_NETWORK_CODES = new Set([
  'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETDOWN', 'ENETRESET',
  'ENETUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
]);

export function isRetryableTvecNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  if (RETRYABLE_TVEC_NETWORK_CODES.has(code)) return true;
  return error?.name === 'TypeError'
    && /fetch failed|network|socket|connection|timed? ?out/i.test(error?.message || '');
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function aggregationUrl(baseUrl, aggregation) {
  const url = new URL(baseUrl);
  url.searchParams.set("Agregacion", aggregation);
  return url.toString();
}

export class TvecAggregationFetchError extends Error {
  constructor(message, { aggregation, url, status = null, attempts, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "TvecAggregationFetchError";
    this.aggregation = aggregation;
    this.url = url;
    this.status = status;
    this.attempts = attempts;
    if (cause) this.cause = cause;
  }
}

export async function fetchTvecAggregation(aggregation, {
  url,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  headers = { "User-Agent": "SN-CRM-TVEC-Radar/1.0" },
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!url) throw new TypeError("url is required");
  const boundedAttempts = Math.max(1, Math.floor(maxAttempts));
  let attempts = 0;
  let lastError = null;

  while (attempts < boundedAttempts) {
    attempts += 1;
    try {
      const response = await fetchImpl(url, { headers });
      if (response?.ok) {
        return { aggregation, url, text: await response.text(), status: response.status, attempts, ok: true };
      }
      const status = response?.status ?? null;
      const error = new TvecAggregationFetchError(`TVEC respondió ${status}`, { aggregation, url, status, attempts });
      if (!isRetryableTvecStatus(status) || attempts >= boundedAttempts) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof TvecAggregationFetchError) {
        if (!isRetryableTvecStatus(error.status)) throw error;
        lastError = error;
      } else {
        lastError = new TvecAggregationFetchError(error?.message || "TVEC network error", { aggregation, url, attempts, cause: error });
        if (!isRetryableTvecNetworkError(error)) throw lastError;
      }
      if (attempts >= boundedAttempts) throw lastError;
    }
    await sleep(baseDelayMs * 2 ** (attempts - 1));
  }

  throw lastError || new TvecAggregationFetchError("TVEC fetch failed", { aggregation, url, attempts });
}

export async function fetchTvecAggregations(aggregations, {
  baseUrl,
  ...options
} = {}) {
  const entries = Array.isArray(aggregations) ? aggregations : Object.entries(aggregations || {});
  return Promise.all(entries.map(async ([aggregation, baseScore]) => {
    const url = aggregationUrl(baseUrl, aggregation);
    try {
      const result = await fetchTvecAggregation(aggregation, { ...options, url });
      return { ...result, baseScore };
    } catch (error) {
      return {
        aggregation,
        baseScore,
        url,
        ok: false,
        status: error?.status ?? null,
        attempts: error?.attempts ?? options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        error,
      };
    }
  }));
}
