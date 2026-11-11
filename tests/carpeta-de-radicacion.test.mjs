// Mejora 11 (Juan, 2026-11-10/11; migración 203): la carpeta de radicación estándar, su índice y la comparación con lo
// radicado. El caso de prueba es la Terminal TT-SPO-07-2026: se preparó «ANEXO_01…docx» y SECOP devolvió «…_1.pdf».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { FILING_STRUCTURE, buildFilingIndex, compareFiling, filingKey, filingProcessFolderName } from '../verticales/licitaciones/tender-filing-folder.js';
import { filingWebUrl, runFilingFolderPass } from '../verticales/licitaciones/tender-filing-folder-run.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('la estructura es la acordada: cinco carpetas y siete subcarpetas en PARA_RADICAR', () => {
  assert.deepEqual(FILING_STRUCTURE.filter(entry => !entry.folder.includes('/')).map(entry => entry.folder), ['01_Observaciones', '02_Borradores', '03_PARA_RADICAR', '04_Radicado', '05_Competidores']);
  assert.equal(FILING_STRUCTURE.filter(entry => entry.folder.startsWith('03_PARA_RADICAR/')).length, 7);
  assert.equal(filingProcessFolderName({ entity: 'Terminal de Transporte S.A.', ref: 'TT-SPO-07-2026' }), 'TERMINAL DE TRANSPORTE S.A. - TT-SPO-07-2026');
});

test('índice: por subcarpeta, sin los LEEME, con las vacías y los sueltos', () => {
  const index = buildFilingIndex([
    { ruta: '03_PARA_RADICAR/00_LEEME.md', nombre: '00_LEEME.md' },
    { ruta: '03_PARA_RADICAR/02_Juridicos/00_LEEME.md', nombre: '00_LEEME.md' },
    { ruta: '03_PARA_RADICAR/02_Juridicos/09_REDAM_RL.pdf', nombre: '09_REDAM_RL.pdf', bytes: 126189 },
    { ruta: '03_PARA_RADICAR/05_Experiencia/CERT_MATECANA_RUP050.pdf', nombre: 'CERT_MATECANA_RUP050.pdf' },
    { ruta: '03_PARA_RADICAR/ANEXO_09.xlsx', nombre: 'ANEXO_09.xlsx' },
    { ruta: '02_Borradores/ANEXO_01.docx', nombre: 'ANEXO_01.docx' },
  ]);
  assert.equal(index.total, 3);
  assert.deepEqual(index.secciones.find(section => section.carpeta === '02_Juridicos').archivos.map(file => file.nombre), ['09_REDAM_RL.pdf']);
  assert.deepEqual(index.sueltos.map(file => file.nombre), ['ANEXO_09.xlsx']);
  assert.ok(index.vacias.includes('07_Garantia') && !index.vacias.includes('05_Experiencia'));
});

test('comparación: «ANEXO_01…docx» preparado = «ANEXO_01…_1.pdf» radicado; sin radicado no hay comparación', () => {
  assert.equal(filingKey('ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026.docx'), filingKey('ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026_1.pdf'));
  const files = [
    { ruta: '03_PARA_RADICAR/01_Anexos_firmados/ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026.docx', nombre: 'ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026.docx' },
    { ruta: '03_PARA_RADICAR/07_Garantia/POLIZA_SERIEDAD.pdf', nombre: 'POLIZA_SERIEDAD.pdf' },
    { ruta: '04_Radicado/ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026_1.pdf', nombre: 'ANEXO_01_Carta_de_presentacion_TT-SPO-07-2026_1.pdf' },
    { ruta: '04_Radicado/ANEXO 9. PROPUESTA ECONOMICA .pdf', nombre: 'ANEXO 9. PROPUESTA ECONOMICA .pdf' },
  ];
  const comparison = compareFiling(files);
  assert.equal(comparison.coinciden, 1);
  assert.deepEqual(comparison.no_radicados, [{ nombre: 'POLIZA_SERIEDAD.pdf', carpeta: '07_Garantia' }]);
  assert.deepEqual(comparison.radicados_sin_preparar.map(file => file.nombre), ['ANEXO 9. PROPUESTA ECONOMICA .pdf']);
  assert.equal(compareFiling(files.filter(file => !file.ruta.startsWith('04_'))), null);
});

function fakeDb(state) {
  return { from: table => {
    const chain = {
      filters: [], select() { return chain; }, eq(column, value) { chain.filters.push([column, value]); return chain; }, gte() { return chain; }, in() { return chain; },
      then(resolve) { return Promise.resolve({ data: table === 'psi_tender_filing_folders' ? state.rows : table === 'psi_tender_go_no_go_decisions' ? state.gos : state.tenders, error: null }).then(resolve); },
      insert: async row => { state.rows.push({ status: 'pendiente', ...row }); return { error: null }; },
      update: values => ({ eq: async (_column, id) => { Object.assign(state.rows.find(row => row.opportunity_id === id), values); state.updates.push(values); return { error: null }; } }),
    };
    return chain;
  } };
}

test('el pase crea la carpeta con un GO nuevo, sin sobrescribir, y después guarda el índice', async () => {
  const state = { rows: [], gos: [{ opportunity_id: 'opp-1', created_at: '2026-11-12T10:00:00Z' }], tenders: [{ id: 't1', ref: 'FGN-REC-IPSE-0058-2026', entity: 'Fiscalía', converted_opportunity_id: 'opp-1' }], updates: [] };
  const uploads = [];
  const deps = {
    processesPath: '06_Productos_PSI/Licitaciones/03_Procesos_Activos',
    listFolders: async () => ['FISCALÍA GENERAL DE LA NACIÓN REGIONAL EJE CAFETERO - FGN-REC-IPSE-0058-2026'],
    upload: async destination => { uploads.push(destination); return destination.includes('01_Observaciones') ? { ok: false, reason: 'ya_existe' } : { ok: true }; },
    inventory: async path => [{ ruta: `${path}/03_PARA_RADICAR/07_Garantia/POLIZA.pdf`, nombre: 'POLIZA.pdf', bytes: 10 }],
    now: () => new Date('2026-11-12T10:05:00Z'),
  };
  const first = await runFilingFolderPass(fakeDb(state), deps);
  assert.ok(first.some(event => event.event === 'tender_filing_created' && event.carpeta_nueva === false));
  assert.equal(uploads.length, FILING_STRUCTURE.length);
  assert.ok(uploads.every(path => path.startsWith('06_Productos_PSI/Licitaciones/03_Procesos_Activos/FISCALÍA GENERAL DE LA NACIÓN REGIONAL EJE CAFETERO - FGN-REC-IPSE-0058-2026/') && path.endsWith('/00_LEEME.md')));
  assert.equal(state.rows[0].status, 'creada');
  state.rows[0].snapshot_at = null;
  const second = await runFilingFolderPass(fakeDb(state), { ...deps, now: () => new Date('2026-11-12T10:06:00Z') });
  assert.ok(second.some(event => event.event === 'tender_filing_indexed' && event.archivos === 1));
  assert.equal(state.rows[0].snapshot.indice.secciones.find(section => section.carpeta === '07_Garantia').archivos[0].nombre, 'POLIZA.pdf');
  assert.deepEqual(await runFilingFolderPass(fakeDb({ rows: [{ ...state.rows[0], snapshot_at: '2026-11-12T10:06:00Z', refresh_requested_at: '2026-11-12T10:05:00Z' }], gos: state.gos, tenders: [], updates: [] }), deps), [{ event: 'tender_filing_idle' }]);
  assert.match(filingWebUrl('06_Productos_PSI/Licitaciones/03_Procesos_Activos/A B'), /\/A%20B$/);
});

test('la 203 sólo para el servidor y reversible; el paso va en el trabajo de borradores; Preparar muestra el bloque', async () => {
  const pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role; create table public.psi_sales_opportunities (id uuid primary key); create table public.psi_sales_profiles (id uuid primary key);`);
  await pg.exec(read('supabase/migrations/203_carpeta_de_radicacion.sql'));
  await assert.rejects(pg.exec(`insert into psi_tender_filing_folders (opportunity_id, status) values (gen_random_uuid(), 'otro')`));
  await pg.exec(read('supabase/rollbacks/203_carpeta_de_radicacion_rollback.sql'));
  await pg.close();
  assert.match(read('supabase/migrations/203_carpeta_de_radicacion.sql'), /revoke all on table public\.psi_tender_filing_folders from public, anon, authenticated, service_role/);
  assert.match(read('ops/agt002-sharepoint-bridge/run-agt002-sharepoint-drafts.mjs'), /await runFilingFolderPass\(database, \{/);
  assert.match(read('src/main.tsx'), /filing=\{<TenderFilingFolder opportunityId=\{o\.id\}/);
  const server = read('server/index.js');
  assert.match(server, /'POST \/api\/tender-filing-folder\/request': \['tenders', ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE\]/);
  assert.equal(server, read('api/[...path].js'));
});
