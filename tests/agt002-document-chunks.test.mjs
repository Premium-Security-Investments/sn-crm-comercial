import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  AGT002_CHUNK_MAX_CHARS,
  AGT002_CHUNK_OVERLAP_CHARS,
  buildAgt002DocumentChunks,
} from '../agt002-document-chunks.js';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function baseDoc(overrides = {}) {
  return {
    document_id: 'doc-1',
    document_version_id: 'ver-1',
    opportunity_id: 'opp-1',
    snapshot_id: null,
    document_type: 'pliego',
    name: 'Pliego de condiciones.pdf',
    version: 1,
    content_hash: hash('pliego-content-v1'),
    current: true,
    extracted_text: 'Objeto del contrato: vigilancia física.',
    ...overrides,
  };
}

assert.ok(AGT002_CHUNK_MAX_CHARS > AGT002_CHUNK_OVERLAP_CHARS);
assert.ok(AGT002_CHUNK_OVERLAP_CHARS > 0);

// 1) Un documento simple produce exactamente un chunk con IDs cerrados y deterministas.
{
  const { chunks, gaps } = buildAgt002DocumentChunks([baseDoc()]);
  assert.equal(gaps.length, 0);
  assert.equal(chunks.length, 1);
  const chunk = chunks[0];
  assert.equal(chunk.chunk_id, 'chunk:ver-1:p1:s1:c0');
  assert.equal(chunk.evidence_ref, 'evidence:chunk:ver-1:p1:s1:c0');
  assert.equal(chunk.document_id, 'doc-1');
  assert.equal(chunk.document_version_id, 'ver-1');
  assert.equal(chunk.opportunity_id, 'opp-1');
  assert.equal(chunk.snapshot_id, null);
  assert.equal(chunk.document_type, 'pliego');
  assert.equal(chunk.page, 1);
  assert.equal(chunk.section, 1);
  assert.equal(chunk.chunk_index, 0);
  assert.equal(chunk.text, 'Objeto del contrato: vigilancia física.');
  assert.equal(chunk.chunk_hash, hash(chunk.text));
  assert.equal(chunk.current, true);
  assert.equal(chunk.precedence, 'base');
  assert.equal(chunk.superseded_by_addendum, false);
}

// 2) Determinismo: llamar dos veces con el mismo documento produce IDs y hashes idénticos.
{
  const runA = buildAgt002DocumentChunks([baseDoc()]);
  const runB = buildAgt002DocumentChunks([baseDoc()]);
  assert.deepEqual(runA.chunks.map(c => c.chunk_id), runB.chunks.map(c => c.chunk_id));
  assert.deepEqual(runA.chunks.map(c => c.chunk_hash), runB.chunks.map(c => c.chunk_hash));
}

// 3) Páginas (separadas por form-feed) y secciones (separadas por línea en blanco) generan metadatos distintos.
{
  const text = 'Página uno, sección uno.\n\nPágina uno, sección dos.\f Página dos, sección uno.';
  const { chunks } = buildAgt002DocumentChunks([baseDoc({ extracted_text: text })]);
  assert.equal(chunks.length, 3);
  const byKey = Object.fromEntries(chunks.map(c => [`${c.page}:${c.section}`, c]));
  assert.equal(byKey['1:1'].text, 'Página uno, sección uno.');
  assert.equal(byKey['1:2'].text, 'Página uno, sección dos.');
  assert.equal(byKey['2:1'].text, 'Página dos, sección uno.');
}

// 4) Límite máximo y overlap verificables: una sección más larga que el máximo produce
//    varias ventanas, ninguna excede el máximo, y el traslape exacto se repite entre ventanas consecutivas.
{
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let long = '';
  while (long.length < AGT002_CHUNK_MAX_CHARS * 2 + 500) long += alphabet;
  const { chunks } = buildAgt002DocumentChunks([baseDoc({ extracted_text: long })]);
  assert.ok(chunks.length >= 3, 'un texto largo debe producir varias ventanas');
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= AGT002_CHUNK_MAX_CHARS, 'ningún chunk debe exceder el máximo configurado');
    assert.ok(chunk.text.length > 0);
  }
  for (let i = 0; i < chunks.length - 1; i += 1) {
    const tail = chunks[i].text.slice(-AGT002_CHUNK_OVERLAP_CHARS);
    const head = chunks[i + 1].text.slice(0, AGT002_CHUNK_OVERLAP_CHARS);
    assert.equal(tail, head, `el traslape entre chunk ${i} y ${i + 1} debe ser exacto`);
  }
  // Reconstructing text by skipping the known overlap between consecutive chunks recovers the source.
  let rebuilt = chunks[0].text;
  for (let i = 1; i < chunks.length; i += 1) rebuilt += chunks[i].text.slice(AGT002_CHUNK_OVERLAP_CHARS);
  assert.equal(rebuilt, long);
}

// 5) Documento vacío/ilegible se convierte en un gap explícito, no en un chunk fantasma.
{
  const empty = buildAgt002DocumentChunks([baseDoc({ document_id: 'doc-empty', document_version_id: 'ver-empty', extracted_text: '   \n\n  ' })]);
  assert.equal(empty.chunks.length, 0);
  assert.equal(empty.gaps.length, 1);
  assert.equal(empty.gaps[0].gap_id, 'gap:ver-empty');
  assert.equal(empty.gaps[0].reason, 'empty_document');
  assert.equal(empty.gaps[0].document_id, 'doc-empty');

  const illegible = buildAgt002DocumentChunks([baseDoc({
    document_id: 'doc-illegible', document_version_id: 'ver-illegible',
    extracted_text: ' %%%%%% ###### ------ ////// ',
  })]);
  assert.equal(illegible.chunks.length, 0);
  assert.equal(illegible.gaps.length, 1);
  assert.equal(illegible.gaps[0].reason, 'illegible_document');
}

// 6) Orden estable: el resultado no depende del orden de entrada de los documentos.
{
  const docA = baseDoc({ document_id: 'doc-a', document_version_id: 'ver-a' });
  const docB = baseDoc({ document_id: 'doc-b', document_version_id: 'ver-b', extracted_text: 'Otro documento distinto.' });
  const forward = buildAgt002DocumentChunks([docA, docB]);
  const backward = buildAgt002DocumentChunks([docB, docA]);
  assert.deepEqual(forward.chunks.map(c => c.chunk_id), backward.chunks.map(c => c.chunk_id));
  assert.deepEqual([...forward.chunks.map(c => c.chunk_id)].sort(), forward.chunks.map(c => c.chunk_id));
}

// 7) Deduplicación determinística por versión/hash: repetir exactamente el mismo documento
//    (misma document_version_id + content_hash) no duplica chunks.
{
  const doc = baseDoc();
  const { chunks } = buildAgt002DocumentChunks([doc, { ...doc }]);
  assert.equal(chunks.length, 1);
}

// 7b) Misma document_version_id con content_hash distinto es una violación de integridad.
{
  const doc = baseDoc();
  assert.throws(
    () => buildAgt002DocumentChunks([doc, { ...doc, content_hash: hash('otro-contenido'), extracted_text: 'Texto distinto.' }]),
    /integridad|hash/i,
  );
}

// 8) Nueva versión de un documento (misma identidad lógica, distinta document_version_id) se agrega, no reemplaza.
{
  const v1 = baseDoc();
  const v2 = baseDoc({ document_version_id: 'ver-2', version: 2, content_hash: hash('pliego-content-v2'), extracted_text: 'Objeto del contrato: vigilancia física y electrónica.' });
  const { chunks } = buildAgt002DocumentChunks([v1, v2]);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks.map(c => c.document_version_id).sort(), ['ver-1', 'ver-2']);
}

// 9) Precedencia explícita de adenda sobre base sin borrar historia: ambos conjuntos de chunks persisten.
{
  const base = baseDoc();
  const addendum = baseDoc({
    document_id: 'doc-adenda', document_version_id: 'ver-adenda', document_type: 'adenda',
    extracted_text: 'Modifica el objeto del contrato original.',
  });
  const { chunks } = buildAgt002DocumentChunks([base, addendum]);
  assert.equal(chunks.length, 2, 'la adenda no debe borrar el chunk base');
  const baseChunk = chunks.find(c => c.document_type === 'pliego');
  const addendumChunk = chunks.find(c => c.document_type === 'adenda');
  assert.equal(baseChunk.precedence, 'base');
  assert.equal(baseChunk.superseded_by_addendum, true);
  assert.equal(addendumChunk.precedence, 'addendum');
  assert.equal(addendumChunk.superseded_by_addendum, false);
}

// 10) Contrato cerrado: claves desconocidas y campos requeridos ausentes se rechazan.
{
  assert.throws(() => buildAgt002DocumentChunks('not-an-array'), /lista|array/i);
  assert.throws(() => buildAgt002DocumentChunks([{ ...baseDoc(), unexpected_field: 'x' }]), /clave|permitida|desconocida/i);
  assert.throws(() => buildAgt002DocumentChunks([{ ...baseDoc(), document_id: '' }]), /document_id/i);
  assert.throws(() => buildAgt002DocumentChunks([{ ...baseDoc(), content_hash: 'not-a-hash' }]), /hash/i);
  assert.throws(() => buildAgt002DocumentChunks([{ ...baseDoc(), version: 0 }]), /version/i);
  assert.throws(() => buildAgt002DocumentChunks([{ ...baseDoc(), current: 'yes' }]), /current/i);
}

// 11) evidence_ref es único y citable sólo para chunks reales, nunca para gaps.
{
  const { chunks, gaps } = buildAgt002DocumentChunks([
    baseDoc(),
    baseDoc({ document_id: 'doc-gap', document_version_id: 'ver-gap', extracted_text: '' }),
  ]);
  assert.ok(chunks.every(c => typeof c.evidence_ref === 'string' && c.evidence_ref.length > 0));
  assert.ok(gaps.every(g => !Object.hasOwn(g, 'evidence_ref')));
  const ids = new Set(chunks.map(c => c.evidence_ref));
  assert.equal(ids.size, chunks.length);
}

console.log('AGT-002 document chunk contract passed');
