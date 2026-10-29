// La pantalla con la que Katherine crea un proceso que no está en SECOP, sin pasar por el chat (Juan, 2026-10-29).
// Prueba conductual sobre el HTML que React realmente renderiza, no sobre el texto fuente, más el espejo del permiso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

// `permissions.ts` se carga como lo hace tests/tender-configuration-permissions.test.mjs: compilado en memoria.
const permissionsBundle = buildSync({
  entryPoints: [new URL('../src/tenders/permissions.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { canCreateManualTenderProcess } = await import(`data:text/javascript;base64,${Buffer.from(permissionsBundle.outputFiles[0].contents).toString('base64')}`);

const TenderManualProcessForm = await loadReactComponent('src/tenders/components/TenderManualProcessForm.tsx', 'TenderManualProcessForm');

const html = renderReactComponent(TenderManualProcessForm, {
  request: async () => { throw new Error('la prueba no llama a la API'); },
  onCreated: () => {},
  onCancel: () => {},
});

test('el formulario pide sólo lo que no se puede adivinar', () => {
  // Tres obligatorios: plataforma, entidad y objeto.
  assert.equal((html.match(/required/g) || []).length, 3);
  for (const label of ['Plataforma donde está el proceso *', 'Entidad *', 'Objeto del proceso *']) {
    assert.ok(html.includes(label), `falta el campo obligatorio "${label}"`);
  }
  for (const label of ['Referencia del proceso', 'Ciudad', 'Departamento', 'Valor estimado (COP)', 'Fecha de cierre', 'Enlace del proceso', 'Notas']) {
    assert.ok(html.includes(label), `falta el campo opcional "${label}"`);
  }
});

test('dice qué se pierde si no hay fecha de cierre, en vez de obligar a inventarla', () => {
  assert.match(html, /Sin fecha de cierre el proceso no tiene reloj de vencimiento/);
  assert.match(html, /type="date"/);
});

test('promete el mismo seguimiento que un proceso del Radar', () => {
  assert.match(html, /expediente, documentos cargados a mano, análisis de Vig-IA, decisión y cierre/);
  assert.match(html, /Crear proceso/);
});

test('los campos quedan asociados a su etiqueta y el panel tiene nombre accesible', () => {
  assert.match(html, /aria-labelledby="tender-manual-process-heading"/);
  assert.match(html, /id="tender-manual-process-heading"/);
  // El idiom del módulo: la etiqueta envuelve su control, así que no hay control sin nombre.
  assert.ok(!/<input(?![^>]*type="date")[^>]*>\s*<\/label>\s*<input/.test(html));
});

test('crear a mano pide la misma custodia que convertir desde el Radar', () => {
  const katherine = { id: 'k', full_name: 'Katherine', role: 'comercial', active: true, permissions: ['licitaciones', 'licitaciones_custodia'] };
  assert.equal(canCreateManualTenderProcess(katherine), true);
  assert.equal(canCreateManualTenderProcess({ ...katherine, permissions: ['licitaciones'] }), false);
  assert.equal(canCreateManualTenderProcess({ ...katherine, role: 'consulta' }), false);
  assert.equal(canCreateManualTenderProcess({ ...katherine, active: false }), false);
  assert.equal(canCreateManualTenderProcess({ ...katherine, identity_type: 'agent' }), false);
  assert.equal(canCreateManualTenderProcess(null), false);
});
