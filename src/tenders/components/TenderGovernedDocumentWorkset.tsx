import { useEffect, useRef, useState } from 'react';
import type { Agt002GovernedWorksetMemberInput, TenderDocumentRecord } from '../types';
import {
  AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY,
  AGT002_GOVERNED_WORKSET_MAX_MEMBERS,
  AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATIONS,
  AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATION_LABELS,
  agt002GovernedWorksetSelectionCountLabel,
  agt002GovernedWorksetSelectionErrors,
  buildAgt002GovernedWorksetMembers,
  buildAgt002RecommendedWorksetSelection,
  currentAgt002GovernedWorksetDocuments,
  tenderDocumentExtractionEligibility,
  type Agt002GovernedWorksetDraftEntry,
} from '../governedWorksetSelection';

type TenderGovernedDocumentWorksetProps = {
  documents: TenderDocumentRecord[];
  busy: boolean;
  // An explicit run-level authorization gate (mirrors canRunPreview upstream) — separate from
  // the pure selection validity the shared model already governs, so a valid, confirmed
  // selection still cannot freeze when the caller has not authorized a run.
  canRun: boolean;
  // Identifies the tender/opportunity this draft selection belongs to. When the mounted
  // component is reused for a different opportunity, selectionScopeKey changes and the draft
  // selection and freeze confirmation must reset instead of silently carrying over stale state.
  selectionScopeKey: string;
  onFreeze: (members: Agt002GovernedWorksetMemberInput[]) => void | Promise<void>;
  onUploadFiles: (files: File[]) => void | Promise<void>;
};

function baselineEntry(documentVersionId: string): Agt002GovernedWorksetDraftEntry {
  return { document_version_id: documentVersionId, source_classification: '', inclusion_reason: '' };
}

export function TenderGovernedDocumentWorkset({ documents, busy, canRun, selectionScopeKey, onFreeze, onUploadFiles }: TenderGovernedDocumentWorksetProps) {
  const [selection, setSelection] = useState<Record<string, Agt002GovernedWorksetDraftEntry>>({});
  const [confirmed, setConfirmed] = useState(false);

  const candidates = currentAgt002GovernedWorksetDocuments(documents);

  // AGT-002 / Vig-IA (.hermes/plans/2026-09-21-vigia-document-preselection.md): tracks the scope
  // (opportunity) the draft selection currently belongs to, and the scope the Vig-IA preselection
  // was last applied for, both via refs keyed by selectionScopeKey — never a plain boolean — so
  // switching to a different opportunity resets the draft and reapplies the preselection exactly
  // once for the new scope, while later uploads, edits, or unchecks within the same scope never
  // re-trigger a clear or silently re-add a document Licitaciones already unchecked.
  const activeScopeRef = useRef<string | null>(null);
  const preselectionAppliedForScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const previousScope = activeScopeRef.current;
    const scopeChanged = previousScope !== null && previousScope !== selectionScopeKey;
    activeScopeRef.current = selectionScopeKey;
    if (scopeChanged) {
      setSelection({});
      setConfirmed(false);
    }
    if (preselectionAppliedForScopeRef.current === selectionScopeKey || !candidates.length) return;
    const preselected = buildAgt002RecommendedWorksetSelection(candidates);
    preselectionAppliedForScopeRef.current = selectionScopeKey;
    if (!preselected.length) return;
    setSelection(current => {
      const next = { ...current };
      for (const entry of preselected) {
        if (!(entry.document_version_id in next)) next[entry.document_version_id] = entry;
      }
      return next;
    });
  }, [candidates, selectionScopeKey]);

  const entries = Object.values(selection);
  const errors = agt002GovernedWorksetSelectionErrors(entries, confirmed);
  const canFreeze = errors.length === 0 && canRun && !busy;
  const atMaxMembers = entries.length >= AGT002_GOVERNED_WORKSET_MAX_MEMBERS;

  const toggleDocument = (documentVersionId: string) => {
    setSelection(current => {
      if (documentVersionId in current) {
        const next = { ...current };
        delete next[documentVersionId];
        return next;
      }
      if (Object.keys(current).length >= AGT002_GOVERNED_WORKSET_MAX_MEMBERS) {
        return current;
      }
      return { ...current, [documentVersionId]: baselineEntry(documentVersionId) };
    });
    setConfirmed(false);
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = '';
    if (!files.length) return;
    void onUploadFiles(files);
  };

  const updateEntry = (documentVersionId: string, patch: Partial<Agt002GovernedWorksetDraftEntry>) => {
    setSelection(current => ({ ...current, [documentVersionId]: { ...current[documentVersionId], ...patch } }));
    setConfirmed(false);
  };

  const handleFreeze = () => {
    if (errors.length !== 0) return;
    void onFreeze(buildAgt002GovernedWorksetMembers(entries));
  };

  return <section className="tender-governed-document-workset" aria-labelledby="tender-governed-document-workset-title">
    <header>
      <span className="eyebrow">Paquete gobernado de documentos</span>
      <h3 id="tender-governed-document-workset-title">Congelar documentos para AGT-002</h3>
      <p>Seleccione los documentos vigentes que formarán parte de esta corrida. No registra ni autoriza GO / NO GO: la conclusión de AGT-002 sigue requiriendo revisión humana antes de cualquier decisión.</p>
      <p className="tender-governed-document-workset-suggestion-disclaimer">Vig-IA preseleccionó algunos documentos como punto de partida. Licitaciones puede agregar o quitar cualquier documento libremente, esté o no sugerido.</p>
    </header>

    <fieldset className="tender-governed-document-workset-fieldset" disabled={busy}>
      <legend>Documentos candidatos</legend>
      <p aria-live="polite" className="tender-governed-document-workset-count">{agt002GovernedWorksetSelectionCountLabel(entries.length)}</p>
      {!candidates.length && <p className="muted">No hay documentos vigentes disponibles para seleccionar.</p>}
      {candidates.map(document => {
        const eligibility = tenderDocumentExtractionEligibility(document);
        const checked = document.id in selection;
        const entry = selection[document.id];
        const checkboxId = `tender-governed-document-workset-doc-${document.id}`;
        const ineligibleId = `${checkboxId}-ineligible`;
        const suggestion = document.analysis_suggestion;
        const suggestionId = `${checkboxId}-suggestion`;
        return <div className="tender-governed-document-workset-row" key={document.id}>
          <label htmlFor={checkboxId}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={checked}
              disabled={!eligibility.eligible || busy || (!checked && atMaxMembers)}
              aria-describedby={eligibility.eligible ? undefined : ineligibleId}
              onChange={() => toggleDocument(document.id)}
            />
            <span>{document.name}</span>
          </label>
          {!eligibility.eligible && <small id={ineligibleId} className="tender-governed-document-workset-ineligible">{eligibility.reason}</small>}
          {suggestion?.recommended && <small id={suggestionId} className="tender-governed-document-workset-suggestion">Sugerido por Vig-IA — {suggestion.reason}</small>}
          {checked && <div className="tender-governed-document-workset-entry-fields">
            <label htmlFor={`${checkboxId}-classification`}>Clasificación de la fuente
              <select id={`${checkboxId}-classification`} value={entry?.source_classification || ''} disabled={busy} onChange={event => updateEntry(document.id, { source_classification: event.target.value as Agt002GovernedWorksetDraftEntry['source_classification'] })}>
                <option value="">Seleccione…</option>
                {AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATIONS.map(value => <option key={value} value={value}>{AGT002_GOVERNED_WORKSET_SOURCE_CLASSIFICATION_LABELS[value]}</option>)}
              </select>
            </label>
            <label htmlFor={`${checkboxId}-reason`}>Motivo de inclusión
              <input id={`${checkboxId}-reason`} type="text" value={entry?.inclusion_reason || ''} disabled={busy} onChange={event => updateEntry(document.id, { inclusion_reason: event.target.value })} />
            </label>
          </div>}
        </div>;
      })}
    </fieldset>

    <label className="tender-governed-document-workset-upload">Cargar documento nuevo
      <input type="file" multiple onChange={handleUpload} disabled={busy} />
      <small>Un documento nuevo cargado aquí se lista como candidato, pero nunca se agrega automáticamente a la selección congelada.</small>
    </label>

    {errors.length > 0 && <div className="notice tender-governed-document-workset-errors" role="status" aria-live="polite"><ul>{errors.map(message => <li key={message}>{message}</li>)}</ul></div>}

    <label className="tender-governed-document-workset-confirm">
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
      <span>{AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY}</span>
    </label>

    <button type="button" className="tender-governed-document-workset-cta" disabled={!canFreeze} onClick={handleFreeze}>Congelar paquete y ejecutar AGT-002</button>
  </section>;
}
