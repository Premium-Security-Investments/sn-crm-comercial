// AGT-003 — formulario de cierre (formato GGC-FO-001): autollenado, completitud, dinero y la puerta de "ganado".
// Decisión de Juan del 2026-10-23: sólo se puede marcar ganado con el formulario completo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOSURE_FORM_FIELDS, CLOSURE_FORM_FORMAT, CLOSURE_FORM_IVA_RATE, CLOSURE_FORM_VERSION,
  autofillClosureForm, autofillClosureSites, closureFormCompleteness, closureFormDurationDays,
  closureFormMoney, closureFormWinVerdict,
} from '../src/vigia/closure-form.js';

const OPPORTUNITY = {
  company_name: 'Bansuri Hotel Group S.A.S.',
  company_nit: '901075665-8',
  economic_sector: 'Comercial',
  quote_city: 'Pereira',
  decision_maker_name: 'Camilo Gómez',
  decision_maker_title: 'Gerente',
  decision_maker_email: 'contacto@ejemplo.com',
  decision_maker_phone: '3004224960',
};

/** Una cabecera completa, para probar la puerta sin repetir 25 campos en cada prueba. */
const fullForm = (overrides = {}) => ({
  ...autofillClosureForm(OPPORTUNITY),
  establishment_name: 'Hotel de Pereira',
  ciiu_code: '5501',
  legal_rep_name: 'Oscar Jaramillo',
  legal_rep_id_number: '16077215',
  withholding_agent: true,
  tax_regime: 'simplificado',
  large_taxpayer: false,
  contract_mail_address: 'Vereda Los Planes km 5 vía Cerritos, Pereira',
  einvoice_email: 'facturacion@ejemplo.com',
  payment_contact_name: 'Oscar Jaramillo',
  payment_contact_title: 'Representante legal',
  payment_terms: 'Dentro del mes',
  operational_supervisor: 'Camilo Gómez',
  service_start_date: '2026-10-01',
  service_end_date: '2029-10-01',
  visit_officer_name: 'Jhon Bermúdez',
  service_mode: 'fija',
  aiu_value: 1_492_420,
  ...overrides,
});
const SITES = [{ address: 'Vereda Los Planes km 5 vía Cerritos', city: 'Pereira', phone: '3004224960', contact_name: 'Camilo', position: 1 }];
const POSTS = [
  { description: 'Vigilante para el acceso principal, 24/7', shift_start: '06:00', shift_end: '06:00', days_per_month: 30, guards_required: 3, armed: false, monthly_value: 19_308_499, position: 1 },
  { description: 'Control de acceso de empleados y zonas de cargue', shift_start: '06:00', shift_end: '06:00', days_per_month: 30, guards_required: 3, armed: false, monthly_value: 19_308_499, position: 2 },
];

test('el formato queda nombrado: GGC-FO-001 versión 18, IVA del 19 % sobre el AIU', () => {
  assert.equal(CLOSURE_FORM_FORMAT, 'GGC-FO-001');
  assert.equal(CLOSURE_FORM_VERSION, 18);
  assert.equal(CLOSURE_FORM_IVA_RATE, 0.19);
  // Un solo catálogo: si mañana el formato cambia, se cambia aquí y la pantalla sigue.
  assert.ok(CLOSURE_FORM_FIELDS.length >= 25);
  assert.equal(new Set(CLOSURE_FORM_FIELDS.map(f => f.key)).size, CLOSURE_FORM_FIELDS.length, 'ninguna clave repetida');
  for (const field of CLOSURE_FORM_FIELDS) assert.ok(field.label && field.kind, field.key);
});

test('autollenado: lo que el CRM ya sabe no se vuelve a escribir', () => {
  const auto = autofillClosureForm(OPPORTUNITY);
  assert.equal(auto.contracting_company_name, 'Bansuri Hotel Group S.A.S.');
  assert.equal(auto.contracting_company_nit, '901075665-8');
  // Facturar y contratar se proponen iguales; el comercial lo cambia cuando son dos empresas.
  assert.equal(auto.billing_company_name, auto.contracting_company_name);
  assert.equal(auto.billing_company_nit, auto.contracting_company_nit);
  assert.equal(auto.authorized_by_name, 'Camilo Gómez');
  assert.equal(auto.authorized_by_title, 'Gerente');
  assert.equal(auto.sector, 'comercial', 'el sector del CRM se normaliza a la opción del formato');
  assert.equal(auto.contact_email, 'contacto@ejemplo.com');
  assert.equal(auto.contact_phones, '3004224960');
  // Lo que el CRM NO sabe no se inventa.
  assert.equal(auto.establishment_name, undefined);
  assert.equal(auto.legal_rep_name, undefined);
  const sites = autofillClosureSites(OPPORTUNITY);
  assert.deepEqual(sites.map(s => [s.city, s.address]), [['Pereira', null]], 'la ciudad se propone, la dirección no se inventa');
});

test('autollenado: un sector que el formato no reconoce queda vacío, no forzado', () => {
  assert.equal(autofillClosureForm({ ...OPPORTUNITY, economic_sector: 'Hotelería' }).sector, null);
  assert.equal(autofillClosureForm({ ...OPPORTUNITY, economic_sector: 'Educación' }).sector, 'educacion');
  assert.deepEqual(autofillClosureSites({}), [], 'sin ciudad no se propone dirección ninguna');
});

test('completitud: con el formulario lleno, sus direcciones y sus puestos, está completo', () => {
  const verdict = closureFormCompleteness({ form: fullForm(), sites: SITES, posts: POSTS });
  assert.deepEqual(verdict.missing, []);
  assert.equal(verdict.complete, true);
  assert.equal(verdict.filled, verdict.required);
});

test('completitud: lo que falta se dice en lenguaje común, no con nombres de campos', () => {
  const verdict = closureFormCompleteness({ form: autofillClosureForm(OPPORTUNITY), sites: [], posts: [] });
  assert.equal(verdict.complete, false);
  assert.ok(verdict.missing.some(m => m.includes('nombre del establecimiento')));
  assert.ok(verdict.missing.some(m => m.includes('representante legal')));
  assert.ok(verdict.missing.some(m => m.includes('dirección donde se presta el servicio')));
  assert.ok(verdict.missing.some(m => m.includes('al menos un puesto')));
  for (const frase of verdict.missing) assert.doesNotMatch(frase, /_/, 'ningún nombre técnico llega al comercial');
});

test('completitud: el estrato sólo se exige cuando el sector es residencial', () => {
  const comercial = closureFormCompleteness({ form: fullForm(), sites: SITES, posts: POSTS });
  assert.equal(comercial.complete, true, 'en comercial no se pide estrato');
  const residencial = closureFormCompleteness({ form: fullForm({ sector: 'residencial' }), sites: SITES, posts: POSTS });
  assert.equal(residencial.complete, false);
  assert.ok(residencial.missing.some(m => m.toLowerCase().includes('estrato')));
  const conEstrato = closureFormCompleteness({ form: fullForm({ sector: 'residencial', residential_stratum: '4' }), sites: SITES, posts: POSTS });
  assert.equal(conEstrato.complete, true);
});

test('completitud: el correo y las opciones se revisan, no sólo que estén escritos', () => {
  const malCorreo = closureFormCompleteness({ form: fullForm({ einvoice_email: 'no-es-un-correo' }), sites: SITES, posts: POSTS });
  assert.ok(malCorreo.missing.some(m => m.includes('no parece un correo válido')));
  const malModalidad = closureFormCompleteness({ form: fullForm({ service_mode: 'aérea' }), sites: SITES, posts: POSTS });
  assert.ok(malModalidad.missing.some(m => m.includes('no reconoce')));
  const malRetencion = closureFormCompleteness({ form: fullForm({ withholding_agent: 'SI' }), sites: SITES, posts: POSTS });
  assert.ok(malRetencion.missing.some(m => m.includes('sí o no')));
});

test('completitud: a un puesto le faltan cosas y se dice cuáles', () => {
  const verdict = closureFormCompleteness({
    form: fullForm(), sites: SITES,
    posts: [{ description: 'Portería', guards_required: 2, position: 1 }],
  });
  assert.equal(verdict.complete, false);
  const frase = verdict.missing.find(m => m.startsWith('Al puesto 1'));
  assert.ok(frase.includes('hora de inicio'));
  assert.ok(frase.includes('hora de fin'));
  assert.ok(frase.includes('valor mensual'));
});

test('el dinero se calcula: el descuadre del Word no se puede repetir', () => {
  const money = closureFormMoney({ posts: POSTS, aiuValue: 1_492_420 });
  // Los dos puestos del caso real, sumados por el sistema.
  assert.equal(money.subtotal, 38_616_998);
  assert.equal(money.aiu, 1_492_420);
  assert.equal(money.iva, 283_560, 'el 19 % del AIU, redondeado al peso');
  assert.equal(money.total, 38_900_558);
  assert.equal(money.aiuMissing, false);
  // El ejemplar real traía TOTAL 15.207.760 con estos mismos puestos: 23,7 millones menos que la suma.
  assert.notEqual(money.total, 15_207_760);
});

test('el dinero: sin AIU no se inventa un IVA de cero', () => {
  const money = closureFormMoney({ posts: POSTS });
  assert.equal(money.subtotal, 38_616_998);
  assert.equal(money.aiu, null);
  assert.equal(money.iva, null, 'null dice "no registrado"; cero diría "no hay IVA"');
  assert.equal(money.total, 38_616_998);
  assert.equal(money.aiuMissing, true);
  const vacio = closureFormMoney();
  assert.deepEqual([vacio.subtotal, vacio.total, vacio.posts], [0, 0, 0]);
});

test('el dinero: un valor que no es número no entra en la suma', () => {
  const money = closureFormMoney({ posts: [{ monthly_value: 'mil pesos' }, { monthly_value: -5 }, { monthly_value: '1000' }], aiuValue: 'nada' });
  assert.equal(money.subtotal, 1000);
  assert.equal(money.posts, 1);
  assert.equal(money.aiu, null);
});

test('duración del contrato: se calcula y no se escribe a mano', () => {
  // En el Word, el campo "AÑOS" del caso real traía "2026" —un año donde iba una cantidad— y los días decían 1095
  // para las fechas 2026-10-01 → 2029-10-01, que son 1096 de diferencia. Aquí hay una sola definición: la
  // diferencia entre las dos fechas. Si el negocio cuenta el último día de otra forma, se decide una vez, aquí.
  assert.equal(closureFormDurationDays('2026-10-01', '2029-10-01'), 1096);
  assert.equal(closureFormDurationDays('2026-10-01', '2026-10-31'), 30);
  assert.equal(closureFormDurationDays('2026-10-01', '2026-10-01'), null, 'sin duración no se devuelve cero');
  assert.equal(closureFormDurationDays('2029-10-01', '2026-10-01'), null, 'al revés tampoco');
  assert.equal(closureFormDurationDays('ayer', '2029-10-01'), null);
});

test('la puerta de "ganado": sin formulario no se gana, y se dice qué hacer', () => {
  const sin = closureFormWinVerdict({ form: null });
  assert.equal(sin.ok, false);
  assert.equal(sin.code, 'AGT003_CLOSURE_FORM_MISSING');
  assert.match(sin.message, /falta el formulario de cierre/i);
  assert.match(sin.message, /lo que el CRM ya sabe viene puesto/i);
});

test('la puerta de "ganado": incompleto explica qué falta, y acota la lista', () => {
  const verdict = closureFormWinVerdict({ form: autofillClosureForm(OPPORTUNITY), sites: [], posts: [] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'AGT003_CLOSURE_FORM_INCOMPLETE');
  assert.ok(verdict.missing.length > 3);
  assert.match(verdict.message, /datos más/, 'no se le vacían veinte frases encima');
  assert.equal(verdict.message.length < 400, true);
});

test('la puerta de "ganado": completo deja pasar', () => {
  assert.deepEqual(closureFormWinVerdict({ form: fullForm(), sites: SITES, posts: POSTS }), { ok: true });
});

test('migración 151: tres tablas, sólo service_role, y su rollback', () => {
  const sql = readFileSync(new URL('../supabase/migrations/151_agt003_formulario_cierre.sql', import.meta.url), 'utf8');
  for (const table of ['psi_sales_closure_forms', 'psi_sales_closure_form_sites', 'psi_sales_closure_form_posts']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} con RLS`);
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`), `${table} sin acceso directo`);
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`), `${table} sólo para el servidor`);
  }
  // Una oportunidad, un formulario.
  assert.match(sql, /opportunity_id uuid not null unique references public\.psi_sales_opportunities\(id\) on delete cascade/);
  // El dinero no se guarda sumado: no existe una COLUMNA de subtotal, de IVA ni de total (la palabra sí aparece en
  // los comentarios, que es donde se explica por qué no están).
  assert.doesNotMatch(sql, /^\s+(subtotal|iva|total|iva_value|total_value)\s+numeric/m);
  assert.match(sql, /aiu_value numeric\(14, 2\)/);
  assert.match(sql, /commit;\s*$/);
  const rollback = readFileSync(new URL('../supabase/rollbacks/151_agt003_formulario_cierre_rollback.sql', import.meta.url), 'utf8');
  for (const table of ['psi_sales_closure_form_posts', 'psi_sales_closure_form_sites', 'psi_sales_closure_forms']) {
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`), `el rollback quita ${table}`);
  }
  assert.match(rollback, /PIERDE DATOS/, 'el rollback advierte qué se pierde');
});
