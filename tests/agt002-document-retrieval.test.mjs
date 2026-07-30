import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { buildAgt002DocumentChunks } from '../agt002-document-chunks.js';
import { buildAgt002DocumentRetrieval } from '../agt002-document-retrieval.js';

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function makeChunk(overrides = {}) {
  const text = overrides.text ?? 'Contenido de evidencia genérico para el proceso de licitación.';
  return {
    chunk_id: 'chunk:ver-1:p1:s1:c0',
    evidence_ref: 'evidence:chunk:ver-1:p1:s1:c0',
    document_id: 'doc-1',
    document_version_id: 'ver-1',
    opportunity_id: 'opp-1',
    snapshot_id: 'snap-1',
    document_type: 'pliego',
    name: 'Documento 1.pdf',
    version: 1,
    content_hash: hash('doc-1-v1'),
    current: true,
    page: 1,
    section: 1,
    chunk_index: 0,
    char_count: text.length,
    chunk_hash: hash(text),
    precedence: 'base',
    superseded_by_addendum: false,
    ...overrides,
    text,
  };
}

function shuffle(array, seed) {
  const out = [...array];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 1) Contrato de entrada cerrado: tipos, claves y presencia obligatoria.
{
  const chunk = makeChunk();
  const requirements = [{ requirement_id: 'req-a', terms: ['evidencia'] }];
  const base = { snapshot_id: 'snap-1', chunks: [chunk], requirements, max_chunks: 5, max_tokens: 10000, max_chars: 5000 };

  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, unexpected: 1 }), /clave|permitida|desconocida/i, 'clave raíz desconocida debe rechazarse');
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, snapshot_id: '' }), /snapshot_id/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: 'not-array' }), /chunks.*lista|lista.*chunks/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, unexpected_field: 'x' }] }), /clave|permitida|desconocida/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, content_hash: 'bad-hash' }] }), /hash/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, precedence: 'sideways' }] }), /precedence/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, page: 0 }] }), /page/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, char_count: chunk.char_count + 1 }] }), /char_count/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, chunks: [{ ...chunk, snapshot_id: 'other-snapshot' }] }), /snapshot/i, 'un chunk de otro snapshot debe rechazarse');
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, requirements: [] }), /requirement|requisito/i, 'se requiere al menos un requisito');
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, requirements: [{ requirement_id: 'req-a', terms: [] }] }), /terms|términos/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, requirements: [{ requirement_id: 'req-a', terms: ['x'], unexpected: 1 }] }), /clave|permitida|desconocida/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, requirements: [{ requirement_id: 'req-a', terms: ['x'] }, { requirement_id: 'req-a', terms: ['y'] }] }), /duplicad/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, max_chunks: 0 }), /max_chunks/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, max_chunks: 1.5 }), /max_chunks/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, max_chars: -1 }), /max_chars/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, gaps: 'not-array' }), /gaps.*lista|lista.*gaps/i);
  assert.throws(() => buildAgt002DocumentRetrieval({ ...base, gaps: [{ document_id: 'doc-x' }] }), /reason|razón/i, 'un gap sin razón explícita debe rechazarse');

  // Entrada válida no debe lanzar.
  assert.doesNotThrow(() => buildAgt002DocumentRetrieval(base));
}

// 2) Presupuesto por caracteres: un candidato que no cabe se omite como budget_exhausted;
//    ningún chunk seleccionado se trunca ni el presupuesto se excede.
{
  const textA = 'alpha alpha alpha información relevante del requisito uno.';
  const textB = 'beta beta beta información relevante del requisito dos, con contenido adicional considerable para exceder el presupuesto disponible.';
  const chunkA = makeChunk({
    chunk_id: 'chunk:ver-a:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-a:p1:s1:c0',
    document_id: 'doc-a', document_version_id: 'ver-a', text: textA,
  });
  const chunkB = makeChunk({
    chunk_id: 'chunk:ver-b:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-b:p1:s1:c0',
    document_id: 'doc-b', document_version_id: 'ver-b', text: textB,
  });
  const requirements = [
    { requirement_id: 'req-a', terms: ['alpha'] },
    { requirement_id: 'req-b', terms: ['beta'] },
  ];
  const maxChars = textA.length + 5;
  assert.ok(maxChars < textB.length, 'el presupuesto debe alcanzar sólo para el primer chunk, no para el segundo');

  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [chunkA, chunkB], requirements, max_chunks: 5, max_tokens: 10000, max_chars: maxChars,
  });

  assert.equal(result.selected_chunks.length, 1);
  assert.equal(result.selected_chunks[0].chunk_id, chunkA.chunk_id);
  assert.equal(result.selected_chunks[0].text, textA, 'el texto del chunk seleccionado nunca se trunca');
  assert.ok(result.budget.chars_used <= maxChars, 'el presupuesto de caracteres nunca se excede');
  assert.ok(result.budget.chunks_used <= result.budget.max_chunks);

  const omittedB = result.omitted_chunks.find(o => o.chunk_id === chunkB.chunk_id);
  assert.ok(omittedB, 'el chunk que no cupo debe reportarse como omitido');
  assert.equal(omittedB.reason, 'budget_exhausted');
  assert.equal(omittedB.evidence_ref, chunkB.evidence_ref);

  assert.deepEqual(result.citation_allowlist, [chunkA.evidence_ref]);
}

// 3) Cobertura primero: con un único requisito y varios candidatos relevantes, el límite de
//    chunks agota el cupo; los candidatos restantes se omiten como lower_relevance (no budget_exhausted),
//    porque el cupo por requisito ya se alcanzó antes de tocar el límite global.
{
  const texts = ['gamma gamma primero', 'gamma gamma segundo', 'gamma gamma tercero'];
  const chunks = texts.map((text, i) => makeChunk({
    chunk_id: `chunk:ver-g${i}:p1:s1:c0`, evidence_ref: `evidence:chunk:ver-g${i}:p1:s1:c0`,
    document_id: `doc-g${i}`, document_version_id: `ver-g${i}`, text,
  }));
  const requirements = [{ requirement_id: 'req-gamma', terms: ['gamma'] }];

  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks, requirements, max_chunks: 1, max_tokens: 10000, max_chars: 5000,
  });

  assert.equal(result.selected_chunks.length, 1);
  assert.equal(result.omitted_chunks.length, 2);
  assert.ok(result.omitted_chunks.every(o => o.reason === 'lower_relevance'), 'los candidatos no elegidos por cupo de cobertura deben marcarse lower_relevance');
}

// 4) Cobertura primero, versión "no llenar todo con un único requisito": con presupuesto de
//    sobra, un requisito con 3 candidatos diversos no se lleva todo el cupo cuando existe
//    otro requisito con evidencia relevante propia.
{
  const req1Chunks = ['delta uno documento', 'delta dos documento', 'delta tres documento'].map((text, i) => makeChunk({
    chunk_id: `chunk:ver-d${i}:p1:s1:c0`, evidence_ref: `evidence:chunk:ver-d${i}:p1:s1:c0`,
    document_id: `doc-d${i}`, document_version_id: `ver-d${i}`, text,
  }));
  const req2Chunk = makeChunk({
    chunk_id: 'chunk:ver-e0:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-e0:p1:s1:c0',
    document_id: 'doc-e0', document_version_id: 'ver-e0', text: 'epsilon documento único',
  });
  const requirements = [
    { requirement_id: 'req-delta', terms: ['delta'] },
    { requirement_id: 'req-epsilon', terms: ['epsilon'] },
  ];
  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [...req1Chunks, req2Chunk], requirements, max_chunks: 5, max_tokens: 10000, max_chars: 50000,
  });

  const deltaSelected = result.selected_chunks.filter(c => c.document_id.startsWith('doc-d'));
  const epsilonSelected = result.selected_chunks.filter(c => c.document_id === 'doc-e0');
  assert.equal(epsilonSelected.length, 1, 'el requisito diverso debe recibir su propia evidencia aunque haya presupuesto de sobra');
  assert.ok(deltaSelected.length < req1Chunks.length, 'no se debe agotar todo el cupo de cobertura en un único requisito habiendo evidencia diversa');
  assert.ok(result.omitted_chunks.some(o => o.reason === 'lower_relevance'));
}

// 5) Precedencia de adenda: para un requisito actual, la adenda relevante más reciente tiene
//    precedencia sobre la evidencia base; ambas citas existen, pero la base superada no se
//    presenta como evidencia vigente equivalente cuando el cupo obliga a elegir.
{
  const baseChunk = makeChunk({
    chunk_id: 'chunk:ver-base:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-base:p1:s1:c0',
    document_id: 'doc-base', document_version_id: 'ver-base', document_type: 'pliego',
    text: 'zeta plazo de ejecución original del contrato',
    superseded_by_addendum: true,
  });
  const addendumChunk = makeChunk({
    chunk_id: 'chunk:ver-adenda:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-adenda:p1:s1:c0',
    document_id: 'doc-adenda', document_version_id: 'ver-adenda', document_type: 'adenda',
    text: 'zeta plazo de ejecución modificado por la adenda',
    precedence: 'addendum', superseded_by_addendum: false,
  });
  const requirements = [{ requirement_id: 'req-zeta', terms: ['zeta', 'plazo'] }];

  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [baseChunk, addendumChunk], requirements, max_chunks: 1, max_tokens: 10000, max_chars: 50000,
  });

  assert.equal(result.selected_chunks.length, 1);
  assert.equal(result.selected_chunks[0].chunk_id, addendumChunk.chunk_id, 'la adenda relevante debe tener precedencia sobre la base para el requisito actual');
  const omittedBase = result.omitted_chunks.find(o => o.chunk_id === baseChunk.chunk_id);
  assert.ok(omittedBase, 'la base superada debe seguir citada como omisión, preservando visibilidad histórica');
  assert.equal(omittedBase.reason, 'superseded_for_current_requirement');
  assert.equal(omittedBase.evidence_ref, baseChunk.evidence_ref, 'la cita histórica de la base se conserva aunque no se seleccione como vigente');

  // Si el presupuesto alcanza para ambas, ambas citas persisten y quedan disponibles.
  const generous = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [baseChunk, addendumChunk], requirements, max_chunks: 5, max_tokens: 10000, max_chars: 50000,
  });
  assert.equal(generous.selected_chunks.length, 2);
  const generousBase = generous.selected_chunks.find(c => c.chunk_id === baseChunk.chunk_id);
  assert.equal(generousBase.superseded_by_addendum, true, 'la base sigue marcada como superada aunque se conserve su cita');
}

// 6) Omisiones tipo gap/unavailable cuando se suministran gaps explícitos (p. ej. documentos
//    ilegibles o que nunca se importaron), y material_omissions se activa en presencia de gaps.
{
  const chunk = makeChunk({ text: 'eta contenido disponible del expediente' });
  const requirements = [{ requirement_id: 'req-eta', terms: ['eta'] }];
  const gaps = [
    { document_id: 'doc-illegible', document_type: 'otro', reason: 'illegible_document' },
    { document_id: 'doc-failed', reason: 'failed_terminal' },
  ];
  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [chunk], requirements, gaps, max_chunks: 5, max_tokens: 10000, max_chars: 5000,
  });

  const gapReasons = result.omitted_chunks.filter(o => o.document_id === 'doc-illegible' || o.document_id === 'doc-failed');
  assert.equal(gapReasons.length, 2);
  assert.ok(gapReasons.every(g => g.reason === 'gap_unavailable'));
  assert.ok(gapReasons.every(g => g.evidence_ref === null && g.chunk_id === null), 'los gaps no tienen chunk citable');
  assert.equal(result.material_omissions, true);
}

// 7) Dedupe por evidence_ref/version/hash: el mismo chunk repetido no duplica selección ni
//    consumo de presupuesto; el mismo evidence_ref con contenido distinto es una violación de integridad.
{
  const chunk = makeChunk({ text: 'theta evidencia repetida en el expediente' });
  const requirements = [{ requirement_id: 'req-theta', terms: ['theta'] }];
  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [chunk, { ...chunk }], requirements, max_chunks: 5, max_tokens: 10000, max_chars: 5000,
  });
  assert.equal(result.selected_chunks.length, 1);
  assert.equal(result.budget.chunks_used, 1);

  const alteredText = 'theta contenido distinto';
  assert.throws(() => buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1',
    chunks: [chunk, { ...chunk, chunk_hash: hash(alteredText), text: alteredText, char_count: alteredText.length }],
    requirements, max_chunks: 5, max_tokens: 10000, max_chars: 5000,
  }), /integridad|hash/i);
}

// 8) Desempate estable e independiente del orden de entrada: mezclar el orden de chunks no
//    cambia el resultado (mismos seleccionados, mismo orden de presentación, mismas omisiones).
{
  const chunks = [];
  for (let i = 0; i < 8; i += 1) {
    chunks.push(makeChunk({
      chunk_id: `chunk:ver-o${i}:p1:s1:c0`, evidence_ref: `evidence:chunk:ver-o${i}:p1:s1:c0`,
      document_id: `doc-o${i}`, document_version_id: `ver-o${i}`,
      document_type: i % 2 === 0 ? 'pliego' : 'anexo_tecnico',
      text: `iota término compartido variante ${i} con contenido adicional para variar el puntaje ${i % 3}`,
    }));
  }
  const requirements = [
    { requirement_id: 'req-iota', terms: ['iota'] },
    { requirement_id: 'req-variante', terms: ['variante'] },
  ];
  const forward = buildAgt002DocumentRetrieval({ snapshot_id: 'snap-1', chunks, requirements, max_chunks: 4, max_tokens: 10000, max_chars: 2000 });
  const shuffled = buildAgt002DocumentRetrieval({ snapshot_id: 'snap-1', chunks: shuffle(chunks, 7), requirements, max_chunks: 4, max_tokens: 10000, max_chars: 2000 });
  const reversed = buildAgt002DocumentRetrieval({ snapshot_id: 'snap-1', chunks: [...chunks].reverse(), requirements, max_chunks: 4, max_tokens: 10000, max_chars: 2000 });

  assert.deepEqual(shuffled, forward, 'el orden de entrada de los chunks no debe alterar el resultado');
  assert.deepEqual(reversed, forward, 'el orden de entrada de los chunks no debe alterar el resultado');
  assert.deepEqual(forward.selected_chunks.map(c => c.chunk_id), [...forward.selected_chunks.map(c => c.chunk_id)].sort(), 'el orden de presentación de selected_chunks debe ser determinista');
}

// 9) Escenario representativo: 14 documentos, tipos y requisitos múltiples, adenda, orden
//    barajado y presupuesto limitado. Cobertura, allowlist y omisiones cerradas.
{
  function hashOf(text) { return hash(text); }
  const docs = [];
  docs.push({ document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 1.pdf', version: 1, content_hash: hashOf('doc-01'), current: true, extracted_text: 'El objeto del contrato es la vigilancia física armada las 24 horas en las instalaciones del cliente.' });
  docs.push({ document_id: 'doc-02', document_version_id: 'ver-02', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 2.pdf', version: 1, content_hash: hashOf('doc-02'), current: true, extracted_text: 'El plazo de ejecución del contrato es de doce meses contados a partir del acta de inicio.' });
  docs.push({ document_id: 'doc-03', document_version_id: 'ver-03', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'estudios_previos', name: 'Doc 3.pdf', version: 1, content_hash: hashOf('doc-03'), current: true, extracted_text: 'El presupuesto oficial estimado para este proceso es de mil millones de pesos.' });
  docs.push({ document_id: 'doc-04', document_version_id: 'ver-04', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'anexo_tecnico', name: 'Doc 4.pdf', version: 1, content_hash: hashOf('doc-04'), current: true, extracted_text: 'Se requieren equipos de comunicación radio digital troncalizado para todo el personal de vigilancia.' });
  docs.push({ document_id: 'doc-05', document_version_id: 'ver-05', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'formatos', name: 'Doc 5.pdf', version: 1, content_hash: hashOf('doc-05'), current: true, extracted_text: 'El proponente debe diligenciar el formato de experiencia específica en seguridad privada.' });
  docs.push({ document_id: 'doc-06', document_version_id: 'ver-06', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'otro', name: 'Doc 6.pdf', version: 1, content_hash: hashOf('doc-06'), current: true, extracted_text: 'Documento informativo general sin relación directa con los requisitos técnicos evaluados.' });
  docs.push({ document_id: 'doc-07', document_version_id: 'ver-07', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 7.pdf', version: 1, content_hash: hashOf('doc-07'), current: true, extracted_text: 'El servicio de vigilancia armada debe prestarse con personal certificado por la Supervigilancia.' });
  docs.push({ document_id: 'doc-08', document_version_id: 'ver-08', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'anexo_tecnico', name: 'Doc 8.pdf', version: 1, content_hash: hashOf('doc-08'), current: true, extracted_text: 'Los equipos de comunicación radio deben contar con cobertura en toda el área operativa.' });
  docs.push({ document_id: 'doc-09', document_version_id: 'ver-09', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'estudios_previos', name: 'Doc 9.pdf', version: 1, content_hash: hashOf('doc-09'), current: true, extracted_text: 'El presupuesto oficial fue calculado con base en el estudio de mercado de vigilancia armada.' });
  docs.push({ document_id: 'doc-10', document_version_id: 'ver-10', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'formatos', name: 'Doc 10.pdf', version: 1, content_hash: hashOf('doc-10'), current: true, extracted_text: 'El formato de experiencia debe incluir certificaciones vigentes de la empresa proponente.' });
  docs.push({ document_id: 'doc-11', document_version_id: 'ver-11', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'otro', name: 'Doc 11.pdf', version: 1, content_hash: hashOf('doc-11'), current: true, extracted_text: '   ' });
  docs.push({ document_id: 'doc-12', document_version_id: 'ver-12', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'adenda', name: 'Adenda 1.pdf', version: 1, content_hash: hashOf('doc-12'), current: true, extracted_text: 'La presente adenda modifica el plazo de ejecución del contrato, ampliándolo a dieciocho meses.' });
  docs.push({ document_id: 'doc-13', document_version_id: 'ver-13', opportunity_id: 'opp-1', snapshot_id: null, document_type: 'pliego', name: 'Doc 13.pdf', version: 1, content_hash: hashOf('doc-13'), current: true, extracted_text: 'El plazo de ejecución podrá prorrogarse previa autorización del supervisor del contrato.' });

  assert.equal(docs.length, 13);
  const { chunks: builtChunks, gaps: builtGaps } = buildAgt002DocumentChunks(docs);
  const snapshotId = 'snap-manizales';
  const chunksForSnapshot = builtChunks.map(c => ({ ...c, snapshot_id: snapshotId }));
  const chunkerGaps = builtGaps.map(g => ({ document_id: g.document_id, document_type: g.document_type, name: g.name, reason: g.reason }));
  // Documento 14: nunca se importó (failed_terminal), nunca llega al chunker; se suministra
  // como gap externo, igual que haría el adaptador del worker (Task 25).
  const externalGap = { document_id: 'doc-14', reason: 'failed_terminal' };
  const gaps = [...chunkerGaps, externalGap];

  assert.equal(new Set([...docs.map(d => d.document_id), 'doc-14']).size, 14, 'el escenario debe cubrir 14 documentos');

  const requirements = [
    { requirement_id: 'req-equipos', terms: ['equipos', 'comunicación', 'radio'] },
    { requirement_id: 'req-experiencia', terms: ['formato', 'experiencia'] },
    { requirement_id: 'req-plazo', terms: ['plazo', 'ejecución'] },
    { requirement_id: 'req-presupuesto', terms: ['presupuesto', 'millones'] },
    { requirement_id: 'req-vigilancia', terms: ['vigilancia', 'armada'] },
  ];

  const run = (chunksInput) => buildAgt002DocumentRetrieval({
    snapshot_id: snapshotId, chunks: chunksInput, gaps, requirements, max_chunks: 8, max_tokens: 10000, max_chars: 900,
  });

  const result = run(shuffle(chunksForSnapshot, 42));
  const resultReordered = run([...chunksForSnapshot].reverse());
  assert.deepEqual(resultReordered, result, 'el orden de entrada no debe alterar el resultado en el escenario representativo');

  assert.equal(result.snapshot_id, snapshotId);
  assert.ok(result.budget.chunks_used <= result.budget.max_chunks);
  assert.ok(result.budget.chars_used <= result.budget.max_chars);
  assert.equal(result.budget.chars_used, result.selected_chunks.reduce((sum, c) => sum + c.char_count, 0));

  // Ningún chunk seleccionado está truncado.
  for (const c of result.selected_chunks) {
    const source = chunksForSnapshot.find(orig => orig.chunk_id === c.chunk_id);
    assert.equal(c.text, source.text);
    assert.equal(c.char_count, source.text.length);
  }

  // citation_allowlist coincide exactamente con selected_chunks, sin duplicados.
  const allowlistSet = new Set(result.citation_allowlist);
  assert.equal(allowlistSet.size, result.citation_allowlist.length);
  assert.deepEqual([...allowlistSet].sort(), [...allowlistSet]);
  assert.deepEqual(result.citation_allowlist, result.selected_chunks.map(c => c.evidence_ref).sort());

  // Cobertura de requisitos: los 5 requisitos aparecen en el manifiesto.
  assert.equal(result.coverage_manifest.by_requirement.length, 5);
  assert.deepEqual(result.coverage_manifest.by_requirement.map(r => r.requirement_id), [...requirements.map(r => r.requirement_id)].sort());

  // Cobertura diversa: no toda la evidencia seleccionada proviene de un único documento ni de un único tipo documental.
  const selectedDocumentIds = new Set(result.selected_chunks.map(c => c.document_id));
  const selectedDocumentTypes = new Set(result.selected_chunks.map(c => c.document_type));
  assert.ok(selectedDocumentIds.size > 1, 'la selección debe cubrir más de un documento');
  assert.ok(selectedDocumentTypes.size > 1, 'la selección debe cubrir más de un tipo documental');

  // La adenda tiene precedencia sobre la base superada para el requisito de plazo.
  const addendumSelected = result.selected_chunks.find(c => c.document_id === 'doc-12');
  assert.ok(addendumSelected, 'la adenda relevante para el requisito de plazo debe seleccionarse');
  assert.equal(addendumSelected.precedence, 'addendum');
  const supersededOmissions = result.omitted_chunks.filter(o => o.reason === 'superseded_for_current_requirement');
  assert.ok(supersededOmissions.some(o => o.document_id === 'doc-02' || o.document_id === 'doc-13'), 'al menos una base de plazo superada debe quedar registrada como omisión de precedencia');

  // Los gaps (ilegible y failed_terminal) están presentes como omisiones sin cita.
  const gapOmissions = result.omitted_chunks.filter(o => o.reason === 'gap_unavailable');
  assert.equal(gapOmissions.length, 2);
  assert.deepEqual(gapOmissions.map(o => o.document_id).sort(), ['doc-11', 'doc-14']);
  assert.ok(gapOmissions.every(o => o.evidence_ref === null && o.chunk_id === null));

  // Con omisiones materiales presentes (gaps), no se afirma cobertura íntegra.
  assert.equal(result.material_omissions, true);

  // El módulo nunca produce una decisión GO/NO-GO ni un campo de recomendación.
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'decision'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'recommendation'), false);
  assert.deepEqual(Object.keys(result).sort(), ['budget', 'citation_allowlist', 'coverage_manifest', 'material_omissions', 'omitted_chunks', 'selected_chunks', 'snapshot_id'].sort());
}

// 10) El presupuesto de modelo debe incluir tokens explícitos y reproducibles, sin cortar chunks.
//     Cuando varias adendas relevantes compiten, la versión más reciente tiene precedencia.
{
  const oldAddendumText = 'lambda plazo modificado por adenda anterior';
  const latestAddendumText = 'lambda plazo modificado por adenda vigente';
  const oldAddendum = makeChunk({
    chunk_id: 'chunk:ver-add-old:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-add-old:p1:s1:c0',
    document_id: 'doc-add-old', document_version_id: 'ver-add-old', document_type: 'adenda',
    version: 1, text: oldAddendumText, precedence: 'addendum',
  });
  const latestAddendum = makeChunk({
    chunk_id: 'chunk:ver-add-latest:p1:s1:c0', evidence_ref: 'evidence:chunk:ver-add-latest:p1:s1:c0',
    document_id: 'doc-add-latest', document_version_id: 'ver-add-latest', document_type: 'adenda',
    version: 2, text: latestAddendumText, precedence: 'addendum',
  });
  const result = buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [oldAddendum, latestAddendum],
    requirements: [{ requirement_id: 'req-lambda', terms: ['lambda', 'plazo'] }],
    max_chunks: 1, max_chars: 5000, max_tokens: 8,
  });
  assert.equal(result.selected_chunks.length, 1);
  assert.equal(result.selected_chunks[0].chunk_id, latestAddendum.chunk_id, 'la adenda relevante más reciente debe prevalecer');
  assert.equal(result.budget.max_tokens, 8);
  assert.ok(result.budget.tokens_used <= result.budget.max_tokens, 'el presupuesto de tokens nunca se excede');
  assert.equal(result.budget.tokens_used, 7, 'el conteo lexical de tokens debe ser determinístico y auditable');
  assert.equal(result.budget.tokens_remaining, 1);
  assert.ok(result.omitted_chunks.some(item => item.chunk_id === oldAddendum.chunk_id));

  assert.throws(() => buildAgt002DocumentRetrieval({
    snapshot_id: 'snap-1', chunks: [latestAddendum],
    requirements: [{ requirement_id: 'req-lambda', terms: ['lambda'] }],
    max_chunks: 1, max_chars: 5000,
  }), /max_tokens/i, 'el límite de tokens debe ser explícito');
}

console.log('AGT-002 document retrieval budget contract passed');
