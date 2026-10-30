// AGT-003 — brief antes de la reunión (F12; Juan, 2026-10-22).
// Lo que se prueba: que todo salga de datos del CRM, que las sugerencias vayan aparte y que lo que falta se nombre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const load = async (relative, named) => {
  const entry = new URL(relative, import.meta.url).pathname;
  const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`))[named];
};
const meetingBrief = await load('../src/vigia/meeting-brief.ts', 'meetingBrief');

const NOW = new Date('2026-10-22T15:00:00.000Z');
const enDias = (days) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
// El mismo formateador del módulo: Intl usa espacio duro entre el signo y el número.
const plata = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

const completa = {
  id: 'o1', client_id: 'c1', company_name: 'Conjunto Los Pinos', stage_code: 'envio_oferta', stage_name: 'Envío de Oferta',
  offer_value: 12_000_000, service_type_name: 'Vigilancia física', economic_sector: 'Propiedad horizontal',
  sede: 'Pereira', decision_maker_name: 'Ana Ruiz', decision_maker_title: 'Administradora',
  decision_maker_phone: '3001234567', decision_maker_email: 'ana@pinos.co', company_website: 'https://pinos.co',
  current_security_provider: 'Atlas', current_contract_end_date: '2026-11-30',
  next_action_at: enDias(2), last_interaction_at: enDias(-3),
  stage_entered_at: enDias(-40), stage_entered_at_measured: true, staleness_days: 14,
};

test('el brief sólo trae lo que no está ya en la ficha', () => {
  const brief = meetingBrief({
    opportunity: completa,
    interactions: [
      { interaction_type: 'llamada', notes: 'Pidió la propuesta por correo', occurred_at: enDias(-3) },
      { interaction_type: 'reunion', notes: 'Visita al conjunto', occurred_at: enDias(-10) },
    ],
    now: NOW,
  });

  // Sector, decisor, contacto, valor y fechas se ven en el encabezado y en las tarjetas: aquí no se repiten.
  assert.deepEqual(brief.contexto.map(item => item.label), ['Seguridad hoy', 'Contrato actual vence', 'En esta etapa']);
  assert.equal(brief.contexto.find(item => item.label === 'Seguridad hoy').value, 'Atlas');
  assert.equal(brief.contexto.find(item => item.label === 'En esta etapa').value, '40 día(s) en Envío de Oferta');
  assert.equal(brief.desdeLaUltimaVez.length, 2, 'lo más reciente primero');
  assert.match(brief.desdeLaUltimaVez[0], /Llamada: Pidió la propuesta por correo$/);
  assert.deepEqual(brief.faltaEnElCrm, [], 'con el perfil completo no falta nada');
});

test('las sugerencias van aparte, cada una apoyada en un dato, y nunca se mezclan con los hechos', () => {
  const brief = meetingBrief({ opportunity: completa, interactions: [{ occurred_at: enDias(-3), notes: 'x' }], now: NOW });
  assert.ok(brief.sugerencias.some(item => /vence el 30 de noviembre \(en 39 día\(s\)\): es el momento de hablar de renovación/.test(item)));
  assert.ok(brief.sugerencias.some(item => /Hoy están con Atlas/.test(item)));
  assert.ok(!brief.sugerencias.some(item => /No hay próxima gestión vigente/.test(item)), 'tiene gestión futura: no se pide');
  // El estancamiento no se sugiere cuando hay compromiso vigente, igual que el aviso de Mi día.
  assert.ok(!brief.sugerencias.some(item => /Conviene salir de la reunión/.test(item)));

  const sinAgenda = meetingBrief({ opportunity: { ...completa, next_action_at: null }, interactions: [], now: NOW });
  assert.ok(sinAgenda.sugerencias.some(item => /No hay próxima gestión vigente/.test(item)));
  assert.ok(sinAgenda.sugerencias.some(item => /Lleva 40 día\(s\) en Envío de Oferta\. Conviene salir de la reunión con un compromiso concreto\./.test(item)));
});

test('sin proveedor y con contrato vencido, el brief lo dice en los términos del negocio', () => {
  const brief = meetingBrief({
    opportunity: { ...completa, current_security_provider: null, current_security_provider_none: true, current_contract_end_date: '2026-09-30' },
    now: NOW,
  });
  assert.equal(brief.contexto.find(item => item.label === 'Seguridad hoy').value, 'No tiene proveedor');
  assert.ok(brief.sugerencias.some(item => /la conversación es de primera vez, no de reemplazo/.test(item)));
  assert.ok(brief.sugerencias.some(item => /venció el 30 de septiembre: confirme con quién está hoy el servicio/.test(item)));
});

test('la familia del cliente: lo abierto se lista y lo perdido trae motivo y competidor', () => {
  const brief = meetingBrief({
    opportunity: completa,
    siblings: [
      completa,
      { id: 'o2', client_id: 'c1', company_name: 'Conjunto Los Pinos', stage_code: 'prospecto', stage_name: 'Prospecto', offer_value: 3_000_000, service_type_name: 'Tecnología' },
      { id: 'o3', client_id: 'c1', company_name: 'Conjunto Los Pinos', stage_code: 'perdido', stage_name: 'Perdido', loss_reason_name: 'Precio', competitor_name: 'Atlas' },
      { id: 'o4', client_id: 'c1', company_name: 'Conjunto Los Pinos', stage_code: 'aprobado', stage_name: 'Aprobado' },
    ],
    now: NOW,
  });
  assert.deepEqual(brief.otrasOportunidades, [`Conjunto Los Pinos · Prospecto · ${plata(3_000_000)} · Tecnología`], 'la propia no se repite y lo cerrado no entra');
  assert.deepEqual(brief.perdidasPrevias, ['Conjunto Los Pinos: Precio · frente a Atlas']);
  assert.ok(brief.sugerencias.some(item => /Ya se perdió una oportunidad de este cliente/.test(item)));
});

test('lo que no está en el CRM se nombra, no se rellena', () => {
  const brief = meetingBrief({
    opportunity: { id: 'o9', company_name: 'Cliente nuevo', stage_code: 'prospecto', stage_name: 'Prospecto' },
    now: NOW,
  });
  assert.deepEqual(brief.faltaEnElCrm, ['quién decide', 'cómo contactarlo', 'con quién están hoy', 'cuándo vence su contrato actual']);
  assert.deepEqual(brief.desdeLaUltimaVez, []);
  assert.deepEqual(brief.contexto, [], 'no inventa ni un campo');
});

test('pantalla: el brief vive en la ficha, se abre desde la cola de hoy y rotula lo que es sugerencia', () => {
  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /const brief = meetingBrief\(\{ opportunity, interactions, siblings \}\);/);
  assert.match(ui, /\{list\('Para tener en cuenta', brief\.sugerencias, 'is-suggestion'\)\}/);
  assert.match(ui, /\{list\('Pregunte en la reunión', brief\.faltaEnElCrm, 'is-missing'\)\}/);
  assert.match(ui, /siblings=\{data\.opportunities\.filter\(row => row\.client_id && row\.client_id === o\.client_id\)\}/);
  assert.match(ui, /const briefFocusRequested = focusTarget === 'brief';/);
  assert.doesNotMatch(ui, /MeetingBriefPanel[\s\S]{0,400}api</, 'el brief no llama a ninguna ruta: sale de lo que ya está cargado');

  const decision = readFileSync(new URL('../src/vigia/OpportunityDecision.tsx', import.meta.url), 'utf8');
  // Desde el rediseño de Mi día (2026-10-22) lo agendado para hoy vive dentro de "Ahora", y su enlace secundario
  // sigue siendo el brief: "Antes de la reunión".
  const now = decision.slice(decision.indexOf('export function NowQueue('));
  assert.ok(now.includes("kind === 'hoy' ? '?focus=brief' : ''"), 'la fila de hoy enlaza al brief');
  assert.ok(now.includes("kind === 'hoy' ? 'Antes de la reunión' : 'Ver ficha'"), 'y lo nombra "Antes de la reunión"');
});

test('nada de "0 días" ni de preguntar por un contrato que no existe (revisión de Juan del 22-oct)', () => {
  // Con la medición de etapas recién arrancada, la primera versión decía "Lleva al menos 0 día(s) en Prospecto".
  const reciente = meetingBrief({ opportunity: { ...completa, stage_entered_at: NOW.toISOString(), stage_entered_at_measured: true }, now: NOW });
  assert.equal(reciente.contexto.some(item => item.label === 'En esta etapa'), false, 'con cero días no se dice nada');

  // Y decía "Seguridad hoy: No tiene proveedor" junto a "falta: cuándo vence su contrato actual".
  const sinProveedor = meetingBrief({
    opportunity: { ...completa, current_security_provider: null, current_security_provider_none: true, current_contract_end_date: null },
    now: NOW,
  });
  assert.equal(sinProveedor.faltaEnElCrm.includes('cuándo vence su contrato actual'), false, 'sin proveedor no hay contrato que venza');
  assert.equal(sinProveedor.faltaEnElCrm.includes('con quién están hoy'), false);
});

test('las notas largas se recortan: el brief no se come la pantalla', () => {
  const larga = `Envié el mensaje sugerido por Vig-IA. ${'palabra '.repeat(80)}fin`;
  const brief = meetingBrief({ opportunity: completa, interactions: [{ interaction_type: 'whatsapp', notes: larga, occurred_at: enDias(-1) }], now: NOW });
  const linea = brief.desdeLaUltimaVez[0];
  assert.ok(linea.endsWith('…'), 'se corta con puntos suspensivos');
  assert.ok(linea.length < 230, `la línea mide ${linea.length}`);
  assert.equal(meetingBrief({
    opportunity: completa, now: NOW,
    interactions: [1, 2, 3, 4, 5].map(n => ({ interaction_type: 'nota', notes: `nota ${n}`, occurred_at: enDias(-n) })),
  }).desdeLaUltimaVez.length, 3, 'máximo tres gestiones');
});
