import assert from 'node:assert/strict';
import test from 'node:test';

import { agt002DocumentRequestIntent, agt002ResolveRequestedDocument } from '../verticales/licitaciones/agt002-mesa-document-intent.js';
import { AGT002_DRAFT_DOCUMENT_SCHEMA } from '../verticales/licitaciones/agt002-workbench-responder.js';

// F16 (auditoría del piloto Fiscalía). El pedido real de Fiscalía (job `4ef8df10`): primero el texto pegado del pliego,
// al final «Con eso, redacta las observaciones…». Antes el detector no lo veía (más de 600 caracteres, verbo después de
// una coma, «observaciones» no era documento) y la carta se armó fuera del CRM.
const PEDIDO = `Te paso el texto literal del pliego definitivo, numeral 5.3.2, punto 1, páginas 37-38, que no te llega completo:\n\n«${'El oferente y posterior contratista debe contar y mantener la infraestructura física. '.repeat(14)}»\n\n`
  + 'Con eso, redacta las observaciones para radicar en SECOP antes de mañana 5 de noviembre a las 11:00 a. m. (hora Colombia). Texto formal, listo para pegar.';

test('caso Fiscalía: el pedido largo con «Con eso, redacta las observaciones» crea «Observaciones al pliego»', () => {
  assert.ok(PEDIDO.length > 600);
  const intent = agt002DocumentRequestIntent(PEDIDO);
  assert.equal(intent?.observaciones, true);
  assert.deepEqual(agt002ResolveRequestedDocument(intent, []), { action: 'create', title: 'Observaciones al pliego', key: 'observaciones_pliego' });
});

test('si ya existe, el pedido va sobre el mismo documento', () => {
  const existente = { id: 'a1', artifact_key: 'observaciones_pliego', title: 'Observaciones al pliego' };
  const decision = agt002ResolveRequestedDocument(agt002DocumentRequestIntent('Prepara las observaciones al pliego definitivo'), [existente, { id: 'a2', artifact_key: 'carta_presentacion', title: 'Carta de presentación' }]);
  assert.equal(decision.action, 'match');
  assert.equal(decision.artifact.id, 'a1');
});

test('preguntas y textos largos sin pedido al final no crean nada', () => {
  assert.equal(agt002DocumentRequestIntent('¿Ya están las observaciones?'), null);
  assert.equal(agt002DocumentRequestIntent(`${'texto pegado '.repeat(80)}\n\n¿Qué te parece?`), null);
  assert.equal(agt002DocumentRequestIntent('Sí, necesito revisar el cronograma'), null, 'una coma no basta: falta el documento');
});

test('la forma de la carta de observaciones está en las instrucciones del documento', () => {
  assert.match(AGT002_DRAFT_DOCUMENT_SCHEMA.description, /«Observaciones al pliego».*OBSERVACIÓN N.*firma del representante legal/);
});
