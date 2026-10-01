// Contrato vigente del componente de Servicio v2 data-driven en modo sombra
// (ver docs/superpowers/specs/2026-10-01-agt002-service-matrix-v2-shadow.md).
// Secciones 1-16: forma de exports, validación fail-closed, tabla de puntaje por
// combinación de familias ancladas, confirmación AMBIGUA/CONTEXTO, exclusión dura/
// condicional por campo, normalización/límites de frase, traza/determinismo, y
// compatibilidad sombra con evaluateTenderFit. Sección 17: absorción de anclas
// ELECTRONICA contenidas en el span de una ancla SUMINISTRO (spec §4.3.1).
import assert from 'node:assert/strict';
import { TENDER_FIT_POLICY_VERSION, evaluateTenderFit } from '../tender-fit-policy.js';
import {
  TENDER_SERVICE_MATRIX_V2_VERSION,
  TENDER_SERVICE_MATRIX_V2,
  TENDER_SERVICE_MATRIX_V2_ROLES,
  TENDER_SERVICE_MATRIX_V2_FAMILIES,
  TenderServiceMatrixV2ValidationError,
  validateTenderServiceMatrixV2,
  evaluateTenderServiceMatrixV2,
} from '../tender-service-matrix-v2.js';

const NOW = '2026-09-20T15:00:00.000Z';

function fields(o = {}) {
  return { title: '', description: '', detail: '', ...o };
}
const retiredTerms = ['transporte de valores', 'custodia y transporte de valores', 'manejo de valores'];

const COMBINING_DIACRITICS_REGEX = new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g');
function normalizeLikeMatrix(value) {
  return String(value || '').normalize('NFD').replace(COMBINING_DIACRITICS_REGEX, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 1. Forma de los exports y matriz real válida
// ---------------------------------------------------------------------------
assert.equal(typeof TENDER_SERVICE_MATRIX_V2_VERSION, 'string');
assert.ok(TENDER_SERVICE_MATRIX_V2_VERSION.trim().length > 0, 'la versión de la matriz no debe estar vacía');
assert.ok(Array.isArray(TENDER_SERVICE_MATRIX_V2));
assert.equal(Object.isFrozen(TENDER_SERVICE_MATRIX_V2), true, 'la matriz exportada debe estar congelada');
assert.deepEqual([...TENDER_SERVICE_MATRIX_V2_ROLES].sort(), ['AMBIGUA', 'ANCLA', 'CONTEXTO', 'EXCLUSION']);
assert.deepEqual([...TENDER_SERVICE_MATRIX_V2_FAMILIES].sort(), ['ELECTRONICA', 'FISICA', 'SUMINISTRO']);
assert.doesNotThrow(
  () => validateTenderServiceMatrixV2({ version: TENDER_SERVICE_MATRIX_V2_VERSION, rows: TENDER_SERVICE_MATRIX_V2 }),
  'la matriz real exportada debe pasar su propio validador fail-closed',
);

// ---------------------------------------------------------------------------
// 2. Cada familia sola (solo ancla de esa familia, nada más)
// ---------------------------------------------------------------------------
const soloFisica = evaluateTenderServiceMatrixV2(fields({ title: 'Contrato de vigilancia armada en sede principal' }));
assert.equal(soloFisica.family, 'FISICA');
assert.equal(soloFisica.points, 45);
assert.equal(soloFisica.status, 'EN_ALCANCE');
assert.equal(soloFisica.excluded, false);

const soloElectronica = evaluateTenderServiceMatrixV2(fields({ title: 'Instalación de CCTV y control de acceso perimetral' }));
assert.equal(soloElectronica.family, 'ELECTRONICA');
assert.equal(soloElectronica.points, 48);
assert.equal(soloElectronica.status, 'EN_ALCANCE');

const soloSuministro = evaluateTenderServiceMatrixV2(fields({ title: 'Suministro e instalación de cámaras para sede principal' }));
assert.equal(soloSuministro.family, 'SUMINISTRO');
assert.equal(soloSuministro.points, 40);
assert.equal(soloSuministro.status, 'EN_ALCANCE');

// ---------------------------------------------------------------------------
// 3. Híbrida: física + electrónica (sin suministro) = 50
// ---------------------------------------------------------------------------
const hibrida = evaluateTenderServiceMatrixV2(fields({ title: 'Vigilancia armada con CCTV y control de acceso' }));
assert.equal(hibrida.family, 'HIBRIDA');
assert.equal(hibrida.points, 50);
assert.equal(hibrida.status, 'EN_ALCANCE');

// ---------------------------------------------------------------------------
// 4. Combinaciones con suministro (ancla real de suministro: `suministro e instalacion de camaras`)
// ---------------------------------------------------------------------------
const supplyElectronic = evaluateTenderServiceMatrixV2(
  fields({ title: 'Suministro e instalación de cámaras junto con seguridad electrónica integral' }),
);
assert.equal(supplyElectronic.family, 'ELECTRONICA', 'suministro+electrónica debe resolver a familia ELECTRONICA');
assert.equal(supplyElectronic.points, 48);

const supplyPhysical = evaluateTenderServiceMatrixV2(
  fields({ title: 'Suministro e instalación de cámaras junto con vigilancia armada' }),
);
assert.equal(supplyPhysical.family, 'FISICA', 'suministro+física debe resolver a familia FISICA');
assert.equal(supplyPhysical.points, 45);

const supplyPhysicalElectronic = evaluateTenderServiceMatrixV2(
  fields({ title: 'Suministro e instalación de cámaras, vigilancia armada y CCTV' }),
);
assert.equal(supplyPhysicalElectronic.family, 'HIBRIDA', 'física+electrónica con suministro sigue siendo HIBRIDA (50)');
assert.equal(supplyPhysicalElectronic.points, 50);

// ---------------------------------------------------------------------------
// 5. Ambigua confirmada por dos contextos distintos, sin ancla => 30/POR_VALIDAR
// ---------------------------------------------------------------------------
const ambiguaConfirmada = evaluateTenderServiceMatrixV2(
  fields({ title: 'Servicio de escolta con armas 24 horas' }),
);
assert.equal(ambiguaConfirmada.family, 'AMBIGUA');
assert.equal(ambiguaConfirmada.points, 30);
assert.equal(ambiguaConfirmada.status, 'POR_VALIDAR');
assert.equal(ambiguaConfirmada.excluded, false);

// ---------------------------------------------------------------------------
// 6. Ambigua sola (sin confirmación de 2 contextos), sin ancla => 0/FUERA_DE_ALCANCE
// ---------------------------------------------------------------------------
const ambiguaSola = evaluateTenderServiceMatrixV2(fields({ title: 'Servicio de escolta para evento corporativo' }));
assert.equal(ambiguaSola.family, null);
assert.equal(ambiguaSola.points, 0);
assert.equal(ambiguaSola.status, 'FUERA_DE_ALCANCE');

const ambiguaUnSoloContexto = evaluateTenderServiceMatrixV2(
  fields({ title: 'Servicio de escolta con armas' }),
);
assert.equal(ambiguaUnSoloContexto.family, null, 'un solo contexto no confirma la ambigua (hacen falta 2 distintos)');
assert.equal(ambiguaUnSoloContexto.points, 0);
assert.equal(ambiguaUnSoloContexto.status, 'FUERA_DE_ALCANCE');

// ---------------------------------------------------------------------------
// 7. Exclusión dura en title: excluye incondicionalmente, incluso con ancla presente
// ---------------------------------------------------------------------------
const exclusionDuraTitle = evaluateTenderServiceMatrixV2(
  fields({ title: 'Interventoria tecnica y administrativa del contrato de vigilancia armada' }),
);
assert.equal(exclusionDuraTitle.excluded, true);
assert.equal(exclusionDuraTitle.exclusion_rule, 'dura');
assert.equal(exclusionDuraTitle.points, 0);
assert.equal(exclusionDuraTitle.family, null);
assert.equal(exclusionDuraTitle.status, 'EXCLUIDA');

// ---------------------------------------------------------------------------
// 8. Misma exclusión dura solo en description (con ancla válida en title) => NO excluye
// ---------------------------------------------------------------------------
const exclusionDuraSoloDescripcion = evaluateTenderServiceMatrixV2(
  fields({ title: 'Contrato de vigilancia armada', description: 'Incluye interventoria externa de seguimiento' }),
);
assert.equal(exclusionDuraSoloDescripcion.excluded, false, 'exclusión dura solo en description no debe excluir');
assert.equal(exclusionDuraSoloDescripcion.family, 'FISICA');
assert.equal(exclusionDuraSoloDescripcion.points, 45);
assert.equal(exclusionDuraSoloDescripcion.status, 'EN_ALCANCE');

// ---------------------------------------------------------------------------
// 9. Exclusión condicional: excluye sin ancla; no excluye con ancla presente
// ("telecomunicaciones" es exclusión condicional; "vigilancia epidemiologica" es dura, no sirve aquí)
// ---------------------------------------------------------------------------
const exclusionCondicionalSinAncla = evaluateTenderServiceMatrixV2(
  fields({ title: 'Proyecto de telecomunicaciones institucionales' }),
);
assert.equal(exclusionCondicionalSinAncla.excluded, true);
assert.equal(exclusionCondicionalSinAncla.exclusion_rule, 'condicional');
assert.equal(exclusionCondicionalSinAncla.points, 0);
assert.equal(exclusionCondicionalSinAncla.status, 'EXCLUIDA');

const exclusionCondicionalConAncla = evaluateTenderServiceMatrixV2(
  fields({ title: 'Vigilancia armada con telecomunicaciones' }),
);
assert.equal(exclusionCondicionalConAncla.excluded, false, 'exclusión condicional con ancla presente no debe excluir');
assert.equal(exclusionCondicionalConAncla.family, 'FISICA');
assert.equal(exclusionCondicionalConAncla.points, 45);

// ---------------------------------------------------------------------------
// 10. Normalización / diacríticos: mayúsculas y tildes resuelven igual
// ---------------------------------------------------------------------------
const diacriticos = evaluateTenderServiceMatrixV2(fields({ title: 'Servicio de SEGURIDAD ELECTRÓNICA integral' }));
assert.equal(diacriticos.family, 'ELECTRONICA');
assert.equal(diacriticos.points, 48);

// ---------------------------------------------------------------------------
// 11. Límites de palabra/frase: ninguna coincidencia de subcadena suelta
// ---------------------------------------------------------------------------
const sinFalsoPositivoAncla = evaluateTenderServiceMatrixV2(
  fields({ title: 'Mantenimiento de control de accesorios electronicos' }),
);
assert.equal(sinFalsoPositivoAncla.family, null, '"control de accesorios" no debe disparar el ancla "control de acceso"');
assert.equal(sinFalsoPositivoAncla.points, 0);

const sinFalsoPositivoAmbigua = evaluateTenderServiceMatrixV2(
  fields({ title: 'Instalacion de arco detectorado perimetral' }),
);
assert.equal(sinFalsoPositivoAmbigua.family, null, '"arco detectorado" no debe disparar la ambigua "arco detector"');
assert.equal(sinFalsoPositivoAmbigua.points, 0);

// ---------------------------------------------------------------------------
// 12. Traza / campo fuente / determinismo
// ---------------------------------------------------------------------------
assert.ok(Array.isArray(hibrida.trace) && hibrida.trace.length > 0, 'debe producir una traza no vacía');
for (const entry of hibrida.trace) {
  assert.ok(['term', 'role', 'family', 'field', 'rule', 'verdict'].every(key => key in entry), 'cada entrada de traza debe traer term/role/family/field/rule/verdict');
  assert.ok(['title', 'description', 'detail'].includes(entry.field), 'el campo fuente de cada entrada de traza debe ser title/description/detail');
}
assert.ok(
  hibrida.trace.some(entry => entry.role === 'ANCLA' && entry.family === 'FISICA' && entry.field === 'title'),
  'la traza debe reportar el ancla física encontrada en title',
);
assert.ok(
  hibrida.trace.some(entry => entry.role === 'ANCLA' && entry.family === 'ELECTRONICA' && entry.field === 'title'),
  'la traza debe reportar el ancla electrónica encontrada en title',
);
const hibridaRepetida = evaluateTenderServiceMatrixV2(fields({ title: 'Vigilancia armada con CCTV y control de acceso' }));
assert.equal(JSON.stringify(hibrida), JSON.stringify(hibridaRepetida), 'la evaluación debe ser determinística ante la misma entrada');

// ---------------------------------------------------------------------------
// 13. Ausencia de los tres términos retirados en la matriz
// ---------------------------------------------------------------------------
const normalizedMatrixTerms = TENDER_SERVICE_MATRIX_V2.map(row => normalizeLikeMatrix(row.term));
for (const retired of retiredTerms) {
  assert.ok(
    !normalizedMatrixTerms.includes(normalizeLikeMatrix(retired)),
    `el término retirado "${retired}" no debe aparecer en la matriz bajo ningún rol`,
  );
}

// ---------------------------------------------------------------------------
// 13.1 Las siete expresiones amplias movidas de ancla a ambigua: siempre AMBIGUA, nunca ANCLA
// ---------------------------------------------------------------------------
const movedToAmbigua = ['escolta', 'escoltas', 'proteccion a personas', 'camaras de seguridad', 'detector de metales', 'arco detector', 'central de monitoreo'];
for (const term of movedToAmbigua) {
  const normalizedTerm = normalizeLikeMatrix(term);
  const matchingRows = TENDER_SERVICE_MATRIX_V2.filter(row => normalizeLikeMatrix(row.term) === normalizedTerm);
  assert.ok(matchingRows.length > 0, `el término movido "${term}" debe existir en la matriz`);
  assert.ok(
    matchingRows.every(row => row.role === 'AMBIGUA'),
    `el término movido "${term}" debe existir únicamente como AMBIGUA, nunca como ANCLA`,
  );
}

// ---------------------------------------------------------------------------
// 14. Ninguna fila de término lleva `points`
// ---------------------------------------------------------------------------
for (const row of TENDER_SERVICE_MATRIX_V2) {
  assert.ok(!('points' in row), `la fila "${row.term}" (${row.role}) no debe tener la propiedad points`);
}

// ---------------------------------------------------------------------------
// 15. El validador rechaza matrices mal formadas (fail-closed)
// ---------------------------------------------------------------------------
const validRow = { term: 'vigilancia armada', role: 'ANCLA', family: 'FISICA', strength: null, active: true };

assert.throws(
  () => validateTenderServiceMatrixV2({ version: '', rows: [validRow] }),
  TenderServiceMatrixV2ValidationError,
  'versión vacía debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({ version: 'v1', rows: [{ ...validRow, role: 'INVALIDO' }] }),
  TenderServiceMatrixV2ValidationError,
  'rol inválido debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({ version: 'v1', rows: [{ ...validRow, family: 'QUIMICA' }] }),
  TenderServiceMatrixV2ValidationError,
  'familia inválida debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({
    version: 'v1',
    rows: [{ term: 'escolta', role: 'AMBIGUA', family: null, strength: null, active: true }],
  }),
  TenderServiceMatrixV2ValidationError,
  'AMBIGUA sin familia debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({
    version: 'v1',
    rows: [{ term: 'interventoria', role: 'EXCLUSION', family: 'FISICA', strength: 'dura', active: true }],
  }),
  TenderServiceMatrixV2ValidationError,
  'EXCLUSION con familia debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({ version: 'v1', rows: [{ ...validRow, points: 45 }] }),
  TenderServiceMatrixV2ValidationError,
  'una fila con la propiedad points debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({ version: 'v1', rows: [{ ...validRow, term: 'vigilancia.armada' }] }),
  TenderServiceMatrixV2ValidationError,
  'un término con punto debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({
    version: 'v1',
    rows: [{ term: 'transporte de valores', role: 'ANCLA', family: 'FISICA', strength: null, active: true }],
  }),
  TenderServiceMatrixV2ValidationError,
  'un término retirado presente en la matriz debe rechazarse',
);
assert.throws(
  () => validateTenderServiceMatrixV2({
    version: 'v1',
    rows: [
      { ...validRow, active: true },
      { term: 'Vigilancia   Armada', role: 'ANCLA', family: 'FISICA', strength: null, active: true },
    ],
  }),
  TenderServiceMatrixV2ValidationError,
  'dos filas activas con el mismo término normalizado deben rechazarse como duplicado/conflicto',
);
assert.doesNotThrow(
  () => validateTenderServiceMatrixV2({
    version: 'v1',
    rows: [
      { ...validRow, active: true },
      { ...validRow, active: false },
    ],
  }),
  'dos filas con el mismo término normalizado son válidas si una está inactiva',
);

// ---------------------------------------------------------------------------
// 16. Compatibilidad sombra: v1 no cambia; shadow.servicio_v2 se añade de forma aditiva
// ---------------------------------------------------------------------------
function baseTender(o = {}) {
  return {
    title: 'Servicio de vigilancia armada', description: 'Guardas de seguridad física',
    value: 2_500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación pública', ...o,
  };
}
const tender = baseTender();
const result = evaluateTenderFit(tender, { nowIso: NOW });

// El eje servicio v1 y el resto del contrato de evaluateTenderFit no deben cambiar.
assert.equal(result.policy_version, TENDER_FIT_POLICY_VERSION);
assert.equal(TENDER_FIT_POLICY_VERSION, 'tender-fit-v1', 'la versión de política v1 no debe cambiar por introducir v2 en sombra');
assert.equal(result.band, 'alto');
assert.ok(result.score >= 75);
assert.equal(result.reasons.map(r => r.axis).join(','), 'servicio,escala_comercial,territorio,ventana_operativa');
const servicioReasonV1 = result.reasons.find(r => r.axis === 'servicio');
assert.equal(servicioReasonV1.points, 50, 'el eje servicio v1 (evaluateServicioAxis) no debe cambiar su puntaje por la introducción de v2');

// La proyección sombra debe existir, ser interna (no reemplaza nada del contrato v1) y coincidir con una llamada directa al evaluador v2.
assert.ok(result.shadow, 'evaluateTenderFit debe exponer un campo shadow aditivo');
assert.ok(result.shadow.servicio_v2, 'shadow.servicio_v2 debe existir');
const directV2 = evaluateTenderServiceMatrixV2({ title: tender.title, description: tender.description, detail: tender.detail });
assert.deepEqual(result.shadow.servicio_v2, directV2, 'shadow.servicio_v2 debe coincidir exactamente con evaluateTenderServiceMatrixV2 sobre los mismos campos');

// ---------------------------------------------------------------------------
// 17. Corrección 2026-10-01: ancla ELECTRONICA totalmente contenida en el span
//     de una ancla SUMINISTRO (mismo campo) debe quedar absorbida — no activa
//     ELECTRONICA por sí sola. Si hay otra ancla ELECTRONICA fuera de ese span,
//     esa sí activa ELECTRONICA con normalidad. Ver spec §4.3.1.
// ---------------------------------------------------------------------------
const suministroVideovigilancia = evaluateTenderServiceMatrixV2(
  fields({ title: 'Instalación de sistema de videovigilancia' }),
);
assert.equal(
  suministroVideovigilancia.family,
  'SUMINISTRO',
  '"instalacion de sistema de videovigilancia" es suministro puro; el ancla electrónica "sistema de videovigilancia" que contiene está absorbida por su span',
);
assert.equal(suministroVideovigilancia.points, 40);
assert.equal(suministroVideovigilancia.status, 'EN_ALCANCE');
assert.ok(
  suministroVideovigilancia.trace.some(
    entry => entry.role === 'ANCLA' && entry.family === 'ELECTRONICA' && entry.verdict === 'absorbida_por_suministro',
  ),
  'la traza debe reportar el ancla electrónica absorbida, no ignorada silenciosamente',
);
assert.ok(
  !suministroVideovigilancia.trace.some(
    entry => entry.role === 'ANCLA' && entry.family === 'ELECTRONICA' && entry.verdict === 'incluido',
  ),
  'el ancla electrónica absorbida no debe contar como incluida',
);

const suministroMantenimientoCctv = evaluateTenderServiceMatrixV2(fields({ title: 'Mantenimiento de CCTV' }));
assert.equal(
  suministroMantenimientoCctv.family,
  'SUMINISTRO',
  '"mantenimiento de cctv" es suministro puro aunque contenga el ancla electrónica "cctv"',
);
assert.equal(suministroMantenimientoCctv.points, 40);

const suministroInstalacionControlAcceso = evaluateTenderServiceMatrixV2(
  fields({ title: 'Instalación de control de acceso' }),
);
assert.equal(
  suministroInstalacionControlAcceso.family,
  'SUMINISTRO',
  '"instalacion de control de acceso" es suministro puro aunque contenga el ancla electrónica "control de acceso"',
);
assert.equal(suministroInstalacionControlAcceso.points, 40);

const suministroEquiposControlAcceso = evaluateTenderServiceMatrixV2(
  fields({ title: 'Suministro de equipos de control de acceso' }),
);
assert.equal(
  suministroEquiposControlAcceso.family,
  'SUMINISTRO',
  '"suministro de equipos de control de acceso" es suministro puro aunque contenga el ancla electrónica "control de acceso"',
);
assert.equal(suministroEquiposControlAcceso.points, 40);

// Pero si hay OTRA ancla electrónica fuera del span cubierto por el ancla de suministro,
// esa coincidencia sí es independiente y activa ELECTRONICA normalmente.
const suministroMasElectronicaIndependiente = evaluateTenderServiceMatrixV2(
  fields({ title: 'Instalación de control de acceso junto con servicio de seguridad electrónica recurrente' }),
);
assert.equal(
  suministroMasElectronicaIndependiente.family,
  'ELECTRONICA',
  'el ancla electrónica "seguridad electronica" está fuera del span de "instalacion de control de acceso" y sí debe activar ELECTRONICA',
);
assert.equal(suministroMasElectronicaIndependiente.points, 48);
assert.ok(
  suministroMasElectronicaIndependiente.trace.some(
    entry =>
      entry.role === 'ANCLA' &&
      entry.family === 'ELECTRONICA' &&
      entry.term === 'control de acceso' &&
      entry.verdict === 'absorbida_por_suministro',
  ),
  'el "control de acceso" contenido en el span de suministro sigue absorbido aunque haya otra ancla electrónica independiente',
);
assert.ok(
  suministroMasElectronicaIndependiente.trace.some(
    entry =>
      entry.role === 'ANCLA' &&
      entry.family === 'ELECTRONICA' &&
      entry.term === 'seguridad electronica' &&
      entry.verdict === 'incluido',
  ),
  'la ancla electrónica independiente "seguridad electronica" sí debe quedar incluida',
);

console.log('tender-service-matrix-v2: OK');
