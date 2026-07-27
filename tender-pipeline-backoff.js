const RETRYABLE_CODES = new Set([
  'AGT002_CODEX_TIMEOUT', 'AGT002_CODEX_TRANSPORT_ERROR', 'AGT002_CODEX_CANCELLED',
  'AGT002_BUSY', 'AGT002_QUOTA', 'AGT002_SATURATED', 'AGT002_PREVIEW_SATURATED', 'AGT002_PREVIEW_QUOTA',
  'TENDER_DOC_TIMEOUT', 'TENDER_DOC_HTTP_429', 'TENDER_DOC_HTTP_5XX', 'TENDER_DOC_DNS_ERROR', 'TENDER_DOC_NETWORK_ERROR',
]);

const TERMINAL_CODES = new Set([
  'TENDER_DOC_INVALID_URL', 'TENDER_DOC_PRIVATE_URL', 'TENDER_DOC_TYPE_NOT_ALLOWED', 'TENDER_DOC_SIZE_EXCEEDED',
  'TENDER_DOC_EMPTY_TEXT', 'AGT002_CODEX_INVALID_RESPONSE', 'AGT002_PROVIDER_CONTRACT_INVALID',
]);

const OPERATIONAL_CODES = new Set([
  'AGT002_CODEX_LOGIN_REQUIRED', 'AGT002_CODEX_ACCOUNT_INVALID',
  'TENDER_DOC_TLS_ERROR', 'TENDER_DOC_CREDENTIAL_ERROR', 'TENDER_DOC_SESSION_UNAVAILABLE',
]);

// Never assumes an unknown code is safely retryable forever or a silent
// terminal discard; defaults to 'operational' so it surfaces as
// needs_attention with an alert instead of guessing (spec §8.4).
export function classifyPipelineError(error) {
  const code = error?.code;
  if (RETRYABLE_CODES.has(code)) return 'retryable';
  if (TERMINAL_CODES.has(code)) return 'terminal';
  if (OPERATIONAL_CODES.has(code)) return 'operational';
  const status = error?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) return 'retryable';
  return 'operational';
}

export const MAX_ATTEMPTS = 6;

export function computeBackoffMs({ attempt, baseMs = 2000, maxMs = 300000, jitter = Math.random }) {
  const exponential = baseMs * 2 ** (attempt - 1);
  return Math.min(maxMs, exponential + jitter() * baseMs);
}
