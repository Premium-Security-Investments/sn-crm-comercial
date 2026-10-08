import { buildAgt002AnalysisConfig } from './agt002-analysis-config.js';
import { buildAgt002CompanyEvidenceIdentity, deriveAgt002CompanyEvidenceAsOf } from './agt002-company-evidence-identity.js';
import { loadAgt002CompanyEvidenceInventorySnapshot } from './agt002-company-evidence-sharepoint-catalog.js';
import { loadAgt002CompanyEvidenceRegistryEntries } from './agt002-company-evidence-classes.js';
import { loadAgt002CompanyDossier } from './agt002-company-dossier.js';
import { loadAgt002IntegralGovernanceOverrides } from './agt002-integral-governance-overrides.js';
import { loadPublishedAgt002LegalCorpus } from './agt002-legal-corpus-store.js';
import { AGT002_OPPORTUNITY_CONTEXT_SELECT, loadAgt002OpportunityContextV2 } from './agt002-opportunity-context-v2.js';
import { computeAgt002PreviewIdempotencyKey } from './agt002-preview-persistence.js';
import { AGT002_INTEGRAL_V3_POLICY_VERSION, getAgt002PreviewRuntimeConfig } from './agt002-preview-runtime.js';
import { buildAgt002FrozenEngineInput } from './agt002-reanalysis-input.js';
import { createAgt002ReanalysisJob } from './agt002-reanalysis-jobs.js';
import { buildAgt002TenderRequirementInventory } from './agt002-preview-input.js';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from './agt002-integral-analysis-v3.js';
import { tenderRequirementInventoryIdentity } from './tender-requirement-inventory.js';
import { registerAgt002ContextVersion } from './tender-analysis-foundation.js';
import { dispatchAgt002IncrementalAnalysis, projectAgt002PriorFindings } from './agt002-incremental-dispatch.js';
import { buildAgt002ActionableReviewSignalContent, buildAgt002CompanyEvidenceLinkSignalContent, buildAgt002HumanResponseSignalContent } from './agt002-incremental-source-ingestion.js';

async function one(query, label) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(label);
  return data;
}

async function loadCompanyProfile(database) {
  const primary = await database.from('psi_company_procurement_profile')
    .select('*').eq('singleton_key', 'seguridad_nacional').maybeSingle();
  if (!primary.error && primary.data) return primary.data;
  if (primary.error && !['PGRST205', '42P01'].includes(primary.error.code)) throw primary.error;
  const fallback = await database.from('psi_tender_radar_runs')
    .select('summary').eq('mode', 'company_profile')
    .order('run_at', { ascending: false }).limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.summary) return {};
  try { return JSON.parse(fallback.data.summary); }
  catch { return { useful_company_info: fallback.data.summary }; }
}

async function loadGovernance(database, opportunityId, analysisConfig) {
  if (!analysisConfig.AGT002_INTEGRAL_CONTRACT_V3) return null;
  const [companyEvidenceRegistryEntries, companyEvidenceInventorySnapshot, overrides] = await Promise.all([
    loadAgt002CompanyEvidenceRegistryEntries(database),
    loadAgt002CompanyEvidenceInventorySnapshot(database),
    loadAgt002IntegralGovernanceOverrides(database, opportunityId),
  ]);
  let evidenceAsOf;
  let evidenceIdentity;
  try {
    evidenceAsOf = deriveAgt002CompanyEvidenceAsOf(companyEvidenceRegistryEntries);
    evidenceIdentity = buildAgt002CompanyEvidenceIdentity({
      registryEntries: companyEvidenceRegistryEntries,
      inventorySnapshot: companyEvidenceInventorySnapshot,
      asOf: new Date(evidenceAsOf),
    });
  } catch {
    const error = new Error('AGT-002: el registro de evidencia empresarial no está disponible.');
    error.runtime_boundary_code = 'AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID';
    throw error;
  }
  return {
    companyEvidenceRegistryEntries,
    companyEvidenceInventorySnapshot,
    categoryOverrides: overrides.categoryOverrides,
    evidenceClassLinkByRequirementId: overrides.evidenceClassLinkByRequirementId,
    governanceProvenance: overrides.provenance,
    evidenceAsOf,
    evidenceIdentity,
  };
}

function evidenceIdentityKey(identity) {
  return identity ? {
    evidenceSourceSnapshotHash: identity.source_snapshot_hash,
    evidencePreviewArtifactHash: identity.preview_artifact_hash,
    evidenceSourceManifestVersion: identity.source_manifest_version,
  } : {};
}

async function loadChangedEvidence(database, manifest) {
  return Promise.all(manifest.members.map(async member => {
    if (member.trigger_kind === 'official_document') {
      const version = await one(database.from('psi_tender_document_versions')
        .select('id,opportunity_id,tender_id,source_document_id,name,document_type,version')
        .eq('id', member.source_version).eq('opportunity_id', manifest.opportunity_id).eq('tender_id', manifest.tender_id),
      'La versión oficial incremental no está disponible.');
      if (version.source_document_id !== member.source_id || version.document_type !== member.source_type) {
        throw new Error('La versión oficial incremental no coincide con su señal congelada.');
      }
      const extraction = await one(database.from('psi_tender_document_extractions')
        .select('extracted_text').eq('document_version_id', member.source_version)
        .eq('opportunity_id', manifest.opportunity_id).eq('tender_id', manifest.tender_id)
        .eq('status', 'ok').order('created_at', { ascending: false }).limit(1),
      'La extracción oficial incremental no está disponible.');
      return { signal_id: member.signal_id, name: version.name, text: extraction.extracted_text, version: version.version };
    }
    if (member.trigger_kind === 'human_interaction' && member.source_table === 'psi_tender_question_responses') {
      const response = await one(database.from('psi_tender_question_responses')
        .select('id,question_id,question_text,status,response,evidence_notes,responded_at')
        .eq('id', member.source_id).eq('opportunity_id', manifest.opportunity_id),
      'La respuesta humana incremental no está disponible.');
      const attachments = await database.from('psi_tender_question_response_attachments')
        .select('name,mime_type,size_bytes,content_hash').eq('response_id', response.id)
        .eq('opportunity_id', manifest.opportunity_id);
      if (attachments.error) throw attachments.error;
      return {
        signal_id: member.signal_id,
        name: `Respuesta humana: ${response.question_text || response.question_id}`,
        text: buildAgt002HumanResponseSignalContent(response, attachments.data || []),
        version: 1,
      };
    }
    if (member.trigger_kind === 'human_document' && member.source_table === 'psi_sales_interactions') {
      const interactionId = member.source_version.split(':')[0];
      const interaction = await one(database.from('psi_sales_interactions').select('id,notes')
        .eq('id', interactionId).eq('opportunity_id', manifest.opportunity_id),
      'La carga documental humana incremental no está disponible.');
      let payload;
      try { payload = JSON.parse(interaction.notes || '{}'); } catch { payload = null; }
      const document = payload?.kind === 'tender_document_upload'
        ? (payload.documents || []).find(item => String(item?.id) === member.source_id) : null;
      if (!document || String(document.document_type) !== member.source_type) {
        throw new Error('El documento humano incremental no coincide con su señal congelada.');
      }
      return { signal_id: member.signal_id, name: document.name, text: String(document.extracted_text || ''), version: 1 };
    }
    if (member.trigger_kind === 'actionable_review' && member.source_table === 'psi_tender_actionable_review_events') {
      const event = await one(database.from('psi_tender_actionable_review_events')
        .select('id,review_item_id,sequence,event_type,outcome,note,reusable_requested,created_at')
        .eq('id', member.source_id), 'El evento de revisión accionable no está disponible.');
      const item = await one(database.from('psi_tender_actionable_review_items')
        .select('id,opportunity_id,tender_id').eq('id', event.review_item_id),
      'El pendiente de revisión accionable no está disponible.');
      if (item.opportunity_id !== manifest.opportunity_id || item.tender_id !== manifest.tender_id) {
        throw new Error('El evento de revisión accionable no pertenece al alcance incremental congelado.');
      }
      return {
        signal_id: member.signal_id,
        name: `Revisión accionable ${event.event_type}`,
        text: buildAgt002ActionableReviewSignalContent(event),
        version: Number(event.sequence || 1),
      };
    }
    if (member.trigger_kind === 'company_evidence_link' && member.source_table === 'psi_agt002_company_evidence_registry') {
      const [entryId, versionText] = member.source_version.split(':');
      const entry = await one(database.from('psi_agt002_company_evidence_registry').select('*')
        .eq('entry_id', entryId).eq('version', Number(versionText)),
      'La evidencia de empresa incremental no está disponible.');
      return {
        signal_id: member.signal_id,
        name: `Evidencia de empresa ${entry.entry_id}`,
        text: buildAgt002CompanyEvidenceLinkSignalContent(entry),
        version: Number(entry.version),
      };
    }
    throw new Error(`La fuente incremental ${member.trigger_kind} no tiene un resolvedor server-side.`);
  }));
}

export async function readCurrentAgt002IncrementalSnapshotId(database, opportunityId) {
  const state = await one(database.from('psi_tender_document_state')
    .select('current_snapshot_id,refresh_in_progress').eq('opportunity_id', opportunityId),
  'R1 requiere estado documental vigente.');
  if (!state.current_snapshot_id || state.refresh_in_progress === true) throw new Error('R1 requiere un snapshot documental vigente y cerrado.');
  return state.current_snapshot_id;
}

export async function prepareAndDispatchAgt002IncrementalJob(database, {
  manifest,
  snapshotId,
  actorProfileId,
  environment = process.env,
  wakeWorker = null,
}) {
  const analysisConfig = buildAgt002AnalysisConfig(environment);
  const runtimeConfig = getAgt002PreviewRuntimeConfig(environment);
  return dispatchAgt002IncrementalAnalysis(database, {
    manifest, snapshotId, actorProfileId, wakeWorker,
    loadChangedEvidence: frozen => loadChangedEvidence(database, frozen),
    loadPriorFindings: async frozen => {
      const prior = await one(database.from('psi_tender_analysis_runs').select('id,result')
        .eq('id', frozen.prior_canonical_run_id).eq('opportunity_id', frozen.opportunity_id)
        .eq('tender_id', frozen.tender_id), 'La corrida canónica previa del delta no está disponible.');
      return projectAgt002PriorFindings(prior.result);
    },
    enqueueIncrementalJob: async ({ incrementalInput }) => {
      const opportunity = await one(database.from('v_psi_sales_opportunity_enriched')
        .select(AGT002_OPPORTUNITY_CONTEXT_SELECT).eq('id', manifest.opportunity_id), 'La oportunidad incremental no existe.');
      const [contextV2Sections, companyDossierV2, companyProfile, governance, legalCorpusContext] = await Promise.all([
        loadAgt002OpportunityContextV2(database, { opportunityId: manifest.opportunity_id, tenderId: manifest.tender_id, opportunity }),
        loadAgt002CompanyDossier(database),
        loadCompanyProfile(database),
        loadGovernance(database, manifest.opportunity_id, analysisConfig),
        analysisConfig.AGT002_LEGAL_CORPUS ? loadPublishedAgt002LegalCorpus(database) : null,
      ]);
      const contextVersion = await registerAgt002ContextVersion(database, {
        opportunity_id: manifest.opportunity_id, tender_id: manifest.tender_id,
        snapshot_id: snapshotId, actor_id: actorProfileId,
        company_evidence_identity: governance?.evidenceIdentity ?? null,
        context: { snapshot_id: snapshotId, ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: [] },
      });
      const policyVersion = analysisConfig.AGT002_INTEGRAL_CONTRACT_V3
        ? AGT002_INTEGRAL_V3_POLICY_VERSION : runtimeConfig.policyVersion;
      const inventoryIdentity = analysisConfig.AGT002_DOCUMENT_RETRIEVAL
        ? tenderRequirementInventoryIdentity(buildAgt002TenderRequirementInventory({
          snapshotId, documents: incrementalInput.analysisDocuments, documentGaps: [],
        })) : {};
      const idempotencyKey = computeAgt002PreviewIdempotencyKey({
        snapshotId, policyVersion, model: runtimeConfig.model, contextVersionId: contextVersion.id,
        legalCorpusVersionId: legalCorpusContext?.legal_corpus_version_id,
        contractVersion: analysisConfig.AGT002_INTEGRAL_CONTRACT_V3
          ? AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION : null,
        ...evidenceIdentityKey(governance?.evidenceIdentity), ...inventoryIdentity,
        incrementalManifestHash: incrementalInput.manifest.manifest_hash,
      });
      const frozenEngineInput = buildAgt002FrozenEngineInput({
        runtimeConfig: { ...runtimeConfig, policyVersion }, analysisConfig,
        analysisContext: {
          opportunity, tenderId: manifest.tender_id, documents: incrementalInput.analysisDocuments,
          documentGaps: [], companyProfile, deepAnalysis: incrementalInput.deepAnalysis,
          snapshotId, canonicalOnly: true,
          contextV2Sections: { ...contextV2Sections, company_dossier: companyDossierV2, human_evidence: [] },
        },
        legalCorpusContext, integralV3Governance: governance, manizalesManifestSource: null,
        idempotencyKey, incrementalDeltaManifest: incrementalInput.manifest,
      });
      const job = await createAgt002ReanalysisJob(database, {
        opportunityId: manifest.opportunity_id, tenderId: manifest.tender_id, snapshotId,
        contextVersionId: contextVersion.id, idempotencyKey, frozenEngineInput, requestedBy: actorProfileId,
      });
      return { status: job.status === 'existing' ? 'running' : 'queued', job_id: job.jobId };
    },
  });
}
