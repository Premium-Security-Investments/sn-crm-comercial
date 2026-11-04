import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { agt002DocumentRequestIntent, agt002ResolveRequestedDocument } from '../verticales/licitaciones/agt002-mesa-document-intent.js';

// Los once que siembra el GO, y los anexos que Juan puso a mano en Terminal el 30-oct.
const SEED = ['Carta de presentación', 'Checklist maestro de documentos', 'Correo a contabilidad con pendientes financieros', 'Correo a jurídico con pendientes legales', 'Declaración de no inhabilidades', 'Copia de documentos oficiales SECOP', 'Índice del expediente', 'Matriz de cumplimiento', 'Propuesta técnica base', 'Resumen para gerencia', 'Solicitud de póliza de seriedad a aseguradora']
  .map((title, index) => ({ id: `s${index}`, title }));
const TERMINAL = [...SEED, { id: 't7', title: 'Anexo 7 · Certificaciones de experiencia' }, { id: 't7a', title: 'Anexo 7A · Experiencia adicional ponderable' }, { id: 't2', title: 'Anexo 2 · Compromiso de transparencia' }];
const resolve = (message, artifacts = SEED) => agt002ResolveRequestedDocument(agt002DocumentRequestIntent(message), artifacts);

test('los dos pedidos del encargo, en las palabras de Katherine', () => {
  assert.equal(resolve('necesito la carta de presentación').artifact.title, 'Carta de presentación');
  assert.equal(resolve('ármame el anexo de experiencia', TERMINAL).artifact.id, 't7');
});

test('el número de anexo manda sobre las palabras', () => {
  assert.equal(resolve('hazme el anexo 7A', TERMINAL).artifact.id, 't7a');
  assert.equal(resolve('Redacta el Anexo No. 2 para este proceso', TERMINAL).artifact.id, 't2');
});

test('un documento que el expediente no tiene se crea con el nombre que se pidió', () => {
  const result = resolve('Prepárame el anexo de apoyo a la industria nacional');
  assert.equal(result.action, 'create');
  assert.equal(result.title, 'Anexo de apoyo a la industria nacional');
  assert.equal(result.key, 'vigia_anexo_de_apoyo_a_la_industria_nacional');
});

test('preguntas y conversación no son pedidos', () => {
  for (const message of ['¿Ya está la carta de presentación?', 'cuál es el plazo de la póliza', 'La carta de presentación la firma el gerente', 'qué dice el anexo 7', 'necesito saber el cierre']) {
    assert.equal(resolve(message), null, message);
  }
});

test('si no dice cuál, o dos empatan, no se adivina', () => {
  assert.equal(resolve('necesito un anexo'), null);
  assert.equal(resolve('necesito el correo', SEED), null, 'contabilidad y jurídico empatan');
  assert.equal(resolve('necesito el correo a jurídico').artifact.title, 'Correo a jurídico con pendientes legales');
});
