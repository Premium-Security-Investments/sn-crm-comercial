import { readAgt002InitialAnalysisStatus } from './agt002-initial-analysis-status.js';

function readError(label) {
  const error = new Error(label);
  error.code = 'AGT002_INITIAL_REPORT_READ_FAILED';
  return error;
}

const arr = value => (Array.isArray(value) ? value : []);
const text = value => (typeof value === 'string' ? value : '');

/**
 * Pure projection of a stored pre_go_analysis.v2 aggregate into the closed shape the CRM renders. It carries
 * only what a person reviews (conclusions, findings, requirements, gaps, sources); it never forwards raw
 * hashes, the check catalog or the server-stamped identity block.
 */
export function projectAgt002InitialReport(envelope, documentNames = new Map()) {
  const nameOf = id => documentNames.get(id) ?? null;
  const claims = arr(envelope?.claims).map(claim => ({
    id: text(claim.claim_id),
    type: text(claim.claim_type),
    text: text(claim.display_text),
    materiality: text(claim.materiality),
    evidenceStatus: text(claim.evidence_status),
    inferenceBasis: typeof claim.inference_basis === 'string' ? claim.inference_basis : null,
    sources: arr(claim.source_refs).map(ref => ({
      documentId: text(ref.document_id),
      documentName: nameOf(ref.document_id),
      locator: text(ref.locator),
    })),
  }));
  const recommendation = envelope?.recommendation ?? {};
  return {
    runId: text(envelope?.meta?.analysis_run_id),
    cutoffAt: text(envelope?.meta?.cutoff_at),
    createdAt: text(envelope?.meta?.created_at),
    modelProfile: text(envelope?.meta?.model_profile_id),
    recommendation: {
      kind: text(recommendation.kind),
      label: text(recommendation.label),
      confidence: text(recommendation.confidence),
      limitations: arr(recommendation.limitations).map(text).filter(Boolean),
      basisClaimIds: arr(recommendation.basis_claim_ids).map(text),
    },
    processStatus: text(envelope?.process_analysis?.status),
    companyFitAuthorized: envelope?.company_fit?.status !== 'NOT_AUTHORIZED',
    companyFitLabel: text(envelope?.company_fit?.overall_label),
    checksExecuted: arr(envelope?.checks).some(check => check?.execution_status === 'EXECUTED'),
    documents: arr(envelope?.evidence_package?.member_refs).map(member => ({
      id: text(member.document_id),
      name: nameOf(member.document_id),
    })),
    deadlines: arr(envelope?.meta?.process_deadlines).map(deadline => ({
      kind: text(deadline.kind),
      value: typeof deadline.value === 'string' ? deadline.value : null,
      certainty: text(deadline.certainty),
      status: text(deadline.status),
    })),
    coverage: arr(envelope?.coverage).map(entry => ({
      block: text(entry.block),
      status: text(entry.status),
      critical: entry.critical === true,
      gapReason: typeof entry.gap_reason === 'string' ? entry.gap_reason : null,
    })),
    findings: arr(envelope?.findings).map(finding => ({
      id: text(finding.finding_id),
      severity: text(finding.severity),
      category: text(finding.category),
      title: text(finding.title),
      impact: text(finding.impact),
      blocker: finding.blocker === true,
      claimIds: arr(finding.claim_ids).map(text),
    })),
    requirements: arr(envelope?.requirements).map(requirement => ({
      id: text(requirement.requirement_id),
      category: text(requirement.category),
      textClaimId: text(requirement.text_claim_id),
      applicability: text(requirement.applicability),
      companyEvaluation: text(requirement.company_evaluation),
      blocker: requirement.blocker === true,
      requiredAction: typeof requirement.required_action === 'string' ? requirement.required_action : null,
    })),
    openItems: arr(envelope?.open_items).map(item => ({
      id: text(item.open_item_id),
      kind: text(item.kind),
      description: text(item.description),
      critical: item.critical === true,
      status: text(item.status),
      ownerRole: typeof item.owner_role === 'string' ? item.owner_role : null,
      dueAt: typeof item.due_at === 'string' ? item.due_at : null,
    })),
    contradictions: arr(envelope?.contradictions).map(item => ({
      id: text(item.contradiction_id),
      topic: text(item.topic),
      impact: text(item.impact),
      status: text(item.status),
      requiredAction: typeof item.required_action === 'string' ? item.required_action : null,
      claimIds: arr(item.claim_ids).map(text),
    })),
    claims,
  };
}

/** Read-only: returns the review report only when the canonical INITIAL status is `ready`. */
export async function readAgt002InitialAnalysisReport(database, opportunityId) {
  const status = await readAgt002InitialAnalysisStatus(database, opportunityId);
  if (status.state !== 'ready') return { available: false, state: status.state, report: null };

  const { data: version, error } = await database
    .from('psi_agt002_pre_go_analysis_versions')
    .select('analysis_run_id,aggregate_version,schema_version,envelope')
    .eq('analysis_run_id', status.runId)
    .order('aggregate_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !version?.envelope || typeof version.envelope !== 'object') {
    throw readError('No fue posible leer el reporte del análisis inicial.');
  }

  const documentIds = arr(version.envelope.evidence_package?.member_refs).map(member => member?.document_id).filter(Boolean);
  const documentNames = new Map();
  if (documentIds.length > 0) {
    const { data: documents, error: documentsError } = await database
      .from('psi_tender_document_versions')
      .select('id,name')
      .in('id', documentIds);
    if (documentsError) throw readError('No fue posible leer los documentos del reporte inicial.');
    for (const document of arr(documents)) if (typeof document?.name === 'string') documentNames.set(document.id, document.name);
  }
  return {
    available: true,
    state: 'ready',
    report: projectAgt002InitialReport(version.envelope, documentNames),
  };
}
