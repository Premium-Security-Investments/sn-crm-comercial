// TDD — P1 adquisición: el `$select` de SECOP II pide `modalidad_de_contratacion` y
// `normalizeTender` lo retiene en `raw`. La política NARROW no oculta un especial
// sin plazo si no hay proveedor nombrado ni ref CTO/CONTRATO (convocatoria viva).
// Pereira (CTO 08 DE 2025) sí es `no_competible`.
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

const pereiraRawRow = {
  ...secopIIRawRow,
  entidad: 'EMPRESA DE ENERGIA DE PEREIRA SA ESP',
  departamento_entidad: 'Risaralda',
  ciudad_entidad: 'Pereira',
  id_del_proceso: 'CO1.REQ.10512285',
  referencia_del_proceso: 'CTO 08 DE 2025',
  nombre_del_procedimiento: 'Contratar un servicio integral de seguridad privada',
  descripci_n_del_procedimiento: 'Servicio de vigilancia Pereira y Cartago',
  modalidad_de_contratacion: 'Contratación régimen especial',
};

const bancoAgrarioRawRow = {
  ...secopIIRawRow,
  entidad: 'Banco Agrario de Colombia S.A.',
  departamento_entidad: 'Bogotá D.C.',
  ciudad_entidad: 'Bogotá',
  id_del_proceso: 'CO1.REQ.11046654',
  referencia_del_proceso: 'PAC-2026-1065',
  nombre_del_procedimiento: 'PAC-2026-1065',
  descripci_n_del_procedimiento: 'Proceso de contratación régimen especial',
  modalidad_de_contratacion: 'Contratación régimen especial',
  nombre_del_proveedor: 'UT GSBCOM 2026',
};

for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { tenderSources, normalizeTender } = loadSecopAcquisitionPath(source, path);

  assert.ok(
    tenderSources['SECOP II'].select.split(',').includes('modalidad_de_contratacion'),
    `${path}: el $select de SECOP II debe incluir modalidad_de_contratacion`,
  );
  assert.ok(
    tenderSources['SECOP II'].select.split(',').includes('nombre_del_proveedor'),
    `${path}: el $select de SECOP II debe incluir nombre_del_proveedor`,
  );

  const scored = { score: 10, reasons: ['test'], risks: [] };
  const tender = normalizeTender(secopIIRawRow, 'SECOP II', scored);
  assert.equal(
    tender.raw.modalidad_de_contratacion,
    'Contratación régimen especial',
    `${path}: la fila normalizada debe retener modalidad_de_contratacion en raw`,
  );
  assert.equal(tender.deadline, null, `${path}: sin fecha_de_recepcion_de reportada no hay plazo verificable`);

  const result = evaluateTenderCompetibility(tender, { nowIso: '2026-10-01T12:00:00.000Z' });
  assert.equal(
    result.status,
    'competible',
    `${path}: régimen especial sin plazo, sin proveedor nombrado y sin CTO/CONTRATO debe ser competible`,
  );

  const pereira = normalizeTender(pereiraRawRow, 'SECOP II', scored);
  assert.equal(
    evaluateTenderCompetibility(pereira, { nowIso: '2026-10-01T12:00:00.000Z' }).status,
    'no_competible',
    `${path}: Pereira CTO 08 DE 2025 (especial sin plazo + ref CTO) debe ser no_competible`,
  );

  const bancoAgrario = normalizeTender(bancoAgrarioRawRow, 'SECOP II', scored);
  assert.equal(
    bancoAgrario.raw.nombre_del_proveedor,
    'UT GSBCOM 2026',
    `${path}: Banco Agrario PAC-2026-1065 debe retener nombre_del_proveedor en raw`,
  );
  assert.equal(
    evaluateTenderCompetibility(bancoAgrario, { nowIso: '2026-10-01T12:00:00.000Z' }).status,
    'no_competible',
    `${path}: Banco Agrario PAC-2026-1065 (especial sin plazo + proveedor UT GSBCOM 2026) debe ser no_competible`,
  );
}

console.log('tender-competibility-acquisition-secop-modalidad.test.mjs OK');
