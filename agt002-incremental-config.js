export const AGT002_INCREMENTAL_FLAG_NAMES = Object.freeze([
  'AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED',
  'AGT002_INCREMENTAL_DISPATCH_ENABLED',
]);

export function getAgt002IncrementalConfig(environment = process.env) {
  const ingressEnabled = environment.AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED === 'true';
  const dispatchEnabled = environment.AGT002_INCREMENTAL_DISPATCH_ENABLED === 'true';
  if (dispatchEnabled && !ingressEnabled) {
    const error = new Error('AGT-002 R1 no puede despachar con el ingreso incremental apagado.');
    error.code = 'AGT002_INCREMENTAL_CONFIG_INVALID';
    throw error;
  }
  const workerDispatchUrl = String(environment.AGT002_INCREMENTAL_WORKER_DISPATCH_URL || '').trim();
  const workerDispatchHmacSecret = String(environment.AGT002_HETZNER_BRIDGE_HMAC_SECRET || '');
  if (dispatchEnabled && (!workerDispatchUrl || workerDispatchHmacSecret.length < 32)) {
    const error = new Error('AGT-002 R1 requiere URL y secreto HMAC para el despacho dirigido por evento.');
    error.code = 'AGT002_INCREMENTAL_CONFIG_INVALID';
    throw error;
  }
  return Object.freeze({ ingressEnabled, dispatchEnabled, workerDispatchUrl, workerDispatchHmacSecret });
}
