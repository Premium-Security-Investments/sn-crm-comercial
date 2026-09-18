// AGT-002 governed document workset — extra run-level gating and disclosure contract, on top of
// the Phase 4 UI RED suite in tests/agt002-governed-document-workset-ui.test.mjs. Covers the
// `canRun`/`busy` freeze gates and the human-review/no-GO-NO-GO disclosure this component must
// carry even in isolation (main.tsx and TenderAnalysisSection are wired in a later phase, not
// here).
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { act } from 'react';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const DOCUMENTS = [
  { id: 'doc-current-ok', name: 'pliego.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok' },
];

async function clickNode(view, node) {
  await act(async () => { node.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true })); });
}

async function changeNode(view, node, value) {
  const proto = node.tagName === 'SELECT' ? view.window.HTMLSelectElement.prototype : view.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  await act(async () => {
    setter.call(node, value);
    node.dispatchEvent(new view.window.Event('input', { bubbles: true }));
    node.dispatchEvent(new view.window.Event('change', { bubbles: true }));
  });
}

async function fillOneValidUnconfirmedSelection(view) {
  const row = view.container.querySelector('.tender-governed-document-workset-row');
  await clickNode(view, row.querySelector('input[type="checkbox"]'));
  await changeNode(view, row.querySelector('select'), 'official');
  await changeNode(view, row.querySelector('input[type="text"]'), 'Documento base del proceso.');
}

test('canRun=false mantiene la CTA deshabilitada aunque la selección sea válida y esté confirmada', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: false,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    await fillOneValidUnconfirmedSelection(view);
    await clickNode(view, view.container.querySelector('.tender-governed-document-workset-confirm input[type="checkbox"]'));
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.equal(cta.disabled, true, 'canRun=false debe mantener la CTA deshabilitada pese a una selección válida y confirmada');
  } finally {
    await view.unmount();
  }
});

test('busy=true deshabilita la CTA, el input de archivo y los controles del fieldset', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.equal(cta.disabled, true, 'busy=true debe deshabilitar la CTA');
    const fileInput = view.container.querySelector('input[type="file"]');
    assert.equal(fileInput.disabled, true, 'busy=true debe deshabilitar el input de carga');
    const confirmCheckbox = view.container.querySelector('.tender-governed-document-workset-confirm input[type="checkbox"]');
    assert.equal(confirmCheckbox.disabled, true, 'busy=true debe deshabilitar la confirmación de congelamiento');
    const rowCheckbox = view.container.querySelector('.tender-governed-document-workset-row input[type="checkbox"]');
    assert.equal(rowCheckbox.disabled, true, 'busy=true debe deshabilitar el fieldset de documentos candidatos (extraction_status ok igualmente bloqueado mientras busy)');
  } finally {
    await view.unmount();
  }
});

test('declara el aviso de revisión humana y nunca registra ni autoriza GO / NO GO', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const html = renderReactComponent(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  assert.match(html, /revisi[oó]n humana/i, 'debe declarar explícitamente que la conclusión de AGT-002 requiere revisión humana');
  assert.match(html, /No registra ni autoriza GO \/ NO GO/, 'debe usar el disclaimer cerrado ya establecido en el resto del módulo de licitaciones');
  const buttonCount = (html.match(/<button/g) || []).length;
  assert.equal(buttonCount, 1, 'la única acción disponible debe ser la CTA de congelar el paquete; ningún botón GO/NO-GO debe existir');
  assert.doesNotMatch(html, />\s*(Registrar\s+)?(GO|NO[\s-]?GO)\s*</i, 'el texto visible de ningún control debe ofrecer registrar GO o NO GO');
});

test('cada campo de clasificación y motivo de un documento seleccionado está asociado a su label mediante htmlFor/id', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const row = view.container.querySelector('.tender-governed-document-workset-row');
    await clickNode(view, row.querySelector('input[type="checkbox"]'));
    const select = row.querySelector('select');
    const reasonInput = row.querySelector('input[type="text"]');
    assert.ok(select.id, 'el select de clasificación debe declarar un id');
    assert.ok(reasonInput.id, 'el input de motivo debe declarar un id');
    assert.ok(row.querySelector(`label[for="${select.id}"]`), 'debe existir un label asociado al select de clasificación vía htmlFor/id');
    assert.ok(row.querySelector(`label[for="${reasonInput.id}"]`), 'debe existir un label asociado al input de motivo vía htmlFor/id');
  } finally {
    await view.unmount();
  }
});

console.log('AGT-002 governed document workset run-gate/disclosure contract checked');
