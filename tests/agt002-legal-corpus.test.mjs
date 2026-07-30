import { strict as assert } from 'node:assert';
import {
  AGT002_LEGAL_OFFICIAL_HOSTS,
  AGT002_LEGAL_MODIFICATION_TYPES,
  AGT002_LEGAL_MODIFICATION_SCOPES,
  AGT002_LEGAL_RESOLUTION_STATUSES,
  AGT002_LEGAL_SOURCE_VERIFICATION_STATUSES,
  AGT002_LEGAL_SOURCE_VALIDITY_STATUSES,
  AGT002_LEGAL_SOURCE_APPLICABILITY_STATUSES,
  AGT002_LEGAL_REVIEW_REASONS,
  AGT002_LEGAL_CONCLUSION_STATUSES,
  AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS,
  isAgt002OfficialLegalUrl,
  buildAgt002LegalSource,
  evaluateAgt002LegalSourceStatus,
  buildAgt002LegalCitation,
  validateAgt002LegalConclusion,
} from '../agt002-legal-corpus.js';

function makeSource(overrides = {}) {
  return {
    source_id: 'ley-80-1993-art-2',
    norm_type: 'ley',
    norm_number: '80',
    year: 1993,
    article_or_section: 'Artículo 2',
    current_text: 'Texto vigente del artículo 2 de la Ley 80 de 1993 sobre modalidades de selección.',
    issuing_authority: 'Congreso de la República',
    issued_at: '1993-10-28',
    effective_from: '1993-10-28',
    effective_to: null,
    modifications: [],
    official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1234567',
    topic: ['contratación estatal', 'modalidades de selección'],
    sector: ['sector público'],
    verified_at: '2026-07-01',
    corpus_version: 'v1',
    verification_status: 'verified',
    validity_status: 'confirmed',
    applicability_status: 'applicable',
    ...overrides,
  };
}

function makeModification(overrides = {}) {
  return {
    modification_id: 'mod-1150-2007',
    modifying_norm_id: 'ley-1150-2007',
    modification_type: 'modification',
    scope: 'partial',
    effective_date: '2007-07-16',
    official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1150',
    resolution_status: 'resolved',
    ...overrides,
  };
}

// 1) Contrato cerrado de fuente: campos requeridos (incluye los 3 estados explícitos) y claves desconocidas.
{
  const valid = makeSource();
  assert.doesNotThrow(() => buildAgt002LegalSource(valid));
  assert.throws(() => buildAgt002LegalSource({ ...valid, unexpected_field: 'x' }), /clave|permitida|desconocida/i);

  const requiredNonNullable = [
    'source_id', 'norm_type', 'norm_number', 'year', 'article_or_section', 'current_text',
    'issuing_authority', 'official_url', 'topic', 'sector', 'verified_at', 'corpus_version', 'modifications',
    'verification_status', 'validity_status', 'applicability_status',
  ];
  for (const key of requiredNonNullable) {
    const broken = { ...valid };
    delete broken[key];
    assert.throws(() => buildAgt002LegalSource(broken), new RegExp(key.replace(/_/g, '.?'), 'i'), `${key} ausente debe rechazarse`);
  }

  const nullable = ['issued_at', 'effective_from', 'effective_to'];
  for (const key of nullable) {
    const withoutKey = { ...valid, validity_status: key === 'effective_from' ? 'uncertain' : valid.validity_status };
    delete withoutKey[key];
    assert.doesNotThrow(() => buildAgt002LegalSource(withoutKey), `${key} ausente (nullable) no debe rechazarse`);
  }
}

// 2) Tipos, longitudes, enums e identidad segura (patrón de IDs y corpus_version).
{
  const valid = makeSource();
  assert.throws(() => buildAgt002LegalSource({ ...valid, current_text: '   ' }), /current_text/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, year: 1993.5 }), /year/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, year: 1500 }), /year/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, year: 1994 }), /year/i, 'year debe coincidir con issued_at');
  assert.throws(() => buildAgt002LegalSource({ ...valid, source_id: '' }), /source_id/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, topic: [] }), /topic/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, sector: [] }), /sector/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, topic: [...Array(21)].map((_, i) => `tema-${i}`) }), /topic/i, 'arreglo de topic acotado');

  assert.throws(() => buildAgt002LegalSource({ ...valid, source_id: 'Ley-80!' }), /source_id/i, 'source_id debe seguir el patrón seguro');
  assert.throws(() => buildAgt002LegalSource({ ...valid, source_id: 'ley 80' }), /source_id/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, corpus_version: 'V 1' }), /corpus_version/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, corpus_version: 'v1:mixed' }), /corpus_version/i, 'separadores libres no permitidos');
  assert.doesNotThrow(() => buildAgt002LegalSource({ ...valid, source_id: 'ley-80.1993_art-2', corpus_version: 'v1.2' }));

  assert.throws(() => buildAgt002LegalSource({ ...valid, verification_status: 'sideways' }), /verification_status/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, validity_status: 'sideways' }), /validity_status/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, applicability_status: 'sideways' }), /applicability_status/i);
  assert.deepEqual([...AGT002_LEGAL_SOURCE_VERIFICATION_STATUSES].sort(), ['unverified', 'verified']);
  assert.deepEqual([...AGT002_LEGAL_SOURCE_VALIDITY_STATUSES].sort(), ['confirmed', 'uncertain']);
  assert.deepEqual([...AGT002_LEGAL_SOURCE_APPLICABILITY_STATUSES].sort(), ['applicable', 'not_applicable', 'uncertain']);

  const longText = 'x'.repeat(20001);
  try {
    buildAgt002LegalSource({ ...valid, current_text: longText });
    assert.fail('debía rechazar current_text excesivo');
  } catch (err) {
    assert.match(err.message, /current_text/i);
    assert.ok(!err.message.includes(longText), 'el error no debe ecoar el texto completo');
  }
}

// 3) Fechas ISO inválidas, secuencia temporal coherente y coherencia entre validity_status y effective_from.
{
  const valid = makeSource();
  assert.throws(() => buildAgt002LegalSource({ ...valid, issued_at: '1993-13-40' }), /issued_at/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, issued_at: '1993/10/28' }), /issued_at/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, verified_at: 'not-a-date' }), /verified_at/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, verified_at: '' }), /verified_at/i);
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, effective_from: '1990-01-01' }),
    /effective_from/i,
    'effective_from no puede ser anterior a issued_at',
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, effective_from: '2000-01-01', effective_to: '1999-01-01' }),
    /effective_to/i,
    'effective_to debe ser posterior a effective_from',
  );
  assert.doesNotThrow(() => buildAgt002LegalSource({ ...valid, effective_to: '2030-01-01' }));

  assert.throws(
    () => buildAgt002LegalSource({ ...valid, effective_from: null, validity_status: 'confirmed' }),
    /effective_from|validity_status/i,
    'validity_status confirmed exige effective_from',
  );
  assert.doesNotThrow(() => buildAgt002LegalSource({ ...valid, effective_from: null, validity_status: 'uncertain' }));
}

// 4) Normalización de topic/sector: no vacíos, dedupe y orden estable.
{
  const source = buildAgt002LegalSource(makeSource({
    topic: ['Contratación Estatal', 'contratación estatal', '  Modalidades  '],
    sector: ['Sector Público'],
  }));
  assert.deepEqual(source.topic, ['contratación estatal', 'modalidades']);
  assert.deepEqual(source.sector, ['sector público']);
}

// 5) official_url: solo HTTPS, host oficial en allowlist cerrada, sin spoofing.
{
  assert.deepEqual(
    [...AGT002_LEGAL_OFFICIAL_HOSTS].sort(),
    ['colombiacompra.gov.co', 'funcionpublica.gov.co', 'suin-juriscol.gov.co', 'supervigilancia.gov.co'],
  );

  const validUrls = [
    'https://funcionpublica.gov.co/norma-1',
    'https://www.funcionpublica.gov.co/norma-1',
    'https://normograma.funcionpublica.gov.co/norma-1',
    'https://suin-juriscol.gov.co/viewDocument.asp?id=1',
    'https://colombiacompra.gov.co/manuales/manual-1',
    'https://docs.colombiacompra.gov.co/manuales/manual-1',
    'https://supervigilancia.gov.co/actos/resolucion-1',
  ];
  for (const url of validUrls) assert.ok(isAgt002OfficialLegalUrl(url), `debe aceptar host oficial: ${url}`);

  const invalidUrls = [
    'http://funcionpublica.gov.co/norma-1',
    'https://example.com/norma-1',
    'https://evilfuncionpublica.gov.co/norma-1',
    'https://funcionpublica.gov.co.evil.com/norma-1',
    'https://funcionpublica.gov.co./norma-1',
    'https://user:pass@funcionpublica.gov.co/norma-1',
    'https://funcionpublica.gov.co:8443/norma-1',
    'https://funcionpublica.gov.co/norma-1#seccion',
    'not-a-url',
    '',
  ];
  for (const url of invalidUrls) assert.ok(!isAgt002OfficialLegalUrl(url), `debe rechazar: ${url}`);

  const valid = makeSource();
  assert.throws(() => buildAgt002LegalSource({ ...valid, official_url: 'https://example.com/x' }), /official_url/i);
  assert.throws(() => buildAgt002LegalSource({ ...valid, official_url: 'http://suin-juriscol.gov.co/x' }), /official_url/i);
}

// 6) modifications: contrato cerrado, enums, verificabilidad (resolved exige fecha+URL oficiales), coherencia y unicidad.
{
  const valid = makeSource();
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), unexpected: 1 }] }),
    /clave|permitida|desconocida/i,
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), modification_type: 'sideways' }] }),
    /modification_type/i,
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), scope: 'sideways' }] }),
    /scope/i,
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), resolution_status: 'sideways' }] }),
    /resolution_status/i,
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), official_url: 'https://example.com/x' }] }),
    /official_url/i,
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), effective_date: '1980-01-01' }] }),
    /effective_date/i,
    'una modificación no puede ser anterior a issued_at de la fuente',
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [makeModification(), makeModification()] }),
    /duplicad/i,
  );

  // resolved exige verificabilidad completa: no se permite fecha o URL nulas.
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [makeModification({ effective_date: null })] }),
    /effective_date/i,
    'resolution_status resolved exige effective_date',
  );
  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [makeModification({ official_url: null })] }),
    /official_url/i,
    'resolution_status resolved exige official_url oficial',
  );
  // unresolved sí permite fecha/URL nulas (fuerza revisión humana en la evaluación).
  const withUnresolved = buildAgt002LegalSource({
    ...valid,
    modifications: [makeModification({ resolution_status: 'unresolved', effective_date: null, official_url: null })],
  });
  assert.equal(withUnresolved.modifications[0].effective_date, null);
  assert.equal(withUnresolved.modifications[0].official_url, null);

  assert.deepEqual([...AGT002_LEGAL_MODIFICATION_TYPES].sort(), ['derogation', 'modification']);
  assert.deepEqual([...AGT002_LEGAL_MODIFICATION_SCOPES].sort(), ['partial', 'total']);
  assert.deepEqual([...AGT002_LEGAL_RESOLUTION_STATUSES].sort(), ['resolved', 'unresolved']);

  assert.throws(
    () => buildAgt002LegalSource({ ...valid, modifications: [{ ...makeModification(), modification_id: 'Mod 1!' }] }),
    /modification_id/i,
    'modification_id debe seguir el patrón seguro',
  );
}

// 7) No mutación del input y determinismo/orden estable del output.
{
  const raw = makeSource({ modifications: [makeModification()] });
  const snapshot = JSON.stringify(raw);
  const first = buildAgt002LegalSource(raw);
  assert.equal(JSON.stringify(raw), snapshot, 'la fuente cruda no debe mutarse');
  const second = buildAgt002LegalSource(raw);
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'la normalización debe ser determinista');
  assert.doesNotThrow(() => JSON.stringify(first));
}

// 8) evaluateAgt002LegalSourceStatus: as_of y umbral explícitos, sin dependencia de Date.now().
{
  const source = makeSource();
  assert.throws(() => evaluateAgt002LegalSourceStatus(source, {}), /as_of/i, 'as_of es obligatorio y explícito');
  assert.throws(() => evaluateAgt002LegalSourceStatus(source, { as_of: 'not-a-date' }), /as_of/i);
  assert.throws(
    () => evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30', stale_after_days: 0 }),
    /stale_after_days/i,
  );
  assert.equal(AGT002_LEGAL_DEFAULT_STALE_AFTER_DAYS > 0, true);
}

// 9) happy path: verified + confirmed + applicable + fechas/modificaciones coherentes => elegible, sin razones.
{
  const source = makeSource();
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.verification_status, 'verified');
  assert.equal(status.validity_status, 'confirmed');
  assert.equal(status.applicability_status, 'applicable');
  assert.equal(status.modification_status, 'none');
  assert.equal(status.eligible_for_verified_law, true);
  assert.equal(status.requires_human_legal_review, false);
  assert.deepEqual(status.reasons, []);
}

// 10) verification_status=unverified (declarado) nunca respalda verified_law, con razón cerrada.
{
  const source = makeSource({ verification_status: 'unverified' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.equal(status.requires_human_legal_review, true);
  assert.ok(status.reasons.includes('source_unverified'));
}

// 11) stale calculado con as_of aunque verification_status declarado sea verified.
{
  const source = makeSource({ verified_at: '2020-01-01' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('stale_verification'));

  const notStale = evaluateAgt002LegalSourceStatus(source, { as_of: '2020-06-01', stale_after_days: 3650 });
  assert.equal(notStale.eligible_for_verified_law, true, 'un umbral explícito distinto cambia el resultado de forma determinista');
}

// 12) fecha de verificación posterior a as_of.
{
  const source = makeSource({ verified_at: '2026-07-01' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2020-01-01' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('verification_date_in_future'));
}

// 13) validity_status=uncertain (declarado) nunca respalda verified_law, aunque las fechas sean coherentes.
{
  const source = makeSource({ validity_status: 'uncertain' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('validity_uncertain'));
}

// 14) issued_at ausente vuelve la fuente no elegible con razón cerrada, aunque effective_from exista.
{
  const source = makeSource({ issued_at: null });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('issuance_date_uncertain'));
}

// 15) effective_to vencida implica no vigente.
{
  const source = makeSource({ effective_to: '2020-01-01' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('expired'));
}

// 16) effective_to: null representa vigencia abierta y sí puede ser elegible cuando validity_status=confirmed.
{
  const source = makeSource({ effective_to: null });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, true);
}

// 17) norma aún no vigente (not_yet_effective).
{
  const source = makeSource({ effective_from: '2030-01-01' });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.eligible_for_verified_law, false);
  assert.ok(status.reasons.includes('not_yet_effective'));
}

// 18) applicability_status declarado uncertain/not_applicable nunca respalda verified_law.
{
  const uncertain = makeSource({ applicability_status: 'uncertain' });
  const uncertainStatus = evaluateAgt002LegalSourceStatus(uncertain, { as_of: '2026-07-30' });
  assert.equal(uncertainStatus.eligible_for_verified_law, false);
  assert.ok(uncertainStatus.reasons.includes('applicability_uncertain'));

  const notApplicable = makeSource({ applicability_status: 'not_applicable' });
  const notApplicableStatus = evaluateAgt002LegalSourceStatus(notApplicable, { as_of: '2026-07-30' });
  assert.equal(notApplicableStatus.eligible_for_verified_law, false);
  assert.ok(notApplicableStatus.reasons.includes('not_applicable_derogated'));
  assert.notEqual(notApplicableStatus.reasons.includes('applicability_uncertain'), true, 'no aplicable no debe confundirse con incierto');
}

// 19) modificación/derogatoria unresolved fuerza incertidumbre aunque applicability_status declarado sea applicable.
{
  const source = makeSource({ modifications: [makeModification({ resolution_status: 'unresolved', effective_date: null, official_url: null })] });
  const status = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(status.modification_status, 'unresolved');
  assert.equal(status.eligible_for_verified_law, false);
  assert.equal(status.requires_human_legal_review, true);
  assert.ok(status.reasons.includes('modification_unresolved'));
}

// 20) derogación total resuelta: una fecha futura no bloquea hoy; efectiva bloquea aplicabilidad de forma distinguible de incertidumbre.
{
  const derogation = makeModification({
    modification_type: 'derogation', scope: 'total', resolution_status: 'resolved',
    effective_date: '2030-01-01', official_url: 'https://supervigilancia.gov.co/derogatoria-1',
  });
  const source = makeSource({ modifications: [derogation] });

  const before = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30' });
  assert.equal(before.eligible_for_verified_law, true, 'una derogación futura no puede tratarse como ya efectiva');
  assert.ok(!before.reasons.includes('not_applicable_derogated'));

  const after = evaluateAgt002LegalSourceStatus(source, { as_of: '2031-01-01', stale_after_days: 3650 });
  assert.equal(after.eligible_for_verified_law, false);
  assert.deepEqual(after.reasons, ['not_applicable_derogated']);
}

// 21) buildAgt002LegalCitation: cita canónica determinista/versionada, solo desde fuente normalizada.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  assert.equal(citation.citation_id, 'citation:ley-80-1993-art-2:v1');
  assert.equal(citation.source_id, 'ley-80-1993-art-2');
  assert.equal(citation.corpus_version, 'v1');
  assert.ok(citation.label.includes('80'));
  assert.ok(citation.label.includes('1993'));
  assert.doesNotThrow(() => JSON.stringify(citation));

  const second = buildAgt002LegalCitation(makeSource());
  assert.deepEqual(citation, second, 'la cita debe ser determinista para la misma fuente');

  const differentVersion = buildAgt002LegalCitation(makeSource({ corpus_version: 'v2' }));
  assert.notEqual(citation.citation_id, differentVersion.citation_id, 'la cita debe versionarse con el corpus');

  assert.throws(
    () => buildAgt002LegalCitation({ ...makeSource(), current_text: '' }),
    /current_text/i,
    'no puede construirse una cita desde una fuente inválida',
  );
}

// 22) validateAgt002LegalConclusion: contrato cerrado y rechazo explícito de autoridad indebida.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  const base = { status: 'requires_human_legal_review', statement: 'Requiere revisión jurídica.', citations: [], reasons: [] };

  assert.throws(
    () => validateAgt002LegalConclusion({ ...base, unexpected_field: 'x' }, { sources: [source], as_of: '2026-07-30' }),
    /clave|permitida|desconocida/i,
  );
  assert.throws(
    () => validateAgt002LegalConclusion({ ...base, status: 'GO' }, { sources: [source], as_of: '2026-07-30' }),
    /status|estado/i,
  );

  const forbiddenKeys = ['go', 'no_go', 'go_no_go', 'decision', 'approval', 'approved', 'signature', 'signed', 'submission', 'submitted', 'authorized_by', 'authorization'];
  for (const key of forbiddenKeys) {
    assert.throws(
      () => validateAgt002LegalConclusion({ ...base, [key]: 'GO' }, { sources: [source], as_of: '2026-07-30' }),
      /autoridad humana|GO\/NO-GO|GO.NO.GO/i,
      `${key} debe rechazarse como autoridad indebida`,
    );
  }

  assert.doesNotThrow(() => validateAgt002LegalConclusion(
    { ...base, citations: [citation], reasons: ['validity_uncertain'] },
    { sources: [source], as_of: '2026-07-30' },
  ), 'una razón cerrada explícita del llamador debe aceptarse aunque la cita sea elegible');
}

// 23) happy path verified_law con cita permitida; reasons siempre vacías.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  const conclusion = validateAgt002LegalConclusion({
    status: 'verified_law',
    statement: 'La modalidad de selección aplicable es licitación pública según el artículo 2 de la Ley 80 de 1993.',
    citations: [citation],
    reasons: [],
  }, { sources: [source], as_of: '2026-07-30' });
  assert.equal(conclusion.status, 'verified_law');
  assert.equal(conclusion.citations.length, 1);
  assert.deepEqual(conclusion.citations[0], citation);
  assert.deepEqual(conclusion.reasons, []);
}

// 24) verified_law no admite reasons: la certeza no requiere (ni permite) explicaciones adicionales.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [citation], reasons: ['stale_verification'] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /reason|razón/i,
  );
}

// 25) reasons solo puede contener valores cerrados de AGT002_LEGAL_REVIEW_REASONS; rechaza texto libre.
{
  const source = makeSource();
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'requires_human_legal_review', statement: 'x', citations: [], reasons: ['mixed'] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /reason|razón/i,
  );
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'requires_human_legal_review', statement: 'x', citations: [], reasons: ['ley inventada 999 de 2099'] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /reason|razón/i,
  );
  const expectedReasons = [
    'applicability_uncertain', 'expired', 'issuance_date_uncertain', 'modification_unresolved', 'no_eligible_source',
    'not_applicable_derogated', 'not_yet_effective', 'source_unverified', 'stale_verification', 'validity_uncertain',
    'verification_date_in_future',
  ];
  assert.deepEqual([...AGT002_LEGAL_REVIEW_REASONS].sort(), expectedReasons.sort());
}

// 26) rechazo de cita/fuente/norma/URL inventada desde memoria (source_id inexistente en el corpus).
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  const invented = { ...citation, source_id: 'invented-source-id', citation_id: 'citation:invented-source-id:v1' };
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [invented], reasons: [] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /corpus|no existe/i,
  );
}

// 27) rechazo de cita alterada (URL/norma no coincide con la fuente real).
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  const alteredUrl = { ...citation, official_url: 'https://suin-juriscol.gov.co/otra-norma-cualquiera' };
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [alteredUrl], reasons: [] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /no coincide|can[oó]nica/i,
  );

  const alteredNorm = { ...citation, norm_number: '9999' };
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [alteredNorm], reasons: [] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /no coincide|can[oó]nica/i,
  );
}

// 28) rechazo de source_id duplicado en el corpus entregado.
{
  const dup1 = makeSource();
  const dup2 = makeSource({ article_or_section: 'Artículo 3' });
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'requires_human_legal_review', statement: 'x', citations: [], reasons: [] },
      { sources: [dup1, dup2], as_of: '2026-07-30' },
    ),
    /duplicad/i,
  );
}

// 29) rechazo de citation_id duplicado dentro de una misma conclusión.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'requires_human_legal_review', statement: 'x', citations: [citation, citation], reasons: [] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /duplicad/i,
  );
}

// 30) rechazo de corpus_version mixto en el corpus entregado, aunque se cite una sola fuente.
{
  const sourceV1 = makeSource({ corpus_version: 'v1' });
  const otherV2 = makeSource({ source_id: 'ley-80-1993-art-3', article_or_section: 'Artículo 3', corpus_version: 'v2' });
  const citationV1 = buildAgt002LegalCitation(sourceV1);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'requires_human_legal_review', statement: 'x', citations: [citationV1], reasons: [] },
      { sources: [sourceV1, otherV2], as_of: '2026-07-30' },
    ),
    /versi[oó]n|corpus/i,
  );
}

// 31) rechazo de cita de fuente no elegible respaldando verified_law (falla cerrado): stale, incierta y derogada.
{
  const staleSource = makeSource({ verified_at: '2020-01-01' });
  const staleCitation = buildAgt002LegalCitation(staleSource);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [staleCitation], reasons: [] },
      { sources: [staleSource], as_of: '2026-07-30' },
    ),
    /no elegible|stale/i,
  );

  const uncertainSource = makeSource({ validity_status: 'uncertain' });
  const uncertainCitation = buildAgt002LegalCitation(uncertainSource);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [uncertainCitation], reasons: [] },
      { sources: [uncertainSource], as_of: '2026-07-30' },
    ),
    /no elegible|incierta|uncertain/i,
  );

  const derogatedSource = makeSource({
    modifications: [makeModification({
      modification_type: 'derogation', scope: 'total', resolution_status: 'resolved', effective_date: '2020-01-01',
    })],
  });
  const derogatedCitation = buildAgt002LegalCitation(derogatedSource);
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [derogatedCitation], reasons: [] },
      { sources: [derogatedSource], as_of: '2026-07-30' },
    ),
    /no elegible|derogad/i,
  );
}

// 32) verified_law exige al menos una cita; sin soporte elegible el único estado permitido es requires_human_legal_review,
//     con razones reales derivadas de forma canónica (nunca ocultas con reasons vacías).
{
  const source = makeSource();
  assert.throws(
    () => validateAgt002LegalConclusion(
      { status: 'verified_law', statement: 'x', citations: [], reasons: [] },
      { sources: [source], as_of: '2026-07-30' },
    ),
    /al menos una cita|verified_law/i,
  );

  const noCitationsConclusion = validateAgt002LegalConclusion(
    { status: 'requires_human_legal_review', statement: 'Sin evidencia normativa suficiente.', citations: [], reasons: [] },
    { sources: [source], as_of: '2026-07-30' },
  );
  assert.ok(noCitationsConclusion.reasons.includes('no_eligible_source'));
  assert.ok(noCitationsConclusion.reasons.length >= 1);

  const staleSource = makeSource({ verified_at: '2020-01-01' });
  const staleCitation = buildAgt002LegalCitation(staleSource);
  const uncertainConclusion = validateAgt002LegalConclusion(
    { status: 'requires_human_legal_review', statement: 'Vigencia no confirmada; requiere revisión jurídica.', citations: [staleCitation], reasons: [] },
    { sources: [staleSource], as_of: '2026-07-30' },
  );
  assert.equal(uncertainConclusion.status, 'requires_human_legal_review');
  assert.ok(uncertainConclusion.reasons.includes('stale_verification'), 'las razones reales deben derivarse aunque el llamador envíe reasons vacío');
}

// 33) determinismo/serialización estable y no mutación en el flujo de conclusión.
{
  const source = makeSource();
  const citation = buildAgt002LegalCitation(source);
  const rawConclusion = { status: 'verified_law', statement: 'x', citations: [citation], reasons: [] };
  const snapshot = JSON.stringify(rawConclusion);
  const sourcesArg = [source];
  const sourcesSnapshot = JSON.stringify(sourcesArg);
  const first = validateAgt002LegalConclusion(rawConclusion, { sources: sourcesArg, as_of: '2026-07-30' });
  assert.equal(JSON.stringify(rawConclusion), snapshot, 'la conclusión cruda no debe mutarse');
  assert.equal(JSON.stringify(sourcesArg), sourcesSnapshot, 'las fuentes del corpus no deben mutarse');
  const second = validateAgt002LegalConclusion(rawConclusion, { sources: sourcesArg, as_of: '2026-07-30' });
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'la validación de conclusión debe ser determinista');
}

// 34) AGT002_LEGAL_CONCLUSION_STATUSES es un contrato cerrado sin estados de decisión GO/NO-GO.
{
  assert.deepEqual([...AGT002_LEGAL_CONCLUSION_STATUSES].sort(), ['requires_human_legal_review', 'verified_law']);
  assert.equal(AGT002_LEGAL_CONCLUSION_STATUSES.has('GO'), false);
  assert.equal(AGT002_LEGAL_CONCLUSION_STATUSES.has('NO_GO'), false);
}

console.log('AGT-002 legal corpus contract passed');
