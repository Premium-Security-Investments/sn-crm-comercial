// AGT-002 · Cobertura territorial temprana (Juan, 2026-10-13): sedes y licencia en el perfil
// congelado, veredicto de participación en la política del análisis y en la vista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { buildAgt002CompanyDossier, loadAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_CONTEXT_V2_FIELDS, buildAgt002ContextV2 } from '../agt002-context-v2.js';
import { AGT002_PARTICIPATION_VERDICTS } from '../agt002-initial-analysis-runtime.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bundle = buildSync({ entryPoints: [new URL('../src/tenders/companyCoverage.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const coverage = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

// Sedes reales informadas por Juan el 2026-10-13 (migración 127).
const SITES = [
  { id: 's1', department: 'Risaralda', city: 'Pereira', is_main: true, supervigilancia_authorization: null },
  { id: 's2', department: 'Antioquia', city: 'Medellín', is_main: false },
  { id: 's3', department: 'Bogotá D.C.', city: 'Bogotá', is_main: false },
  { id: 's4', department: 'Valle del Cauca', city: 'Cartago', is_main: false },
  { id: 's5', department: 'Caldas', city: 'Manizales', is_main: false },
  { id: 's6', department: 'Valle del Cauca', city: 'Cali', is_main: false },
  { id: 's7', department: 'Quindío', city: 'Armenia', is_main: false, supervigilancia_authorization: 'Pendiente de resolución de la SVSP' },
];

test('Veredicto de participación leído de recommendation.label', () => {
  assert.deepEqual(coverage.participationVerdict('Solo en unión temporal: sin sede en Bolívar, Casanare y Nariño; el socio debe aportarlas.'),
    { kind: 'union_temporal', title: 'Solo en unión temporal', detail: 'sin sede en Bolívar, Casanare y Nariño; el socio debe aportarlas.' });
  assert.equal(coverage.participationVerdict('Puede presentarse sola. Cumple sedes, licencia y códigos.').kind, 'sola');
  assert.equal(coverage.participationVerdict('No puede presentarse: el pliego no admite uniones temporales.').kind, 'no_puede');
  assert.equal(coverage.participationVerdict('Seguir con condiciones: faltan soportes.'), null, 'los análisis viejos no muestran veredicto');
  assert.equal(coverage.participationVerdict(''), null);
  for (const phrase of AGT002_PARTICIPATION_VERDICTS) assert.ok(coverage.participationVerdict(`${phrase} detalle`), `la vista reconoce "${phrase}"`);
});

test('Perfil congelado: incluye sedes y alcance de la licencia; los dossiers viejos siguen siendo válidos', async () => {
  const profile = { id: 'p1', legal_name: 'SEGURIDAD NACIONAL LIMITADA', supervigilancia_license: 'Modalidades: vigilancia fija, móvil, medio canino, medio tecnológico.', updated_at: '2026-10-13T17:21:34Z' };
  const dossier = buildAgt002CompanyDossier({ profile, sites: SITES.map(site => ({ ...site, updated_at: '2026-10-13T17:00:00Z' })) });
  assert.deepEqual(Object.keys(dossier), [...AGT002_CONTEXT_V2_FIELDS.company_dossier, ...AGT002_CONTEXT_V2_FIELDS.company_dossier_optional]);
  assert.equal(dossier.sites.status, 'reported');
  assert.equal(dossier.sites.value.length, 7);
  assert.ok(dossier.sites.value.includes('department=Risaralda|city=Pereira|kind=sede_principal|supervigilancia_authorization=sin_observacion'));
  assert.ok(dossier.sites.value.includes('department=Quindío|city=Armenia|kind=agencia|supervigilancia_authorization=Pendiente de resolución de la SVSP'));
  assert.match(dossier.license_scope.value, /medio canino/);

  const empty = buildAgt002CompanyDossier({});
  assert.equal(empty.sites.status, 'not_verified');
  assert.equal(empty.license_scope.status, 'not_verified');

  // Un contexto congelado antes (sin sites ni license_scope) se sigue validando igual.
  const legacy = Object.fromEntries(AGT002_CONTEXT_V2_FIELDS.company_dossier.map(key => [key, dossier[key]]));
  const sourced = key => ({ status: 'not_verified', value: null, source: { type: 'system', reference: `missing:${key}`, observed_at: '2026-10-13T00:00:00.000Z' } });
  const context = buildAgt002ContextV2({
    snapshot_id: 'legacy', human_evidence: [], company_dossier: legacy,
    opportunity: Object.fromEntries(AGT002_CONTEXT_V2_FIELDS.opportunity.map(key => [key, sourced(key)])),
    commercial_context: Object.fromEntries(AGT002_CONTEXT_V2_FIELDS.commercial_context.map(key => [key, sourced(key)])),
  });
  assert.equal(Object.hasOwn(context.company_dossier, 'sites'), false);
  const { context_version: _version, ...raw } = context;
  assert.throws(() => buildAgt002ContextV2({ ...raw, company_dossier: { ...legacy, otra_clave: sourced('x') } }), /otra_clave/);
});

function fakeDatabase({ sitesError = null } = {}) {
  const result = (data, error = null) => ({ data, error });
  return {
    from(table) {
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        maybeSingle: async () => result({ id: 'p1', legal_name: 'SN', updated_at: '2026-10-13T00:00:00Z' }),
        then(resolve) {
          if (table === 'psi_company_sites') return resolve(sitesError ? result(null, sitesError) : result([{ department: 'Risaralda', city: 'Pereira', is_main: true, updated_at: '2026-10-13T00:00:00Z' }]));
          return resolve(result([]));
        },
      };
      return chain;
    },
  };
}

test('Perfil congelado: sin la tabla de sedes (127 sin aplicar) sigue funcionando; otros errores no se esconden', async () => {
  const withSites = await loadAgt002CompanyDossier(fakeDatabase());
  assert.equal(withSites.sites.value.length, 1);
  const withoutTable = await loadAgt002CompanyDossier(fakeDatabase({ sitesError: { code: '42P01', message: 'relation does not exist' } }));
  assert.equal(withoutTable.sites.status, 'not_verified');
  await assert.rejects(loadAgt002CompanyDossier(fakeDatabase({ sitesError: { code: '42501', message: 'permission denied' } })));
});

test('Política del análisis: veredicto de participación sólo cuando hay perfil de empresa', () => {
  const runtime = read('../agt002-initial-analysis-runtime.js');
  assert.match(runtime, /const PARTICIPATION_POLICY = ' Participación \(va primero\)/);
  assert.match(runtime, /claim_id CLM-PARTICIPACION/);
  assert.match(runtime, /company_profile\.sites/);
  assert.match(runtime, /company_profile\.license_scope/);
  assert.match(runtime, /policy: \(batch\.mode === 'incremental' \? INCREMENTAL_POLICY : ''\) \+ \(company \? SYNTHESIS_COMPANY_POLICY \+ PARTICIPATION_POLICY : SYNTHESIS_POLICY\) \+ WRITING_POLICY \+ DEADLINES_POLICY \+/);
  for (const phrase of AGT002_PARTICIPATION_VERDICTS) assert.ok(runtime.includes(`"${phrase}"`), `la política nombra "${phrase}"`);
});

test('Vista: el análisis muestra el veredicto; el Radar no cruza sedes (Juan, 2026-10-13)', () => {
  const radar = read('../src/tenders/TenderRadarView.tsx');
  assert.doesNotMatch(radar, /radarCoverageMark|loadCompanyBase|companySites/);
  for (const path of ['../src/tenders/components/TenderInitialReport.tsx', '../src/tenders/components/TenderInitialDecisionSummary.tsx']) {
    assert.match(read(path), /participationVerdict\(/);
  }
});
