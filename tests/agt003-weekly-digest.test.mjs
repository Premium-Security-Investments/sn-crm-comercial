// AGT-003 — correo semanal (capacidad agt003.weekly_digest, contrato agt003-weekly-digest-v1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEEKLY_DIGEST_CAPABILITY,
  WEEKLY_DIGEST_CONTRACT,
  WeeklyDigestValidationError,
  buildWeeklyDigest,
  digestWeeks,
  formatDayRange,
  greetingName,
  messageId,
  selectDigestRecipients,
} from '../src/vigia/weekly-digest.js';
import { MANAGER_EMAIL, NOW, PREVIEW_TO, SECRET_NOTE, TENDER_CLIENT, weeklyDigestFixture } from './fixtures/agt003-weekly-digest-fixture.mjs';
import { outboxSummary, parseArgs, writeOutbox } from '../ops/agt003-weekly-digest/run-agt003-weekly-digest.mjs';

const live = (overrides = {}) => buildWeeklyDigest({ ...weeklyDigestFixture(), mode: 'live', ...overrides });
const preview = (overrides = {}) => buildWeeklyDigest({ ...weeklyDigestFixture(), mode: 'preview', ...overrides });
const byKind = (outbox, kind) => outbox.messages.filter(m => m.kind === kind);
const salespersonFor = (outbox, profileId) => outbox.messages.find(m => m.kind === 'salesperson' && m.recipient_profile_id === profileId);

test('contrato y capacidad nombrados para Plataforma Agentes', () => {
  const outbox = live();
  assert.equal(outbox.contract, 'agt003-weekly-digest-v1');
  assert.equal(outbox.contract, WEEKLY_DIGEST_CONTRACT);
  assert.equal(outbox.capability, 'agt003.weekly_digest');
  assert.equal(outbox.capability, WEEKLY_DIGEST_CAPABILITY);
  assert.equal(outbox.agent, 'AGT-003');
  assert.equal(outbox.generated_at, NOW.toISOString());
  assert.equal(outbox.generated_day_bogota, '2026-10-12');
  assert.equal(outbox.sender, 'juanbotero@premiumsecurity.ai');
  assert.deepEqual(outbox.rules, { recipients: 'recipients-v1', behavior: 'behavior-v1' });
});

test('destinatarios: sólo comerciales activos y humanos; licitaciones-sólo excluida por regla', () => {
  const { profiles, areaAssignments } = weeklyDigestFixture();
  const { included, excluded } = selectDigestRecipients({ profiles, areaAssignments });
  assert.deepEqual(included.map(p => p.id), ['p-ana', 'p-beto', 'p-caro'], 'ordenados por nombre; sin gerente, dueño, agente ni inactivo');
  assert.deepEqual(excluded, [{ profile_id: 'p-kata', name: 'Katalina Licitaciones Prueba', reason: 'area_comercial_solo_licitaciones' }]);
  // Con otra subárea comercial además de licitaciones sí recibe (Beto). Sin asignaciones comerciales también.
  const noAreas = selectDigestRecipients({ profiles, areaAssignments: [] });
  assert.ok(noAreas.included.some(p => p.id === 'p-kata'), 'la regla depende de las asignaciones, no del nombre');
  const outbox = live();
  assert.deepEqual(byKind(outbox, 'salesperson').map(m => m.recipient_profile_id), ['p-ana', 'p-beto', 'p-caro']);
  assert.equal(byKind(outbox, 'manager').length, 1);
  const all = outbox.messages.flatMap(m => [...m.to, ...m.cc]);
  assert.ok(!all.includes(PREVIEW_TO), 'Juan no recibe copias en el envío real');
  assert.ok(!all.includes('kata@example.co'));
});

test('el gerente va en copia de cada correo personal y recibe el resumen del equipo', () => {
  const outbox = live();
  for (const m of byKind(outbox, 'salesperson')) {
    assert.equal(m.to.length, 1);
    assert.deepEqual(m.cc, [MANAGER_EMAIL]);
    assert.deepEqual(m.real_to, m.to);
    assert.deepEqual(m.real_cc, m.cc);
  }
  assert.deepEqual(salespersonFor(outbox, 'p-beto').to, ['beto.ramirez@example.co'], 'correo normalizado en minúsculas');
  const [manager] = byKind(outbox, 'manager');
  assert.deepEqual(manager.to, [MANAGER_EMAIL]);
  assert.deepEqual(manager.cc, []);
  assert.equal(manager.recipient_profile_id, 'p-lucho');
  assert.equal(manager.subject, 'Resumen comercial de la semana (5 al 11 de octubre)');
});

test('validación: gerente inexistente, sin destinatarios, correos inválidos, modo y muestra', () => {
  const expectCode = (fn, code) => assert.throws(fn, error => error instanceof WeeklyDigestValidationError && error.code === code);
  expectCode(() => live({ config: { managerEmail: 'nadie@example.co' } }), 'manager_not_found');
  const fx = weeklyDigestFixture();
  expectCode(() => buildWeeklyDigest({ ...fx, mode: 'live', profiles: fx.profiles.map(p => (p.id === 'p-lucho' ? { ...p, identity_type: 'agent' } : p)) }), 'manager_not_found');
  expectCode(() => buildWeeklyDigest({ ...fx, mode: 'live', profiles: fx.profiles.filter(p => p.role !== 'comercial') }), 'no_recipients');
  expectCode(() => buildWeeklyDigest({ ...fx, mode: 'live', profiles: fx.profiles.map(p => (p.id === 'p-beto' ? { ...p, microsoft_email: 'beto-sin-arroba' } : p)) }), 'bad_recipient_email');
  expectCode(() => live({ config: { managerEmail: 'mal correo' } }), 'bad_manager_email');
  expectCode(() => live({ config: { managerEmail: MANAGER_EMAIL, appUrl: 'http://inseguro' } }), 'bad_app_url');
  expectCode(() => live({ mode: 'otro' }), 'bad_mode');
  expectCode(() => live({ sample: 1 }), 'sample_in_live');
  expectCode(() => preview({ sample: 0 }), 'bad_sample');
  expectCode(() => live({ now: new Date('x') }), 'bad_now');
});

test('preview: todo a Juan, sin copia, asunto [PRUEBA] y aviso con los destinatarios reales', () => {
  const outbox = preview();
  assert.equal(outbox.mode, 'preview');
  for (const m of outbox.messages) {
    assert.deepEqual(m.to, [PREVIEW_TO]);
    assert.deepEqual(m.cc, []);
    assert.ok(m.subject.startsWith('[PRUEBA] '));
  }
  const ana = salespersonFor(outbox, 'p-ana');
  const banner = `Prueba: en el envío real este correo iría a ana.perez@example.co con copia a ${MANAGER_EMAIL}.`;
  assert.ok(ana.text.startsWith(banner));
  assert.ok(ana.html.indexOf('Prueba: en el envío real') < ana.html.indexOf('Hola Ana María'), 'el aviso va arriba');
  assert.deepEqual(ana.real_to, ['ana.perez@example.co']);
  assert.deepEqual(ana.real_cc, [MANAGER_EMAIL]);
  const [manager] = byKind(outbox, 'manager');
  assert.ok(manager.text.startsWith(`Prueba: en el envío real este correo iría a ${MANAGER_EMAIL} sin copia.`));
  // El envío real no lleva aviso ni prefijo.
  const real = live();
  assert.ok(!real.messages.some(m => m.subject.includes('[PRUEBA]') || m.text.includes('Prueba:') || m.html.includes('Prueba:')));
});

test('preview --sample=1: un comercial (el de más oportunidades activas) más el resumen del gerente', () => {
  const outbox = preview({ sample: 1 });
  assert.equal(outbox.sample, 1);
  assert.deepEqual(outbox.messages.map(m => m.kind), ['salesperson', 'manager']);
  assert.equal(outbox.messages[0].recipient_profile_id, 'p-ana');
  const [manager] = byKind(outbox, 'manager');
  for (const name of ['Ana María Pérez Gómez', 'Beto Ramírez', 'Carolina Díaz Ríos']) assert.ok(manager.text.includes(name), 'el resumen del gerente es del equipo completo');
});

test('ids determinísticos: sha256(contrato|modo|lunes|tipo|destinatario)', () => {
  const a = live();
  const b = live();
  assert.deepEqual(a.messages.map(m => m.id), b.messages.map(m => m.id));
  assert.deepEqual(a, b, 'misma entrada, misma salida');
  const ana = salespersonFor(a, 'p-ana');
  assert.equal(ana.id, messageId({ mode: 'live', weekStart: '2026-10-12', kind: 'salesperson', recipient: 'p-ana' }));
  assert.match(ana.id, /^[0-9a-f]{64}$/);
  assert.equal(new Set(a.messages.map(m => m.id)).size, a.messages.length);
  const p = preview();
  assert.notEqual(salespersonFor(p, 'p-ana').id, ana.id, 'preview y live nunca comparten id');
  // Re-generar el mismo lunes más tarde no cambia los ids (Hermes no reenvía); otra semana sí.
  const later = live({ now: new Date('2026-10-12T15:00:00Z') });
  assert.equal(salespersonFor(later, 'p-ana').id, ana.id);
  assert.notEqual(later.run_id, a.run_id);
  const nextWeek = live({ now: new Date('2026-10-19T11:45:00Z') });
  assert.notEqual(salespersonFor(nextWeek, 'p-ana').id, ana.id);
  assert.equal(a.run_id, '2026-10-12-live-20261012T114500Z');
});

test('semanas de Bogotá: la pasada para las cifras, la actual para la agenda', () => {
  assert.deepEqual(digestWeeks(NOW), { timezone: 'America/Bogota', last_week_start: '2026-10-05', last_week_end: '2026-10-11', this_week_start: '2026-10-12', this_week_end: '2026-10-18' });
  // Lunes 04:59 UTC sigue siendo domingo en Bogotá.
  assert.equal(digestWeeks(new Date('2026-10-12T04:59:00Z')).this_week_start, '2026-10-05');
  assert.equal(formatDayRange('2026-09-28', '2026-10-04'), '28 de septiembre al 4 de octubre');
  assert.equal(formatDayRange('2026-12-28', '2027-01-03'), '28 de diciembre de 2026 al 3 de enero de 2027');
  const ana = salespersonFor(live(), 'p-ana');
  assert.equal(ana.subject, 'Su semana en el CRM — Ana María (semana del 5 al 11 de octubre)');
  assert.match(ana.text, /registró 3 seguimientos y tomó 2 decisiones/, 'lunes 00:00 y domingo 23:30 cuentan; domingo anterior, este lunes, licitación y cambio_estado no');
  assert.match(ana.text, /lunes 12 de octubre: Bodegas El Puerto/);
  assert.match(ana.text, /domingo 18 de octubre: Colegio San José/, 'domingo 23:30 Bogotá todavía es esta semana');
  assert.doesNotMatch(ana.text, /Próxima Semana/, 'lunes 00:30 Bogotá siguiente queda fuera');
  assert.match(salespersonFor(live(), 'p-beto').text, /registró 1 seguimiento y tomó 0 decisiones/, 'la decisión del sábado anterior no cuenta');
});

test('contenido del comercial: estado, por decidir, meta y Mi día; sin licitaciones', () => {
  const outbox = live();
  const ana = salespersonFor(outbox, 'p-ana');
  assert.match(ana.text, /Su estado hoy: Atrasado\. 2 oportunidades pendientes de decidir y agenda al día en 67% \(mínimo 70%\)\./);
  assert.match(ana.text, /Tiene 2 oportunidades por decidir/);
  assert.match(ana.text, /Hotel Los Andes \(Eje cafetero\) — \$45\.000\.000 — sin seguimientos registrados/);
  assert.doesNotMatch(ana.text, /Congelada SAS/);
  assert.match(ana.text, /Meta de octubre: lleva \$25\.000\.000 en ventas aprobadas de \$100\.000\.000 \(25%\)/, 'la meta de licitaciones no suma');
  assert.match(ana.text, /https:\/\/seguridad-nacional-crm\.vercel\.app\/#\/home/);
  assert.match(ana.html, /href="https:\/\/seguridad-nacional-crm\.vercel\.app\/#\/home"/);
  assert.ok(ana.text.includes('Este resumen lo genera el CRM con lo que usted registró. Si algo no cuadra, actualícelo en el CRM.'));
  assert.match(salespersonFor(outbox, 'p-caro').text, /Su estado hoy: Inactivo/);
  assert.doesNotMatch(salespersonFor(outbox, 'p-beto').text, /Meta de/, 'sin meta no hay línea de meta');
  const custom = live({ config: { managerEmail: MANAGER_EMAIL, appUrl: 'https://crm.example.co/' } });
  assert.match(salespersonFor(custom, 'p-ana').text, /https:\/\/crm\.example\.co\/#\/home/);
  assert.match(byKind(custom, 'manager')[0].text, /https:\/\/crm\.example\.co\/#\/dashboard2/);
});

test('resumen del gerente: inactivos y atrasados primero, titular de 3 líneas y top 5 por decidir', () => {
  const [manager] = byKind(live(), 'manager');
  const order = ['Carolina Díaz Ríos\n', 'Ana María Pérez Gómez\n', 'Beto Ramírez\n'].map(n => manager.text.indexOf(n));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], `orden ${order}`);
  assert.match(manager.text, /Al día: 1 \(Beto Ramírez\)\nAtrasados: 1 \(Ana María Pérez Gómez\)\nInactivos: 1 \(Carolina Díaz Ríos\)/);
  assert.match(manager.text, /1\. Universidad del Café \(Manizales\) — Carolina Díaz Ríos — \$350\.000\.000/);
  assert.match(manager.text, /Agenda al día: 67%/);
  assert.match(manager.text, /Último ingreso al CRM: 20 de septiembre \(hace 22 días\)/);
  assert.match(manager.html, /#\/dashboard2/);
  assert.doesNotMatch(manager.text, /Katalina|Cliente de Juan|Juan Dueño/);
});

test('sólo oportunidades de AGT-003 y nunca notas', () => {
  for (const outbox of [live(), preview()]) {
    for (const m of outbox.messages) {
      for (const body of [m.text, m.html, m.subject]) {
        assert.ok(!body.includes(SECRET_NOTE), 'las notas/observaciones nunca salen');
        assert.ok(!body.includes(TENDER_CLIENT), 'las licitaciones (AGT-002) nunca salen');
        assert.ok(!body.includes('9.000.000.000'));
        assert.ok(!/o-a\d|p-ana|p-lucho/.test(body), 'sin ids internos en el contenido');
      }
    }
  }
});

test('HTML seguro: nombres escapados, estilos en línea y sin recursos externos', () => {
  const ana = salespersonFor(live(), 'p-ana');
  assert.ok(!ana.html.includes('<script>'));
  assert.ok(ana.html.includes('Clínica &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Cía (Pereira)'));
  assert.ok(ana.text.includes('Clínica <script>alert("x")</script> & Cía'), 'el texto plano no se escapa');
  for (const m of live().messages) {
    assert.doesNotMatch(m.html, /<img|<link|<style|src=|url\(/i);
    assert.match(m.html, /^<!DOCTYPE html>/);
    assert.ok(m.text.endsWith('\n'));
  }
});

test('nombre para saludar', () => {
  assert.equal(greetingName('Luis Fernando López Ruiz'), 'Luis Fernando');
  assert.equal(greetingName('Katherine Valencia Buitrago'), 'Katherine');
  assert.equal(greetingName('  Juan   Botero '), 'Juan');
  assert.match(byKind(live(), 'manager')[0].text, /^Hola Luis Fernando,/, 'saludo por defecto del gerente por defecto');
  const fx = weeklyDigestFixture();
  const other = buildWeeklyDigest({ ...fx, mode: 'live', profiles: [...fx.profiles, { id: 'p-otro', full_name: 'Pedro Gerente Otro', role: 'director', active: true, microsoft_email: 'otro@example.co' }], config: { managerEmail: 'otro@example.co' } });
  assert.match(byKind(other, 'manager')[0].text, /^Hola Pedro,/);
});

test('runner: argumentos, escritura atómica y punteros separados por modo', () => {
  assert.deepEqual(parseArgs(['--mode=preview', '--sample=1', '--dry']), { mode: 'preview', sample: 1, outDir: null, dry: true, now: null });
  assert.throws(() => parseArgs([]), /--mode/);
  assert.throws(() => parseArgs(['--mode=live', '--enviar']), /no reconocido/);
  const dir = mkdtempSync(join(tmpdir(), 'agt003-digest-test-'));
  try {
    const p = writeOutbox(dir, preview({ sample: 1 }));
    const l = writeOutbox(dir, live());
    assert.equal(p.latest, join(dir, 'outbox-preview-latest.json'));
    assert.equal(l.latest, join(dir, 'outbox-latest.json'));
    assert.equal(JSON.parse(readFileSync(l.latest, 'utf8')).mode, 'live');
    assert.equal(JSON.parse(readFileSync(p.latest, 'utf8')).mode, 'preview', 'una prueba nunca pisa el outbox real');
    assert.ok(existsSync(join(dir, 'receipts')));
    assert.ok(!readdirSync(dir).some(name => name.endsWith('.tmp')));
    assert.match(readFileSync(p.summary, 'utf8'), /real: ana\.perez@example\.co · copia: directorfisica@seguridadnacional\.co/);
    assert.match(outboxSummary(live()), /Excluidos por regla:\n- Katalina Licitaciones Prueba: area_comercial_solo_licitaciones/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('frontera: el módulo es puro, de AGT-003, sin AGT-002, red ni envío', () => {
  const src = readFileSync(new URL('../src/vigia/weekly-digest.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import\s.*?from\s+'([^']+)';/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./commercial-behavior.js', './commercial-scope.js', './opportunity-decision-rules.js', 'node:crypto']);
  assert.ok(!imports.some(spec => /agt002|tender-|hermes/i.test(spec)), 'sin imports de AGT-002');
  assert.doesNotMatch(src, /import\(/, 'sin imports dinámicos');
  assert.doesNotMatch(src, /fetch\(|process\.env|Date\.now\(|new Date\(\)|readFileSync|writeFileSync|nodemailer|smtp/i);
  const runner = readFileSync(new URL('../ops/agt003-weekly-digest/run-agt003-weekly-digest.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /from '[^']*agt002[^']*'|import\('[^']*agt002/);
  assert.doesNotMatch(runner, /\.(insert|update|upsert|delete|rpc)\(/, 'el runner sólo lee la base de datos');
  assert.doesNotMatch(runner, /nodemailer|smtp|sendMail|graph\.microsoft/i, 'el runner nunca envía correo');
  assert.doesNotMatch(runner, /_SELECT = '[^']*\b(notes|observaciones|loss_notes)\b/, 'nunca lee notas');
});

test('artefactos de operación: timer 11:45 UTC del lunes y servicios endurecidos', () => {
  const read = name => readFileSync(new URL(`../ops/agt003-weekly-digest/${name}`, import.meta.url), 'utf8');
  const timer = read('agt003-weekly-digest.timer');
  assert.match(timer, /^OnCalendar=Mon \*-\*-\* 11:45:00 UTC$/m);
  assert.match(timer, /^Persistent=true$/m);
  for (const [name, args] of [['agt003-weekly-digest.service', '--mode=live'], ['agt003-weekly-digest-preview.service', '--mode=preview --sample=1']]) {
    const unit = read(name);
    assert.match(unit, /^Type=oneshot$/m);
    assert.match(unit, /^User=psi-comercial$/m);
    assert.match(unit, /^StateDirectory=agt003-weekly-digest$/m);
    assert.match(unit, /^StateDirectoryMode=0755$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
    assert.ok(unit.includes(`run-agt003-weekly-digest.mjs ${args}`), name);
    assert.doesNotMatch(unit, /^\[Install\]/m, 'los servicios no se habilitan solos');
  }
});
