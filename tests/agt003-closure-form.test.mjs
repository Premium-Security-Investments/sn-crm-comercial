// AGT-003 — formulario de cierre (formato GGC-FO-001): autollenado, completitud, dinero y la puerta de "ganado".
// Decisión de Juan del 2026-10-23: sólo se puede marcar ganado con el formulario completo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOSURE_FORM_FIELDS, CLOSURE_FORM_FORMAT, CLOSURE_FORM_IVA_RATE, CLOSURE_FORM_MAX_POSTS,
  CLOSURE_FORM_MAX_SITES, CLOSURE_FORM_SECTIONS, CLOSURE_FORM_VERSION,
  autofillClosureForm, autofillClosureSites, cleanClosureFormInput, closureFormCatalog,
  closureFormCompleteness, closureFormDurationDays, closureFormMoney, closureFormPlainText,
  closureFormWinVerdict,
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

test('duración del contrato: la terminación es el último día y cuenta', () => {
  // Decisión de Juan del 2026-10-24: la fecha de terminación es el último día de servicio. Entonces octubre
  // completo son 31 días, no 30, y tres años desde el 1 de octubre de 2026 terminan el 30 de septiembre de 2029.
  // En el Word el caso real decía 1095 días con terminación el 2029-10-01, y eso no cuadra con ninguna
  // convención: era una suma a mano, y la fecha además estaba corrida un día.
  assert.equal(closureFormDurationDays('2026-10-01', '2026-10-31'), 31, 'el mes completo');
  assert.equal(closureFormDurationDays('2026-10-01', '2029-09-30'), 1096, 'tres años, con el 2028 bisiesto');
  assert.equal(closureFormDurationDays('2026-10-01', '2026-10-01'), 1, 'un servicio de un solo día es un día');
  assert.equal(closureFormDurationDays('2029-10-01', '2026-10-01'), null, 'al revés no se calcula');
  assert.equal(closureFormDurationDays('ayer', '2029-10-01'), null);
  assert.notEqual(closureFormDurationDays('2026-10-01', '2029-10-01'), 1095, 'el número del Word no se puede reproducir');
});

test('migración 154: la terminación puede ser el mismo día del inicio', () => {
  const sql = readFileSync(new URL('../supabase/migrations/154_agt003_cierre_duracion_ultimo_dia.sql', import.meta.url), 'utf8');
  assert.match(sql, /check \(service_end_date is null or service_start_date is null or service_end_date >= service_start_date\)/);
  assert.match(sql, /Último día de servicio, inclusive/);
  assert.doesNotMatch(sql, /drop table|delete from/i, 'no borra nada');
  const rollback = readFileSync(new URL('../supabase/rollbacks/154_agt003_cierre_duracion_ultimo_dia_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /service_end_date > service_start_date/);
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

// ---------------------------------------------------------------------------------------------------------------------
// Lo que llega de la pantalla o del chat, y los dos endpoints

test('limpieza: sólo pasan las claves del catálogo, cada una según su tipo', () => {
  const { form, avisos } = cleanClosureFormInput({
    form: {
      establishment_name: '  Hotel   de   Pereira ',
      withholding_agent: true,
      large_taxpayer: 'SI',
      tax_regime: 'especial',
      service_start_date: '2026-10-01T05:00:00Z',
      service_end_date: 'mañana',
      aiu_value: '1492420',
      ciiu_code: '5501',
      stage_code: 'aprobado',
      id: 'otra-cosa',
    },
  });
  assert.equal(form.establishment_name, 'Hotel de Pereira', 'se normalizan los espacios');
  assert.equal(form.withholding_agent, true);
  assert.equal(form.large_taxpayer, null, '"SI" no es un booleano');
  assert.equal(form.tax_regime, null, 'una opción que el formato no tiene no entra');
  assert.equal(form.service_start_date, '2026-10-01', 'de un instante se toma el día');
  assert.equal(form.service_end_date, null);
  assert.equal(form.aiu_value, 1492420);
  assert.equal('stage_code' in form, false, 'ningún campo ajeno al catálogo llega a la base');
  assert.equal('id' in form, false);
  // Lo descartado se avisa: no se borra en silencio lo que el comercial escribió. Tres avisos, uno por cada valor
  // que no se pudo usar; la fecha de inicio no avisa porque de un instante válido sí se pudo tomar el día.
  assert.equal(avisos.length, 3);
  assert.ok(avisos.some(a => a.includes('Gran contribuyente')));
  assert.ok(avisos.some(a => a.includes('Régimen')));
});

test('limpieza: un campo que no viene en el cuerpo no se toca, y uno vacío se borra', () => {
  const { form } = cleanClosureFormInput({ form: { ciiu_code: '', establishment_name: 'Hotel' } });
  assert.equal(form.ciiu_code, null, 'vacío es borrar');
  assert.equal('legal_rep_name' in form, false, 'lo que no viene no se menciona: el servidor lo mezcla con lo guardado');
});

test('limpieza: los puestos quedan con horario válido, enteros y su orden', () => {
  const { posts } = cleanClosureFormInput({
    posts: [
      { description: 'Portería 24/7', shift_start: '6:00', shift_end: '18:00', guards_required: '3', monthly_value: '19308499', armed: 'si', days_per_month: 30 },
      { description: 'Ronda', shift_start: '25:00', shift_end: '06:00', guards_required: 0, monthly_value: -1, days_per_month: 45 },
    ],
  });
  assert.equal(posts.length, 2);
  assert.equal(posts[0].shift_start, null, '"6:00" no es una hora de dos dígitos');
  assert.equal(posts[0].shift_end, '18:00');
  assert.equal(posts[0].guards_required, 3, 'el texto numérico sí se acepta');
  assert.equal(posts[0].monthly_value, 19308499);
  assert.equal(posts[0].armed, false, 'armado sólo es true con true: "si" no arma a nadie');
  assert.equal(posts[0].position, 1);
  assert.equal(posts[1].shift_start, null);
  assert.equal(posts[1].guards_required, null, 'cero vigilantes no es un puesto');
  assert.equal(posts[1].monthly_value, null);
  assert.equal(posts[1].days_per_month, null, '45 días en un mes, no');
  assert.equal(posts[1].position, 2);
});

test('limpieza: hay techo de direcciones y de puestos, y se dice cuándo se recortó', () => {
  const muchos = Array.from({ length: CLOSURE_FORM_MAX_POSTS + 3 }, (_, i) => ({ description: `Puesto ${i + 1}`, guards_required: 1, monthly_value: 1000 }));
  const { posts, avisos } = cleanClosureFormInput({ posts: muchos });
  assert.equal(posts.length, CLOSURE_FORM_MAX_POSTS);
  assert.ok(avisos.some(a => a.includes('primeros')));
  const sitios = Array.from({ length: CLOSURE_FORM_MAX_SITES + 1 }, () => ({ address: 'Calle 1', city: 'Pereira' }));
  const limpio = cleanClosureFormInput({ sites: sitios });
  assert.equal(limpio.sites.length, CLOSURE_FORM_MAX_SITES);
  assert.ok(limpio.avisos.some(a => a.includes('direcciones')));
});

test('el catálogo para la pantalla no lleva funciones, y el estrato cambia con el sector', () => {
  const comercial = closureFormCatalog({ sector: 'comercial' });
  const residencial = closureFormCatalog({ sector: 'residencial' });
  const estrato = c => c.find(field => field.key === 'residential_stratum');
  assert.equal(estrato(comercial).required, false);
  assert.equal(estrato(residencial).required, true);
  for (const field of comercial) {
    assert.equal(typeof field.required, 'boolean', field.key);
    assert.equal(typeof field.label, 'string');
  }
  assert.doesNotThrow(() => JSON.stringify(comercial), 'tiene que poder viajar como JSON');
  const auto = comercial.filter(field => field.auto).map(field => field.key);
  assert.equal(auto.length, 9, 'nueve campos los pone el CRM; el resto los escribe el comercial');
});

test('servidor: los dos endpoints, con sus permisos y la semántica de parche', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');

  assert.match(server, /'GET \/api\/agt003\/closure-form': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_DETAIL_VIEW\]/);
  assert.match(server, /'PUT \/api\/agt003\/closure-form': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_EDIT\]/);

  // Abrir la oportunidad no crea filas: el borrador autocompletado se devuelve, no se guarda.
  const getHandler = server.slice(server.indexOf("app.get('/api/agt003/closure-form'"), server.indexOf("app.put('/api/agt003/closure-form'"));
  assert.doesNotMatch(getHandler, /\.insert\(|\.upsert\(|\.delete\(/, 'el GET no escribe nada');

  const putHandler = server.slice(server.indexOf("app.put('/api/agt003/closure-form'"));
  const put = putHandler.slice(0, putHandler.indexOf('\n});'));
  // Las listas se reemplazan sólo si vienen: así el chat puede llenar dos campos sin borrar los puestos.
  assert.match(put, /const sendsSites = Array\.isArray\(req\.body\?\.sites\)/);
  assert.match(put, /const sendsPosts = Array\.isArray\(req\.body\?\.posts\)/);
  assert.match(put, /if \(sendsSites\) \{/);
  assert.match(put, /if \(sendsPosts\) \{/);
  // El estado lo decide la regla, no el cuerpo de la petición.
  assert.match(put, /status: completeness\.complete \? 'completo' : 'borrador'/);
  assert.doesNotMatch(put, /req\.body\?\.status|body\.status/, 'nadie se declara completo desde el cuerpo');
  // La fecha de "completo" no se borra si después le quitan un dato.
  assert.match(put, /completed_at: stored\?\.completed_at \|\|/);
  // Las licitaciones no entran por aquí.
  assert.match(server, /Las licitaciones públicas no usan este formulario/);
});

// ---------------------------------------------------------------------------------------------------------------------
// Secciones, texto para enviar y la pantalla

test('secciones: cada campo tiene la suya y cada sección tiene campos', () => {
  const claves = new Set(CLOSURE_FORM_SECTIONS.map(section => section.key));
  assert.equal(claves.size, CLOSURE_FORM_SECTIONS.length);
  for (const field of CLOSURE_FORM_FIELDS) assert.ok(claves.has(field.section), `${field.key} sin sección válida`);
  for (const section of CLOSURE_FORM_SECTIONS) {
    assert.ok(CLOSURE_FORM_FIELDS.some(field => field.section === section.key), `${section.key} quedó vacía`);
    assert.ok(section.label.length > 3);
  }
  assert.ok(closureFormCatalog({}).every(field => typeof field.section === 'string'), 'la sección viaja al catálogo');
});

test('texto para enviar: trae el formato, los puestos y las sumas calculadas', () => {
  const texto = closureFormPlainText({ form: fullForm(), sites: SITES, posts: POSTS, company: 'Bansuri Hotel Group S.A.S.' });
  assert.match(texto, /^GGC-FO-001 — Nuevo puesto de vigilancia física \(versión 18\)/);
  assert.match(texto, /Cliente: Bansuri Hotel Group S\.A\.S\./);
  assert.match(texto, /CLIENTE Y CONTRATACIÓN/);
  assert.match(texto, /Sector al que pertenece: Comercial/, 'las opciones se leen con su nombre, no con el código');
  assert.match(texto, /Agente de retención: Sí/);
  assert.match(texto, /Duración: 1097 días \(unos 36 meses\)/, 'las fechas del ejemplar, con el último día contado');
  assert.match(texto, /06:00 a 06:00, 30 días al mes · 3 vigilante\(s\) · sin arma · \$19\.308\.499 al mes/);
  assert.match(texto, /Subtotal: \$38\.616\.998/);
  assert.match(texto, /IVA 19 % sobre el AIU: \$283\.560/);
  assert.match(texto, /Total: \$38\.900\.558/);
  assert.doesNotMatch(texto, /15\.207\.760/, 'el total del Word no puede reaparecer');
});

test('texto para enviar: lo que falta se nombra, y sin AIU el total lo dice', () => {
  const texto = closureFormPlainText({ form: autofillClosureForm(OPPORTUNITY), sites: [], posts: [] });
  assert.match(texto, /Nombre del establecimiento: sin registrar/, 'un dato faltante se nombra, no se deja en blanco');
  assert.match(texto, /DIRECCIONES DE PRESTACIÓN DEL SERVICIO\n  sin registrar/);
  assert.match(texto, /PUESTOS\n  sin registrar/);
  assert.match(texto, /AIU informativo: sin registrar/);
  assert.match(texto, /Total: \$0 \(sin IVA, falta el AIU\)/);
});

test('pantalla: va en la ficha y no reimplementa ninguna regla', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(main, /import \{ ClosureFormPanel \} from '\.\/vigia\/ClosureFormPanel'/);
  assert.match(main, /o\.service_type_code !== 'licitacion_publica' && <ClosureFormPanel/, 'no se le muestra a una licitación');

  const panel = readFileSync(new URL('../src/vigia/ClosureFormPanel.tsx', import.meta.url), 'utf8');
  // Las reglas se importan: la pantalla no tiene su propia idea de completitud ni de aritmética.
  for (const regla of ['closureFormCompleteness', 'closureFormMoney', 'closureFormPlainText', 'CLOSURE_FORM_SECTIONS']) {
    assert.ok(panel.includes(regla), `la pantalla debe usar ${regla}`);
  }
  assert.doesNotMatch(panel, /0\.19|\* 19|subtotal \+/, 'ni el IVA ni el subtotal se calculan en el JSX');
  // Los campos salen del catálogo del servidor, no de una lista escrita a mano en la pantalla.
  assert.doesNotMatch(panel, /legal_rep_id_number|contract_mail_address|withholding_agent/, 'ninguna clave del formulario escrita a mano');
  assert.match(panel, /state\.catalog\.filter/);
  // Guardar incompleto es válido: queda borrador. Y se dice.
  assert.match(panel, /queda como borrador/);
});
