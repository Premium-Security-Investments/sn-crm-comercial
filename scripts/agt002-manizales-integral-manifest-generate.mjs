// Generador OFFLINE y read-only del MANIFIESTO INTEGRAL versionado de Rama Judicial Manizales
// SA-24-2026. Consolida, de forma determinista, las tres fuentes gobernadas locales (registro
// contractual, análisis pre-GO y propuestas de sección) más el espejo congelado de los 3 bindings
// de la migración 066.
//
// No accede a Supabase, red, Vercel, SharePoint ni secretos. Lee EXCLUSIVAMENTE los tres artefactos
// JSON gobernados locales y aplica la guarda de PII antes de escribir. El artefacto es
// `validated_candidate` / `human_approved: false`: NO habilita, NO puntúa, NO afirma cumplimiento.
// Reproducible: mismo insumo + misma marca ISO => artefacto byte-idéntico.
//
// Uso:
//   node scripts/agt002-manizales-integral-manifest-generate.mjs [generatedAtIso]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgt002ManizalesIntegralManifest,
  validateAgt002ManizalesIntegralManifest,
} from '../agt002-manizales-integral-manifest.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_JSON = resolve(PROJECT_ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const ANALYSIS_JSON = resolve(PROJECT_ROOT, 'docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json');
const PROPOSALS_JSON = resolve(PROJECT_ROOT, 'docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json');
const OUTPUT_JSON = resolve(PROJECT_ROOT, 'data/agt002/manizales-sa-24-2026.integral-manifest.v1.json');
const OUTPUT_MD = resolve(PROJECT_ROOT, 'docs/governance/manizales-sa-24-2026.integral-manifest-consolidated.md');

function renderMarkdown(m) {
  const lines = [];
  lines.push('# Manifiesto integral versionado — Rama Judicial Manizales SA-24-2026');
  lines.push('');
  lines.push('> Artefacto: `data/agt002/manizales-sa-24-2026.integral-manifest.v1.json` (regenerable con');
  lines.push('> `node scripts/agt002-manizales-integral-manifest-generate.mjs`). Estado: **validated_candidate**,');
  lines.push(`> \`human_approval_required: true\`, \`human_approved: false\`. Generado: ${m.generated_at}.`);
  lines.push('');
  lines.push('Consolida las tres fuentes gobernadas (registro contractual, análisis pre-GO y propuestas de');
  lines.push('sección) y el espejo de los 3 bindings de la migración 066. **No habilita, no puntúa y no afirma');
  lines.push('cumplimiento ni suficiencia**: la aplicabilidad, la suficiencia, la subsanabilidad y el GO/NO-GO son');
  lines.push('compuertas humanas. La categoría es metadato de gobernanza, nunca una decisión de cumplimiento.');
  lines.push('');
  lines.push('## Cobertura');
  lines.push('');
  lines.push(`- Secciones del registro: **${m.coverage.registry_sections}**; documentos fuente: **${m.source_documents.length}**.`);
  lines.push(`- Propuestas curadas: **${m.coverage.proposals}** en **${m.coverage.proposal_sections}** secciones.`);
  lines.push(`- Requisitos gobernados en tiempo de ejecución: **${m.coverage.governed_runtime}**; bindings 066: **${m.coverage.governed_bindings_066}**.`);
  lines.push(`- section_ledger: **${m.coverage.section_ledger.total}** (analyzed_candidate ${m.coverage.section_ledger.by_disposition.analyzed_candidate}).`);
  lines.push(`- proposal_ledger: **${m.coverage.proposal_ledger.total}** (analyzed_candidate ${m.coverage.proposal_ledger.by_disposition.analyzed_candidate}).`);
  lines.push(`- Entradas: **${m.coverage.entries.total}** (analizables ${m.coverage.entries.analyzable}, unresolved_visible ${m.coverage.entries.unresolved_visible}).`);
  lines.push('');
  lines.push('## Entradas por categoría de gobernanza');
  lines.push('');
  lines.push('| categoría | # |');
  lines.push('|---|---|');
  for (const [k, n] of Object.entries(m.coverage.entries.by_category)) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  lines.push('## section_ledger (15 secciones pre-GO)');
  lines.push('');
  lines.push('| item_ref | fase | disposición | origen | produce |');
  lines.push('|---|---|---|---|---|');
  for (const s of m.section_ledger) {
    lines.push(`| ${s.item_ref} | ${s.fase} | ${s.disposition} | ${s.origin} | ${s.produced_requirement_ids.length} |`);
  }
  lines.push('');
  lines.push('## Entradas gobernadas y compuertas');
  lines.push('');
  lines.push('| requirement_id | origen | item_ref | categoría | clase de evidencia | materialidad | analizable |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const e of m.entries) {
    lines.push(`| \`${e.requirement_id}\` | ${e.origin} | ${e.item_ref ?? '—'} | ${e.category ?? '—'} | ${e.evidence_class_id ?? '—'} | ${e.materiality} | ${e.analyzable ? 'sí' : 'no'} |`);
  }
  lines.push('');
  lines.push('## Límites probatorios');
  lines.push('');
  for (const limit of m.probative_limits) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const generatedAt = process.argv[2] || new Date().toISOString();
  const registry = JSON.parse(readFileSync(REGISTRY_JSON, 'utf8'));
  const analysis = JSON.parse(readFileSync(ANALYSIS_JSON, 'utf8'));
  const proposals = JSON.parse(readFileSync(PROPOSALS_JSON, 'utf8'));

  const manifest = buildAgt002ManizalesIntegralManifest({ registry, analysis, proposals, generatedAt });

  validateAgt002ManizalesIntegralManifest(manifest);
  assertNoOpenPii(manifest);

  const markdown = renderMarkdown(manifest);

  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  mkdirSync(dirname(OUTPUT_MD), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(OUTPUT_MD, markdown, 'utf8');

  process.stdout.write(
    `manifiesto integral generado: ${manifest.coverage.section_ledger.total} secciones + ${manifest.coverage.proposal_ledger.total} propuestas, `
    + `${manifest.coverage.entries.total} entradas (validated_candidate).\n-> ${OUTPUT_JSON}\n-> ${OUTPUT_MD}\n`,
  );
}

main();
