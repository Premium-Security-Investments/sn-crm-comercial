import assert from 'node:assert/strict';
import test from 'node:test';

import { requirementSeedItems, requirementWhere } from '../verticales/licitaciones/agt002-requirements-model.js';

// Mejora 2, versión básica (encargo desde Terminal; criterio §8.6). Textos de los ítems reales leídos con `select` el
// 2026-11-06: TT-SPO-07 sembró «Jurídico · Otros habilitantes técnicos» con seis documentos dentro (multas y sanciones,
// vencido, entre ellos) y nadie lo abrió hasta la víspera.
const base = { area: 'Jurídico', status: 'por_confirmar', rejection: false, category: 'TECHNICAL', dueAt: null };
const TERMINAL = {
  ...base, key: 'CLM-TT-TECNICOS', title: 'Otros habilitantes técnicos',
  sources: [{ documentName: 'PLIEGO DE CONDICIONES DEFINITIVO TT-SPO-07-2026.pdf', locator: 'Sección IV.C Requisitos técnicos habilitantes (pp. 55-64)' }],
  demand: 'Otros habilitantes técnicos (cumple o no cumple): licencia de espectro y registro de tecnologías de la información y las comunicaciones (TIC) del Ministerio de las TIC, con radiocomunicación de muy alta frecuencia (VHF) con repetidoras en las tres terminales; autorización de uniformes y distintivos; certificación de disponibilidad de 2 vehículos modelo 2021 o posterior con conductor; certificación de sanciones y multas de la Supervigilancia expedida máximo 90 días hábiles antes del cierre; certificación de cumplimiento de tarifas mínimas reguladas; y carta de compromiso del personal (Anexo 8).',
  actions: [
    'Revisa solo la autorización de uniformes y distintivos: confirmar que no exista acto posterior que la reemplace.',
    'Revisa solo la certificación de disponibilidad de 2 vehículos (camioneta y camioneta doble cabina) modelo 2021 o posterior con conductor (Anexo 12).',
    'Revisa solo la certificación de sanciones y multas de la Supervigilancia: pedir una nueva.',
  ],
};

test('caso Terminal: «Otros habilitantes técnicos» se siembra como seis tareas, una por documento, con su página', () => {
  const items = requirementSeedItems([TERMINAL], '2026-11-04', '2026-10-30');
  assert.equal(items.length, 6);
  assert.ok(items.every(item => !/·\s*Otr[oa]s\b/i.test(item.title)), 'ningún ítem «otros»');
  const multas = items.find(item => /sanciones y multas/.test(item.title));
  assert.match(multas.title, /^Jurídico · Certificación de sanciones y multas de la Supervigilancia.*\(págs\. 55-64\)$/);
  assert.match(multas.instruction, /^Qué hacer: Revisa solo la certificación de sanciones y multas de la Supervigilancia: pedir una nueva\./);
  assert.match(multas.instruction, /Parte de: Otros habilitantes técnicos \(cumple o no cumple\)/);
  const tarifas = items.find(item => /tarifas mínimas/.test(item.title));
  assert.match(tarifas.instruction, /el análisis no dio una acción propia para este documento/, 'no se le copian acciones de otros documentos');
  assert.deepEqual(items.map(item => item.item_key), [1, 2, 3, 4, 5, 6].map(n => `agt002_req:CLM-TT-TECNICOS#${n}`));
});

test('un «Otros…» sin «;» se parte por comas, sin romper «seguridad y salud en el trabajo»', () => {
  const items = requirementSeedItems([{ ...base, key: 'CLM-JUR', title: 'Otros habilitantes jurídicos', actions: [],
    sources: [{ documentName: 'Pliego.pdf', locator: 'Numeral 3.1 y Capítulos VI-VII, págs. 32-44 y 97-103' }],
    demand: 'Otros habilitantes jurídicos: póliza de responsabilidad civil extracontractual (RCE) de 400 salarios mínimos con la oferta, resolución de uniformes, autorización de espectro del Ministerio TIC y certificación del sistema de gestión de seguridad y salud en el trabajo (SG-SST). Durante la ejecución la RCE sube a 500 salarios mínimos.' }], '2026-11-04', '2026-10-30');
  assert.deepEqual(items.map(item => item.title), [
    'Jurídico · Póliza de responsabilidad civil extracontractual (RCE) de 400 salarios mínimos con la oferta (num. 3.1 · págs. 32-44)',
    'Jurídico · Resolución de uniformes (num. 3.1 · págs. 32-44)',
    'Jurídico · Autorización de espectro del Ministerio TIC (num. 3.1 · págs. 32-44)',
    'Jurídico · Certificación del sistema de gestión de seguridad y salud en el trabajo (SG-SST) (num. 3.1 · págs. 32-44)',
  ]);
});

test('un requisito de un solo documento queda igual, con su clave de siempre, y gana numeral y página', () => {
  const [item] = requirementSeedItems([{ ...base, key: 'CLM-RUP', title: 'El RUP debe estar en firme', rejection: true, actions: ['Pedir el RUP.'],
    sources: [{ documentName: 'pliego.pdf', locator: 'Numerales 4.1.1-4.1.3, págs. 65-70' }], demand: 'El RUP debe estar en firme a la fecha de cierre.' }], '2026-11-30', '2026-11-06');
  assert.equal(item.item_key, 'agt002_req:CLM-RUP');
  assert.equal(item.title, 'Jurídico · El RUP debe estar en firme (num. 4.1.1-4.1.3 · págs. 65-70) — CAUSA RECHAZO');
});

test('numeral y página se leen de las formas en que los trae el análisis', () => {
  assert.equal(requirementWhere([{ locator: '§27.1.1 Capacidad jurídica (habilitantes)' }]), 'num. 27.1.1');
  assert.equal(requirementWhere([{ locator: 'Págs. 130-132, numeral 5.6, causal 15' }]), 'num. 5.6 · págs. 130-132');
  assert.equal(requirementWhere([{ locator: 'Estudio previo, pp. 10-33' }]), 'págs. 10-33');
  assert.equal(requirementWhere([]), '');
});
