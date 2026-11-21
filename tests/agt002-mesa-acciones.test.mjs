// Paso 4 del expediente vivo (Juan, 2026-11-12): lo que la persona pide en la Mesa se hace, a su nombre, con constancia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pidioLaPersona, ejecutarAgt002AccionesDeLaMesa, AGT002_MESA_ACCIONES_POLICY } from '../verticales/licitaciones/agt002-mesa-acciones.js';
import { createAgt002WorkbenchResponder } from '../verticales/licitaciones/agt002-workbench-responder.js';
import { AGT002_WORKBENCH_CAPABILITIES, AGT002_WORKBENCH_CONTRACT_VERSION, AGT002_WORKBENCH_POLICY_VERSION } from '../verticales/licitaciones/agt002-workbench-contract.js';
import { tenderOfficialValuesPlan } from '../verticales/licitaciones/tender-official-values.js';

const MENSAJE = 'Ok podemos actualizar la información en el crm para que no salga 1.000';

test('sólo cuenta como pedido una frase que está de verdad en el mensaje de la persona', () => {
  assert.equal(pidioLaPersona('actualizar la informacion en el CRM', MENSAJE), true, 'sin tildes ni mayúsculas');
  assert.equal(pidioLaPersona('corrija el presupuesto', MENSAJE), false);
  assert.equal(pidioLaPersona('ok', MENSAJE), false, 'una palabra suelta no es un pedido');
});

function baseDeDatos(oportunidad) {
  const hecho = { clarifications: [], updates: [], lineas: [] };
  return {
    hecho,
    rpc: async (nombre, args) => { hecho.lineas.push(args.p_line); return { error: null }; },
    from: tabla => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: oportunidad, error: null }),
        insert: async fila => { hecho.clarifications.push({ tabla, ...fila }); return { error: null }; },
        update: cambios => ({ eq: async () => { hecho.updates.push(cambios); return { error: null }; } }),
      };
      return q;
    },
  };
}

const BASE = { opportunityId: 'o1', tenderId: 't1', autorId: 'p1', autorNombre: 'Juan Botero', ahora: new Date('2026-11-12T20:40:00Z') };

test('corrige el presupuesto que pidió la persona, deja constancia y lo dice', async () => {
  const db = baseDeDatos({ id: 'o1', offer_value: '1000.00', tender_offer_status: null });
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: MENSAJE, acciones: [{
    tipo: 'corregir', campo: 'presupuesto', valor: '$16.760.713.273', fuente: 'ProyectoPliegoCondiciones Vigilancia.txt, numeral 9.1', pedido_literal: 'actualizar la información en el crm',
  }] });
  assert.deepEqual(db.hecho.updates, [{ offer_value: 16760713273 }]);
  assert.match(db.hecho.lineas[0], /^Vig-IA, a pedido de Juan Botero en la Mesa \(2026-11-12\): el presupuesto \(valor de la oportunidad\) pasó de \$1\.000 a \$16\.760\.713\.273\. Fuente: ProyectoPliego/);
  assert.match(lineas[0], /^Corregí el presupuesto .*de \$1\.000 a \$16\.760\.713\.273, según ProyectoPliego/);
});

test('anota en la ficha lo que la persona decide, a su nombre', async () => {
  const db = baseDeDatos(null);
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: 'Yo me encargo de definir lo del socio', acciones: [{
    tipo: 'anotar', campo: '', valor: 'Juan Botero se encarga de definir el socio de la unión temporal.', fuente: '', pedido_literal: 'Yo me encargo de definir lo del socio',
  }] });
  assert.equal(db.hecho.clarifications[0].tabla, 'psi_agt002_clarifications');
  assert.equal(db.hecho.clarifications[0].author_id, 'p1');
  assert.match(db.hecho.clarifications[0].target_label, /Dicho en la Mesa: «Yo me encargo/);
  assert.match(lineas[0], /^Anoté en la ficha del proceso: «Juan Botero se encarga/);
});

test('la nota de la Mesa cumple las reglas de la tabla de aclaraciones (sin target_kind suelto)', async () => {
  const db = baseDeDatos({ id: 'o1' });
  await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: 'anote que yo me encargo del socio', acciones: [{ tipo: 'anotar', campo: '', valor: 'Juan se encarga del socio.', fuente: '', pedido_literal: 'yo me encargo del socio' }] });
  const fila = db.hecho.clarifications[0];
  assert.equal(fila.tabla, 'psi_agt002_clarifications');
  assert.ok(fila.target_kind === null || fila.target_kind === undefined || ['requirement', 'finding'].includes(fila.target_kind));
  assert.equal(fila.target_kind == null, fila.target_id == null, 'target_kind y target_id van juntos (check de la tabla)');
});

test('lleva a Requisitos el bloqueo que la persona pide, en su grupo y con la cita; no lo duplica', async () => {
  const db = baseDeDatos({ id: 'o1' });
  const mensaje = 'Eso de la sucursal llévelo a Requisitos, nos inhabilita';
  const accion = { tipo: 'bloqueo', campo: 'presencia', valor: 'Piden sede principal o sucursal en Bogotá y tenemos agencia.', fuente: 'Pliego 1.7: «SEDE PRINCIPAL O SUCURSAL EN BOGOTÁ»', pedido_literal: 'llévelo a Requisitos' };
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje, acciones: [accion, { ...accion, campo: 'seriedad' }] });
  assert.equal(db.hecho.clarifications.length, 1);
  assert.deepEqual(db.hecho.clarifications[0], { tabla: 'psi_tender_requirement_blocks', opportunity_id: 'o1', focus_key: 'presencia', reason: accion.valor, citation: accion.fuente, source: 'mesa', created_by: 'p1' });
  assert.match(lineas[0], /Llevé a Requisitos, en «Sede principal o sucursal en la ciudad del contrato»/);
  assert.match(lineas[1], /falta el grupo/, 'un grupo que no existe no se anota');
  const repetido = baseDeDatos({ id: 'o1' });
  repetido.from = () => ({ insert: async () => ({ error: { code: '23505' } }) });
  assert.match((await ejecutarAgt002AccionesDeLaMesa(repetido, { ...BASE, mensaje, acciones: [accion] }))[0], /ya estaba en Requisitos/);
  const sinPedido = baseDeDatos({ id: 'o1' });
  await ejecutarAgt002AccionesDeLaMesa(sinPedido, { ...BASE, mensaje: 'qué dice el pliego de la sede', acciones: [accion] });
  assert.equal(sinPedido.hecho.clarifications.length, 0, 'sin pedido no se anota');
  assert.match(AGT002_MESA_ACCIONES_POLICY, /tipo «bloqueo»/);
});

test('no hace nada si no lo pidió la persona, si la oferta ya se presentó o si el valor no sirve', async () => {
  const db = baseDeDatos({ id: 'o1', offer_value: '1000.00', tender_offer_status: 'presentada' });
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: '¿Cuál es el monto?', acciones: [
    { tipo: 'corregir', campo: 'presupuesto', valor: '16760713273', fuente: 'x', pedido_literal: 'corrija el monto' },
  ] });
  assert.match(lineas[0], /no encontré en su mensaje el pedido/);
  const presentada = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: MENSAJE, acciones: [
    { tipo: 'corregir', campo: 'presupuesto', valor: '16760713273', fuente: 'x', pedido_literal: 'actualizar la información' },
    { tipo: 'corregir', campo: 'cierre', valor: 'mañana', fuente: 'x', pedido_literal: 'actualizar la información' },
  ] });
  assert.match(presentada[0], /la oferta ya está presentada/);
  assert.match(presentada[1], /no es válido/);
  assert.equal(db.hecho.updates.length, 0);
});

test('la Mesa pide las acciones en el esquema, las ejecuta y agrega al final lo que hizo', async () => {
  const llamadas = []; const ejecutadas = [];
  const responder = createAgt002WorkbenchResponder({
    client: { run: async args => { llamadas.push(args); return { content: JSON.stringify({ content_text: 'El presupuesto es $16.760.713.273.', source_links: [], missing_information: [], required_actions: [],
      acciones: [{ tipo: 'corregir', campo: 'presupuesto', valor: '16760713273', fuente: 'pliego', pedido_literal: 'actualizar la información' }] }), usage: { input_tokens: 1, output_tokens: 1 } }; } },
    model: 'sonnet', timeoutMs: 30_000,
    ejecutarAcciones: async ({ acciones }) => { ejecutadas.push(...acciones); return ['Corregí el presupuesto: de $1.000 a $16.760.713.273.']; },
  });
  const id = n => `0000000${n}-0000-4000-8000-00000000000${n}`;
  const resultado = await responder.respond({ job_id: id(1), thread_id: id(2), origin_message_id: id(3), opportunity_id: id(4), tender_id: id(5), snapshot_id: id(6), base_version_id: id(7),
    capability_id: AGT002_WORKBENCH_CAPABILITIES.reply, contract_version: AGT002_WORKBENCH_CONTRACT_VERSION, policy_version: AGT002_WORKBENCH_POLICY_VERSION, context_links: [], message: MENSAJE });
  assert.ok(llamadas[0].outputSchema.properties.acciones);
  assert.ok(llamadas[0].policy.includes(AGT002_MESA_ACCIONES_POLICY));
  assert.equal(ejecutadas.length, 1);
  const texto = JSON.stringify(resultado);
  assert.match(texto, /El presupuesto es \$16\.760\.713\.273\.\\n\\nCorregí el presupuesto/);
});

test('un presupuesto absurdo de SECOP se reemplaza con el del proyecto, como provisional', () => {
  const documentos = [{ name: 'ProyectoPliegoCondiciones Vigilancia.pdf', document_type: 'pliego', extracted_text: 'PRESUPUESTO OFICIAL la suma de ($16.760.713.273)' }];
  const plan = tenderOfficialValuesPlan({ opportunity: { offer_value: '1000.00' }, secopValue: '1000', documents: documentos, deadlines: [] });
  assert.equal(plan.updates.offer_value, 16760713273);
  assert.match(plan.lines[0], /Es provisional: sale del proyecto/);
  const sano = tenderOfficialValuesPlan({ opportunity: { offer_value: '8000000000' }, secopValue: '8000000000', documents: documentos, deadlines: [] });
  assert.equal(sano.updates.offer_value, undefined, 'con un valor razonable, el proyecto sigue sin contar');
});

// Rama Pereira (2026-11-14): al publicar el definitivo SECOP cambió de aviso (11107533 → 11222448) y los datos abiertos
// tardaron días. La persona pega el enlace nuevo en la Mesa y queda igual que si lo hubiera cambiado el Radar.
test('la Mesa cambia el enlace de SECOP que la persona pega: licitación, «Link fuente», seguimiento y constancia', async () => {
  const { enlaceSecopOficial } = await import('../verticales/licitaciones/agt002-mesa-acciones.js');
  const VIEJO = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11107533';
  const NUEVO = 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11222448';
  assert.equal(enlaceSecopOficial(`  ${NUEVO} `), NUEVO);
  assert.equal(enlaceSecopOficial('https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.11217040'), 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.11217040', 'el enlace de la entidad se lleva al público');
  assert.equal(enlaceSecopOficial('https://otro.sitio/?noticeUID=CO1.NTC.11222448'), null);
  assert.equal(enlaceSecopOficial('CO1.REQ.11251632'), null);

  const hecho = { updates: [], inserts: [], lineas: [] };
  const filas = {
    psi_public_tenders: { id: 't1', url: VIEJO, ref: 'LP-01-2026', status: 'Presentación de observaciones', deadline_at: '2026-11-26T00:00:00Z' },
    psi_sales_opportunities: { id: 'o1', observaciones: `Origen: SECOP II\nLink fuente: ${VIEJO}`, tender_offer_status: null },
  };
  const database = {
    rpc: async (_name, args) => { hecho.lineas.push(args.p_line); return { error: null }; },
    from: tabla => {
      const q = {
        select: () => q, eq: () => q, like: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: filas[tabla], error: null }),
        insert: async fila => { hecho.inserts.push({ tabla, ...fila }); return { error: null }; },
        update: cambios => ({ eq: async () => { hecho.updates.push({ tabla, ...cambios }); return { error: null }; } }),
      };
      return q;
    },
  };
  const mensaje = `El proceso cambió de link, este es el enlace nuevo: ${NUEVO}`;
  const accion = { tipo: 'corregir', campo: 'enlace_secop', valor: NUEVO, fuente: '', pedido_literal: 'este es el enlace nuevo' };
  const lineas = await ejecutarAgt002AccionesDeLaMesa(database, { ...BASE, mensaje, acciones: [accion] });
  assert.match(lineas[0], /Cambié el enlace de SECOP del aviso CO1\.NTC\.11107533 al CO1\.NTC\.11222448/);
  assert.equal(hecho.updates.find(row => row.tabla === 'psi_public_tenders').url, NUEVO);
  const obs = hecho.updates.find(row => row.tabla === 'psi_sales_opportunities').observaciones;
  assert.match(obs, /^Link fuente: .*CO1\.NTC\.11222448$/m);
  assert.match(obs, /^Link fuente histórico: .*CO1\.NTC\.11107533$/m);
  const marca = JSON.parse(hecho.inserts.find(row => row.tabla === 'psi_sales_interactions').notes);
  assert.equal(marca.kind, 'tender_phase_change_detected');
  assert.equal(marca.notice_uid, 'CO1.NTC.11222448');
  assert.equal(marca.origin, 'mesa');
  assert.match(hecho.lineas[0], /pasó del aviso CO1\.NTC\.11107533 al CO1\.NTC\.11222448/);

  filas.psi_public_tenders = { ...filas.psi_public_tenders, url: NUEVO };
  assert.match((await ejecutarAgt002AccionesDeLaMesa(database, { ...BASE, mensaje, acciones: [accion] }))[0], /ya era/);
  filas.psi_sales_opportunities = { ...filas.psi_sales_opportunities, tender_offer_status: 'presentada' };
  filas.psi_public_tenders = { ...filas.psi_public_tenders, url: VIEJO };
  assert.match((await ejecutarAgt002AccionesDeLaMesa(database, { ...BASE, mensaje, acciones: [accion] }))[0], /ya está presentada/);
  assert.match((await ejecutarAgt002AccionesDeLaMesa(database, { ...BASE, mensaje, acciones: [{ ...accion, valor: 'no sé' }] }))[0], /no es el enlace de un proceso/);
  assert.match(AGT002_MESA_ACCIONES_POLICY, /campo enlace_secop/);
});

// DEAJ LP-07-2026 (Juan, 2026-11-20): pegó el aviso de cambio de SECOP y, en el mensaje siguiente, pidió «la idea es que
// actualice el cronograma completo». El servidor toma el aviso literal del chat, mueve el cierre con su hora, lo guarda
// en el expediente (que pide el reanálisis) y deja la constancia.
const AVISO_DEAJ = `Respuesta a las observaciones al Pliego de Condiciones ha cambiado desde '20/11/2026 6:00:00 PM ((UTC-05:00) Bogotá, Lima, Quito)' hasta '23/11/2026 6:00:00 PM ((UTC-05:00) Bogotá, Lima, Quito)'
\tPlazo máximo para expedir adendas ha cambiado desde '20/11/2026 7:00:00 PM ((UTC-05:00) Bogotá, Lima, Quito)' hasta '23/11/2026 7:00:00 PM ((UTC-05:00) Bogotá, Lima, Quito)'
\tPresentación de Ofertas ha cambiado desde '26/11/2026 9:00:00 AM ((UTC-05:00) Bogotá, Lima, Quito)' hasta '27/11/2026 9:00:00 AM ((UTC-05:00) Bogotá, Lima, Quito)'
\tAudiencia de Adjudicación ha cambiado desde '11/12/2026 3:00:00 PM ((UTC-05:00) Bogotá, Lima, Quito)' hasta '14/12/2026 11:00:00 AM ((UTC-05:00) Bogotá, Lima, Quito)'
\tEl campo del proceso Pago de salarios - Fecha de vigencia (desde) ha cambiado desde 12/15/2026 00:00:00 hasta 12/16/2026 00:00:00

cambio el cronogramadel proceso podemos actualizar por favor`;

test('lee el aviso de cambio de SECOP: las fechas del cronograma, en hora de Colombia, sin los campos del contrato', async () => {
  const { leerAvisoDeCambioSecop, cierreDelAviso, fechaDelAviso } = await import('../verticales/licitaciones/agt002-mesa-cronograma.js');
  const cambios = leerAvisoDeCambioSecop(AVISO_DEAJ);
  assert.deepEqual(cambios.map(cambio => cambio.actividad), ['Respuesta a las observaciones al Pliego de Condiciones', 'Plazo máximo para expedir adendas', 'Presentación de Ofertas', 'Audiencia de Adjudicación']);
  assert.equal(cambios[0].hasta, '2026-11-23T18:00:00-05:00');
  assert.equal(cierreDelAviso(cambios).hasta, '2026-11-27T09:00:00-05:00');
  assert.equal(fechaDelAviso('2026-12-14T11:00:00-05:00'), '14-dic-2026 11:00 a. m.');
  assert.deepEqual(leerAvisoDeCambioSecop('la idea es que actualice el cronograma completo'), []);
});

function baseDeDatosPorTabla(filas) {
  const hecho = { updates: [], lineas: [] };
  return {
    hecho,
    rpc: async (nombre, args) => { hecho.lineas.push(args.p_line); return { error: null }; },
    from: tabla => {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: filas[tabla] ?? null, error: null }),
        update: cambios => ({ eq: async () => { hecho.updates.push({ tabla, ...cambios }); return { error: null }; } }),
      };
      return q;
    },
  };
}

test('la Mesa actualiza el cronograma con el aviso que la persona pegó antes: cierre con hora, expediente y constancia', async () => {
  const db = baseDeDatosPorTabla({
    psi_sales_opportunities: { id: 'o1', tender_offer_status: null },
    psi_public_tenders: { id: 't1', deadline_at: '2026-11-26T14:00:00.000Z', raw: { deadline_source: 'pliego', deadline: '2026-11-26' } },
  });
  const guardados = [];
  const MENSAJE_NUEVO = 'la idea es que actualice el cronograma completo';
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, ahora: new Date('2026-11-21T03:36:00Z'), mensaje: MENSAJE_NUEVO,
    textosDeLaPersona: [MENSAJE_NUEVO, AVISO_DEAJ],
    ingerirDocumento: async args => { guardados.push(args); return { analysis_request: { requested: true } }; },
    acciones: [{ tipo: 'corregir', campo: 'cronograma', valor: 'Cierre al 27-nov y respuestas al 23-nov', fuente: '', pedido_literal: 'actualice el cronograma completo' }] });
  const licitacion = db.hecho.updates.find(update => update.tabla === 'psi_public_tenders');
  assert.equal(licitacion.deadline_at, '2026-11-27T14:00:00.000Z');
  assert.equal(licitacion.raw.deadline, '2026-11-27');
  assert.equal(licitacion.raw.deadline_source, 'pliego', 'la fuente del pliego se conserva');
  assert.equal(licitacion.raw.deadline_mesa.by, 'Juan Botero');
  assert.equal(licitacion.raw.deadline_mesa.previous_deadline_at, '2026-11-26T14:00:00.000Z');
  assert.deepEqual(db.hecho.updates.find(update => update.tabla === 'psi_sales_opportunities'), { tabla: 'psi_sales_opportunities', expected_close_date: '2026-11-27' });
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].nombre, 'Aviso de cambio de cronograma SECOP 2026-11-20 2236.txt');
  assert.ok(guardados[0].texto.includes("hasta '27/11/2026 9:00:00 AM"), 'el aviso va literal');
  assert.equal(guardados[0].autorId, 'p1');
  assert.match(lineas[0], /^Moví el cierre: de 26-nov-2026 9:00 a\. m\. a 27-nov-2026 9:00 a\. m\./);
  assert.match(lineas[1], /Respuesta a las observaciones al Pliego de Condiciones: 23-nov-2026 6:00 p\. m\./);
  assert.match(lineas[2], /y pedí el reanálisis: cuando termine, Mi día queda con todas estas fechas/);
  assert.match(db.hecho.lineas[0], /cronograma actualizado con el aviso de cambio de SECOP/);
});

test('sin aviso en el chat, o con la oferta presentada, el cronograma no se toca', async () => {
  const sinAviso = baseDeDatosPorTabla({ psi_sales_opportunities: { id: 'o1', tender_offer_status: null } });
  const [linea] = await ejecutarAgt002AccionesDeLaMesa(sinAviso, { ...BASE, mensaje: 'actualice el cronograma completo', textosDeLaPersona: ['actualice el cronograma completo'],
    acciones: [{ tipo: 'corregir', campo: 'cronograma', valor: 'x', fuente: '', pedido_literal: 'actualice el cronograma completo' }] });
  assert.match(linea, /no encontré en este chat el aviso de cambio de SECOP/);
  const presentada = baseDeDatosPorTabla({ psi_sales_opportunities: { id: 'o1', tender_offer_status: 'presentada' } });
  const [otra] = await ejecutarAgt002AccionesDeLaMesa(presentada, { ...BASE, mensaje: 'actualice el cronograma completo', textosDeLaPersona: ['actualice el cronograma completo', AVISO_DEAJ],
    acciones: [{ tipo: 'corregir', campo: 'cronograma', valor: 'x', fuente: '', pedido_literal: 'actualice el cronograma completo' }] });
  assert.match(otra, /la oferta ya está presentada/);
  assert.equal(sinAviso.hecho.updates.length + presentada.hecho.updates.length, 0);
});

test('corregir el cierre en la Mesa mueve también el cierre con hora de la licitación, conservando la hora', async () => {
  const db = baseDeDatosPorTabla({
    psi_sales_opportunities: { id: 'o1', expected_close_date: '2026-11-26', tender_offer_status: null },
    psi_public_tenders: { id: 't1', deadline_at: '2026-11-26T14:00:00.000Z', raw: { deadline_source: 'pliego' } },
  });
  await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: 'corrija el cierre al 27', acciones: [{ tipo: 'corregir', campo: 'cierre', valor: '2026-11-27', fuente: 'aviso', pedido_literal: 'corrija el cierre' }] });
  assert.deepEqual(db.hecho.updates[0], { tabla: 'psi_sales_opportunities', expected_close_date: '2026-11-27' });
  assert.equal(db.hecho.updates[1].deadline_at, '2026-11-27T14:00:00.000Z');
  assert.equal(db.hecho.updates[1].raw.deadline_mesa.fuente, 'aviso');
});

test('si el cierre ya estaba en la fecha del aviso, la Mesa lo dice así, y no pone dos puntos seguidos', async () => {
  const db = baseDeDatosPorTabla({
    psi_sales_opportunities: { id: 'o1', tender_offer_status: null },
    psi_public_tenders: { id: 't1', deadline_at: '2026-11-27T14:00:00.000Z', raw: {} },
  });
  const lineas = await ejecutarAgt002AccionesDeLaMesa(db, { ...BASE, mensaje: 'actualice el cronograma completo', textosDeLaPersona: ['actualice el cronograma completo', AVISO_DEAJ],
    acciones: [{ tipo: 'corregir', campo: 'cronograma', valor: 'x', fuente: '', pedido_literal: 'actualice el cronograma completo' }] });
  assert.match(lineas[0], /^El cierre ya estaba en 27-nov-2026 9:00 a\. m\./);
  assert.ok(!lineas[1].includes('m..'), lineas[1]);
  assert.ok(!db.hecho.lineas[0].includes('m..'));
});
