import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AGT002_LEGAL_OFFICIAL_HOSTS,
  buildAgt002LegalSource,
  evaluateAgt002LegalSourceStatus,
} from '../agt002-legal-corpus.js';
import { validateAgt002LegalManifest } from '../scripts/validate_agt002_legal_corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, '..', 'data', 'agt002', 'legal-corpus-v1.1.json');

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

function makeValidSource(overrides = {}) {
  return {
    source_id: 'ley-80-1993-art-1',
    norm_type: 'ley',
    norm_number: '80',
    year: 1993,
    article_or_section: 'Artículo 1',
    current_text: 'Texto verificado de prueba con longitud suficiente para pasar validaciones básicas.',
    issuing_authority: 'Congreso de la República',
    issued_at: '1993-10-28',
    effective_from: '1993-10-28',
    effective_to: null,
    modifications: [],
    official_url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Leyes/1790106',
    topic: ['contratación estatal'],
    sector: ['sector público'],
    verified_at: '2026-07-30',
    corpus_version: 'legal-corpus-v1',
    verification_status: 'verified',
    validity_status: 'confirmed',
    applicability_status: 'applicable',
    ...overrides,
  };
}

// 1) El manifiesto real debe existir, cargar y validar de punta a punta.
{
  const manifest = loadManifest();
  assert.doesNotThrow(() => validateAgt002LegalManifest(manifest), 'el manifiesto real debe ser válido');
  assert.equal(manifest.corpus_version, 'legal-corpus-v1.1');
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length > 0, 'debe tener al menos una fuente');

  for (const source of manifest.sources) {
    assert.doesNotThrow(() => buildAgt002LegalSource(source), `fuente ${source.source_id} debe pasar el contrato Task29`);
  }

  const officialHostsUsed = new Set();
  for (const source of manifest.sources) {
    const host = new URL(source.official_url).hostname;
    const matches = AGT002_LEGAL_OFFICIAL_HOSTS.some(root => host === root || host.endsWith(`.${root}`));
    assert.ok(matches, `official_url de ${source.source_id} debe pertenecer a la allowlist oficial`);
    officialHostsUsed.add(host.replace(/^www\./, ''));
  }

  // Toda fuente marcada como verified+confirmed+applicable exige effective_from (vigencia sustentable).
  for (const source of manifest.sources) {
    if (source.verification_status === 'verified' && source.validity_status === 'confirmed' && source.applicability_status === 'applicable') {
      assert.ok(source.effective_from, `${source.source_id} declara vigencia confirmada y debe tener effective_from`);
    }
  }

  // No debe haber ninguna fuente incierta presentada como si fuera derecho verificado sin abstención posible:
  // es decir, toda fuente con algún estado distinto de verified/confirmed/applicable debe quedar detectable.
  // En corpus-v1 ninguna fuente tiene todavía evidencia auditable suficiente de vigencia,
  // modificaciones y aplicabilidad, por lo que todas deben abstenerse.
  for (const source of manifest.sources) {
    const evaluation = evaluateAgt002LegalSourceStatus(source, { as_of: '2026-07-30', stale_after_days: 180 });
    assert.equal(evaluation.eligible_for_verified_law, false, `${source.source_id} no puede elevarse a verified_law`);
    assert.equal(evaluation.requires_human_legal_review, true);
  }
}

// 2) source_id únicos en el manifiesto real.
{
  const manifest = loadManifest();
  const ids = manifest.sources.map(s => s.source_id);
  assert.equal(ids.length, new Set(ids).size, 'source_id debe ser único en el manifiesto');
}

// 3) corpus_version consistente en todas las fuentes del manifiesto real.
{
  const manifest = loadManifest();
  const versions = new Set(manifest.sources.map(s => s.corpus_version));
  assert.equal(versions.size, 1, 'todas las fuentes deben compartir corpus_version');
  assert.ok(versions.has(manifest.corpus_version));
}

// 4) El validador rechaza: texto/artículo ausente.
{
  const manifest = { corpus_version: 'legal-corpus-v1', sources: [makeValidSource({ current_text: '' })] };
  assert.throws(() => validateAgt002LegalManifest(manifest), /current_text|texto/i);
  const manifest2 = { corpus_version: 'legal-corpus-v1', sources: [(() => { const s = makeValidSource(); delete s.article_or_section; return s; })()] };
  assert.throws(() => validateAgt002LegalManifest(manifest2), /article_or_section/i);
}

// 5) El validador rechaza dominio no oficial.
{
  const manifest = { corpus_version: 'legal-corpus-v1', sources: [makeValidSource({ official_url: 'https://www.blogjuridico.com/ley-80' })] };
  assert.throws(() => validateAgt002LegalManifest(manifest), /host|oficial|allowlist/i);
}

// 6) El validador rechaza verified_at ausente.
{
  const s = makeValidSource();
  delete s.verified_at;
  const manifest = { corpus_version: 'legal-corpus-v1', sources: [s] };
  assert.throws(() => validateAgt002LegalManifest(manifest), /verified_at/i);
}

// 7) El validador rechaza source_id duplicado.
{
  const manifest = { corpus_version: 'legal-corpus-v1', sources: [makeValidSource(), makeValidSource()] };
  assert.throws(() => validateAgt002LegalManifest(manifest), /duplicad/i);
}

// 8) El validador rechaza estado de modificación desconocido.
{
  const s = makeValidSource({
    modifications: [{
      modification_id: 'mod-1',
      modifying_norm_id: 'ley-1150-2007',
      modification_type: 'modification',
      scope: 'partial',
      effective_date: null,
      official_url: null,
      resolution_status: 'desconocido',
    }],
  });
  const manifest = { corpus_version: 'legal-corpus-v1', sources: [s] };
  assert.throws(() => validateAgt002LegalManifest(manifest), /resolution_status|resolved|unresolved/i);
}

// 9) El validador rechaza ausencia de tags de aplicabilidad/tema/sector.
{
  const s1 = makeValidSource({ topic: [] });
  assert.throws(() => validateAgt002LegalManifest({ corpus_version: 'legal-corpus-v1', sources: [s1] }), /topic/i);
  const s2 = makeValidSource();
  delete s2.applicability_status;
  assert.throws(() => validateAgt002LegalManifest({ corpus_version: 'legal-corpus-v1', sources: [s2] }), /applicability_status/i);
}

// 10) El validador rechaza claves desconocidas en una fuente.
{
  const s = makeValidSource({ unexpected_field: 'x' });
  assert.throws(() => validateAgt002LegalManifest({ corpus_version: 'legal-corpus-v1', sources: [s] }), /clave|desconocid/i);
}

// 11) El validador rechaza corpus_version mezclado entre fuentes o distinto del declarado en el manifiesto.
{
  const s1 = makeValidSource();
  const s2 = makeValidSource({ source_id: 'ley-1150-2007-art-2', corpus_version: 'legal-corpus-v2' });
  assert.throws(() => validateAgt002LegalManifest({ corpus_version: 'legal-corpus-v1', sources: [s1, s2] }), /corpus_version/i);
}

// 12) El validador rechaza que una fuente incierta se presente como verificada sin abstención:
// verification_status=unverified pero validity_status=confirmed y applicability_status=applicable
// no puede coexistir con una declaración externa de "requires_human_legal_review=false" implícita;
// el validador exige que toda incertidumbre real (unverified/uncertain) quede marcada como tal y no
// se "limpie" para aparentar certeza total.
{
  const s = makeValidSource({ verification_status: 'unverified', validity_status: 'confirmed', applicability_status: 'applicable' });
  // unverified + confirmed + applicable es una combinación contradictoria: si la fuente no está
  // verificada, no puede simultáneamente darse su vigencia y aplicabilidad por confirmadas/aplicables.
  assert.throws(() => validateAgt002LegalManifest({ corpus_version: 'legal-corpus-v1', sources: [s] }), /verification_status|incertidumbre|verified/i);
}

console.log('AGT-002 legal corpus manifest contract passed');
