// AGT-002 Radar — clasificador transicional de "churn derivado" de raw.days/raw.window.
//
// PROBLEMA. `computeAgt002RadarSourceRowHash` (agt002-radar-gate.js) proyecta `raw` **entero**
// dentro de la identidad de ingesta, y el recolector diario externo
// (`/root/.hermes/scripts/secop_psi_radar_export.sh --persist-supabase`, fuera de este
// repositorio, que invoca `secop_psi_radar.py`) reescribe cada día dos campos que no son datos de
// la fuente sino derivados del reloj: `raw.days`, los días que faltan para el cierre, y
// `raw.window`, su etiqueta de banda. La forma exacta de ese cálculo vive en `secop_psi_radar.py`,
// función `window_label` (líneas 811-823) — fuera de este repositorio y de este sandbox; este
// módulo la replica a partir de la evidencia dada, no leyendo ese archivo. **No** es
// `tenderDaysUntil`/`tenderWindow` (server/index.js:1053-1054, api/[...path].js:1053-1054,
// esu-direct-crawl.js:60-61): esa es la etiqueta de la UI de este repo, para pintar en pantalla, y
// nunca escribe `raw` — usarla aquí sería replicar la fuente equivocada. Consecuencia del defecto
// real: una licitación sin ningún cambio material cambia de `source_row_hash` todos los días, el
// corto circuito `satisfied` del RPC `psi_enqueue_agt002_radar_preanalysis_job` (072:205-207) deja
// de aplicar, y se encola un reanálisis que sólo puede llegar a la misma conclusión que la corrida
// canónica vigente.
//
// ALCANCE. Este módulo NO cambia el algoritmo de `source_row_hash`, ni `policy_version`/
// `context_version`, ni el esquema 071/072: hacerlo invalidaría todos los canónicos ya escritos.
// Es un filtro **previo al encolado**, conservador y reversible, que responde una única pregunta
// pura: *¿el `source_row_hash` de la corrida canónica vigente se reproduce desde la fila de hoy
// cambiando ÚNICAMENTE `raw.days` y `raw.window` a una variante histórica válida?* Si la respuesta
// es sí, el cambio es deriva del recolector y no hay nada que reanalizar. Cualquier otra cosa
// —estado, cierre, título, URL, un campo más o uno menos en `raw`, `days`/`window` ausentes,
// inválidos o inconsistentes entre sí, canónico ausente, política/contexto distintos— cae por el
// camino cerrado y se encola exactamente como hoy.
//
// Sin I/O, sin reloj, sin base de datos, y nunca lanza: es clasificación pura. Los fallos técnicos
// (lookup del canónico) los maneja quien llama, y deben hacer fallar la corrida, no contarse como
// un rechazo de negocio.

import { computeAgt002RadarSourceRowHash } from './agt002-radar-gate.js';

/** Los dos únicos campos de `raw` que este clasificador acepta como distintos entre hoy y el canónico. */
export const AGT002_RADAR_DERIVED_DAY_FIELDS = Object.freeze(['days', 'window']);
const [DAYS_FIELD, WINDOW_FIELD] = AGT002_RADAR_DERIVED_DAY_FIELDS;

// Cuántos días hacia atrás se prueban como `raw.days` histórico. Es un techo explícito, no un
// barrido abierto: sólo se prueban `current + 1 .. current + MAX`, un valor por día transcurrido.
//
// Es una **ventana de compatibilidad explícita y fail-closed**, NO un horizonte que aplique a
// todas las fuentes del Radar por igual: no hay evidencia de que TVEC ni el crawler directo de ESU
// lo respeten. La evidencia real es el `RECENT_DAYS=60` del recolector SECOP dominante
// (`secop_psi_radar_export.sh` / `secop_psi_radar.py`, fuera de este repositorio), replicado en
// este árbol por `fetchSecopSource` — `new Date(Date.now() - 60 * 86400000)` en
// server/index.js:1203, api/[...path].js:1203—: 60 días es el intervalo más largo durante el cual
// una fila SECOP puede seguir reapareciendo en la ingesta diaria. TVEC (`fetchTvecEvents`,
// server/index.js) y el crawler directo de ESU (esu-direct-crawl.js) **no** acotan su consulta a
// 60 días: para esas fuentes, o para un canónico SECOP más viejo que la ventana, este límite no alcanza
// a explicar la deriva y la fila reanaliza de forma conservadora — el comportamiento vigente antes
// de este hotfix, no una regresión.
//
// El costo es acotado y despreciable: como mucho 60 hashes sha256 sobre una proyección pequeña por
// cada superviviente con la forma derivada exacta (y ninguno para el resto). Sobrepasar el techo
// **falla cerrado**: no se clasifica como churn y la fila se encola.
export const AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS = 60;

const SOURCE_ROW_HASH_PATTERN = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Réplica exacta y determinista de `window_label(days)` del EXPORTADOR PRODUCTIVO EXTERNO
 * (`secop_psi_radar.py:811-823`, invocado por `secop_psi_radar_export.sh --persist-supabase`,
 * fuera de este repositorio y de este sandbox — la forma exacta viene dada como evidencia, no de
 * una lectura directa de ese archivo), que es quien realmente escribe `raw.days`/`raw.window` en
 * producción. **No** replica `tenderWindow(days)` (server/index.js:1054): esa es la etiqueta de la
 * UI de este repo y difiere en dos bandas — `days < 0` ahí sigue siendo "urgente" y `days > 30` es
 * "ventana amplia" — que el exportador productivo nunca escribe.
 *
 * Restringida al dominio entero: fuera de él devuelve `null` en vez de inventar una banda, y una
 * fila sin `days` entero —incluido `days: null`, "sin fecha de cierre reportada"— queda
 * deliberadamente fuera de alcance y se encola.
 */
export function agt002RadarDerivedDayWindowLabel(days) {
  if (!Number.isInteger(days)) return null;
  if (days < 0) return 'vencido / validar estado';
  if (days <= 7) return 'urgente (0-7 días)';
  if (days <= 15) return 'revisar rápido (8-15 días)';
  if (days <= 30) return 'buena ventana (16-30 días)';
  return 'excelente ventana (30+ días)';
}

/**
 * ¿La fila trae el par derivado con la forma exacta que este hotfix admite? Exige `raw` objeto,
 * `raw.days` entero y `raw.window` **exactamente** la etiqueta determinista de ese `days`. Una
 * fila cuya etiqueta no corresponde a su propio `days` no la produjo el recolector: no se puede
 * razonar sobre su historia derivada y se encola.
 *
 * Es también el predicado que permite a quien llama evitar la consulta bulk de canónicos cuando
 * ninguna fila del lote podría clasificarse.
 */
export function hasAgt002RadarDerivedDayShape(tenderRow) {
  if (!isPlainObject(tenderRow) || !isPlainObject(tenderRow.raw)) return false;
  const label = agt002RadarDerivedDayWindowLabel(tenderRow.raw[DAYS_FIELD]);
  return label !== null && tenderRow.raw[WINDOW_FIELD] === label;
}

/**
 * @param {object} tenderRow fila vigente de `psi_public_tenders`. Nunca se muta.
 * @param {object} canonicalRun fila canónica de `psi_agt002_radar_preanalysis_runs`.
 * @param {object} options
 * @param {string} options.policyVersion política de la evaluación de gate de hoy.
 * @param {string} options.contextVersion contexto de la evaluación de gate de hoy.
 * @param {function} [options.computeSourceRowHash] inyectable sólo para pruebas.
 * @param {number} [options.maxOffsetDays]
 * @returns {boolean} `true` sólo si el hash canónico se reproduce cambiando exclusivamente
 * `raw.days`/`raw.window`. Falla cerrado (`false`) ante cualquier forma extraña.
 */
export function isAgt002RadarDerivedDayOnlyChurn(tenderRow, canonicalRun, options = {}) {
  const {
    policyVersion, contextVersion,
    computeSourceRowHash = computeAgt002RadarSourceRowHash,
    maxOffsetDays = AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS,
  } = options;

  if (!hasAgt002RadarDerivedDayShape(tenderRow)) return false;
  if (!isPlainObject(canonicalRun)) return false;
  if (typeof canonicalRun.source_row_hash !== 'string' || !SOURCE_ROW_HASH_PATTERN.test(canonicalRun.source_row_hash)) return false;
  // La identidad del canónico tiene que ser la misma con la que se evaluó hoy. Un canónico de otra
  // política o de otro contexto describe otra pregunta y siempre merece reanálisis.
  if (!isNonEmptyString(policyVersion) || !isNonEmptyString(contextVersion)) return false;
  if (canonicalRun.policy_version !== policyVersion || canonicalRun.context_version !== contextVersion) return false;
  if (!Number.isInteger(maxOffsetDays) || maxOffsetDays < 1) return false;

  let currentHash;
  try { currentHash = computeSourceRowHash(tenderRow); } catch { return false; }
  if (typeof currentHash !== 'string') return false;
  // Hash idéntico: no hay deriva que absorber. Ese caso ya lo corta `satisfied` dentro del RPC y
  // este clasificador no debe reclamarlo como propio ni inflar su contador.
  if (currentHash === canonicalRun.source_row_hash) return false;

  // Copia de trabajo: `tenderRow` y `tenderRow.raw` quedan intactos (la fila puede venir congelada).
  // Sólo `days` y `window` se reescriben sobre la copia; todo lo demás —incluido cualquier
  // subobjeto anidado de `raw`— se comparte por referencia y jamás se toca. Por eso una
  // coincidencia de hash prueba que la diferencia estaba EXCLUSIVAMENTE en esos dos campos.
  const candidateRow = { ...tenderRow, raw: { ...tenderRow.raw } };
  const currentDays = tenderRow.raw[DAYS_FIELD];
  // Sólo valores históricos: el recolector calcula días que FALTAN, así que ayer siempre había más
  // que hoy. Probar `current - offset` sería aceptar un futuro que el recolector no pudo escribir.
  for (let offset = 1; offset <= maxOffsetDays; offset += 1) {
    const candidateDays = currentDays + offset;
    const candidateWindow = agt002RadarDerivedDayWindowLabel(candidateDays);
    if (candidateWindow === null) return false;
    candidateRow.raw[DAYS_FIELD] = candidateDays;
    candidateRow.raw[WINDOW_FIELD] = candidateWindow;
    let candidateHash;
    try { candidateHash = computeSourceRowHash(candidateRow); } catch { return false; }
    if (candidateHash === canonicalRun.source_row_hash) return true;
  }
  return false;
}
