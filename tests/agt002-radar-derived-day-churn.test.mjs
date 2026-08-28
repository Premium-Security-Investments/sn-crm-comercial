import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT002_RADAR_DERIVED_DAY_FIELDS,
  AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS,
  agt002RadarDerivedDayWindowLabel,
  hasAgt002RadarDerivedDayShape,
  isAgt002RadarDerivedDayOnlyChurn,
} from '../agt002-radar-derived-day-churn.js';
import { computeAgt002RadarSourceRowHash } from '../agt002-radar-gate.js';

const VENCIDO = 'vencido / validar estado';
const URGENTE = 'urgente (0-7 días)';
const RAPIDO = 'revisar rápido (8-15 días)';
const BUENA = 'buena ventana (16-30 días)';
const EXCELENTE = 'excelente ventana (30+ días)';
// Etiquetas de la UI de este repo (`tenderWindow`, server/index.js:1054) que el exportador
// productivo NUNCA escribe: negativos siguen "urgente" y nunca hay banda >30 propia. Sirven aquí
// sólo como contraejemplo: si el clasificador las aceptara estaría replicando la UI equivocada.
const UI_AMPLIA = 'ventana amplia';

// El clasificador NO se ocupa de la identidad diaria de la evaluación: sólo compara el hash
// canónico ya persistido contra hashes reproducidos desde la fila actual.
const row = (raw, overrides = {}) => ({
  id: '44444444-4444-4444-8444-444444444444', stable_key: 'k-churn', source: 'SECOP II',
  entity: 'Alcaldía', title: 'Vigilancia armada', status: 'Convocado',
  deadline_at: '2026-09-05T00:00:00+00:00', url: 'https://example.gov.co/p/1',
  ...overrides, raw,
});
const canonical = (sourceRowHash, overrides = {}) => ({
  id: 'run-1', tender_id: '44444444-4444-4444-8444-444444444444', canonical: true,
  status: 'completed', policy_version: 'p', context_version: 'c',
  source_row_hash: sourceRowHash, ...overrides,
});
const MATCH = { policyVersion: 'p', contextVersion: 'c' };
const withDerived = (baseRow, days, window) => ({ ...baseRow, raw: { ...baseRow.raw, days, window } });

// 1. Etiqueta determinista: réplica exacta de `window_label` del EXPORTADOR PRODUCTIVO EXTERNO
//    (`/root/.hermes/scripts/secop_psi_radar_export.sh --persist-supabase`, que invoca
//    `secop_psi_radar.py::window_label`, líneas 811-823), que es quien realmente escribe
//    `raw.days`/`raw.window` en producción. Esto es DISTINTO de `tenderWindow` (server/index.js:1054,
//    api/[...path].js:1054, esu-direct-crawl.js:61), la etiqueta de la UI de este repo: esa función
//    no persiste `raw` y no debe usarse como referencia aquí. Diferencias exigidas por esa evidencia:
//    `days < 0` tiene su propia banda ("vencido / validar estado", no "urgente"), y `days > 30` es
//    "excelente ventana (30+ días)", no "ventana amplia".
assert.equal(agt002RadarDerivedDayWindowLabel(-1), VENCIDO);
assert.equal(agt002RadarDerivedDayWindowLabel(-30), VENCIDO);
assert.equal(agt002RadarDerivedDayWindowLabel(0), URGENTE);
assert.equal(agt002RadarDerivedDayWindowLabel(7), URGENTE);
assert.equal(agt002RadarDerivedDayWindowLabel(8), RAPIDO);
assert.equal(agt002RadarDerivedDayWindowLabel(15), RAPIDO);
assert.equal(agt002RadarDerivedDayWindowLabel(16), BUENA);
assert.equal(agt002RadarDerivedDayWindowLabel(30), BUENA);
assert.equal(agt002RadarDerivedDayWindowLabel(31), EXCELENTE);
assert.equal(agt002RadarDerivedDayWindowLabel(40), EXCELENTE);
// Fuera del dominio entero no hay etiqueta: `null`/decimal/cadena cierran el camino en vez de
// inventar una banda. Una fila sin `days` entero nunca se clasifica como churn derivado.
for (const invalid of [null, undefined, '7', 7.5, NaN, Infinity, {}, []]) {
  assert.equal(agt002RadarDerivedDayWindowLabel(invalid), null, `label(${String(invalid)}) debe ser null`);
}

// 2. El límite de offsets es explícito, pequeño y documentado con evidencia del repositorio.
assert.deepEqual(AGT002_RADAR_DERIVED_DAY_FIELDS, ['days', 'window']);
assert.ok(Object.isFrozen(AGT002_RADAR_DERIVED_DAY_FIELDS));
assert.ok(Number.isInteger(AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS));
assert.ok(AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS >= 1 && AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS <= 90,
  'el límite debe ser pequeño y acotado, no un barrido abierto');
const moduleSource = readFileSync(new URL('../agt002-radar-derived-day-churn.js', import.meta.url), 'utf8');
assert.match(moduleSource, /server\/index\.js:1203/, 'el límite debe citar la evidencia de la ventana de 60 días del recolector SECOP dominante');
assert.match(moduleSource, /60 \* 86400000/, 'el límite debe citar la constante real de esa ingesta');
assert.match(moduleSource, /RECENT_DAYS/, 'el límite debe nombrar RECENT_DAYS=60 del recolector SECOP dominante externo, base real del techo');
// El límite NO puede presentarse como el horizonte máximo de TODO el Radar: TVEC (fetchTvecEvents,
// server/index.js) y el crawler directo de ESU (esu-direct-crawl.js) no acotan por fecha a 60 días.
assert.doesNotMatch(moduleSource, /horizonte m[aá]ximo (global )?del [Rr]adar/, 'no debe afirmar que 60 días es el horizonte global del Radar: TVEC/ESU directo no tienen esa prueba');
assert.match(moduleSource, /TVEC/, 'debe aclarar que TVEC no comparte esta ventana de 60 días');
assert.match(moduleSource, /esu-direct-crawl/, 'debe aclarar que el crawler directo de ESU no comparte esta ventana de 60 días');
assert.match(moduleSource, /reanaliza[a-záéíóú]*[^.]*conservador/i,
  'debe documentar que fuentes/canónicos fuera de la ventana de 60 días reanalizan de forma conservadora (fail-closed), no una regresión');

// 3. Forma exigida: raw objeto, days entero y window exactamente la etiqueta determinista de days.
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: 11, window: RAPIDO })), true);
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: 11, window: URGENTE })), false, 'window inconsistente con days');
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: 11 })), false, 'window ausente');
assert.equal(hasAgt002RadarDerivedDayShape(row({ window: RAPIDO })), false, 'days ausente');
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: '11', window: RAPIDO })), false, 'days no entero');
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: null, window: 'sin fecha de cierre reportada' })), false, 'days null queda fuera de alcance');
assert.equal(hasAgt002RadarDerivedDayShape(row(null)), false);
assert.equal(hasAgt002RadarDerivedDayShape(row([{ days: 1, window: URGENTE }])), false, 'raw array no es objeto');
assert.equal(hasAgt002RadarDerivedDayShape(undefined), false);
assert.equal(hasAgt002RadarDerivedDayShape('x'), false);

// 4. Caso central: el canónico previo se reproduce cambiando SÓLO days/window.
const current = row({ modalidad_de_contratacion: 'Licitación pública', objeto: 'Vigilancia', days: 11, window: RAPIDO });
const previousHash = computeAgt002RadarSourceRowHash(withDerived(current, 12, RAPIDO));
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), MATCH), true);

// 5. El offset se prueba en todo el rango declarado, y ni uno más.
const farHash = computeAgt002RadarSourceRowHash(withDerived(current, 11 + AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS, EXCELENTE));
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(farHash), MATCH), true, 'el offset máximo declarado debe probarse');
const tooFarHash = computeAgt002RadarSourceRowHash(withDerived(current, 11 + AGT002_RADAR_DERIVED_DAY_MAX_OFFSET_DAYS + 1, EXCELENTE));
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(tooFarHash), MATCH), false, 'más allá del límite se cierra: se reanaliza');
// Sólo se prueban valores históricos (days mayores): un canónico con MENOS días que hoy no es
// deriva del recolector diario y no se acepta.
const futureHash = computeAgt002RadarSourceRowHash(withDerived(current, 10, RAPIDO));
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(futureHash), MATCH), false, 'sólo se prueban valores históricos current+offset');

// 6. Cruce de etiqueta 7 -> 8 y 15 -> 16 (la banda cambia junto con el número).
const urgentRow = row({ objeto: 'Vigilancia', days: 7, window: URGENTE });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(urgentRow, canonical(computeAgt002RadarSourceRowHash(withDerived(urgentRow, 8, RAPIDO))), MATCH), true);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(urgentRow, canonical(computeAgt002RadarSourceRowHash(withDerived(urgentRow, 8, URGENTE))), MATCH), false,
  'una etiqueta que no corresponde al days histórico no es deriva determinista');
const quickRow = row({ objeto: 'Vigilancia', days: 15, window: RAPIDO });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(quickRow, canonical(computeAgt002RadarSourceRowHash(withDerived(quickRow, 16, BUENA))), MATCH), true);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(quickRow, canonical(computeAgt002RadarSourceRowHash(withDerived(quickRow, 16, RAPIDO))), MATCH), false);

// 6b. Caso central sobre la banda "excelente ventana (30+ días)": fila actual con days:40 cuyo
//     canónico se explica con days:41 histórico, ambos en la banda del exportador productivo.
const wideRow = row({ objeto: 'Vigilancia', days: 40, window: EXCELENTE });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(wideRow, canonical(computeAgt002RadarSourceRowHash(withDerived(wideRow, 41, EXCELENTE))), MATCH), true,
  'days 40/excelente hoy contra canónico days 41/excelente es churn derivado puro: no se encola');

// 6c. Las etiquetas de la UI de este repo (`tenderWindow`) son incorrectas para el exportador
//     productivo y NUNCA satisfacen la forma exigida: ni suprimen el encolado.
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: -3, window: URGENTE })), false,
  'la UI etiqueta -3 como "urgente", pero el exportador productivo lo etiqueta "vencido / validar estado": no es la forma exacta');
assert.equal(hasAgt002RadarDerivedDayShape(row({ days: 31, window: UI_AMPLIA })), false,
  'la UI etiqueta 31 como "ventana amplia", pero el exportador productivo dice "excelente ventana (30+ días)": no es la forma exacta');
const uiMislabeledNegativeRow = row({ objeto: 'Vigilancia', days: -3, window: URGENTE });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(
  uiMislabeledNegativeRow,
  canonical(computeAgt002RadarSourceRowHash(withDerived(uiMislabeledNegativeRow, -2, URGENTE))),
  MATCH,
), false, 'una fila con la etiqueta de UI para negativos no tiene la forma derivada exacta: se encola');
const uiMislabeledWideRow = row({ objeto: 'Vigilancia', days: 31, window: UI_AMPLIA });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(
  uiMislabeledWideRow,
  canonical(computeAgt002RadarSourceRowHash(withDerived(uiMislabeledWideRow, 32, UI_AMPLIA))),
  MATCH,
), false, 'una fila con la etiqueta de UI para >30 días no tiene la forma derivada exacta: se encola');

// 7. Cualquier diferencia adicional cierra el camino: estado, cierre, título, URL y raw extra.
for (const [field, value] of [['status', 'Cerrado'], ['deadline_at', '2026-09-30T00:00:00+00:00'], ['title', 'Otro objeto'], ['url', 'https://example.gov.co/p/2']]) {
  const materialHash = computeAgt002RadarSourceRowHash({ ...withDerived(current, 12, RAPIDO), [field]: value });
  assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(materialHash), MATCH), false, `${field} distinto debe encolarse`);
}
const extraRawHash = computeAgt002RadarSourceRowHash({ ...current, raw: { ...current.raw, days: 12, window: RAPIDO, nuevo_campo: 'x' } });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(extraRawHash), MATCH), false, 'raw adicional debe encolarse');
const droppedRawHash = computeAgt002RadarSourceRowHash({ ...current, raw: { days: 12, window: RAPIDO } });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(droppedRawHash), MATCH), false, 'raw que perdió campos debe encolarse');

// 8. Política/contexto distintos: nunca es churn derivado, aunque el hash se reprodujera.
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash, { policy_version: 'p2' }), MATCH), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash, { context_version: 'c2' }), MATCH), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), { policyVersion: 'p', contextVersion: '' }), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), { policyVersion: null, contextVersion: 'c' }), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), {}), false, 'sin política/contexto esperados no se clasifica');

// 9. Falla cerrado ante formas extrañas del canónico.
const sameHash = computeAgt002RadarSourceRowHash(current);
for (const broken of [null, undefined, 'x', 42, [], canonical(undefined), canonical(null), canonical('no-hex'),
  canonical('A'.repeat(64)), canonical(previousHash.slice(0, 63)), canonical(previousHash.toUpperCase())]) {
  assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, broken, MATCH), false, `canónico ${JSON.stringify(broken)} debe cerrarse`);
}
// Hash idéntico al actual: no hay deriva que absorber; el corto circuito `satisfied` del RPC ya
// cubre ese caso y este clasificador no debe reclamarlo como propio.
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(sameHash), MATCH), false);
// Fila de entrada extraña.
for (const broken of [null, undefined, 'x', [], {}, { raw: { days: 1, window: URGENTE } }]) {
  assert.equal(isAgt002RadarDerivedDayOnlyChurn(broken, canonical(previousHash), MATCH), false);
}

// 10. Nunca muta la fila original: congelada en profundidad y verificada por estructura.
const frozenRaw = Object.freeze({ objeto: 'Vigilancia', days: 11, window: RAPIDO, anidado: Object.freeze({ a: 1 }) });
const frozenRow = Object.freeze(row(frozenRaw));
const frozenSnapshot = JSON.stringify(frozenRow);
const frozenPrevious = computeAgt002RadarSourceRowHash({ ...frozenRow, raw: { ...frozenRaw, days: 13, window: RAPIDO } });
assert.equal(isAgt002RadarDerivedDayOnlyChurn(frozenRow, canonical(frozenPrevious), MATCH), true);
assert.equal(JSON.stringify(frozenRow), frozenSnapshot, 'la fila original no puede cambiar');
assert.equal(frozenRow.raw, frozenRaw, 'la fila original conserva su mismo raw');
assert.equal(frozenRow.raw.days, 11);
assert.equal(frozenRow.raw.window, RAPIDO);

// 11. Sólo raw.days y raw.window varían entre candidatos: se inspecciona cada fila entregada al
//     hasher. Cualquier otro campo, incluido el subobjeto anidado de raw, es idéntico.
const seen = [];
const probeRow = row({ objeto: 'Vigilancia', days: 4, window: URGENTE, anidado: { a: 1 } });
const probeTarget = computeAgt002RadarSourceRowHash(withDerived(probeRow, 9, RAPIDO));
assert.equal(isAgt002RadarDerivedDayOnlyChurn(probeRow, canonical(probeTarget), {
  ...MATCH,
  computeSourceRowHash: value => { seen.push(JSON.parse(JSON.stringify(value))); return computeAgt002RadarSourceRowHash(value); },
}), true);
assert.equal(seen.length, 6, 'un hash de la fila actual + cinco candidatos hasta acertar en offset 5');
assert.deepEqual(seen[0], JSON.parse(JSON.stringify(probeRow)), 'el primer hash es el de la fila actual, sin tocar');
for (const [index, candidate] of seen.slice(1).entries()) {
  const days = 4 + index + 1;
  assert.deepEqual(candidate, JSON.parse(JSON.stringify(withDerived(probeRow, days, agt002RadarDerivedDayWindowLabel(days)))),
    `el candidato ${index + 1} sólo puede diferir en raw.days/raw.window`);
}

// 12. Un hasher que lanza no clasifica como churn (falla cerrado, sin propagar).
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), {
  ...MATCH, computeSourceRowHash: () => { throw new Error('boom'); },
}), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), { ...MATCH, maxOffsetDays: 0 }), false);
assert.equal(isAgt002RadarDerivedDayOnlyChurn(current, canonical(previousHash), { ...MATCH, maxOffsetDays: 1.5 }), false);

console.log('AGT-002 Radar derived-only day/window churn classifier passed');
