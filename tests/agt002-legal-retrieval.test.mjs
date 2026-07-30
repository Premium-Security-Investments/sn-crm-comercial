import { strict as assert } from 'node:assert';
import { retrieveAgt002LegalEvidence } from '../agt002-legal-retrieval.js';

function makeSource(overrides = {}) {
  return {
    source_id: 'ley-80-1993-art-2',
    norm_type: 'ley',
    norm_number: '80',
    year: 1993,
    article_or_section: 'Artículo 2',
    current_text: 'Texto vigente de prueba sobre modalidades de selección en contratación estatal.',
    issuing_authority: 'Congreso de la República',
    issued_at: '1993-10-28',
    effective_from: '1993-10-28',
    effective_to: null,
    modifications: [],
    official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1234567',
    topic: ['contratación estatal', 'modalidades de selección'],
    sector: ['sector público'],
    verified_at: '2026-01-01',
    corpus_version: 'test-corpus-v1',
    verification_status: 'verified',
    validity_status: 'confirmed',
    applicability_status: 'applicable',
    ...overrides,
  };
}

const eligibleSourceA = makeSource();
const eligibleSourceB = makeSource({
  source_id: 'decreto-356-1994-art-4',
  norm_type: 'decreto_ley',
  norm_number: '356',
  year: 1994,
  article_or_section: 'Artículo 4',
  current_text: 'Texto vigente de prueba sobre campo de aplicación de vigilancia y seguridad privada.',
  issuing_authority: 'Presidencia de la República',
  issued_at: '1994-02-11',
  effective_from: '1994-02-11',
  official_url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1341',
  topic: ['vigilancia y seguridad privada', 'campo de aplicación'],
  sector: ['vigilancia y seguridad privada'],
});
const uncertainSource = makeSource({
  source_id: 'ley-1150-2007-art-2',
  norm_number: '1150',
  year: 2007,
  article_or_section: 'Artículo 2',
  issued_at: '2007-07-16',
  effective_from: null,
  official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=7654321',
  validity_status: 'uncertain',
  modifications: [{
    modification_id: 'mod-1',
    modifying_norm_id: 'ley-1955-2019-art-41',
    modification_type: 'modification',
    scope: 'partial',
    effective_date: null,
    official_url: null,
    resolution_status: 'unresolved',
  }],
});

function makeManifest(sources) {
  return { corpus_version: 'test-corpus-v1', sources };
}

const BASE_QUERY = {
  corpus_version: 'test-corpus-v1',
  as_of: '2026-01-01',
  sector: ['sector público'],
  topics: ['contratación estatal'],
};

// 1) Selección determinista: fuentes elegibles producen verified_legal_evidence con cita canónica real.
{
  const result = retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA, eligibleSourceB]), ...BASE_QUERY });
  assert.equal(result.verified_legal_evidence.length, 1);
  assert.equal(result.verified_legal_evidence[0].source_id, 'ley-80-1993-art-2');
  assert.equal(result.human_legal_review_items.length, 0);
  assert.equal(result.corpus_version, 'test-corpus-v1');
  assert.deepEqual(result.allowed_citation_ids, [`citation:ley-80-1993-art-2:test-corpus-v1`]);
  assert.equal(result.verified_legal_evidence[0].citation.official_url, eligibleSourceA.official_url);
}

// 2) Filtro por sector: vigilancia y seguridad privada no debe traer la fuente de contratación estatal.
{
  const result = retrieveAgt002LegalEvidence({
    corpus: makeManifest([eligibleSourceA, eligibleSourceB]),
    corpus_version: 'test-corpus-v1',
    as_of: '2026-01-01',
    sector: ['vigilancia y seguridad privada'],
    topics: ['campo de aplicación'],
  });
  assert.equal(result.verified_legal_evidence.length, 1);
  assert.equal(result.verified_legal_evidence[0].source_id, 'decreto-356-1994-art-4');
}

// 3) Abstención por vigencia incierta: requires_human_legal_review con texto visible exacto y razones cerradas.
{
  const result = retrieveAgt002LegalEvidence({ corpus: makeManifest([uncertainSource]), ...BASE_QUERY });
  assert.equal(result.verified_legal_evidence.length, 0);
  assert.equal(result.human_legal_review_items.length, 1);
  const item = result.human_legal_review_items[0];
  assert.equal(item.statement, 'No verificado jurídicamente; requiere revisión humana');
  assert.ok(item.reasons.includes('validity_uncertain'));
  assert.ok(item.reasons.includes('modification_unresolved'));
  assert.equal(item.citation.source_id, 'ley-1150-2007-art-2');
}

// 4) Determinismo ante permutación: el orden de entrada del corpus no debe alterar el resultado.
{
  const forward = retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA, eligibleSourceB, uncertainSource]), ...BASE_QUERY, sector: ['sector público', 'vigilancia y seguridad privada'], topics: ['contratación estatal', 'campo de aplicación'] });
  const reversed = retrieveAgt002LegalEvidence({ corpus: makeManifest([uncertainSource, eligibleSourceB, eligibleSourceA]), ...BASE_QUERY, sector: ['sector público', 'vigilancia y seguridad privada'], topics: ['contratación estatal', 'campo de aplicación'] });
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward.coverage.matched_source_ids, [...forward.coverage.matched_source_ids].sort());
}

// 5) Exact version tag: corpus_version de la consulta debe coincidir con la del corpus; si no, falla cerrado.
{
  assert.throws(
    () => retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA]), ...BASE_QUERY, corpus_version: 'otra-version' }),
    /corpus_version/i,
  );
}

// 6) Citas oficiales: toda cita expuesta debe ser la canónica de Task29, nunca sintetizada.
{
  const result = retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA]), ...BASE_QUERY });
  const citation = result.verified_legal_evidence[0].citation;
  assert.equal(citation.citation_id, 'citation:ley-80-1993-art-2:test-corpus-v1');
  assert.equal(citation.norm_type, 'ley');
  assert.equal(citation.norm_number, '80');
}

// 7) Rechazo de fuente/corpus desconocido o inválido: un corpus con una fuente que no valida debe fallar cerrado.
{
  const brokenSource = { ...eligibleSourceA };
  delete brokenSource.official_url;
  assert.throws(() => retrieveAgt002LegalEvidence({ corpus: makeManifest([brokenSource]), ...BASE_QUERY }), /official_url/i);
}

// 8) Rechazo de claves desconocidas en la consulta.
{
  assert.throws(
    () => retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA]), ...BASE_QUERY, unexpected_field: 'x' }),
    /clave|desconocid/i,
  );
}

// 9) Filtro por tags (topics/sector) es obligatorio: sin ninguna dimensión de tema, falla cerrado.
{
  assert.throws(
    () => retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA]), corpus_version: 'test-corpus-v1', as_of: '2026-01-01', sector: ['sector público'] }),
    /dimensión de tema|topics|process_stage|modality/i,
  );
}

// 9b) process_stage y modality también actúan como dimensión de tema válida (coinciden con tags de topic).
{
  const tagged = makeSource({ source_id: 'ley-80-1993-art-3', topic: ['contratación estatal', 'seleccion_abreviada'] });
  const result = retrieveAgt002LegalEvidence({
    corpus: makeManifest([tagged]),
    corpus_version: 'test-corpus-v1',
    as_of: '2026-01-01',
    sector: ['sector público'],
    process_stage: 'seleccion_abreviada',
  });
  assert.equal(result.verified_legal_evidence.length, 1);
}

// 10) Presupuesto (max_results) acota resultados y expone omisiones explícitas y estables.
{
  const many = [eligibleSourceA, { ...eligibleSourceA, source_id: 'ley-80-1993-art-2b' }, { ...eligibleSourceA, source_id: 'ley-80-1993-art-2a' }];
  const result = retrieveAgt002LegalEvidence({ corpus: makeManifest(many), ...BASE_QUERY, max_results: 2 });
  assert.equal(result.coverage.considered_count, 3);
  assert.equal(result.coverage.returned_count, 2);
  assert.equal(result.verified_legal_evidence.length, 2);
  assert.equal(result.omissions.length, 1);
  assert.equal(result.omissions[0].reason, 'excluded_by_budget');
  assert.deepEqual(result.verified_legal_evidence.map(e => e.source_id), ['ley-80-1993-art-2', 'ley-80-1993-art-2a']);
  assert.equal(result.omissions[0].source_id, 'ley-80-1993-art-2b');
}

// 11) as_of obligatorio y explícito (nunca implícito): ausente debe fallar cerrado.
{
  assert.throws(
    () => retrieveAgt002LegalEvidence({ corpus: makeManifest([eligibleSourceA]), corpus_version: 'test-corpus-v1', sector: ['sector público'], topics: ['contratación estatal'] }),
    /as_of/i,
  );
}

// 12) Sin coincidencias: coverage vacío pero determinista, sin lanzar error.
{
  const result = retrieveAgt002LegalEvidence({
    corpus: makeManifest([eligibleSourceA]),
    corpus_version: 'test-corpus-v1',
    as_of: '2026-01-01',
    sector: ['sector inexistente'],
    topics: ['tema inexistente'],
  });
  assert.equal(result.verified_legal_evidence.length, 0);
  assert.equal(result.human_legal_review_items.length, 0);
  assert.deepEqual(result.coverage.matched_source_ids, []);
}

console.log('AGT-002 legal retrieval contract passed');
