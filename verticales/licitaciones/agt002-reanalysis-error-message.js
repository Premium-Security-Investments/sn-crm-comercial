const CLASSIFIED_MESSAGES = {
  timeout: 'El análisis se detuvo porque superó el tiempo máximo permitido de ejecución. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
  provider_error: 'El proveedor de análisis no pudo completar la solicitud. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
  invalid_output: 'El resultado no superó la validación técnica requerida. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
  persistence_failure: 'No fue posible guardar el resultado del nuevo análisis. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
  lease_lost: 'Se perdió la reserva de ejecución antes de finalizar el análisis. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
  capacity_unavailable: 'No hay capacidad del paquete disponible para ejecutar el análisis en este momento. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.',
};

const UNCLASSIFIED_MESSAGE = 'El análisis no pudo completarse por una causa técnica no clasificada. El análisis canónico anterior se conserva y sigue disponible mientras se reintenta.';

export function agt002UnavailableMessage(code) {
  return Object.prototype.hasOwnProperty.call(CLASSIFIED_MESSAGES, code)
    ? CLASSIFIED_MESSAGES[code]
    : UNCLASSIFIED_MESSAGE;
}
