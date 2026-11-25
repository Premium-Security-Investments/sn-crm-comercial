import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTenderMiDia, miDiaClave, nombreCorto } from '../verticales/licitaciones/tender-mi-dia.js';

// Mi día de licitaciones (Juan, 2026-11-15, maqueta aprobada): alertas en dos niveles. Lo que hace la persona va al día a
// día con «Hecho»; lo que publica la entidad, aparte; y las cuatro actividades resumen la semana. Lo crítico del
// expediente no se lista: sólo se cuenta al lado del cierre (Juan, 2026-11-25).
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const today = '2026-11-15';
const deaj = {
  opportunity_id: 'deaj', entity: 'Rama Judicial - Dirección Ejecutiva de Administración Judicial', ref: 'LP-07-2026', responsable: 'Katherine',
  recomendacion: 'Solo en unión temporal: sin sucursal en Bogotá.',
  deadlines: [
    { kind: 'OBSERVATIONS', value: '2026-11-17T17:00:00-05:00', label: 'Presentación de observaciones al pliego' },
    { kind: 'ADDENDA', value: '2026-11-18T19:00:00-05:00', label: 'Plazo máximo para expedir adendas' },
    { kind: 'SUBMISSION', value: '2026-11-24T09:00:00-05:00', label: 'Presentación de Ofertas' },
  ],
};
const pereira = {
  opportunity_id: 'pereira', entity: 'Rama Judicial \u0096 Dirección Seccional de Administración Judicial de Pereira', ref: 'LP-01-2026', responsable: 'Katherine',
  recomendacion: 'Puede presentarse sola.',
  deadlines: [{ kind: 'OBSERVATIONS', value: '2026-11-18T18:00:00-05:00', label: 'Observaciones al definitivo', certainty: 'INFERRED' }],
  criticos: [{ titulo: 'Garantía de seriedad', consecuencia: 'no_subsanable', target_date: null }],
};
const metro = {
  opportunity_id: 'metro', entity: 'METRO DE BOGOTA SA', ref: 'GGC-SAMC-004-2026', responsable: 'Katherine',
  deadlines: [{ kind: 'OTHER', value: '2026-11-20T23:59:00-05:00', label: 'Plazo para manifestación de Interés' }],
};

test('lo que hace la persona va al día a día; lo de la entidad, aparte', () => {
  const view = buildTenderMiDia({ processes: [deaj, pereira, metro], today });
  const acciones = view.dias.flatMap(day => day.items);
  assert.deepEqual(acciones.map(item => `${item.day} ${item.actividad} ${item.texto}`), [
    '2026-11-17 observar Radicar observaciones al definitivo',
    '2026-11-18 observar Radicar observaciones al definitivo',
    '2026-11-20 presentar Manifestar interés',
  ]);
  assert.equal(view.dias[0].day, today, 'hoy siempre aparece, aunque no tenga nada');
  assert.deepEqual(view.entidad.map(item => item.texto), ['Plazo máximo para expedir adendas']);
  assert.deepEqual(view.proxima.map(item => item.texto), ['Presentar la oferta (cierre)']);
  assert.ok(acciones.every(item => !('por_confirmar' in item)), 'sin «por confirmar»: es una alerta, no un cronograma');
});

test('las cuatro actividades y la frase de arriba', () => {
  const view = buildTenderMiDia({ processes: [deaj, pereira, metro], today,
    requisitos: [{ key: 'sede', title: 'Sucursal en Bogotá', status: 'en_tramite', upcoming: [{ deadline: '2026-11-24', unknown: false }] },
      { key: 'res', title: 'Ya resuelto', status: 'resuelto', upcoming: [{ deadline: '2026-11-24' }] }] });
  assert.equal(view.actividades.observar.esta_semana, 2);
  assert.equal(view.actividades.presentar.cierres, 1, 'sólo el cierre de DEAJ: la manifestación de Metro no es un cierre');
  assert.deepEqual(view.actividades.presentar.items.map(item => item.opportunity_id), ['deaj']);
  assert.ok(!('critico' in view.actividades.presentar), 'sin línea «Crítico»: el expediente se trabaja en el proceso');
  assert.deepEqual(view.actividades.tramitar.items.map(item => item.titulo), ['Sucursal en Bogotá'], 'lo resuelto no sale');
  assert.deepEqual(view.actividades.unirnos.items.map(item => item.opportunity_id), ['deaj']);
  assert.equal(view.frase.observaciones, 2);
  assert.deepEqual(view.frase.manifestaciones.map(item => item.proceso), ['METRO DE BOGOTA SA']);
  assert.equal(view.frase.primero.opportunity_id, 'deaj');
});

test('«Hecho» se marca por plazo y sale de la cuenta de la frase', () => {
  const key = miDiaClave('deaj', 'OBSERVATIONS', '2026-11-17T17:00:00-05:00');
  const view = buildTenderMiDia({ processes: [deaj, pereira], today, hechos: [{ item_key: key, done_at: '2026-11-16T15:00:00Z', done_by_name: 'Katherine' }] });
  const done = view.dias.flatMap(day => day.items).find(item => item.key === key);
  assert.deepEqual(done.hecho, { at: '2026-11-16T15:00:00Z', por: 'Katherine' });
  assert.equal(view.frase.observaciones, 1);
  assert.equal(view.frase.primero.opportunity_id, 'pereira');
});

test('lo crítico del expediente se cuenta al lado del cierre y no se lista; no hay «Mis pendientes»', () => {
  const conCierre = { ...pereira, deadlines: [...pereira.deadlines, { kind: 'SUBMISSION', value: '2026-11-27T16:00:00-05:00' }],
    criticos: [...pereira.criticos, { titulo: 'RUP en firme', consecuencia: 'causa_rechazo', target_date: '2026-11-10' }] };
  const view = buildTenderMiDia({ processes: [conCierre, { ...metro, cronograma_faltante: true }], today });
  assert.ok(!('pendientes' in view));
  const cierre = view.actividades.presentar.items[0];
  assert.equal(cierre.opportunity_id, 'pereira');
  assert.equal(cierre.criticos, 2);
  assert.deepEqual(cierre.criticos_titulos, ['Garantía de seriedad', 'RUP en firme']);
  const observacion = view.dias.flatMap(day => day.items).find(item => item.opportunity_id === 'pereira');
  assert.ok(!('criticos' in observacion), 'la cuenta va sólo en el cierre');
});

test('ya presentada, el cierre no es una acción', () => {
  const view = buildTenderMiDia({ processes: [{ ...deaj, offer_status: 'presentada' }], today });
  assert.ok(![...view.dias.flatMap(day => day.items), ...view.proxima].some(item => item.actividad === 'presentar'));
});

test('el nombre corto aguanta el carácter dañado de SECOP y el guion', () => {
  assert.equal(nombreCorto(pereira.entity), 'Rama Judicial · Seccional Pereira');
  assert.equal(nombreCorto(deaj.entity), 'Rama Judicial · Dirección Ejecutiva');
  assert.equal(nombreCorto('Rama Judicial  Dirección Seccional de Administración Judicial de Medellín'), 'Rama Judicial · Seccional Medellín');
});

test('la ruta, la tabla de «Hecho» y Mi día', () => {
  const server = read('../server/index.js');
  assert.equal(server, read('../api/[...path].js'));
  assert.match(server, /'GET \/api\/tender-mi-dia': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.match(server, /'POST \/api\/tender-mi-dia\/hecho': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.match(server, /recomendacion: report\?\.available && report\.report \? report\.report\.recommendation\?\.label \|\| null : null,\n      criticos,/);
  assert.match(read('../supabase/migrations/224_mi_dia_licitaciones_hecho.sql'), /create table if not exists public\.psi_tender_mi_dia_hechos/);
  const main = read('../src/main.tsx');
  assert.match(main, /LICITACIONES_VIEW\) && <TenderMiDia request=\{api\}/);
  assert.match(main, /\{tendersOnly \? null : !opportunities\.length/);
  const component = read('../src/tenders/components/TenderMiDia.tsx');
  for (const text of ['Lo general · las cuatro actividades', 'El día a día · lo que hace usted', 'Ir al proceso →', 'Ir a Requisitos →', 'Lo que publica la entidad esta semana']) {
    assert.ok(component.includes(text), `falta «${text}»`);
  }
  assert.ok(!component.includes('Mis pendientes sin fecha de la entidad'), '«Mis pendientes» salió de Mi día (Juan, 25-nov)');
});

test('fechas contradichas: no se anuncian, se pide confirmar; sin oferta, el informe de evaluación no se observa', () => {
  const barranquilla = { opportunity_id: 'baq', entity: 'Rama Judicial - Dirección Seccional de Administración Judicial de Barranquilla', ref: 'LP-001-2026',
    deadlines: [
      { kind: 'SUBMISSION', value: '2026-12-02T00:00:00-05:00', certainty: 'CONTRADICTED' },
      { kind: 'EVALUATION_OBSERVATIONS', value: '2026-11-20T00:00:00-05:00', certainty: 'CONFIRMED' },
    ] };
  const view = buildTenderMiDia({ processes: [barranquilla], today });
  assert.deepEqual([...view.dias.flatMap(day => day.items), ...view.proxima], []);
  const presentada = buildTenderMiDia({ processes: [{ ...barranquilla, offer_status: 'presentada', criticos: [{ titulo: 'RUP', consecuencia: 'causa_rechazo', target_date: '2026-11-01' }] }], today });
  assert.deepEqual(presentada.dias.flatMap(day => day.items).map(item => item.texto), ['Radicar observaciones al informe de evaluación']);
});

test('un requisito crítico con fecha no va al día: «Presentar» en el día es sólo el cierre (Juan, 25-nov)', () => {
  const baq = { opportunity_id: 'baq', entity: 'Rama Judicial - Dirección Seccional de Administración Judicial de Barranquilla', ref: 'LP-001-2026', responsable: 'Katherine',
    deadlines: [{ kind: 'SUBMISSION', value: '2026-12-01T10:00:00-05:00', certainty: 'CONFIRMED' }],
    criticos: [{ titulo: 'Financiero · Garantía de seriedad', consecuencia: 'causa_rechazo', target_date: '2026-11-25' }] };
  const view = buildTenderMiDia({ processes: [baq], today: '2026-11-25' });
  const enElDia = [...view.dias.flatMap(day => day.items), ...view.proxima];
  assert.deepEqual(enElDia.map(item => item.texto), ['Presentar la oferta (cierre)']);
  assert.equal(enElDia[0].criticos, 1, 'el crítico se cuenta al lado del cierre');
  assert.deepEqual(view.actividades.presentar.items.map(item => item.criticos), [1]);
});
