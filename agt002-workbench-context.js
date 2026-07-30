import { validateAgt002WorkbenchContinuityReference } from './agt002-tender-adapter.js';

function dossierLink(link_kind, resource_id, label, source_ref) {
  return { link_kind, resource_id, label, source_ref };
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

  const dossierLinks = [
    dossierLink('snapshot', validated.snapshot_id, 'Expediente documental analizado por Vig-IA', `psi_tender_document_snapshots:${validated.snapshot_id}`),
    dossierLink('source', validated.canonical_run_id, 'Análisis canónico Vig-IA', `psi_tender_analysis_runs:${validated.canonical_run_id}`),
  ];
  if (validated.context_version_id) {
    dossierLinks.push(dossierLink('source', validated.context_version_id, 'Versión de contexto Vig-IA', `psi_agt002_context_versions:${validated.context_version_id}`));
  }
  if (validated.legal_corpus_version_id) {
    dossierLinks.push(dossierLink('source', validated.legal_corpus_version_id, 'Corpus jurídico verificado', `psi_agt002_legal_corpus_versions:${validated.legal_corpus_version_id}`));
  }

  return {
    opportunity_id: validated.opportunity_id,
    tender_id: validated.tender_id,
    snapshot_id: validated.snapshot_id,
    canonical_run_id: validated.canonical_run_id,
    context_version_id: validated.context_version_id,
    legal_corpus_version_id: validated.legal_corpus_version_id,
    evidence_coverage: validated.evidence_coverage,
    open_questions: validated.open_questions.map(({ id, text, critical }) => ({ id, text, critical })),
    dossier_links: dossierLinks,
  };
}
