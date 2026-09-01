// AGT-002 revisión accionable — canonicalización JSON y hash únicos (spec §6.4,
// §13 de docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md).
//
// Único módulo Node que define el contrato persistido `agt002-actionable-review-json-v1`:
// toda identidad/idempotencia semántica de la revisión accionable se calcula aquí, nunca
// en SQL. PostgreSQL sólo almacena y compara los hashes que este módulo produce.
//
// Reglas cerradas (no reinterpretar sin versionar el módulo):
// - sólo JSON plano: objetos de prototipo plano, arrays sin huecos, strings, booleanos,
//   números finitos y null; todo lo demás (undefined, función, símbolo, BigInt, número no
//   finito, Date, hueco de array, prototipo no plano) se rechaza;
// - strings y nombres de clave se normalizan a NFC; una colisión de claves tras NFC falla;
// - las claves se ordenan recursivamente por orden de unidades de código UTF-16; los
//   arrays conservan orden, longitud y null;
// - -0 se normaliza a 0; el resultado es JSON compacto (sin espacios) codificado UTF-8.

import { createHash } from 'node:crypto';

export const HASH_CONTRACT = 'agt002-actionable-review-json-v1';

function fail(message) {
  throw new Error(`AGT-002 revisión accionable — canonicalización: ${message}.`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalStringifyValue(value, path) {
  if (value === null) return 'null';

  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`número no finito en ${path}`);
    return JSON.stringify(value === 0 ? 0 : value);
  }

  if (Array.isArray(value)) {
    const parts = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail(`hueco de array en ${path}[${index}]`);
      parts.push(canonicalStringifyValue(value[index], `${path}[${index}]`));
    }
    return `[${parts.join(',')}]`;
  }

  if (isPlainObject(value)) {
    const rawKeyByNormalizedKey = new Map();
    for (const rawKey of Object.keys(value)) {
      const normalizedKey = rawKey.normalize('NFC');
      if (rawKeyByNormalizedKey.has(normalizedKey)) {
        fail(`colisión de claves tras NFC en ${path}: "${rawKeyByNormalizedKey.get(normalizedKey)}" y "${rawKey}"`);
      }
      rawKeyByNormalizedKey.set(normalizedKey, rawKey);
    }
    const sortedNormalizedKeys = [...rawKeyByNormalizedKey.keys()].sort();
    const parts = sortedNormalizedKeys.map((normalizedKey) => {
      const rawKey = rawKeyByNormalizedKey.get(normalizedKey);
      const serializedValue = canonicalStringifyValue(value[rawKey], `${path}.${normalizedKey}`);
      return `${JSON.stringify(normalizedKey)}:${serializedValue}`;
    });
    return `{${parts.join(',')}}`;
  }

  fail(`valor no serializable en JSON canónico en ${path} (tipo ${typeof value})`);
}

/** Serializa `value` como JSON canónico compacto UTF-8 según el contrato §6.4. Lanza si el valor no es JSON plano. */
export function canonicalizeActionableReviewJson(value) {
  return canonicalStringifyValue(value, '$');
}

/** SHA-256 hexadecimal minúsculo sobre los bytes UTF-8 de `canonicalizeActionableReviewJson(value)`. */
export function hashActionableReviewJson(value) {
  const canonical = canonicalizeActionableReviewJson(value);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

// §6.4: claves exactas de la proyección estructural de `integral_unit`, espejo
// del conjunto cerrado de unidad del contrato V3 (`UNIT_KEYS` de
// `agt002-integral-analysis-v3.js`). La proyección persistida es exactamente
// estas claves más `source_kind`; nunca conteos, posición visual,
// traducciones, timestamps de ejecución ni nada enviado por el cliente.
export const ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS = Object.freeze([
  'unit_id', 'unit_kind', 'requirement_id', 'category', 'sequence', 'title', 'assessment_mode',
  'conclusion', 'blocking', 'evidence_state', 'evidence_refs', 'missing_evidence', 'commercial_impact',
  'legal_assessment', 'actions', 'milestone', 'escalation', 'closure', 'human_validation',
]);

const INTEGRAL_UNIT_ID_MAX_LENGTH = 120;

// §6.2/§6.4: único constructor de la identidad estructural de un pendiente de
// unidad integral V3. Recibe la unidad TAL COMO está en el resultado canónico
// server-side (jamás una versión reconstruida por el navegador) y devuelve el
// `source_id`, el `requirement_id` y el `source_hash` que la RPC de ensure
// persiste. Falla cerrado ante una unidad que no expone exactamente el
// contrato cerrado o que no tiene identidad estructural: §6.2 prohíbe fabricar
// un ID alternativo basado en texto.
export function buildActionableReviewIntegralUnitSource(unit) {
  if (!isPlainObject(unit)) fail('la unidad integral V3 debe ser un objeto plano');
  const keys = Object.keys(unit);
  if (keys.length !== ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS.length
    || !ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS.every(key => Object.hasOwn(unit, key))) {
    fail('la unidad integral V3 no expone exactamente las claves cerradas de la proyección §6.4');
  }
  const unitId = unit.unit_id;
  if (typeof unitId !== 'string' || !unitId.trim() || unitId.length > INTEGRAL_UNIT_ID_MAX_LENGTH) {
    fail('la unidad integral V3 no tiene un unit_id estructural utilizable');
  }
  if (unit.requirement_id !== null && (typeof unit.requirement_id !== 'string' || !unit.requirement_id.trim())) {
    fail('requirement_id de la unidad integral V3 debe ser un texto no vacío o null');
  }
  const projection = { source_kind: 'integral_unit' };
  for (const key of ACTIONABLE_REVIEW_INTEGRAL_UNIT_PROJECTION_KEYS) projection[key] = unit[key];
  return { projection, sourceKind: 'integral_unit', sourceId: unitId, requirementId: unit.requirement_id, sourceHash: hashActionableReviewJson(projection) };
}
