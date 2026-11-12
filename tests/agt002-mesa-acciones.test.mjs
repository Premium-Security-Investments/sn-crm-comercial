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
