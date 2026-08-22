import { validateAgt002WorkbenchContinuityReference } from './agt002-tender-adapter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function dossierLink(link_kind, resource_id, label, source_ref) {
  return { link_kind, resource_id, label, source_ref };
}

/**
 * The single place that decides which references the Mesa carries and how each one is
 * labelled/addressed. Snapshot and canonical run are always present; context version and
 * legal corpus version are appended only when the case actually has them.
 */
function buildDossierLinks({ snapshot_id, canonical_run_id, context_version_id, legal_corpus_version_id }) {
  const links = [
    dossierLink('snapshot', snapshot_id, 'Expediente documental analizado por Vig-IA', `psi_tender_document_snapshots:${snapshot_id}`),
    dossierLink('source', canonical_run_id, 'Análisis canónico Vig-IA', `psi_tender_analysis_runs:${canonical_run_id}`),
  ];
  if (context_version_id) {
    links.push(dossierLink('source', context_version_id, 'Versión de contexto Vig-IA', `psi_agt002_context_versions:${context_version_id}`));
  }
  if (legal_corpus_version_id) {
    links.push(dossierLink('source', legal_corpus_version_id, 'Corpus jurídico verificado', `psi_agt002_legal_corpus_versions:${legal_corpus_version_id}`));
  }
  return links;
}

/**
 * Builds the post-GO Mesa's continuity context from a validated pre-GO reference: opportunity,
 * snapshot, canonical analysis run, context version, evidence coverage, legal corpus version,
 * and open questions — carried forward by id only. `dossier_links` matches the existing
 * psi_agt002_workbench_message_links shape (link_kind/resource_id/label/source_ref) so the Mesa
 * can attach these as references to the same case dossier instead of a second copy of it.
 */
export function buildAgt002WorkbenchContinuityContext(reference) {
  const validated = validateAgt002WorkbenchContinuityReference(reference);

  return {
    opportunity_id: validated.opportunity_id,
    tender_id: validated.tender_id,
    snapshot_id: validated.snapshot_id,
    canonical_run_id: validated.canonical_run_id,
    context_version_id: validated.context_version_id,
    legal_corpus_version_id: validated.legal_corpus_version_id,
    evidence_coverage: validated.evidence_coverage,
    open_questions: validated.open_questions.map(({ id, text, critical }) => ({ id, text, critical })),
    dossier_links: buildDossierLinks(validated),
  };
}

/**
 * Translates the dossier-link shape into the closed 4-key shape the Mesa's message RPC
 * accepts (`kind`/`id`/`label`/`source_ref`). Keeping the translation here means the client
 * never has to invent, reshape or re-label a context link.
 */
function toMessageContextLinks(dossierLinks) {
  return dossierLinks.map(({ link_kind, resource_id, label, source_ref }) => ({
    kind: link_kind, id: resource_id, label, source_ref,
  }));
}

/**
 * Fail-closed shape gate for the analysis run row that may seed a Mesa. Only a run that is
 * simultaneously AGT-002, agent_ai, completed and canonical — with real snapshot/run/case
 * UUIDs — is allowed through. Anything else throws instead of degrading into a placeholder.
 */
function assertCanonicalRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('La Mesa Vig-IA requiere una corrida de análisis canónica para derivar su referencia inicial.');
  }
  if (run.producer !== 'AGT-002' || run.method !== 'agent_ai' || run.status !== 'completed' || run.canonical !== true) {
    throw new Error('Sólo un análisis canónico Vig-IA completado puede sembrar la referencia inicial de la Mesa.');
  }
  for (const [label, value] of [
    ['identificador de la corrida', run.id],
    ['oportunidad', run.opportunity_id],
    ['licitación', run.tender_id],
    ['snapshot documental', run.snapshot_id],
  ]) {
    if (!isUuid(value)) throw new Error(`La corrida canónica Vig-IA no tiene ${label} válido para la Mesa.`);
  }
  for (const [label, value] of [['versión de contexto', run.context_version_id], ['versión del corpus jurídico', run.legal_corpus_version_id]]) {
    if (value !== null && value !== undefined && !isUuid(value)) {
      throw new Error(`La ${label} de la corrida canónica Vig-IA no es un UUID válido.`);
    }
  }
  return run;
}

/**
 * Derives, entirely server-side, the canonical reference a freshly opened post-GO Mesa needs
 * before it has any job of its own: the analysed snapshot, the canonical analysis run, and the
 * safe context links that point at both. When the persisted run also carries the full
 * continuity material (open questions plus an evidence-coverage summary) the reference is
 * enriched through the existing continuity validator, so context version, legal corpus version,
 * open questions and coverage travel with it. When that material is absent or fails validation,
 * the minimum safe reference is returned rather than a fabricated one — never a placeholder UUID.
 */
export function buildAgt002WorkbenchInitialReference(run) {
  const source = assertCanonicalRun(run);
  const contextVersionId = source.context_version_id ?? null;
  const legalCorpusVersionId = source.legal_corpus_version_id ?? null;
  const coverage = source.result?.evidence_coverage;
  const openQuestions = source.result?.questions;

  let continuity = null;
  if (Array.isArray(openQuestions)
    && coverage && typeof coverage === 'object' && !Array.isArray(coverage)
    && typeof coverage.material_omissions === 'boolean'
    && Array.isArray(coverage.omitted_chunks)) {
    try {
      continuity = buildAgt002WorkbenchContinuityContext({
        opportunity_id: source.opportunity_id,
        tender_id: source.tender_id,
        snapshot_id: source.snapshot_id,
        canonical_run_id: source.id,
        context_version_id: contextVersionId,
        legal_corpus_version_id: legalCorpusVersionId,
        evidence_coverage: { material_omissions: coverage.material_omissions, omitted_count: coverage.omitted_chunks.length },
        open_questions: openQuestions,
      });
    } catch {
      // A run whose stored continuity material no longer validates still yields a usable
      // Mesa: it degrades to the minimum safe reference instead of blocking the case.
      continuity = null;
    }
  }

  const links = continuity
    ? continuity.dossier_links
    : buildDossierLinks({
      snapshot_id: source.snapshot_id,
      canonical_run_id: source.id,
      context_version_id: contextVersionId,
      legal_corpus_version_id: legalCorpusVersionId,
    });

  return {
    snapshot_id: source.snapshot_id,
    canonical_run_id: source.id,
    tender_id: source.tender_id,
    context_version_id: contextVersionId,
    legal_corpus_version_id: legalCorpusVersionId,
    evidence_coverage: continuity ? continuity.evidence_coverage : null,
    open_questions: continuity ? continuity.open_questions : [],
    context_links: toMessageContextLinks(links),
  };
}
