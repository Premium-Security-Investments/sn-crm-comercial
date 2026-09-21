// AGT-002 governed document workset — extra run-level gating and disclosure contract, on top of
// the Phase 4 UI RED suite in tests/agt002-governed-document-workset-ui.test.mjs. Covers the
// `canRun`/`busy` freeze gates and the human-review/no-GO-NO-GO disclosure this component must
// carry even in isolation (main.tsx and TenderAnalysisSection are wired in a later phase, not
// here).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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

// mountWithJsdom importa react-dom antes de instalar los globales de jsdom, así que los eventos
// 'input'/'change' despachados aquí nunca llegan al onChange sintético de React. El puente es la
// prop React adjunta al nodo montado (`__reactProps$...`): devuelve el onChange REAL del árbol.
// Mismo patrón establecido en tests/tender-post-go-decision-and-readiness-ui.test.mjs.
function reactOnChange(node, label) {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, `${label} debe tener props de React adjuntas (__reactProps$...)`);
  const onChange = node[reactPropsKey].onChange;
  assert.equal(typeof onChange, 'function', `${label} debe tener un onChange de React invocable`);
  return onChange;
}

async function changeNode(view, node, value) {
  const proto = node.tagName === 'SELECT' ? view.window.HTMLSelectElement.prototype : view.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const onChange = reactOnChange(node, 'el campo');
  await act(async () => {
    setter.call(node, value);
    onChange({ target: node, currentTarget: node });
  });
}

async function fillOneValidUnconfirmedSelection(view) {
  const row = view.container.querySelector('.tender-governed-document-workset-row');
  await clickNode(view, row.querySelector('input[type="checkbox"]'));
  await changeNode(view, row.querySelector('select'), 'official');
  await changeNode(view, row.querySelector('input[type="text"]'), 'Documento base del proceso.');
}

test('canRun=false mantiene la CTA deshabilitada aunque la selección sea válida y esté confirmada, y handleFreeze falla cerrado aunque se fuerce el clic', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  let onFreezeCalls = 0;
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: false,
    onFreeze: async () => { onFreezeCalls += 1; },
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    await fillOneValidUnconfirmedSelection(view);
    await clickNode(view, view.container.querySelector('.tender-governed-document-workset-confirm input[type="checkbox"]'));
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.equal(cta.disabled, true, 'canRun=false debe mantener la CTA deshabilitada pese a una selección válida y confirmada');
    assert.equal(onFreezeCalls, 0, 'onFreeze no debe haberse invocado todavía');

    // La CTA deshabilitada ya impide el clic en un navegador real, pero eso solo prueba el
    // atributo `disabled`. Forzamos el DOM a un estado inconsistente (disabled=false) y
    // disparamos el clic directamente para probar que el propio handleFreeze —no solo el
    // atributo disabled del botón— falla cerrado cuando canRun es false.
    cta.disabled = false;
    await clickNode(view, cta);
    assert.equal(onFreezeCalls, 0, 'handleFreeze debe fallar cerrado y no invocar onFreeze cuando canRun=false, incluso si el clic se fuerza pese al atributo disabled');
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

test('agrupa las filas seleccionadas preservando el orden original y conserva clasificación/motivo de cada selección tras el reordenamiento', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const FOUR_DOCUMENTS = [
    { id: 'doc-a', name: 'documento-a.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok' },
    { id: 'doc-b', name: 'documento-b.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:01:00.000Z', extraction_status: 'ok' },
    { id: 'doc-c', name: 'documento-c.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:02:00.000Z', extraction_status: 'ok' },
    { id: 'doc-d', name: 'documento-d.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:03:00.000Z', extraction_status: 'ok' },
  ];

  function rowNames(view) {
    return Array.from(view.container.querySelectorAll('.tender-governed-document-workset-row'))
      .map(row => row.querySelector('label > span')?.textContent);
  }

  // Rows reorder as selections change, so every lookup after a mutation must re-find the row by
  // its visible filename rather than reuse a node/index captured before the reorder.
  function findRowByName(view, name) {
    const row = Array.from(view.container.querySelectorAll('.tender-governed-document-workset-row'))
      .find(candidate => candidate.querySelector('label > span')?.textContent === name);
    assert.ok(row, `no se encontró la fila de ${name}`);
    return row;
  }

  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: FOUR_DOCUMENTS,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    assert.deepEqual(
      rowNames(view),
      ['documento-a.pdf', 'documento-b.pdf', 'documento-c.pdf', 'documento-d.pdf'],
      'el orden inicial debe respetar el orden original A,B,C,D',
    );

    const rowB = findRowByName(view, 'documento-b.pdf');
    await clickNode(view, rowB.querySelector('input[type="checkbox"]'));
    const rowBAfterCheck = findRowByName(view, 'documento-b.pdf');
    await changeNode(view, rowBAfterCheck.querySelector('select'), 'official');
    await changeNode(view, rowBAfterCheck.querySelector('input[type="text"]'), 'Motivo B: pliego vigente.');

    const rowD = findRowByName(view, 'documento-d.pdf');
    await clickNode(view, rowD.querySelector('input[type="checkbox"]'));
    const rowDAfterCheck = findRowByName(view, 'documento-d.pdf');
    await changeNode(view, rowDAfterCheck.querySelector('select'), 'corporate');
    await changeNode(view, rowDAfterCheck.querySelector('input[type="text"]'), 'Motivo D: anexo corporativo.');

    assert.deepEqual(
      rowNames(view),
      ['documento-b.pdf', 'documento-d.pdf', 'documento-a.pdf', 'documento-c.pdf'],
      'las filas seleccionadas (B, D) deben agruparse primero preservando su orden original entre sí, seguidas de las no seleccionadas (A, C) en su orden original',
    );

    const finalRowB = findRowByName(view, 'documento-b.pdf');
    assert.equal(finalRowB.querySelector('input[type="checkbox"]').checked, true, 'B debe seguir seleccionado tras el reordenamiento');
    assert.equal(finalRowB.querySelector('select').value, 'official', 'la clasificación de B debe sobrevivir al reordenamiento');
    assert.equal(finalRowB.querySelector('input[type="text"]').value, 'Motivo B: pliego vigente.', 'el motivo de B debe sobrevivir al reordenamiento');

    const finalRowD = findRowByName(view, 'documento-d.pdf');
    assert.equal(finalRowD.querySelector('input[type="checkbox"]').checked, true, 'D debe seguir seleccionado tras el reordenamiento');
    assert.equal(finalRowD.querySelector('select').value, 'corporate', 'la clasificación de D debe sobrevivir al reordenamiento');
    assert.equal(finalRowD.querySelector('input[type="text"]').value, 'Motivo D: anexo corporativo.', 'el motivo de D debe sobrevivir al reordenamiento');

    const finalRowA = findRowByName(view, 'documento-a.pdf');
    assert.equal(finalRowA.querySelector('input[type="checkbox"]').checked, false, 'A no debe estar seleccionado');
    const finalRowC = findRowByName(view, 'documento-c.pdf');
    assert.equal(finalRowC.querySelector('input[type="checkbox"]').checked, false, 'C no debe estar seleccionado');
  } finally {
    await view.unmount();
  }
});

test('handleFreeze falla cerrado sobre el predicado completo canFreeze (errors + canRun + !busy), no sólo sobre errors.length', () => {
  const source = readFileSync(
    new URL('../src/tenders/components/TenderGovernedDocumentWorkset.tsx', import.meta.url),
    'utf8',
  );
  const handleFreezeMatch = source.match(/const handleFreeze = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(handleFreezeMatch, 'debe existir la función handleFreeze en el componente');
  assert.match(
    handleFreezeMatch[0],
    /if\s*\(\s*!canFreeze\s*\)\s*return;[\s\S]*onFreeze\(/,
    'handleFreeze debe fallar cerrado comprobando el predicado completo canFreeze (que ya incluye errors, canRun y !busy) antes de invocar onFreeze, en vez de repetir sólo la comprobación de errors.length',
  );
});

console.log('AGT-002 governed document workset run-gate/disclosure contract checked');
