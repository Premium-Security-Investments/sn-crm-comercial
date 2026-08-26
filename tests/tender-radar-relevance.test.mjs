import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { normalizeTenderStatusText } from '../tender-source-status.js';
import { TENDER_CORE_SERVICE_TERMS, TENDER_DISQUALIFYING_TERMS } from '../tender-relevance-terms.js';

// Regression coverage for the Radar de licitaciones eligibility bug: a SECOP process
// unrelated to PSI's offerable business (vigilancia, seguridad privada, CCTV/videovigilancia,
// control de acceso) was reaching "sugerencias" only because a generic word, the entity's
// name/department, or a high value/foco-zone bonus happened to match somewhere in the raw
// row. Reported case: SECOP CO1.NTC.10520000 (synthetic fixture below, no real SECOP data
// is fetched or used here).
const backendPaths = ['../server/index.js', '../api/[...path].js'];

function extract(source, path, label, regex) {
  const match = source.match(regex);
  assert.ok(match, `${path} must define ${label} for scoped tender relevance scoring`);
  return match[0];
}

function loadTenderRelevance(source, path) {
  const pieces = [
    extract(source, path, 'tenderSources', /const tenderSources = \{[\s\S]*?\n\};\n/),
    extract(source, path, 'tenderPositiveTerms', /const tenderPositiveTerms = \{[\s\S]*?\n\};\n/),
    extract(source, path, 'normTenderText', /function normTenderText\(value\) \{ return normalizeTenderStatusText\(value\); \}\n/),
    extract(source, path, 'tenderContextualPhysicalSecurityReason', /const tenderContextualPhysicalSecurityReason = [^\n]*;\n/),
    extract(source, path, 'tenderDirectServiceReason', /const tenderDirectServiceReason = [^\n]*;\n/),
    extract(source, path, 'tenderPhysicalSecurityContextTerms', /const tenderPhysicalSecurityContextTerms = \[[\s\S]*?\n\]\.map\(normTenderText\);\n/),
    extract(source, path, 'tenderNonOfferableDirectIntentTerms', /const tenderNonOfferableDirectIntentTerms = \[[\s\S]*?\n\]\.map\(normTenderText\);\n/),
    extract(source, path, 'tenderCoreServiceTerms', /const tenderCoreServiceTerms = new Set\(\[[\s\S]*?\]\);\n/),
    extract(source, path, 'tenderDisqualifyingTerms', /const tenderDisqualifyingTerms = TENDER_DISQUALIFYING_TERMS;\n/),
    extract(source, path, 'tenderFocusTerms', /const tenderFocusTerms = \{[^\n]*\};\n/),
    extract(source, path, 'tenderMoney', /function tenderMoney\(value\) \{[^\n]*\}\n/),
    extract(source, path, 'tenderText', /function tenderText\(row\) \{[^\n]*\}\n/),
    extract(source, path, 'tenderObjectText', /function tenderObjectText\([\s\S]*?\n\}\n/),
    extract(source, path, 'tenderObjectParts', /function tenderObjectParts\([\s\S]*?\n\}\n/),
    extract(source, path, 'tenderPositiveEntries', /const tenderPositiveEntries = Object\.entries\(tenderPositiveTerms\)\.map\([^\n]*\);\n/),
    extract(source, path, 'hasTenderPhysicalSecurityContext', /function hasTenderPhysicalSecurityContext\([\s\S]*?\n\}\n/),
    extract(source, path, 'hasDirectOfferableTenderIntent', /function hasDirectOfferableTenderIntent\([\s\S]*?\n\}\n/),
    extract(source, path, 'hasTenderServiceSignal', /function hasTenderServiceSignal\(item\) \{[\s\S]*?\n\}\n/),
    extract(source, path, 'scoreTender', /function scoreTender\(row, nameFields\) \{[\s\S]*?\n\}\n/),
    extract(source, path, 'classifyTenderSection', /function classifyTenderSection\([\s\S]*?\n\}\n/),
  ];
  const body = `${pieces.join('')}\nreturn { scoreTender, hasTenderServiceSignal, classifyTenderSection, tenderSources };`;
  return new Function('normalizeTenderStatusText', 'TENDER_CORE_SERVICE_TERMS', 'TENDER_DISQUALIFYING_TERMS', body)(normalizeTenderStatusText, TENDER_CORE_SERVICE_TERMS, TENDER_DISQUALIFYING_TERMS);
}

for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { scoreTender, hasTenderServiceSignal, classifyTenderSection, tenderSources } = loadTenderRelevance(source, path);
  const secop2NameFields = tenderSources['SECOP II'].nameFields;

  // Synthetic regression fixture representing the reported SECOP CO1.NTC.10520000 case:
  // an unrelated process from a security-named entity, with no PSI-offerable service in
  // objeto/título/descripción. This is fabricated test data, not a real SECOP fetch.
  const unrelatedFromSecurityEntity = {
    id_del_proceso: 'CO1.NTC.10520000-SYNTHETIC-REGRESSION',
    entidad: 'Secretaría de Seguridad, Convivencia y Justicia de Bogotá D.C.',
    departamento_entidad: 'Bogotá D.C.',
    ciudad_entidad: 'Bogotá',
    nombre_del_procedimiento: 'Suministro de papelería y elementos de oficina',
    descripci_n_del_procedimiento: 'Compra de resmas de papel, esferos y carpetas para las dependencias de la entidad',
    precio_base: '600000000',
  };
  const unrelatedScored = scoreTender(unrelatedFromSecurityEntity, secop2NameFields);
  assert.equal(
    hasTenderServiceSignal(unrelatedScored),
    false,
    `${path}: an unrelated process must not become eligible just because the entity/department string contains "seguridad"`,
  );

  // Generic/weak word appearing in the objeto itself must not be sufficient alone.
  const genericWordOnly = {
    nombre_del_procedimiento: 'Servicio de monitoreo de calidad del aire en la ciudad',
    descripci_n_del_procedimiento: 'Contratar monitoreo ambiental para estaciones de medición y alarma de contingencia',
    precio_base: '100000000',
  };
  const genericScored = scoreTender(genericWordOnly, secop2NameFields);
  assert.equal(
    hasTenderServiceSignal(genericScored),
    false,
    `${path}: generic words like "monitoreo"/"alarma" in the objeto must not alone make a process eligible`,
  );

  // High value + foco zone alone (no business signal at all) must not confer eligibility.
  const valueAndZoneOnly = {
    nombre_del_procedimiento: 'Construcción de puente vehicular sobre el río',
    descripci_n_del_procedimiento: 'Obra civil de infraestructura vial en la ciudad',
    departamento_entidad: 'Bogotá D.C.',
    ciudad_entidad: 'Bogotá',
    precio_base: '2000000000',
  };
  const valueZoneScored = scoreTender(valueAndZoneOnly, secop2NameFields);
  assert.equal(
    hasTenderServiceSignal(valueZoneScored),
    false,
    `${path}: high value or foco-zone match alone must not make a process eligible`,
  );

  // Real vigilancia/seguridad privada process must remain eligible.
  const realVigilancia = {
    nombre_del_procedimiento: 'Prestación del servicio de vigilancia y seguridad privada para las sedes de la entidad',
    descripci_n_del_procedimiento: 'Servicio de vigilancia armada con guardas certificados en las instalaciones',
    precio_base: '300000000',
  };
  const vigilanciaScored = scoreTender(realVigilancia, secop2NameFields);
  assert.equal(hasTenderServiceSignal(vigilanciaScored), true, `${path}: a real vigilancia y seguridad privada process must remain eligible`);

  // Real CCTV/videovigilancia/control de acceso process must remain eligible even without
  // the word "vigilancia" itself.
  const realCctv = {
    nombre_del_procedimiento: 'Suministro e instalación de sistema de circuito cerrado de televisión (CCTV) y control de acceso',
    descripci_n_del_procedimiento: 'Adquisición de videovigilancia para el edificio administrativo',
    precio_base: '150000000',
  };
  const cctvScored = scoreTender(realCctv, secop2NameFields);
  assert.equal(hasTenderServiceSignal(cctvScored), true, `${path}: a real CCTV/videovigilancia/control de acceso process must remain eligible`);

  const falsePositiveFixtures = [
    {
      nombre_del_procedimiento: 'Adquisición e instalación de equipos de aire acondicionado',
      descripci_n_del_procedimiento: 'Equipos para la Superintendencia de Vigilancia y Seguridad Privada',
    },
    {
      nombre_del_procedimiento: 'Prestación de servicios profesionales jurídicos',
      descripci_n_del_procedimiento: 'Acompañamiento jurídico para la Superintendencia de Vigilancia y Seguridad Privada',
    },
    {
      nombre_del_procedimiento: 'Arrendamiento del espacio destinado a cafetería',
      descripci_n_del_procedimiento: 'Atención al cuerpo de custodia y vigilancia de la entidad',
    },
    {
      nombre_del_procedimiento: 'Apoyo a la gestión administrativa y financiera',
      descripci_n_del_procedimiento: 'Consultoría para gestionar y liquidar el contrato de servicio de vigilancia de la universidad',
    },
    {
      nombre_del_procedimiento: 'Asistencia técnica para la supervisión contractual',
      descripci_n_del_procedimiento: 'Acompañamiento a la prestación del servicio de vigilancia y seguridad privada',
    },
  ];
  for (const fixture of falsePositiveFixtures) {
    const scored = scoreTender({ ...fixture, precio_base: '900000000' }, secop2NameFields);
    assert.equal(hasTenderServiceSignal(scored), false, `${path}: contextual mention must not replace a direct offerable procurement object: ${fixture.nombre_del_procedimiento}`);
  }

  const electronicMaintenance = {
    nombre_del_procedimiento: 'Mantenimiento preventivo y correctivo del sistema CCTV y control de acceso',
    descripci_n_del_procedimiento: 'Soporte técnico, repuestos y puesta en funcionamiento del sistema de seguridad electrónica',
    precio_base: '240000000',
  };
  const maintenanceScored = scoreTender(electronicMaintenance, secop2NameFields);
  assert.equal(hasTenderServiceSignal(maintenanceScored), true, `${path}: electronic-security maintenance is directly offerable even without guards`);
  assert.equal(maintenanceScored.risks.some(risk => risk.includes('no ofertable')), false, `${path}: electronic-security maintenance must not be blanket-disqualified`);

  assert.equal(classifyTenderSection({ risks: [], score: 220, value: 2_000_000_000, days: null }), 'revisar', `${path}: a missing deadline requires review even when score/value are high`);
  assert.equal(classifyTenderSection({ risks: [], score: 180, value: 2_000_000_000, days: 7 }), 'hacer', `${path}: an eligible high-fit process with an actionable deadline remains in Hacer`);

  // The read-path re-validation gate (persisted tenders) must derive eligibility from the
  // same core-term reasons, not from re-scanning the whole raw row.
  assert.equal(hasTenderServiceSignal({ reasons: vigilanciaScored.reasons }), true, `${path}: persisted reasons for a real vigilancia case must remain eligible on re-validation`);
  assert.equal(hasTenderServiceSignal({ reasons: unrelatedScored.reasons }), false, `${path}: persisted reasons for an unrelated case must remain ineligible on re-validation`);
  assert.equal(hasTenderServiceSignal({}), false, `${path}: missing reasons must fail closed as ineligible`);
}

console.log('tender radar relevance eligibility checks passed');
