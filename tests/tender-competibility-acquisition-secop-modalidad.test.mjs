// TDD (RED) — P1 adquisición: el select real de SECOP II nunca pedía
// `modalidad_de_contratacion` a la fuente (datos.gov.co), así que la política de
// competibilidad (`tender-competibility-policy.js`) nunca podía detectar régimen especial vía
// `raw.modalidad_de_contratacion` en producción, aunque la política ya sabía leer ese campo.
//
// Este contrato extrae las piezas REALES de ambos backends (server/index.js y
// api/[...path].js, que deben permanecer byte-idénticos) y prueba, sin reimplementar nada:
//   1. El `$select` real de SECOP II pide `modalidad_de_contratacion`.
//   2. La vía de normalización real (`normalizeTender`) retiene ese campo en `raw` tal cual.
//   3. La política PURA (import real) clasifica ese caso -régimen especial sin plazo
//      verificable- como `por_verificar`.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeTenderStatusText, officialTenderStatus } from '../tender-source-status.js';
import { evaluateTenderCompetibility } from '../tender-competibility-policy.js';

const backendPaths = ['../server/index.js', '../api/[...path].js'];

function extract(source, path, label, regex) {
  const match = source.match(regex);
  assert.ok(match, `${path} must define ${label}`);
  return match[0];
}

// Reconstruye, a partir del código fuente REAL de cada backend, el `tenderSources` real
// (para el `select`) y la función `normalizeTender` real (para probar la retención en `raw`),
// con sus dependencias directas. No reimplementa ninguna lógica propia.
function loadSecopAcquisitionPath(source, path) {
  const pieces = [
    extract(source, path, 'tenderSources', /const tenderSources = \{[\s\S]*?\n\};\n/),
    extract(source, path, 'normTenderText', /function normTenderText\(value\) \{ return normalizeTenderStatusText\(value\); \}\n/),
    extract(source, path, 'tenderMoney', /function tenderMoney\(value\) \{[^\n]*\}\n/),
    extract(source, path, 'tenderDate', /function tenderDate\(value\) \{[^\n]*\}\n/),
    extract(source, path, 'tenderDaysUntil', /function tenderDaysUntil\(value\) \{[^\n]*\}\n/),
    extract(source, path, 'tenderWindow', /function tenderWindow\(days\) \{[^\n]*\}\n/),
    extract(source, path, 'stableTenderKey', /function stableTenderKey\(tender\) \{[\s\S]*?\n\}\n/),
    extract(source, path, 'classifyTenderSection', /function classifyTenderSection\([\s\S]*?\n\}\n/),
    extract(source, path, 'normalizeTender', /function normalizeTender\(row, source, scored\) \{[\s\S]*?\n\}\n/),
  ];
  const body = `${pieces.join('')}\nreturn { tenderSources, normalizeTender };`;
  return new Function('normalizeTenderStatusText', 'officialTenderStatus', 'createHash', body)(
    normalizeTenderStatusText, officialTenderStatus, createHash,
  );
}

// Fixture sintética: una fila como la que hoy sí devuelve datos.gov.co para SECOP II, ahora
// con `modalidad_de_contratacion` presente (porque el `$select` ya la pide) y SIN
// `fecha_de_recepcion_de` (sin plazo verificable), igual que el caso real reportado.
const secopIIRawRow = {
  entidad: 'Empresas Públicas de Medellín E.S.P.',
  departamento_entidad: 'Antioquia',
  ciudad_entidad: 'Medellín',
  id_del_proceso: 'CO1.REQ.ACQ-TEST-0001',
  referencia_del_proceso: 'ACQ-TEST-0001',
  nombre_del_procedimiento: 'Prórroga de interventoría técnica de subestaciones',
  descripci_n_del_procedimiento: 'Continuidad del contrato de interventoría integral',
  fase: 'Selección',
  estado_del_procedimiento: 'Presentación de oferta',
  fecha_de_publicacion_del: '2026-09-01T00:00:00.000',
  precio_base: '500000000',
  codigo_principal_de_categoria: 'V1.81101500',
  urlproceso: { url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.TEST' },
  modalidad_de_contratacion: 'Contratación régimen especial',
};

for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { tenderSources, normalizeTender } = loadSecopAcquisitionPath(source, path);

  // 1. El select real de SECOP II debe pedir modalidad_de_contratacion a la fuente.
  assert.ok(
    tenderSources['SECOP II'].select.split(',').includes('modalidad_de_contratacion'),
    `${path}: el $select de SECOP II debe incluir modalidad_de_contratacion`,
  );

  // 2. La normalización REAL retiene ese campo en raw, sin transformarlo.
  const scored = { score: 10, reasons: ['test'], risks: [] };
  const tender = normalizeTender(secopIIRawRow, 'SECOP II', scored);
  assert.equal(
    tender.raw.modalidad_de_contratacion,
    'Contratación régimen especial',
    `${path}: la fila normalizada debe retener modalidad_de_contratacion en raw`,
  );
  assert.equal(tender.deadline, null, `${path}: sin fecha_de_recepcion_de reportada no hay plazo verificable`);

  // 3. La política PURA (import real, sin reimplementar) clasifica régimen especial detectado
  //    sólo vía raw.modalidad_de_contratacion, sin plazo verificable, como por_verificar.
  const result = evaluateTenderCompetibility(tender, { nowIso: '2026-10-01T12:00:00.000Z' });
  assert.equal(
    result.status,
    'por_verificar',
    `${path}: régimen especial (vía raw.modalidad_de_contratacion) sin plazo verificable debe ser por_verificar`,
  );
}

console.log('tender-competibility-acquisition-secop-modalidad.test.mjs OK');
