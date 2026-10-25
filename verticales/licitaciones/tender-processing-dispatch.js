function safeErrorCode(error) {
  return typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'TENDER_IMMEDIATE_DISPATCH_FAILED';
}

export async function dispatchTenderProcessingAfterConversion({
  enabled = false,
  job,
  runOnce,
  onError = () => undefined,
} = {}) {
  if (!enabled || job?.outcome !== 'created') return { status: 'skipped' };
  if (typeof runOnce !== 'function') throw new Error('dispatchTenderProcessingAfterConversion: runOnce es obligatorio.');

  try {
    const result = await runOnce();
    return { status: 'dispatched', worker_status: result?.status || 'unknown' };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    onError({ event: 'tender_immediate_dispatch_failed', job_id: job.job_id || null, error_code: errorCode, error });
    return { status: 'failed', error_code: errorCode };
  }
}
