import test from 'node:test';
import assert from 'node:assert/strict';
import { runTenderDocumentOcrPass, paseSinCambios, PASE_COMPLETO_CADA_MS } from '../verticales/licitaciones/tender-document-ocr.js';

// Los pases de OCR se saltan cuando nada cambió (2026-11-20): antes descargaban el texto de todos los documentos cada
// 2 minutos para concluir que no había nada que hacer.

function baseFalsa() {
  const tablas = {
    psi_sales_opportunities: [{ id: 'o1', service_type_code: 'licitacion_publica', archived_at: null }],
    psi_tender_document_versions: [{ id: 'v1', opportunity_id: 'o1', name: 'pliego.pdf', mime_type: 'application/pdf', storage_path: 'x', current: true, extracted_text: 'texto suficiente '.repeat(20), created_at: '2026-11-01T00:00:00Z', origin: 'entidad' }],
    psi_tender_document_extractions: [],
    psi_agt002_pase_huellas: [],
  };
  const lecturasDeTexto = { n: 0 };
  function consulta(tabla) {
    let columnas = '';
    let soloConteo = false;
    let limite = null;
    const filtros = [];
    const filas = () => tablas[tabla].filter(f => filtros.every(fn => fn(f)));
    const q = {
      select(c, opciones = {}) { columnas = c; soloConteo = Boolean(opciones.head); return q; },
      eq(c, v) { filtros.push(f => f[c] === v); return q; },
      is(c, v) { filtros.push(f => (f[c] ?? null) === v); return q; },
      in(c, vs) { filtros.push(f => vs.includes(f[c])); return q; },
      order() { return q; },
      limit(n) { limite = n; return q; },
      upsert(fila) { tablas[tabla] = tablas[tabla].filter(f => f.pase !== fila.pase).concat(fila); return Promise.resolve({ error: null }); },
      delete() { return { eq: (c, v) => { tablas[tabla] = tablas[tabla].filter(f => f[c] !== v); return Promise.resolve({ error: null }); } }; },
      then(ok, mal) {
        if (columnas.includes('extracted_text')) lecturasDeTexto.n += 1;
        if (soloConteo) return Promise.resolve({ count: filas().length, error: null }).then(ok, mal);
        const datos = limite === null ? filas() : filas().slice(0, limite);
        return Promise.resolve({ data: datos, error: null }).then(ok, mal);
      },
    };
    return q;
  }
  return { tablas, lecturasDeTexto, from: consulta, rpc: async () => ({ error: null }), storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from('%PDF')]), error: null }) }) } };
}

test('sin candidatos, el pase siguiente con la misma huella se salta sin leer textos', async () => {
  const db = baseFalsa();
  const primero = await runTenderDocumentOcrPass(db, { ocr: async () => { throw new Error('no debía'); } });
  assert.deepEqual(primero, [{ event: 'tender_ocr_idle' }]);
  const leidas = db.lecturasDeTexto.n;
  assert.ok(leidas > 0, 'el primer pase sí lee los textos');
  assert.equal(db.tablas.psi_agt002_pase_huellas.length, 1);
  const segundo = await runTenderDocumentOcrPass(db, { ocr: async () => { throw new Error('no debía'); } });
  assert.deepEqual(segundo, [{ event: 'tender_ocr_idle', sin_cambios: true }]);
  assert.equal(db.lecturasDeTexto.n, leidas, 'el segundo pase no descargó ningún texto');
});

test('un documento nuevo cambia la huella y el pase vuelve a mirar todo', async () => {
  const db = baseFalsa();
  await runTenderDocumentOcrPass(db, {});
  db.tablas.psi_tender_document_versions.push({ id: 'v2', opportunity_id: 'o1', name: 'anexo.pdf', mime_type: 'application/pdf', storage_path: 'y', current: true, extracted_text: '', created_at: '2026-11-20T00:00:00Z', origin: 'entidad' });
  const vistos = [];
  const eventos = await runTenderDocumentOcrPass(db, { ocr: async () => { vistos.push('ocr'); return { text: '--- página 1 ---\n' + 'Pliego de condiciones del proceso de vigilancia. '.repeat(10), pages: 1 }; } });
  assert.equal(vistos.length, 1, 'le pasó OCR al documento nuevo');
  assert.ok(eventos.some(e => e.event === 'tender_ocr_recorded'));
  assert.equal(db.tablas.psi_agt002_pase_huellas.length, 0, 'con candidatos se olvida la huella: el siguiente pase mira todo');
});

test('una vez por hora el pase corre completo aunque la huella no cambie', async () => {
  const db = baseFalsa();
  db.tablas.psi_agt002_pase_huellas.push({ pase: 'ocr', huella: 'h', completo_en: new Date(Date.now() - PASE_COMPLETO_CADA_MS - 1000).toISOString() });
  assert.equal(await paseSinCambios(db, 'ocr', 'h'), false);
  db.tablas.psi_agt002_pase_huellas[0].completo_en = new Date().toISOString();
  assert.equal(await paseSinCambios(db, 'ocr', 'h'), true);
  assert.equal(await paseSinCambios(db, 'ocr', 'otra'), false);
});
