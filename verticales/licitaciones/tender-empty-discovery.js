/**
 * Qué hacer cuando el descubrimiento de documentos no encuentra NINGUNO.
 *
 * Hasta el 2026-10-28 ese caso terminaba en `needs_attention`, que el propio worker
 * define como "parked for a human; not claimable": el trabajo quedaba detenido para
 * siempre, con `attempt_count` en cero, sin `next_attempt_at` y sin un solo carácter
 * de explicación. Pero cero documentos casi nunca significa que la descarga falló:
 * significa que la entidad todavía no los publicó.
 *
 * El 2026-10-28 cuatro licitaciones recién convertidas —Rama Judicial Pereira
 * (CO1.REQ.11251632) y Manizales (CO1.REQ.11259361), Terminal de Transporte
 * (CO1.REQ.11254258) y Fiscalía Eje Cafetero (CO1.REQ.11243926)— estaban en cero, y
 * al consultar SECOP el conjunto `dmgg-8hin` devolvía efectivamente **0 documentos**
 * para sus cuatro portafolios. El control fue SIC 23 de 2026, que tenía 13 publicados
 * y se trajo los 13. O sea: el importador hizo lo correcto. Lo que estaba mal era
 * tratar "la entidad aún no publicó" como si fuera "la descarga falló", porque lo
 * primero se resuelve solo en unos días y lo segundo necesita una persona.
 *
 * Aquí el cero se trata como espera: se reprograma el descubrimiento con una espera
 * creciente y se deja escrita la razón, para que la ficha pueda decirla. Sólo cuando
 * la espera se agota el trabajo se aparca —y entonces sí, con motivo.
 */

export const TENDER_DOCUMENTS_NOT_PUBLISHED_CODE = 'TENDER_DOCUMENTS_NOT_PUBLISHED_YET';
export const TENDER_EMPTY_DISCOVERY_EXHAUSTED_CODE = 'TENDER_DOCUMENTS_NEVER_PUBLISHED';

/** Resultado de runOnce() cuando el descubrimiento quedó reprogramado. No es un fallo. */
export const TENDER_DOCUMENTS_PENDING_STATUS = 'documents_not_published_yet';

/**
 * Esperas entre revisiones, en horas. Las primeras son cortas porque una conversión
 * puede adelantarse por minutos a la publicación; después se estira a un día, que es
 * el ritmo real con que datos abiertos incorpora los documentos de un proceso nuevo.
 * La última se repite hasta agotar los intentos.
 */
const RETRY_HOURS = Object.freeze([1, 3, 6, 12, 24]);

/**
 * Doce revisiones cubren unos nueve días. Pasado eso, que un proceso publicado siga
 * sin un solo documento ya no es demora de la fuente: es algo que una persona tiene
 * que mirar.
 */
export const TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS = 12;

const HOUR_MS = 60 * 60 * 1000;

export function tenderEmptyDiscoveryDelayMs(attempt) {
  const index = Math.min(Math.max(1, Number(attempt) || 1), RETRY_HOURS.length) - 1;
  return RETRY_HOURS[index] * HOUR_MS;
}

/** Horas acumuladas hasta agotar los intentos, para que el mensaje final no invente un plazo. */
function exhaustedSpanHours() {
  let total = 0;
  for (let attempt = 1; attempt < TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS; attempt += 1) {
    total += tenderEmptyDiscoveryDelayMs(attempt) / HOUR_MS;
  }
  return total;
}

function plural(value, singular, pluralWord) {
  return value === 1 ? `1 ${singular}` : `${value} ${pluralWord}`;
}

/**
 * Decide qué hacer con un descubrimiento vacío.
 *
 * @param {object} input
 * @param {number} input.attempt  Número de esta revisión (1 para la primera).
 * @param {number} input.now      Milisegundos epoch.
 * @returns {{retry: boolean, attempt: number, status: string, currentStep: string,
 *            nextAttemptAt: string|null, errorCode: string, errorMessage: string, outcome: string}}
 */
export function planEmptyDiscovery({ attempt, now } = {}) {
  const current = Math.max(1, Math.trunc(Number(attempt) || 1));
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();

  if (current >= TENDER_EMPTY_DISCOVERY_MAX_ATTEMPTS) {
    const days = Math.round(exhaustedSpanHours() / 24);
    return Object.freeze({
      retry: false,
      attempt: current,
      status: 'needs_attention',
      currentStep: 'documents',
      nextAttemptAt: null,
      errorCode: TENDER_EMPTY_DISCOVERY_EXHAUSTED_CODE,
      errorMessage: `La fuente oficial no publicó ningún documento en ${plural(current, 'revisión', 'revisiones')} `
        + `durante unos ${plural(days, 'día', 'días')}. Requiere que una persona lo revise.`,
      outcome: 'needs_attention',
    });
  }

  const delayMs = tenderEmptyDiscoveryDelayMs(current);
  const hours = Math.round(delayMs / HOUR_MS);
  return Object.freeze({
    retry: true,
    attempt: current,
    // `queued` es el único estado que vuelve a ejecutar el descubrimiento (el worker
    // sólo descubre desde 'queued' o 'discovering_documents'); `retry_wait` reentra
    // por la rama de importación, donde no hay nada pendiente y se volvería a aparcar.
    status: 'queued',
    currentStep: 'documents',
    nextAttemptAt: new Date(at + delayMs).toISOString(),
    errorCode: TENDER_DOCUMENTS_NOT_PUBLISHED_CODE,
    errorMessage: `La entidad aún no ha publicado documentos en la fuente oficial. `
      + `Se vuelve a revisar en ${plural(hours, 'hora', 'horas')}.`,
    outcome: TENDER_DOCUMENTS_PENDING_STATUS,
  });
}
