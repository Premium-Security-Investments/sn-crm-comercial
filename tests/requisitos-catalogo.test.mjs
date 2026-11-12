// Pestaña «Requisitos» (Juan, 2026-11-11; migración 210): catálogo histórico por tipo y «lo que nos frena».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import AdmZip from 'adm-zip';
import { parseRequirementMatrix, runRequirementMatrixSync } from '../verticales/licitaciones/requirement-history-import.js';
import { REQUIREMENT_FOCUS, REQUIREMENT_TYPES, buildRequirementCatalog, buildRequirementFocus, classifyRequirement, isRequirementFragment } from '../verticales/licitaciones/requirement-catalog.js';
import { saveRequirementFocus } from '../verticales/licitaciones/tender-requirements.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('clasifica por tema, no por palabras sueltas', () => {
  const h = (...parts) => classifyRequirement({ parts });
  assert.equal(h('Índice de liquidez mayor o igual a 3,06'), 'liquidez');
  assert.equal(h('El proponente debe tener sede, sucursal o agencia en cada departamento con puestos'), 'presencia_local');
  assert.equal(h('Estar inscrito en el RUP con los códigos 46101500 y 92121500'), 'codigos_unspsc');
  assert.equal(h('Garantía de seriedad de la oferta por el 10 % del presupuesto'), 'garantia_seriedad');
  assert.equal(h('Vigilancia fija armada en las sedes'), 'presencia_local', '«armada» no es un permiso de armas; «sedes» sí es presencia');
  assert.equal(h('Relación de armamento autorizado y permisos de tenencia'), 'armas');
  assert.equal(h('Certificado de aportes parafiscales'), 'seguridad_social', '«parafiscales» no es «antecedentes fiscales»');
  assert.equal(h('Cada integrante del consorcio debe estar inscrito en el RUP'), 'rup_vigente', 'el tema gana sobre la regla de plurales');
  assert.equal(classifyRequirement({ parts: ['CAPITAL-TRABAJO'], crmCategory: 'FINANCIAL' }), 'capital_trabajo');
  assert.equal(classifyRequirement({ kind: 'puntuable', parts: ['Puntaje por apoyo a la industria nacional'] }), 'p_industria_nacional');
});

test('los pedazos de frase del PDF no cuentan si no nombran un tema', () => {
  assert.equal(isRequirementFragment('5.1 REQUISITOS HABILITANTES JURÍDICOS:'), true);
  assert.equal(isRequirementFragment('su posterior calificación. Se evaluará con CUMPLE o NO CUMPLE.'), true);
  assert.equal(isRequirementFragment('El proponente deberá acreditar un índice de liquidez mayor o igual a 1,5.'), false);
});

// Un .xlsx mínimo con las dos hojas de la matriz (celdas en línea): título, nota, encabezados y filas.
function workbook(sheets) {
  const zip = new AdmZip();
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const names = Object.keys(sheets);
  zip.addFile('xl/workbook.xml', Buffer.from(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`));
  names.forEach((name, i) => {
    const rows = sheets[name].map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => value === null ? '' : `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`).join('')}</row>`).join('');
    zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`));
  });
  return zip.toBuffer();
}
const HEAD = ['ID_OCURRENCIA', 'CATEGORIA', 'REQUISITO', 'UMBRAL_O_CONDICION', 'CITA_TEXTUAL', 'URL_PROCESO', 'SHA256_PLIEGO', 'OBSERVACIONES', 'ESTADO_METODOLOGICO'];
const MATRIX = workbook({
  Resumen: [['Matriz unificada']],
  Habilitantes: [['Matriz histórica'], ['Una fila = un requisito'], HEAD,
    ['H-001', 'financiero', 'El proponente deberá acreditar un índice de liquidez mayor o igual a 1,5.', '≥ 1,5', 'liquidez ≥ 1,5', null, null, 'Fuentes consolidadas: pereira-risaralda-electronica-H-0004; ibague-tolima-hibrida-H-0002', 'OCURRENCIA_HISTORICA'],
    ['H-002', 'general', '5.1 REQUISITOS HABILITANTES JURÍDICOS:', null, null, null, null, '', 'OCURRENCIA_HISTORICA'],
    ['H-003', 'presencia', 'Contar con sede principal, sucursal o agencia en Ibagué.', null, null, null, '03901ad3303994aa', '', 'OCURRENCIA_HISTORICA']],
  Puntuables: [['Matriz'], ['Una fila'], ['ID_OCURRENCIA', 'CATEGORIA', 'REQUISITO', 'REGLA_DE_PUNTUACION', 'PUNTOS_MAXIMOS_OPCION', 'OBSERVACIONES'],
    ['PUN-001', 'industria nacional', 'Puntaje por apoyo a la industria nacional.', 'Hasta 10 puntos', '10', 'Fuentes consolidadas: neiva-huila-vigilancia-P-0001']],
  'Alistamiento SN': [['ID_REQUISITO'], ['H-001']],
});

test('la matriz se limpia: sólo Habilitantes y Puntuables, proceso legible, sin columnas técnicas', () => {
  const rows = parseRequirementMatrix(MATRIX);
  assert.deepEqual(rows.map(row => row.id), ['H-001', 'H-002', 'H-003', 'PUN-001']);
  assert.deepEqual(rows[0].procesos, ['Ibagué (Tolima) · vigilancia híbrida', 'Pereira (Risaralda) · seguridad electrónica']);
  assert.deepEqual(rows[2].procesos, ['Rama Judicial Pereira · vigilancia'], 'sin observaciones, el proceso sale de la huella del pliego');
  assert.equal(rows[3].kind, 'puntuable');
  assert.equal(rows[3].umbral, 'Hasta 10 puntos');
  assert.equal(rows[3].puntos, '10');
  assert.equal('ESTADO_METODOLOGICO' in rows[0] || 'estado' in rows[0], false);
  const catalog = buildRequirementCatalog({ matriz: rows });
  assert.equal(catalog.totals.excluded_fragments, 1, 'el título del PDF no cuenta');
  assert.equal(catalog.types.find(type => type.key === 'liquidez').processes, 2);
  assert.ok(catalog.types.some(type => type.key === 'presencia_local'));
  assert.ok(catalog.types.some(type => type.key === 'p_industria_nacional'));
});

test('el puente sólo baja la matriz si cambió, y la tabla queda igual al Excel', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  await pg.exec(read('supabase/migrations/211_matriz_historica_requisitos.sql'));
  await pg.exec("insert into public.psi_tender_requirement_history (id, kind, requisito, loaded_at) values ('H-999', 'habilitante', 'Ya no está en el Excel', now() - interval '1 day')");
  const database = pgliteRest(pg);
  let downloads = 0;
  const file = { nombre: 'Matriz_Historica_Requisitos_Habilitantes_y_Puntuables.xlsx', modificado_en: '2026-10-27T10:54:58Z' };
  const deps = { listFolder: async () => [file], download: async () => { downloads += 1; return MATRIX; } };
  assert.deepEqual(await runRequirementMatrixSync(database, deps), { event: 'requirement_matrix_loaded', filas: 4, retiradas: 1 });
  assert.deepEqual(await runRequirementMatrixSync(database, deps), { event: 'requirement_matrix_unchanged' });
  assert.equal(downloads, 1);
  const { rows } = await pg.query('select id, procesos from public.psi_tender_requirement_history order by id');
  assert.deepEqual(rows.map(row => row.id), ['H-001', 'H-002', 'H-003', 'PUN-001']);
  assert.deepEqual(await runRequirementMatrixSync(database, { ...deps, listFolder: async () => [] }), { event: 'requirement_matrix_missing' });
  await pg.exec(read('supabase/rollbacks/211_matriz_historica_requisitos_rollback.sql'));
});

// Lo justo del cliente de Supabase que usa la sincronización, sobre PGlite.
function pgliteRest(pg) {
  return { from: table => {
    const q = { filters: [], limitN: null };
    const where = () => q.filters.length ? ` where ${q.filters.join(' and ')}` : '';
    const api = {
      select: columns => { q.columns = columns; return api; },
      limit: n => { q.limitN = n; return api; },
      lt: (column, value) => { q.filters.push(`${column} < '${value}'`); return api; },
      in: (column, values) => { q.filters.push(`${column} in (${values.map(v => `'${v}'`).join(',')})`); return api; },
      delete: () => { q.del = true; return api; },
      upsert: async rows => {
        for (const row of rows) {
          const cols = Object.keys(row);
          await pg.query(`insert into public.${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict (id) do update set ${cols.map(c => `${c} = excluded.${c}`).join(',')}`, cols.map(c => row[c]));
        }
        return { error: null };
      },
      then: (resolve, reject) => {
        const sql = q.del ? `delete from public.${table}${where()}` : `select ${q.columns} from public.${table}${where()}${q.limitN ? ` limit ${q.limitN}` : ''}`;
        return pg.query(sql).then(result => resolve({ data: result.rows, error: null }), reject);
      },
    };
    return api;
  } };
}

test('los análisis y las actas cuentan: «nos frenó» sin repetir el proceso', () => {
  const crm = [
    { opportunity_id: 'o1', process: 'Municipio de Pereira · LP-220', requirement_id: 'REQ-LIQUIDEZ', category: 'FINANCIAL', text: 'Liquidez mínima 3,06', blocker: true },
    { opportunity_id: 'o1', process: 'Municipio de Pereira · LP-220', requirement_id: 'REQ-CODIGOS', category: 'EXPERIENCE', text: 'Código 46101500', evaluation: 'BLOCKER' },
    { opportunity_id: 'o2', process: 'Rama Judicial', requirement_id: 'REQ-LIQUIDEZ', category: 'FINANCIAL', text: 'Liquidez 2,73', blocker: false },
  ];
  const actas = [{ opportunity_id: 'o1', process: 'Municipio de Pereira · LP-220', title: 'Liquidez mínima 3,06', text: 'La empresa declara 2,37.' }];
  const catalog = buildRequirementCatalog({ crm, actas });
  const liquidez = catalog.types.find(type => type.key === 'liquidez');
  assert.equal(liquidez.processes, 2);
  assert.deepEqual(liquidez.blocked_in.map(item => item.opportunity_id), ['o1']);
  const focus = buildRequirementFocus(catalog, { state: [{ focus_key: 'financiero', status: 'en_tramite', owner: 'Katherine', note: 'Hablando con el banco.' }] });
  assert.equal(focus.length, REQUIREMENT_FOCUS.length);
  const financiero = focus.find(item => item.key === 'financiero');
  assert.equal(financiero.status, 'en_tramite');
  assert.equal(financiero.blocked_in.length, 1);
  assert.ok(financiero.fix_action.length > 20, 'sin acción guardada, propone la inicial');
  assert.equal(focus[0].blocked_in.length >= focus.at(-1).blocked_in.length, true, 'primero lo que más nos frenó');
});

test('guardar valida el foco y el estado, y avisa si falta la migración', async () => {
  const saved = [];
  const db = missing => ({ from: () => ({ upsert: row => { saved.push(row); return { select: () => ({ single: async () => missing ? { error: { code: '42P01' } } : { data: row, error: null } }) }; } }) });
  await assert.rejects(saveRequirementFocus(db(), { focus_key: 'otra', status: 'pendiente' }, 'p1'), /no es válido/);
  await assert.rejects(saveRequirementFocus(db(), { focus_key: 'seriedad', status: 'listo' }, 'p1'), /estado no es válido/);
  const row = await saveRequirementFocus(db(), { focus_key: 'seriedad', status: 'en_tramite', owner: ' Katherine ', note: '' }, 'p1');
  assert.equal(row.owner, 'Katherine');
  assert.equal(row.note, null);
  await assert.rejects(saveRequirementFocus(db(true), { focus_key: 'seriedad', status: 'pendiente' }, 'p1'), /migración 210/);
});

test('migración 210: tabla sólo para el servidor, siete focos, no pisa lo escrito', async () => {
  const pg = new PGlite();
  await pg.exec("create role anon; create role authenticated; create role service_role; create table public.psi_sales_profiles (id uuid primary key);");
  const sql = read('supabase/migrations/210_requisitos_que_nos_frenan.sql');
  await pg.exec(sql);
  await pg.exec("update public.psi_tender_requirement_focus set note = 'escrito por una persona' where focus_key = 'seriedad'");
  await pg.exec(sql);
  const { rows } = await pg.query('select focus_key, owner, note from public.psi_tender_requirement_focus order by focus_key');
  assert.deepEqual(rows.map(row => row.focus_key).sort(), REQUIREMENT_FOCUS.map(focus => focus.key).sort());
  assert.equal(rows.find(row => row.focus_key === 'seriedad').note, 'escrito por una persona');
  assert.ok(rows.every(row => row.owner === 'Katherine'));
  assert.match(sql, /revoke all on table public\.psi_tender_requirement_focus from public, anon, authenticated, service_role/);
  await assert.rejects(pg.exec("insert into public.psi_tender_requirement_focus (focus_key) values ('otra')"));
  await pg.exec(read('supabase/rollbacks/210_requisitos_que_nos_frenan_rollback.sql'));
});

test('la pestaña va entre Empresa y Aliados, y el servidor la protege', () => {
  const nav = read('src/tenders/components/TenderModuleNavigation.tsx');
  const order = ['Empresa', 'Requisitos', 'Aliados', 'Lecciones'].map(label => nav.indexOf(`        ${label}\n`));
  assert.ok(order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]), `orden ${order}`);
  const server = read('server/index.js');
  assert.match(server, /'GET \/api\/tender-requirements': \['tenders', ACTIONS\.LICITACIONES_VIEW\]/);
  assert.match(server, /'POST \/api\/tender-requirements\/focus': \['tenders', ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE\]/);
});
