import type { ReactNode } from 'react';

export type TenderModuleView = 'radar' | 'seguimiento' | 'oportunidades' | 'configuracion';
export type TenderRequest = <T>(path: string, options?: RequestInit) => Promise<T>;
export type TenderSection = 'hacer' | 'revisar' | 'prioridad_baja';
export type TenderInternalStatus = 'nueva' | 'en_revision' | 'convertida_oportunidad' | 'descartada';
export type TenderDeadlineFilter = 'todas' | '0_7' | '8_15' | '16_30' | 'vencida' | 'sin_fecha';
export type TenderValueFilter = 'todas' | 'sin_valor' | 'lt_50m' | '50m_500m' | '500m_plus' | '1000m_plus';
export type TenderScoreFilter = 'todas' | 'alto' | 'medio' | 'bajo';
export type TenderSortKey = 'deadline' | 'value' | 'score' | 'entity' | 'source';
export type TenderRegionKey = 'todas' | 'bog_cundinamarca' | 'med_antioquia' | 'eje_cafetero' | 'cali_valle' | 'costa_caribe' | 'santanderes' | 'sur_occidente' | 'otros';
export type TenderTrackingStatus = 'pendiente_revision' | 'analizando' | 'esperando_informacion' | 'listo_para_decision' | 'bloqueado';

export type PublicTender = {
  id: string; stable_key?: string; source: string; section: TenderSection; internal_status?: TenderInternalStatus;
  converted_opportunity_id?: string | null; tracking_updated_at?: string | null; reviewed_at?: string | null; reviewed_by?: string | null;
  tracking_owner_id?: string | null; tracking_status?: TenderTrackingStatus | null; tracking_next_action?: string | null;
  tracking_due_at?: string | null; tracking_blocker?: string | null; tracking_last_note?: string | null; tracking_started_at?: string | null;
  detected_at?: string | null; last_seen_at?: string | null; entity: string; dept?: string; city?: string;
  ref?: string; process_id?: string; title: string; desc?: string; value: number; status?: string;
  category?: string; published?: string | null; deadline?: string | null; window?: string; days?: number | null;
  score: number; reasons: string[]; risks: string[]; url?: string;
};
export type TenderTrackingUpdate = { id: string; tracking_owner_id: string; tracking_status: TenderTrackingStatus; tracking_next_action?: string | null; tracking_due_at?: string | null; tracking_blocker?: string | null; note?: string | null; expected_tracking_updated_at: string | null };
export type TenderTrackingEvent = { id: string; tender_id: string; event_type: string; actor_kind?: 'human' | 'system' | 'agent' | null; note?: string | null; from_status?: string | null; to_status?: string | null; assigned_to?: string | null; next_action?: string | null; due_at?: string | null; blocker?: string | null; created_by?: string | null; source_ref_type?: string | null; source_ref_id?: string | null; metadata?: Record<string, unknown> | null; created_at: string };
export type TenderTrackingEventsPage = { events: TenderTrackingEvent[]; next_cursor: string | null };
export type TenderSourceDiagnostic = { source: string; status: 'ok' | 'error' | string; count?: number; message?: string };
export type TenderRadarPayload = { generatedAt: string; source?: string; diagnostics?: TenderSourceDiagnostic[]; totals: { all: number; hacer: number; revisar: number; prioridadBaja: number; highValue: number; urgent: number; enRevision?: number; convertidas?: number; descartadas?: number }; tenders: PublicTender[] };
export type TenderRadarFilters = { query: string; source: string; region: TenderRegionKey; deadline: TenderDeadlineFilter; value: TenderValueFilter; score: TenderScoreFilter; section: TenderSection | 'todas'; internalStatus: TenderInternalStatus | 'todas' };
export type TenderDocumentImportStatus = 'analisis_generado' | 'documentos_cargados' | 'fallo_importacion' | 'pendiente_documentos' | 'no_aplica' | 'error';
export type TenderConversionResult = { id: string; duplicate: boolean; document_import_status: TenderDocumentImportStatus; document_import_error: string | null };
export type TenderDocumentRefreshResult = { new_count: number; updated_count: number; unchanged_count: number; failed_count: number; analysis_generated: boolean };
export type TenderProcessingStatus = { job_id: string | null; idempotency_key: string | null; status: string; current_step: string | null; counts: { discovered: number; processed: number; imported: number; unchanged: number; failed: number }; failed_items: Array<{ id: string; name: string; status: 'failed_retryable' | 'failed_terminal'; last_error_code?: string | null; last_error_message?: string | null }>; snapshot_id: string | null; analysis_run_id: string | null; last_error_code: string | null; last_error_message: string | null; updated_at: string | null };
export type TenderSearchProfile = { id: string; name: string; description?: string | null; region_key: TenderRegionKey; source_filter: string; section_filter: TenderSection | 'todas'; internal_status_filter: TenderInternalStatus | 'todas'; deadline_filter: TenderDeadlineFilter; value_filter: TenderValueFilter; score_filter: TenderScoreFilter; query_text?: string | null; is_default?: boolean; created_at?: string; updated_at?: string };
export type TenderCompanyProfile = { legal_name?: string | null; nit?: string | null; rup_status?: string | null; rup_updated_at?: string | null; rup_unspsc_codes?: string | null; authorized_services?: string | null; supervigilancia_license?: string | null; financial_capacity?: string | null; organizational_capacity?: string | null; experience_summary?: string | null; certifications?: string | null; recurring_documents?: string | null; disqualifications_notes?: string | null; useful_company_info?: string | null; source_document_name?: string | null; rup_import_notes?: string | null; updated_at?: string | null; updated_by_name?: string | null };
export type TenderCompanyDocument = { id: string; document_type: string; display_name: string; issued_at?: string | null; expires_at?: string | null; version: number; current: boolean; state: 'vigente' | 'vence_pronto' | 'vencido' | 'sin_vencimiento'; mime_type?: string | null; size_bytes: number; created_at: string; uploaded_by_name?: string | null; url?: string | null };
export type TenderDossier = { tender_id?: string; opportunity_id: string; entity?: string; title?: string; source?: string; url?: string | null; document_count: number; missing_document_count: number; document_import_status: string; document_import_error?: string | null; go_no_go?: string | null; risk?: string | null; checklist_progress?: { total?: number; auto_generated?: number; human_required?: number } | null; preparation_status?: string | null; human_pending_count?: number; sharepoint_status?: string | null; sharepoint_url?: string | null; dossier_error?: string | null };
export type TenderOpportunityFilter = 'all' | 'pending_decision' | 'go_authorized' | 'in_preparation' | 'submitted' | 'closed';
export type TenderOfferStatus = 'pendiente_decision' | 'en_preparacion' | 'lista_para_presentar' | 'presentada' | 'adjudicada' | 'no_adjudicada' | 'cerrada_no_go';
export type TenderOpportunitySummary = TenderDossier & {
  recommendation: string;
  decision: 'go' | 'no_go' | null;
  decided_by_name: string | null;
  decided_at: string | null;
  tender_offer_status: TenderOfferStatus;
};
export type TenderDossierAssignee = { id: string; full_name: string; role: string; active?: boolean; identity_type?: 'human' | 'agent' | null };
export type TenderDossierItemStatus = 'pendiente' | 'en_progreso' | 'listo' | 'bloqueado';
export type TenderDossierItemApplicability = 'requerido' | 'no_aplica';
export type TenderDossierItemType = 'documento' | 'pendiente_humano' | 'general';
export type TenderDossierItem = {
  id: string;
  item_key: string;
  title: string;
  item_type: TenderDossierItemType;
  required: boolean;
  origin: 'seed_go' | 'human';
  status: TenderDossierItemStatus;
  applicability: TenderDossierItemApplicability;
  assignee_id: string | null;
  assignee_name: string | null;
  target_date: string | null;
  latest_evidence: { kind: 'texto' | 'url'; text: string | null; url: string | null; at: string } | null;
};
export type TenderDossierArtifactVersion = {
  id: string;
  version: number;
  content_kind: 'markdown' | 'texto' | 'metadata';
  content_text: string | null;
  content_metadata: Record<string, unknown> | null;
  author_id: string;
  created_at: string;
};
export type TenderDossierArtifact = {
  id: string;
  artifact_key: string;
  title: string;
  required: boolean;
  origin: 'seed_go' | 'human';
  current_version: TenderDossierArtifactVersion | null;
  review_status: 'pendiente' | 'aprobado' | 'rechazado';
  has_approved_version: boolean;
  version_count: number;
};
export type TenderDossierReadinessReference = { item_key?: string; artifact_key?: string; title: string };
export type TenderDossierReadiness = {
  ready: boolean;
  pending_required_items: TenderDossierReadinessReference[];
  blocking_items: TenderDossierReadinessReference[];
  active_blockers: TenderDossierReadinessReference[];
  unapproved_artifacts: TenderDossierReadinessReference[];
};
export type TenderDossierWorkspace = {
  opportunity_id: string;
  checklist: TenderDossierItem[];
  artifacts: TenderDossierArtifact[];
  readiness: TenderDossierReadiness;
  can_mark_ready: boolean;
  workbench_enabled: boolean;
};
export type TenderDossierWorkbenchContextLink = { kind: string; id: string; label: string; source_ref: string };
export type TenderDossierWorkbenchMessage = {
  id: string;
  thread_id: string;
  opportunity_id: string;
  author_id: string;
  author_kind: 'human' | 'agent';
  visible_agent_name: string | null;
  content: string;
  idempotency_key: string | null;
  origin_job_id: string | null;
  created_at: string;
};
export type TenderDossierWorkbenchJob = {
  id: string;
  thread_id: string;
  origin_message_id: string;
  opportunity_id: string;
  tender_id: string;
  snapshot_id: string;
  base_version_id: string | null;
  capability_id: string;
  contract_version: string;
  policy_version: string;
  context_links: TenderDossierWorkbenchContextLink[];
  message: string;
  requested_by: string;
  idempotency_key: string;
  created_at: string;
};
export type TenderDossierWorkbenchRequiredAction = {
  id: string;
  job_id: string;
  message_id: string;
  opportunity_id: string;
  action_text: string;
  created_at: string;
};
export type TenderDossierWorkbenchLearningProposal = {
  id: string;
  job_id: string;
  opportunity_id: string;
  source_message_id: string;
  proposal_type: 'pattern' | 'preference' | 'rule' | 'source';
  proposed_rule: string;
  requested_scope: 'tender' | 'entity' | 'modality_sector' | 'psi_rule';
  valid_from: string;
  valid_until: string | null;
  source_links: TenderDossierWorkbenchContextLink[];
  created_at: string;
};
export type TenderDossierWorkbench = {
  enabled: true;
  thread_id: string | null;
  messages: TenderDossierWorkbenchMessage[];
  jobs: TenderDossierWorkbenchJob[];
  required_actions: TenderDossierWorkbenchRequiredAction[];
  learning_proposals: TenderDossierWorkbenchLearningProposal[];
};
export type TenderDossierWorkbenchMessageInput = {
  opportunity_id: string;
  thread_id: string;
  client_message_id: string;
  content: string;
  context_links: TenderDossierWorkbenchContextLink[];
  capability_id: string;
  snapshot_id: string;
  base_version_id: string | null;
};
export type TenderDossierWorkbenchRetryInput = { opportunity_id: string; job_id: string };
export type TenderDossierWorkbenchLearningReviewInput = {
  opportunity_id: string;
  proposal_id: string;
  decision: 'approved' | 'rejected';
  scope: string | null;
  comment: string | null;
};
export type TenderDossierItemActionInput = {
  opportunity_id: string;
  item_id: string;
  action_type: 'status_changed' | 'assigned' | 'evidence_attached' | 'marked_not_applicable' | 'requirement_changed' | 'reopened';
  to_status?: TenderDossierItemStatus | null;
  assignee_id?: string | null;
  target_date?: string | null;
  evidence_kind?: 'texto' | 'url' | null;
  evidence_text?: string | null;
  evidence_url?: string | null;
  justification?: string | null;
  note?: string | null;
};
export type TenderCurrentProfile = { id: string; full_name: string; role: string; microsoft_email?: string | null; active?: boolean; permissions?: string[]; identity_type?: 'human' | 'agent' | null };
export type TenderEvidenceCoverageChunk = {
  evidence_ref: string;
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  document_type: string;
  name: string;
  version: number;
  content_hash: string;
  current: boolean;
  page: number;
  section: number;
  chunk_index: number;
  char_count: number;
  chunk_hash: string;
  precedence: 'base' | 'addendum';
  superseded_by_addendum: boolean;
  requirement_ids: string[];
};
export type TenderEvidenceOmissionReason = 'budget_exhausted' | 'lower_relevance' | 'superseded_for_current_requirement' | 'gap_unavailable';
export type TenderEvidenceOmission = {
  evidence_ref: string | null;
  chunk_id: string | null;
  document_id: string;
  document_type: string | null;
  requirement_id: string | null;
  reason: TenderEvidenceOmissionReason;
};
export type TenderEvidenceRequirementCoverage = {
  requirement_id: string;
  candidates_available: number;
  chunks_selected: number;
  status: 'covered' | 'not_covered' | 'no_evidence';
};
export type TenderRequirementManifestSource = { document_id: string; document_version_id: string; content_hash: string };
export type TenderRequirementManifestUnresolvedSource = { document_id: string; reason: 'document_identity_not_resolved' };
export type TenderRequirementManifestEntry = {
  requirement_id: string;
  front: 'legal' | 'financial' | 'technical';
  label: string;
  sources: TenderRequirementManifestSource[];
  unresolved_sources: TenderRequirementManifestUnresolvedSource[];
};
export type TenderEvidenceCoverage = {
  snapshot_id: string;
  budget: {
    max_chunks: number; max_chars: number; max_tokens: number;
    chunks_used: number; chars_used: number; tokens_used: number;
    chunks_remaining: number; chars_remaining: number; tokens_remaining: number;
  };
  coverage_manifest: {
    by_document: Array<{ document_id: string; document_type: string | null; chunks_available: number; chunks_selected: number; gap: boolean; covered: boolean }>;
    by_document_type: Array<{ document_type: string; chunks_available: number; chunks_selected: number; covered: boolean }>;
    by_requirement: TenderEvidenceRequirementCoverage[];
  };
  selected_chunks: TenderEvidenceCoverageChunk[];
  omitted_chunks: TenderEvidenceOmission[];
  citation_allowlist: string[];
  material_omissions: boolean;
  requirement_manifest_version: string;
  requirement_manifest: TenderRequirementManifestEntry[];
};
export type TenderLegalFindingClassification = 'tender_requirement' | 'legal_obligation' | 'company_evidence' | 'inference' | 'human_legal_review';
export type TenderLegalFinding = {
  classification: TenderLegalFindingClassification;
  text: string;
  evidence_refs: string[];
  legal_citation_ids: string[];
};
export type TenderLegalCitation = {
  citation_id: string;
  source_id: string;
  norm_type: string;
  norm_number: string;
  year: number;
  article_or_section: string;
  issuing_authority: string;
  official_url: string;
  verified_at: string;
  corpus_version: string;
  label: string;
};
export type TenderVerifiedLegalEvidenceItem = { source_id: string; topic: string[]; sector: string[]; citation: TenderLegalCitation; statement: string };
export type TenderHumanLegalReviewItem = { source_id: string; topic: string[]; sector: string[]; citation: TenderLegalCitation; statement: string; reasons: string[] };
export type TenderLegalEvidence = {
  corpus_version: string;
  as_of: string;
  query: { process_stage: string | null; modality: string | null; topics: string[]; sector: string[]; max_results: number | null };
  verified_legal_evidence: TenderVerifiedLegalEvidenceItem[];
  human_legal_review_items: TenderHumanLegalReviewItem[];
  citation_allowlist: string[];
  coverage: { matched_source_ids: string[]; considered_count: number; returned_count: number };
  omissions: Array<{ source_id: string; reason: string }>;
  abstention_state: 'grounded' | 'abstained';
};
// AGT-002 integral analysis v3 (optional, read-only): mirrors the closed contract in
// agt002-integral-analysis-v3.js. Only present when the server-side
// AGT002_INTEGRAL_CONTRACT_V3 flag produced this run; UI code must always treat this as
// optional and never require it.
export type TenderIntegralCategory = 'discard' | 'habilitating' | 'technical' | 'financial_execution' | 'strategic';
export type TenderIntegralEvidenceRef = { ref: string; source_type: 'tender_document' | 'company_evidence' | 'legal_corpus' | 'human_evidence' | 'objective_validation'; purpose: string };
export type TenderIntegralMissingEvidence = { missing_id: string; evidence_class_id: string | null; needed_source_type: string; reason: string; critical: boolean };
export type TenderIntegralAction = { action_id: string; action_type: string; summary: string; basis_unit_id: string; suggested_role: string; priority: 'critical' | 'high' | 'medium' | 'low'; external_side_effect: false };
export type TenderIntegralAnalysisUnit = {
  unit_id: string;
  unit_kind: 'tender_requirement' | 'strategic_consideration';
  requirement_id: string | null;
  category: TenderIntegralCategory;
  sequence: number;
  title: string;
  assessment_mode: 'assessed' | 'abstained';
  conclusion: { status: string; summary: string; confidence: 'high' | 'medium' | 'low' | 'unavailable' };
  blocking: { effect: 'blocker' | 'conditional' | 'non_blocking' | 'undetermined'; curability: string; reason: string };
  evidence_state: { presence: string; review: string; validity: string; applicability: string; compliance: string };
  evidence_refs: TenderIntegralEvidenceRef[];
  missing_evidence: TenderIntegralMissingEvidence[];
  commercial_impact: { level: 'critical' | 'high' | 'medium' | 'low' | 'unknown'; summary: string; dimension: string };
  legal_assessment: { status: string; basis_refs: string[]; summary: string; human_legal_review_required: boolean };
  actions: TenderIntegralAction[];
  milestone: { status: string; type: string; at: string | null; source_ref: string | null; summary: string };
  escalation: { required: boolean; level: string; reason: string };
  closure: { status: string; condition: string; evidence_required: string[] };
  human_validation: { required: true; status: 'pending'; reason: string };
};
export type TenderIntegralAnalysisV3 = {
  contract_version: string;
  coverage: {
    manifest_version: string; expected_requirement_ids: string[]; analyzed_requirement_ids: string[];
    material_omissions: boolean; omission_reasons: string[];
    company_evidence_manifest_version: string; company_evidence_class_ids: string[];
    legal_corpus_version_id: string | null;
  };
  analysis_units: TenderIntegralAnalysisUnit[];
};
// AGT-002 manifest scope (optional, read-only): the server-owned, top-level honest coverage
// accounting for a manifest-driven V3 run. Mirrors the closed shape derived in
// agt002-manizales-manifest-wiring.js. It is a SIBLING of integral_analysis — never nested inside
// TenderIntegralAnalysisV3 — so a reader can tell the 20 analyzable requirements, the 25 atomized
// entries, the 15 pre-GO sections of 68 registered, and the closed 15/15 + 20/20 ledgers apart
// from analyzed/expected. UI code must always treat this as optional and never require it.
export type TenderManifestScope = {
  registry_sections: number;
  pre_go_relevant: number;
  proposal_sections: number;
  analyzable_requirement_ids: string[];
  atomized_entry_count: number;
  dispositions: { analyzed_candidate: number; excluded_with_reason: number; unresolved_visible: number };
  section_ledger_accounted: number;
  proposal_ledger_accounted: number;
};
// AGT-002 manifest unresolved entries (optional, read-only): the identities of the manifest's
// status=unresolved_visible entries (material omissions the engine never fed to the model) —
// the 5 of the 25 atomized entries the coverage scope's dispositions tally already counts but
// never named. A SIBLING of TenderManifestScope and integral_analysis, never nested inside
// either. Closed, minimal shape: no citation text/quotes, never a conclusion or compliance
// claim. UI code must always treat this as optional and never require it.
export type TenderManifestUnresolvedEntry = {
  requirement_id: string;
  label: string;
  category: TenderIntegralCategory | null;
  origin: string;
  status: 'unresolved_visible';
  human_review_required: true;
};
// AGT-002 Manizales decision-review presentation (optional, read-only, single pinned production
// artifact — see tender-analysis-foundation.js): a human-curated review that the server attaches
// ONLY for the exact governed opportunity+run it was authored against. Replaces the raw 20-item
// v2 question projection with 2 real decision_questions in the UI; everything else (preparation,
// supported, not_applicable, blockers) is presentational, never an answerable question. A SIBLING
// of manifest_unresolved_entries/integral_analysis, never nested inside either.
export type TenderDecisionReviewEvidenceRef =
  | { type: 'registry_citation'; item_ref: string; sub_item_id: string; char_start: number }
  | { type: 'manifest_requirement'; requirement_id: string }
  | { type: 'review_finding'; finding_id: string };
export type TenderDecisionReviewStatus = 'supported' | 'preparation' | 'not_applicable' | 'decision_question' | 'blocker';
export type TenderDecisionReviewFinding = {
  id: string;
  requirement_id: string;
  label: string;
  reviewed_status: TenderDecisionReviewStatus;
  rationale: string;
  evidence_refs: TenderDecisionReviewEvidenceRef[];
  material_impediment_category?: string;
  curability?: 'curable' | 'not_curable';
  exercise_bypassed?: true;
};
export type TenderDecisionReviewFindingSource = {
  id: string;
  disposition: 'supports' | 'requires_verification';
  source_id: string;
  locator: string;
  summary: string;
};
export type TenderDecisionReview = {
  artifact_type: string;
  contract_version: string;
  source_fixture_version: number;
  opportunity_id: string;
  human_approval_required: true;
  decision_status: 'pending_human_decision';
  decision_ready: boolean;
  routing_action: 'flag_for_responsible_person';
  external_communications_allowed: false;
  evidence_requests_allowed: false;
  review_findings: TenderDecisionReviewFindingSource[];
  exercise_mode: { active: true; bypassed_requirement_ids: string[] };
  recommendation: string;
  blockers: TenderDecisionReviewFinding[];
  decision_questions: TenderDecisionReviewFinding[];
  supported: TenderDecisionReviewFinding[];
  preparation: TenderDecisionReviewFinding[];
  not_applicable: TenderDecisionReviewFinding[];
  counts: { supported: number; preparation: number; not_applicable: number; decision_questions: number; blockers: number };
};

export type TenderDocumentAnalysis = {
  run_id: string;
  snapshot_id: string;
  producer: 'siio_rules_v1' | 'HERMES-INTERIM' | 'AGT-002';
  method: 'rules' | 'agent_ai';
  status: 'completed' | 'failed';
  current: boolean;
  critical_open_count: number;
  created_at?: string | null;
  completed_at?: string | null;
  interaction_id?: string | null;
  recommendation?: string;
  risk?: string;
  summary?: string;
  generated_at?: string;
  findings?: string[];
  commercial_fit?: { status?: string; positives?: string[]; concerns?: string[] };
  strengths?: TenderAnalysisFinding[];
  weaknesses?: TenderAnalysisFinding[];
  blockers?: TenderAnalysisFinding[];
  questions?: TenderAnalysisFinding[];
  unverified?: TenderAnalysisFinding[];
  company_profile_crosscheck?: { status?: string; matches?: string[]; gaps?: TenderAnalysisFinding[]; profile_source?: string };
  next_action?: string;
  evidence_coverage?: TenderEvidenceCoverage | null;
  legal_findings?: TenderLegalFinding[];
  legal_evidence?: TenderLegalEvidence | null;
  integral_analysis?: TenderIntegralAnalysisV3 | null;
  manifest_scope?: TenderManifestScope | null;
  manifest_unresolved_entries?: TenderManifestUnresolvedEntry[] | null;
  decision_review?: TenderDecisionReview | null;
  [key: string]: unknown;
};
export type TenderDocumentRecord = {
  id: string;
  name: string;
  size: number;
  mime_type?: string | null;
  document_type: string;
  current: boolean;
  storage_path?: string;
  uploaded_at: string;
  uploaded_by?: string | null;
  signed_url?: string | null;
  extracted_text?: string | null;
};
export type TenderAnalysisAttempt = {
  event_id: string;
  snapshot_id: string;
  tender_id: string;
  attempt_key: string;
  producer: 'AGT-002';
  state: 'queued' | 'running' | 'completed' | 'retry_wait' | 'needs_attention' | 'unavailable';
  error_code: string | null;
  analysis_run_id: string | null;
  created_at: string | null;
};
export type Agt002ReanalysisJob = {
  job_id: string | null;
  opportunity_id?: string;
  snapshot_id?: string;
  context_version_id?: string;
  status: 'no_job' | 'queued' | 'running' | 'completed' | 'unavailable';
  analysis_run_id: string | null;
  error_code: string | null;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
};
export type TenderDocumentsPayload = Partial<TenderDocumentRefreshResult> & {
  import_error?: { kind?: string; source?: string | null; created_at?: string | null; failure_marker?: string | null } | null;
  documents: TenderDocumentRecord[];
  analysis: TenderDocumentAnalysis | null;
  analyses: TenderDocumentAnalysis[];
  question_responses?: TenderQuestionResponse[];
  analysis_attempt?: TenderAnalysisAttempt | null;
  reanalysis_job?: Agt002ReanalysisJob | null;
  analysis_engine?: { requested: 'AGT-002'; used: 'AGT-002' | 'siio_rules_v1' | null; fallback: boolean; state?: Agt002ReanalysisJob['status']; job_id?: string; reason?: 'not_configured' | 'preview_unavailable'; reused?: boolean; human_review_required: true };
};
export type TenderAnalysisFinding = string | {
  id?: string;
  text?: string;
  critical?: boolean;
  evidence_refs?: string[];
};
export type TenderQuestionResponseStatus = 'pending' | 'resolved' | 'not_applicable';
export type TenderQuestionResponseAttachment = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  uploaded_at: string;
  signed_url: string | null;
};
export type TenderQuestionResponse = {
  id: string;
  opportunity_id: string;
  analysis_run_id: string;
  question_id: string;
  question_text: string;
  status: TenderQuestionResponseStatus;
  response: string;
  evidence_notes?: string | null;
  responded_by: string;
  responded_by_name?: string | null;
  responded_at: string;
  attachments: TenderQuestionResponseAttachment[];
};
export type TenderQuestionResponseInput = Pick<TenderQuestionResponse, 'analysis_run_id' | 'question_id' | 'question_text' | 'status' | 'response'>;
export type TenderGoNoGoDecision = {
  id: string;
  opportunity_id: string;
  tender_id: string;
  decision: 'go' | 'no_go';
  analysis_interaction_id: string | null;
  analysis_run_id: string | null;
  justification: string | null;
  decided_by: string;
  decided_at: string;
  supersedes_decision_id?: string | null;
  psi_sales_profiles?: { full_name?: string | null } | null;
};
export type TenderGoNoGoDecisionInput = { opportunity_id: string; decision: 'go' | 'no_go'; analysis_run_id?: string | null; justification?: string | null };
export type TenderOfferPreparation = { status: string; interaction_id?: string; [key: string]: unknown };
export type TenderOfferStatusTransition = {
  id: string;
  opportunity_id: string;
  tender_id: string;
  actor_id: string;
  from_status: Exclude<TenderOfferStatus, 'pendiente_decision' | 'cerrada_no_go' | 'adjudicada' | 'no_adjudicada'>;
  to_status: Exclude<TenderOfferStatus, 'pendiente_decision' | 'cerrada_no_go' | 'en_preparacion'>;
  note: string | null;
  changed_at: string;
  psi_sales_profiles?: { full_name?: string | null } | null;
};
export type TenderOfferStatusPayload = { status: TenderOfferStatus; history: TenderOfferStatusTransition[] };
export type TenderOfferStatusTransitionInput = { opportunity_id: string; to_status: TenderOfferStatus; expected_current_status: TenderOfferStatus; note?: string | null };
export type TenderGoNoGoPayload = { decision: TenderGoNoGoDecision | null; history: TenderGoNoGoDecision[]; preparation: TenderOfferPreparation | null; analysis?: TenderDocumentAnalysis | null };
export type TenderGoNoGoPostPayload = {
  decision: {
    decision_id: string;
    supersedes_decision_id: string | null;
    decision: 'go' | 'no_go';
    preparation_id: string | null;
    preparation_created: boolean;
    tender_offer_status: TenderOfferStatus;
  };
  preparation: TenderOfferPreparation | null;
};
export type TenderModuleData = { currentProfile: TenderCurrentProfile; profiles: Array<{ id: string; full_name: string; role: string }> };
export type TendersModuleProps = { view: TenderModuleView; data: TenderModuleData; refresh: () => Promise<void>; request: TenderRequest; navigate: (hash: string) => void; children?: ReactNode };
