// Pure selection/validation helpers for the AGT-002 governed document workset builder
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md, Phase 4). No I/O: every
// function here takes plain data and returns plain data, so the UI, main.tsx and the test suite
// share one source of truth for eligibility, bounds and the exact request body shape. The
// backend (agt002-governed-document-worksets.js, lines 115-120) is the final authority: it
// rejects any evidence row whose extraction_status !== 'ok', so this module fails closed on the
// exact same condition — 'legacy', missing, or any other status is never selectable here either.
import type { Agt002GovernedWorksetMemberInput, Agt002GovernedWorksetSourceClassification, TenderDocumentRecord } from './types';

export const AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATIONS: Agt002GovernedWorksetSourceClassification[] = ['official', 'corporate', 'draft'];

export const AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATION_LABELS: Record<Agt002GovernedWorksetSourceClassification, string> = {
  official: 'Oficial',
  corporate: 'Corporativo',
  draft: 'Borrador',
};

export const AGT002_GOVERNED_WORKSET_MIN_MEMBERS = 1;
export const AGT002_GOVERNED_WORKSET_MAX_MEMBERS = 12;

export const AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY = 'Confirmo que este paquete exacto de documentos quedará congelado para esta corrida de análisis; cualquier cambio posterior en los documentos (agregar, quitar o reemplazar alguno) exigirá una nueva corrida.';

export function isAgt002GovernedWorksetSourceClassification(value: unknown): value is Agt002GovernedWorksetSourceClassification {
  return value === 'official' || value === 'corporate' || value === 'draft';
}

export type Agt002GovernedWorksetExtractionEligibility = { eligible: boolean; reason: string | null };

// The backend only accepts evidence rows with extraction_status === 'ok' (exact string match).
// Everything else — 'gap', 'legacy', missing/null, or any unrecognized status — must fail closed
// here too, or the UI would let a user select a document whose freeze the server always rejects.
export function tenderDocumentExtractionEligibility(document: Pick<TenderDocumentRecord, 'extraction_status' | 'extraction_gap_reason'>): Agt002GovernedWorksetExtractionEligibility {
  if (document.extraction_status === 'ok') {
    return { eligible: true, reason: null };
  }
  if (document.extraction_status === 'gap') {
    return { eligible: false, reason: document.extraction_gap_reason || 'Este documento no tiene texto extraído disponible para el análisis.' };
  }
  return { eligible: false, reason: 'Este documento no tiene una extracción de texto vigente ("ok") disponible para el paquete gobernado.' };
}

// Requirement 1: only current document records are ever selectable candidates. Historical
// (superseded) versions are never listed, eligible or not.
export function currentAgt002GovernedWorksetDocuments(documents: TenderDocumentRecord[]): TenderDocumentRecord[] {
  return documents.filter(document => document.current !== false);
}

export type Agt002GovernedWorksetDraftEntry = {
  document_version_id: string;
  source_classification: Agt002GovernedWorksetSourceClassification | '';
  inclusion_reason: string;
};

/**
 * Every human-readable reason the package cannot be frozen yet: bounds (1..12), a closed
 * classification and a nonblank reason per member, and the explicit freeze confirmation. Empty
 * array means the package is valid and the CTA may be enabled.
 */
export function agt002GovernedWorksetSelectionErrors(entries: Agt002GovernedWorksetDraftEntry[], confirmed: boolean): string[] {
  const errors: string[] = [];
  if (entries.length < AGT002_GOVERNED_WORKSET_MIN_MEMBERS) {
    errors.push(`Seleccione al menos ${AGT002_GOVERNED_WORKSET_MIN_MEMBERS} documento para el paquete gobernado.`);
  }
  if (entries.length > AGT002_GOVERNED_WORKSET_MAX_MEMBERS) {
    errors.push(`Seleccione como máximo ${AGT002_GOVERNED_WORKSET_MAX_MEMBERS} documentos para el paquete gobernado.`);
  }
  if (entries.some(entry => !isAgt002GovernedWorksetSourceClassification(entry.source_classification))) {
    errors.push('Cada documento seleccionado necesita una clasificación: oficial, corporativo o borrador.');
  }
  if (entries.some(entry => !entry.inclusion_reason.trim())) {
    errors.push('Cada documento seleccionado necesita un motivo de inclusión.');
  }
  if (!confirmed) {
    errors.push('Debe confirmar que el paquete quedará congelado antes de continuar.');
  }
  return errors;
}

/** Builds the exact closed member shape the endpoint accepts. Throws if called on an invalid
 * draft — callers must gate on `agt002GovernedWorksetSelectionErrors(...).length === 0` first. */
export function buildAgt002GovernedWorksetMembers(entries: Agt002GovernedWorksetDraftEntry[]): Agt002GovernedWorksetMemberInput[] {
  return entries.map(entry => {
    if (!isAgt002GovernedWorksetSourceClassification(entry.source_classification)) {
      throw new Error('No se puede construir el paquete: falta una clasificación válida.');
    }
    const inclusionReason = entry.inclusion_reason.trim();
    if (!inclusionReason) {
      throw new Error('No se puede construir el paquete: falta un motivo de inclusión.');
    }
    return {
      document_version_id: entry.document_version_id,
      source_classification: entry.source_classification,
      inclusion_reason: inclusionReason,
    };
  });
}

export function agt002GovernedWorksetSelectionCountLabel(count: number): string {
  return `${count} de ${AGT002_GOVERNED_WORKSET_MAX_MEMBERS} documentos seleccionados (mínimo ${AGT002_GOVERNED_WORKSET_MIN_MEMBERS}).`;
}
