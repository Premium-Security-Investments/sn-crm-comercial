// Generador OFFLINE y read-only del OVERLAY DE PROPUESTAS CURADAS de requisitos para las diez
// secciones pre-GO sin requisito gobernado de Rama Judicial Manizales SA-24-2026
// (2.3, 2.4, 2.4.1, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6).
//
// No accede a Supabase, red, Vercel, SharePoint ni secretos. Lee EXCLUSIVAMENTE el registro
// contractual local ya versionado y deriva las propuestas del CUERPO del pliego vigente por
// offsets (nunca del índice/TOC, nunca contenido inventado). El artefacto es
// `proposed_for_human_review` / `is_approved: false`: NO aprueba requisitos ni afirma
// cumplimiento. Reproducible: mismo insumo => mismo artefacto (salvo generated_at).
//
// Uso:
//   node scripts/agt002-manizales-pre-go-section-proposals-generate.mjs [generatedAtIso]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgt002PreGoSectionProposals,
  validateAgt002PreGoSectionProposals,
  iterateProposalRequirements,
} from '../agt002-pre-go-section-proposals.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_JSON = resolve(PROJECT_ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const OUTPUT_JSON = resolve(PROJECT_ROOT, 'docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json');
const OUTPUT_MD = resolve(PROJECT_ROOT, 'docs/governance/propuestas/2026-08-12-manizales-pre-go-propuestas.md');

function renderMarkdown(artifact) {
  const lines = [];
  lines.push('# Propuestas curadas de requisitos pre-GO — Rama Judicial Manizales SA-24-2026');
  lines.push('');
  lines.push('> Artefacto: `docs/governance/propuestas/manizales-sa-24-2026.section-proposals.json` (regenerable con');
  lines.push('> `node scripts/agt002-manizales-pre-go-section-proposals-generate.mjs`). Estado: **proposed_for_human_review**,');
  lines.push(`> \`human_approval_required: true\`, \`is_approved: false\`. Generado: ${artifact.generated_at}.`);
  lines.push('');
  lines.push('Overlay **LOCAL** que atomiza las diez secciones pre-GO **sin requisito gobernado** en requisitos');
  lines.push('estables derivados del **cuerpo** del pliego vigente. **No aprueba requisitos, no habilita, no puntúa');
  lines.push('y no afirma cumplimiento ni suficiencia**: la aplicabilidad, la suficiencia y el GO/NO-GO son compuertas');
  lines.push('humanas. Pereira SA-MC-02-2026 se usa **sólo como lección/provenance**, nunca como prueba.');
  lines.push('');
  lines.push('## Cobertura');
  lines.push('');
  lines.push(`- Secciones cubiertas: **${artifact.coverage.sections}** (${artifact.covers_refs.join(', ')}).`);
  lines.push(`- Requisitos propuestos: **${artifact.coverage.requirements}**.`);
  lines.push(`- Con clase de evidencia empresarial candidata (1:1 de las 17): **${artifact.coverage.with_candidate_evidence_class}**; sin clase: **${artifact.coverage.without_candidate_evidence_class}**.`);
  lines.push('');
  lines.push('| requirement_kind | # |');
  lines.push('|---|---|');
  for (const [k, n] of Object.entries(artifact.coverage.by_requirement_kind)) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  lines.push('## Requisitos propuestos por sección');
  lines.push('');
  for (const section of artifact.sections) {
    lines.push(`### ${section.item_ref} — ${section.titulo} (${section.fase})`);
    lines.push('');
    lines.push('| requirement_id | kind | offer_stage | evidence_need | clase candidata | subsanabilidad |');
    lines.push('|---|---|---|---|---|---|');
    for (const r of section.requirements) {
      lines.push(`| \`${r.requirement_id}\` | ${r.requirement_kind} | ${r.offer_stage} | ${r.evidence_need} | ${r.candidate_evidence_class_id || '—'} | ${r.subsanability.candidate} |`);
    }
    lines.push('');
    for (const r of section.requirements) {
      const c = r.source_citation;
      lines.push(`- **${r.label}**`);
      lines.push(`  - Racional: ${r.rationale}`);
      lines.push(`  - Cita corporal (${c.document_name} [${c.char_start}..${c.char_end}]): «${c.quote}»`);
      lines.push(`  - Aplicabilidad: ${r.applicability_gate.decision} (${r.applicability_gate.owner}); Suficiencia: ${r.sufficiency_gate.decision} (${r.sufficiency_gate.owner}).`);
    }
    lines.push('');
  }
  lines.push('## Límites probatorios');
  lines.push('');
  for (const limit of artifact.probative_limits) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const generatedAt = process.argv[2] || new Date().toISOString();
  const registry = JSON.parse(readFileSync(REGISTRY_JSON, 'utf8'));

  const artifact = buildAgt002PreGoSectionProposals({ registry, generatedAt });

  validateAgt002PreGoSectionProposals(artifact);
  assertNoOpenPii(artifact);

  const markdown = renderMarkdown(artifact);

  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  writeFileSync(OUTPUT_MD, markdown, 'utf8');

  const total = [...iterateProposalRequirements(artifact)].length;
  process.stdout.write(
    `propuestas pre-GO generadas: ${artifact.coverage.sections} secciones, ${total} requisitos propuestos (proposed_for_human_review).\n`
    + `-> ${OUTPUT_JSON}\n-> ${OUTPUT_MD}\n`,
  );
}

main();
