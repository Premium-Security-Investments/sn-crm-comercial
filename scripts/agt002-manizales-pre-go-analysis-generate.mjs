// Generador OFFLINE y read-only del BLOQUE LOCAL DE ANÁLISIS PRE-GO GOBERNADO de Rama
// Judicial Manizales SA-24-2026.
//
// No accede a Supabase, red, Vercel, SharePoint ni secretos. Lee EXCLUSIVAMENTE artefactos
// LOCALES ya versionados en el repositorio:
//   - el registro contractual generado  docs/governance/registro/manizales-sa-24-2026.registry.json
//   - el borrador de gobernanza local    docs/governance/drafts/agt002-rama-judicial-*.v1.json
//     (de allí se toman, por identificador, el enlace gobernado requisito->clase de evidencia
//      y qué requisitos gobernados son «habilitating»)
// y cruza cada sección relevante con la evidencia empresarial gobernada. En el entorno LOCAL
// la bóveda de evidencia (17 clases, Supabase) NO es observable y NO hay corpus legal
// publicado: por diseño, las secciones relevantes quedan honestamente unverifiable y la
// verificación jurídica queda oculta (gated). Reproducible: mismo insumo => mismo artefacto
// (salvo generated_at).
//
// Uso:
//   node scripts/agt002-manizales-pre-go-analysis-generate.mjs [generatedAtIso]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgt002PreGoAnalysis,
  validateAgt002PreGoAnalysis,
  AGT002_PRE_GO_CROSS_STATES,
} from '../agt002-pre-go-analysis.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_JSON = resolve(PROJECT_ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const GOVERNANCE_DRAFT_JSON = resolve(PROJECT_ROOT, 'docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json');
const OUTPUT_JSON = resolve(PROJECT_ROOT, 'docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json');
const OUTPUT_MD = resolve(PROJECT_ROOT, 'docs/governance/analisis/2026-08-12-manizales-pre-go-analisis.md');

// El corpus legal PUBLICADO vive en Supabase (compuerta humana). En local no hay versión
// publicada, así que la verificación jurídica queda gated por diseño (no se inventa).
const LEGAL_CORPUS_VERSION_LOCAL = null;

function loadGovernedLinks() {
  const draft = JSON.parse(readFileSync(GOVERNANCE_DRAFT_JSON, 'utf8'));
  const evidenceClassLinkByRequirementId = {};
  for (const proposal of draft.evidence_class_link_proposals || []) {
    if (proposal?.requirement_id && proposal?.evidence_class_id) {
      evidenceClassLinkByRequirementId[proposal.requirement_id] = proposal.evidence_class_id;
    }
  }
  const habilitatingGovernedRequirementIds = (draft.category_override_proposals || [])
    .filter(p => p?.category_value === 'habilitating' && p?.requirement_id)
    .map(p => p.requirement_id);
  return { evidenceClassLinkByRequirementId, habilitatingGovernedRequirementIds, draftVersion: draft.version || null };
}

function pct(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 1000) / 10}%`;
}

function renderMarkdown(artifact, meta) {
  const cov = artifact.coverage;
  const rec = artifact.recommendation;
  const lines = [];
  lines.push('# Análisis pre-GO gobernado — Rama Judicial Manizales SA-24-2026');
  lines.push('');
  lines.push(`> Artefacto: \`docs/governance/analisis/manizales-sa-24-2026.pre-go-analysis.json\` (regenerable con`);
  lines.push('> `node scripts/agt002-manizales-pre-go-analysis-generate.mjs`). Estado: **draft_for_human_review**,');
  lines.push(`> \`human_approval_required: true\`. Generado: ${artifact.generated_at}.`);
  lines.push('');
  lines.push('Este bloque **cruza** cada sección relevante del registro contractual con la evidencia');
  lines.push('empresarial gobernada. **No decide cumplimiento, habilitación, puntaje ni GO/NO-GO**: esas son');
  lines.push('compuertas humanas. Pereira SA-MC-02-2026 se incorpora **sólo como patrón**, nunca como prueba.');
  lines.push('');
  lines.push('## Entorno local y sus límites');
  lines.push('');
  lines.push('- Bóveda de evidencia empresarial (17 clases): **no observable localmente** (vive en Supabase; no se accede).');
  lines.push('- Corpus legal publicado: **ausente** → la verificación jurídica **no se muestra** (gated).');
  lines.push('- Por ello, las secciones relevantes con enlace gobernado quedan honestamente **unverifiable** (no *missing*).');
  lines.push('');
  lines.push('## Matriz de estados (cobertura estructural, no exhaustividad humana)');
  lines.push('');
  lines.push('| Estado de cruce | Secciones |');
  lines.push('|---|---|');
  for (const state of AGT002_PRE_GO_CROSS_STATES) {
    lines.push(`| ${state} | ${cov.por_estado[state]} |`);
  }
  lines.push(`| **Total** | **${cov.total_secciones}** |`);
  lines.push('');
  lines.push(`- Secciones relevantes pre-GO (oferta): **${cov.secciones_relevantes_pre_go}** de ${cov.total_secciones} (${pct(cov.secciones_relevantes_pre_go, cov.total_secciones)}).`);
  lines.push(`- Secciones no aplicables pre-GO (explicadas por fase): **${cov.secciones_no_aplicables_pre_go}**.`);
  lines.push('');
  lines.push('### Por fase');
  lines.push('');
  lines.push('| Fase | Política probatoria | Secciones |');
  lines.push('|---|---|---|');
  for (const [fase, n] of Object.entries(cov.por_fase)) {
    lines.push(`| ${fase} | ${artifact.fase_evidence_policy[fase] || '—'} | ${n} |`);
  }
  lines.push('');
  lines.push('> Fases que **no** requieren evidencia pre-GO del proponente: `postadjudicacion`, `ejecucion_tecnica`');
  lines.push('> (obligaciones de ejecución post-adjudicación), `evaluacion` (regla de la entidad) y la mayoría de');
  lines.push('> `generalidad` (contexto), salvo secciones del Capítulo I que reexpresan un requisito habilitante.');
  lines.push('');
  lines.push('## Secciones relevantes (cruce sección ↔ evidencia)');
  lines.push('');
  lines.push('| Sección | Fase | Estado | Razón | Subsanabilidad |');
  lines.push('|---|---|---|---|---|');
  for (const c of artifact.crossings.filter(x => x.pre_go_relevant)) {
    lines.push(`| ${c.item_ref} | ${c.fase} | ${c.cross_state} | ${c.reason} | ${c.subsanabilidad} |`);
  }
  lines.push('');
  lines.push('## Bloqueadores');
  lines.push('');
  if (artifact.blockers.length === 0) {
    lines.push('- (sin bloqueadores)');
  } else {
    for (const b of artifact.blockers) {
      const refs = b.affected_item_refs.length ? ` — secciones: ${b.affected_item_refs.join(', ')}` : '';
      lines.push(`- **[${b.class}] ${b.id}**: ${b.summary}${refs}`);
      lines.push(`  - Remediación: ${b.remediation} (responsable sugerido: ${b.human_owner}).`);
    }
  }
  lines.push('');
  lines.push('## Preguntas indispensables (para el humano)');
  lines.push('');
  for (const q of artifact.indispensable_questions) {
    lines.push(`- **${q.id}** (eje: ${q.blocks_axis}): ${q.question}`);
  }
  lines.push('');
  lines.push('## Abstenciones');
  lines.push('');
  lines.push(`- Cobertura **estructural**, no exhaustividad humana: ${artifact.abstentions.not_human_exhaustive}`);
  for (const a of artifact.abstentions.module_abstentions) {
    const scope = Array.isArray(a.scope) ? (a.scope.length ? a.scope.join(', ') : '(ninguna)') : a.scope;
    lines.push(`- **${a.axis}** (${scope}): ${a.reason}`);
  }
  lines.push('');
  lines.push('## Riesgos');
  lines.push('');
  for (const domain of Object.keys(artifact.risks)) {
    lines.push(`### ${domain}`);
    for (const r of artifact.risks[domain]) {
      lines.push(`- (${r.confidence}) ${r.risk} _[${r.basis}]_`);
    }
    lines.push('');
  }
  lines.push('## Recomendación (SÓLO candidata — GO/NO-GO humano obligatorio)');
  lines.push('');
  lines.push(`- **recommendation_candidate: ${rec.recommendation_candidate}** (confianza: ${rec.confidence}).`);
  lines.push(`- ${rec.note}`);
  lines.push('- A favor:');
  for (const a of rec.arguments_for) lines.push(`  - ${a}`);
  lines.push('- En contra:');
  for (const a of rec.arguments_against) lines.push(`  - ${a}`);
  lines.push('');
  lines.push('## Patrón Pereira (taxonomía y escalera probatoria — no prueba de Manizales)');
  lines.push('');
  lines.push(`- Caso: ${artifact.pereira_pattern.case.case} — uso: \`${artifact.pereira_pattern.applies_to_manizales}\`.`);
  lines.push(`- Universales: ${artifact.pereira_pattern.buckets.universales.length}; variables por proceso: ${artifact.pereira_pattern.buckets.variables_por_proceso.length}; post-adjudicación: ${artifact.pereira_pattern.buckets.postadjudicacion.length}.`);
  lines.push('');
  lines.push('## Límites probatorios');
  lines.push('');
  for (const limit of artifact.probative_limits) lines.push(`- ${limit}`);
  lines.push('');
  lines.push(`> Enlace gobernado tomado del borrador local v${meta.draftVersion} (\`docs/governance/drafts/…\`);`);
  lines.push('> requisitos habilitantes: ' + meta.habilitatingGovernedRequirementIds.join(', ') + '.');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const generatedAt = process.argv[2] || new Date().toISOString();
  const registry = JSON.parse(readFileSync(REGISTRY_JSON, 'utf8'));
  const { evidenceClassLinkByRequirementId, habilitatingGovernedRequirementIds, draftVersion } = loadGovernedLinks();

  const artifact = buildAgt002PreGoAnalysis({
    registry,
    evidenceClasses: [], // la bóveda de evidencia empresarial no es observable localmente
    evidenceClassLinkByRequirementId,
    habilitatingGovernedRequirementIds,
    legalCorpusVersion: LEGAL_CORPUS_VERSION_LOCAL,
    generatedAt,
  });

  validateAgt002PreGoAnalysis(artifact);
  assertNoOpenPii(artifact);

  const markdown = renderMarkdown(artifact, { draftVersion, habilitatingGovernedRequirementIds });

  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  writeFileSync(OUTPUT_MD, markdown, 'utf8');

  const cov = artifact.coverage;
  process.stdout.write(
    `pre-GO analysis generado: ${cov.total_secciones} secciones, ${cov.secciones_relevantes_pre_go} relevantes.\n`
    + `estados: ${AGT002_PRE_GO_CROSS_STATES.map(s => `${s}=${cov.por_estado[s]}`).join(' ')}\n`
    + `recommendation_candidate=${artifact.recommendation.recommendation_candidate} (GO/NO-GO humano obligatorio)\n`
    + `-> ${OUTPUT_JSON}\n-> ${OUTPUT_MD}\n`,
  );
}

main();
