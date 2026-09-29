// AGT-002 governed document workset builder — Phase 4 UI RED
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md). The component
// `src/tenders/components/TenderGovernedDocumentWorkset.tsx` does not exist yet, so
// `loadReactComponent` throws before any scenario runs.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const DOCUMENTS = [
  { id: 'doc-current-ok', name: 'pliego.pdf', size: 100, document_type: 'pliego', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok' },
  { id: 'doc-current-gap', name: 'anexo-escaneado.pdf', size: 100, document_type: 'anexo_tecnico', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'gap', extraction_gap_reason: 'El escaneo no tiene texto legible.' },
  { id: 'doc-historical', name: 'pliego-viejo.pdf', size: 100, document_type: 'pliego', current: false, uploaded_at: '2026-08-01T00:00:00.000Z', extraction_status: 'ok' },
];

test('lista sólo documentos vigentes, sin auto-seleccionar ninguno, y deshabilita los no elegibles con motivo visible', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const text = view.container.textContent || '';
    assert.match(text, /pliego\.pdf/, 'debe listar el documento vigente elegible');
    assert.match(text, /anexo-escaneado\.pdf/, 'debe listar el documento vigente inelegible (deshabilitado, no oculto)');
    assert.doesNotMatch(text, /pliego-viejo\.pdf/, 'nunca debe listar una versión histórica (current:false)');
    assert.match(text, /texto legible/i, 'debe mostrar el motivo de inelegibilidad exacto del documento');

    const checkboxes = [...view.container.querySelectorAll('input[type="checkbox"]')];
    const ineligibleCheckbox = checkboxes.find(el => el.disabled);
    assert.ok(ineligibleCheckbox, 'el checkbox del documento inelegible debe existir y estar disabled');
    assert.equal(checkboxes.filter(el => el.checked).length, 0, 'nada debe llegar preseleccionado: no auto-seleccionar todo');
  } finally {
    await view.unmount();
  }
});

test('el fieldset agrupa el selector con legend, y expone contador aria-live que explica el rango 1..12', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const html = renderReactComponent(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  assert.match(html, /<fieldset/);
  assert.match(html, /<legend/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /12/, 'debe mencionar el máximo de 12 documentos');
  assert.match(html, /m[ií]nimo 1/i, 'debe explicar el mínimo de 1 documento');
});

test('la CTA permanece deshabilitada hasta que cada documento seleccionado tenga clasificación cerrada, motivo y se confirme el congelamiento', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const freezeCalls = [];
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    onFreeze: async members => { freezeCalls.push(members); },
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.ok(cta, 'debe existir la CTA de congelar paquete');
    assert.equal(cta.disabled, true, 'debe iniciar deshabilitada: nada seleccionado');

    const eligibleRow = [...view.container.querySelectorAll('.tender-governed-document-workset-row')]
      .find(row => (row.textContent || '').includes('pliego.pdf'));
    const checkbox = eligibleRow.querySelector('input[type="checkbox"]');
    await act_click(view, checkbox);
    assert.equal(cta.disabled, true, 'sin clasificación ni motivo, sigue deshabilitada');

    const select = eligibleRow.querySelector('select');
    await act_change(view, select, 'official');
    assert.equal(cta.disabled, true, 'falta el motivo de inclusión');

    const reasonInput = eligibleRow.querySelector('input[type="text"], textarea');
    await act_change(view, reasonInput, 'Documento base del proceso.');
    assert.equal(cta.disabled, true, 'falta confirmar el congelamiento');

    const confirmCheckbox = view.container.querySelector('.tender-governed-document-workset-confirm input[type="checkbox"]');
    await act_click(view, confirmCheckbox);
    assert.equal(cta.disabled, false, 'con selección válida y confirmación, la CTA debe habilitarse');

    await view.click('.tender-governed-document-workset-cta');
    await view.flush();
    assert.equal(freezeCalls.length, 1);
    assert.deepEqual(freezeCalls[0], [{ document_version_id: 'doc-current-ok', source_classification: 'official', inclusion_reason: 'Documento base del proceso.' }]);
  } finally {
    await view.unmount();
  }
});

// Same robust technique as tests/tender-post-go-decision-and-readiness-ui.test.mjs: grab the real
// React onChange off the fiber's attached props (`__reactProps$...`) and invoke it directly,
// rather than trusting jsdom's native activation behavior for controlled checkbox/select/text
// inputs (unreliable across jsdom versions for React-controlled elements).
function reactOnChange(node) {
  const reactPropsKey = Object.keys(node).find(key => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'el nodo debe tener props de React adjuntas (__reactProps$...)');
  const onChange = node[reactPropsKey].onChange;
  assert.equal(typeof onChange, 'function', 'el nodo debe tener un onChange de React invocable');
  return onChange;
}
async function act_click(view, element) {
  const { act } = await import('react');
  const onChange = reactOnChange(element);
  await act(async () => {
    element.checked = !element.checked;
    onChange({ target: element, currentTarget: element });
  });
}
async function act_change(view, element, value) {
  const { act } = await import('react');
  const proto = element.tagName === 'SELECT' ? view.window.HTMLSelectElement.prototype : view.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const onChange = reactOnChange(element);
  await act(async () => {
    setter.call(element, value);
    onChange({ target: element, currentTarget: element });
  });
}

// Unlike act_click, this does NOT mutate element.checked before firing onChange. A disabled
// checkbox can never be actually activated by a user, so there is no native `checked` flip to
// simulate — we only want to prove the component's own guard rejects the change event itself.
async function act_fire_onchange_only(view, element) {
  const { act } = await import('react');
  const onChange = reactOnChange(element);
  await act(async () => {
    onChange({ target: element, currentTarget: element });
  });
}

test('al alcanzar 12 seleccionados, los checkboxes elegibles restantes se deshabilitan y no se puede seleccionar un 13.º documento', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const thirteenDocs = Array.from({ length: 13 }, (_, i) => ({
    id: `doc-${i}`, name: `doc-${i}.pdf`, size: 10, document_type: 'otro', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok',
  }));
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: thirteenDocs,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const checkboxes = [...view.container.querySelectorAll('.tender-governed-document-workset-row input[type="checkbox"]')];
    for (let i = 0; i < 12; i += 1) await act_click(view, checkboxes[i]);
    assert.equal(checkboxes.slice(0, 12).every(cb => cb.checked), true, 'los primeros 12 documentos elegibles deben quedar seleccionados');

    const thirteenth = checkboxes[12];
    assert.equal(thirteenth.checked, false, 'el 13.º documento no debe llegar seleccionado');
    assert.equal(thirteenth.disabled, true, 'el checkbox del 13.º documento debe deshabilitarse al alcanzar el máximo de 12');

    await act_fire_onchange_only(view, thirteenth);
    await view.flush();
    assert.equal(thirteenth.checked, false, 'el guard de selección debe impedir un 13.º documento aún si se dispara el evento de cambio');
    assert.equal(checkboxes.filter(cb => cb.checked).length, 12, 'sigue habiendo exactamente 12 documentos seleccionados');

    const text = view.container.textContent || '';
    assert.match(text, /13 archivos vigentes/, 'el contador debe comunicar el tamaño del corpus vigente (13), distinto del tope');
    assert.match(text, /12 seleccionados/, 'el contador debe comunicar cuántos documentos están seleccionados ahora mismo (12)');
    assert.match(text, /máximo 12/, 'el contador debe comunicar el tope duro (12) como máximo, no como total de documentos');
    assert.doesNotMatch(text, /12 de 12/, '12 es el tope, no el total de documentos vigentes: "12 de 12" comunicaría erróneamente que 12 es también el tamaño del corpus');
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.equal(cta.disabled, true, 'sin clasificación, motivo ni confirmación para los 12 seleccionados, la CTA sigue deshabilitada');
  } finally {
    await view.unmount();
  }
});

test('el contador distingue el tamaño del corpus vigente (17) de la selección actual (0) y del tope (12), incluso sin seleccionar nada', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const seventeenDocs = Array.from({ length: 17 }, (_, i) => ({
    id: `doc-${i}`, name: `doc-${i}.pdf`, size: 10, document_type: 'otro', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok',
  }));
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: seventeenDocs,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const text = view.container.textContent || '';
    assert.match(text, /17 archivos vigentes/, 'el contador debe comunicar el tamaño real del corpus vigente (17)');
    assert.match(text, /0 seleccionados/, 'el contador debe comunicar que no hay ninguno seleccionado todavía');
    assert.match(text, /máximo 12/, 'el contador debe seguir comunicando el tope duro (12), sin confundirlo con el tamaño del corpus');
    assert.doesNotMatch(text, /12 de 12/, 'el tope nunca debe presentarse como si fuera el total de documentos vigentes');
  } finally {
    await view.unmount();
  }
});

test('un upload nuevo no expande silenciosamente la selección existente', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  let uploadCalls = 0;
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => { uploadCalls += 1; },
  });
  try {
    await view.flush();
    const eligibleRow = [...view.container.querySelectorAll('.tender-governed-document-workset-row')]
      .find(row => (row.textContent || '').includes('pliego.pdf'));
    await act_click(view, eligibleRow.querySelector('input[type="checkbox"]'));

    const fileInput = view.container.querySelector('input[type="file"]');
    assert.ok(fileInput, 'debe existir un input de archivo para cargar un documento nuevo antes de congelar');
    const file = new view.window.File(['contenido'], 'nuevo.pdf', { type: 'application/pdf' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    const { act } = await import('react');
    await act(async () => { fileInput.dispatchEvent(new view.window.Event('change', { bubbles: true })); });
    await view.flush();
    assert.equal(uploadCalls, 1, 'debe invocar el manejador de carga pasado por props');

    const checkedAfterUpload = [...view.container.querySelectorAll('.tender-governed-document-workset-row input[type="checkbox"]')].filter(el => el.checked);
    assert.equal(checkedAfterUpload.length, 1, 'la carga en sí no debe alterar la selección existente');
  } finally {
    await view.unmount();
  }
});

test('un documento agregado a `documents` tras un upload nunca llega preseleccionado', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const grownDocuments = [...DOCUMENTS, { id: 'doc-new', name: 'nuevo.pdf', size: 10, document_type: 'otro', current: true, uploaded_at: '2026-09-01T00:00:00.000Z', extraction_status: 'ok' }];
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: grownDocuments,
    busy: false,
    canRun: true,
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const newRow = [...view.container.querySelectorAll('.tender-governed-document-workset-row')].find(row => (row.textContent || '').includes('nuevo.pdf'));
    assert.ok(newRow, 'el documento recién cargado debe listarse como candidato');
    const newCheckbox = newRow.querySelector('input[type="checkbox"]');
    assert.equal(newCheckbox.checked, false, 'el documento nuevo nunca debe llegar preseleccionado tras un upload');
  } finally {
    await view.unmount();
  }
});

test('el checkbox de confirmación declara el texto exacto de congelamiento y nueva corrida', () => {
  const source = read('src/tenders/components/TenderGovernedDocumentWorkset.tsx');
  assert.match(source, /AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY/, 'debe reutilizar la copia cerrada del modelo puro, no un texto ad hoc');
  assert.match(source, /governedWorksetSelection/);
});

// --- Feedback (statusText/statusTone) debe vivir junto a la CTA, no sólo arriba de la lista ------
// Hoy el único feedback visible sobre esta corrida vive en TenderAnalysisSection, por encima de
// esta lista larga de candidatos. Estos props (futuros: statusText/statusTone/runState) deben
// permitir que TenderGovernedDocumentWorkset repita ese mismo feedback pegado a su propia CTA,
// para que Licitaciones no tenga que desplazarse hacia arriba para ver por qué la corrida avanza
// o falló justo después de pulsar el botón.

test('con statusText/statusTone="status", el feedback se anuncia con role="status" pegado a la CTA, no sólo arriba de la lista de candidatos', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    statusText: 'Congelando el paquete y enviándolo a análisis…',
    statusTone: 'status',
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    assert.ok(cta, 'debe existir la CTA');
    const feedback = [...view.container.querySelectorAll('[role="status"]')]
      .find(node => (node.textContent || '').includes('Congelando el paquete'));
    assert.ok(feedback, 'debe existir un nodo role="status" con el texto de statusText recibido por props');
    assert.equal(feedback.parentElement, cta.parentElement, 'el feedback debe vivir en el mismo contenedor inmediato que la CTA, no sólo arriba de la lista de candidatos');
    const fieldset = view.container.querySelector('.tender-governed-document-workset-fieldset');
    const { DOCUMENT_POSITION_FOLLOWING } = view.window.Node;
    assert.ok(
      Boolean(fieldset.compareDocumentPosition(feedback) & DOCUMENT_POSITION_FOLLOWING),
      'el feedback debe aparecer después de la lista de candidatos (fieldset), junto a la CTA — no únicamente en un bloque anterior a la lista larga',
    );
  } finally {
    await view.unmount();
  }
});

test('con statusTone="error", el mismo feedback junto a la CTA se anuncia con role="alert"', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const view = mountWithJsdom(TenderGovernedDocumentWorkset, {
    documents: DOCUMENTS,
    busy: false,
    canRun: true,
    statusText: 'El análisis no pudo completarse.',
    statusTone: 'error',
    onFreeze: async () => {},
    onUploadFiles: async () => {},
  });
  try {
    await view.flush();
    const cta = view.container.querySelector('.tender-governed-document-workset-cta');
    const feedback = [...view.container.querySelectorAll('[role="alert"]')]
      .find(node => (node.textContent || '').includes('El análisis no pudo completarse.'));
    assert.ok(feedback, 'un error debe anunciarse con role="alert", no role="status"');
    assert.equal(feedback.parentElement, cta.parentElement, 'el feedback de error también debe vivir pegado a la CTA');
    const duplicatedAsStatus = [...view.container.querySelectorAll('[role="status"]')]
      .some(node => (node.textContent || '').includes('El análisis no pudo completarse.'));
    assert.equal(duplicatedAsStatus, false, 'el mensaje de error no debe duplicarse también en un nodo role="status" (el rol accesible debe ser alert, no status)');
  } finally {
    await view.unmount();
  }
});

// --- runState controla el rótulo explícito de la CTA y bloquea clics duplicados en fases ocupadas
test('runState determina el rótulo explícito de la CTA y deshabilita la CTA (sin permitir onFreeze) en cada fase ocupada', async () => {
  const TenderGovernedDocumentWorkset = await loadReactComponent(
    'src/tenders/components/TenderGovernedDocumentWorkset.tsx',
    'TenderGovernedDocumentWorkset',
  );
  const cases = [
    { runState: undefined, label: /Congelar paquete y ejecutar AGT-002/, disabled: false },
    { runState: 'freezing', label: /Congelando…/, disabled: true },
    { runState: 'queued', label: /Paquete congelado · En cola/, disabled: true },
    { runState: 'running', label: /Análisis en curso/, disabled: true },
  ];
  for (const { runState, label, disabled } of cases) {
    let freezeCalls = 0;
    const props = {
      documents: DOCUMENTS,
      busy: false,
      canRun: true,
      onFreeze: async () => { freezeCalls += 1; },
      onUploadFiles: async () => {},
    };
    if (runState !== undefined) props.runState = runState;
    const view = mountWithJsdom(TenderGovernedDocumentWorkset, props);
    try {
      await view.flush();
      // Selección completa y confirmada, para que cualquier diferencia de rótulo/disabled se
      // deba únicamente a runState, no a los errores de validación de la selección misma.
      const eligibleRow = [...view.container.querySelectorAll('.tender-governed-document-workset-row')]
        .find(row => (row.textContent || '').includes('pliego.pdf'));
      await act_click(view, eligibleRow.querySelector('input[type="checkbox"]'));
      await act_change(view, eligibleRow.querySelector('select'), 'official');
      await act_change(view, eligibleRow.querySelector('input[type="text"], textarea'), 'Documento base del proceso.');
      await act_click(view, view.container.querySelector('.tender-governed-document-workset-confirm input[type="checkbox"]'));

      const cta = view.container.querySelector('.tender-governed-document-workset-cta');
      assert.match(cta.textContent || '', label, `runState=${runState} debe mostrar su rótulo explícito de CTA`);
      assert.equal(cta.disabled, disabled, `runState=${runState}: el estado disabled de la CTA no coincide con el contrato`);

      if (disabled) {
        await view.click('.tender-governed-document-workset-cta');
        await view.flush();
        assert.equal(freezeCalls, 0, `runState=${runState} es una fase ocupada: no debe permitir un clic duplicado que invoque onFreeze`);
      }
    } finally {
      await view.unmount();
    }
  }
});

console.log('AGT-002 governed document workset UI contract (RED until the component exists) checked');
