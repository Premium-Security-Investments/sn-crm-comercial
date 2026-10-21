import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../components/tender-dossier.css';
import './tender-workspace.css';
import {
  REQUIREMENT_ITEM_KEY_PREFIX, REQUIREMENT_STATUS_LABEL, buildRequirementRows, decisiveRequirementRows, groupRowsByCategory, otherRiskNotes,
  placeAgt002Clarifications,
  type RequirementRow,
} from '../../../agt002-requirements-model.js';
import { appendTenderDossierItemAction, loadTenderDossierWorkspace, loadTenderOfferStatus, recordTenderOfferStatusTransition } from '../api';
import { initialReportCompanyFit, initialReportLabels, initialReportRecommendationText, initialReportVerdict, type Agt002InitialReport } from '../agt002InitialReportProjection';
import { groupDossierChecklist, parseDossierItemTitle } from '../dossierChecklistModel';
import { TenderDossierArtifacts } from '../components/TenderDossierArtifacts';
import type { TenderDossierAssignee, TenderDossierItem, TenderDossierItemActionInput, TenderDossierWorkspace, TenderOfferStatus, TenderRequest } from '../types';
import { TenderVigiaChannel } from './TenderVigiaChannel';
import { TenderClarificationNotes, TenderClarificationsCard, TenderClarifyInline, useTenderClarifications, type TenderClarification, type TenderClarificationPlacement } from './TenderClarify';
import { OFFER_STATUS_LABEL, POST_GO_STATUSES, countdownLabel, daysUntil, formatDay, formatDeadline, todayInBogota } from './tenderWorkspaceFormat';

export type TenderWorkspaceTab = 'principal' | 'analisis' | 'documentos' | 'historial';
export type TenderWorkspaceMoment = 'decidir' | 'preparar';

/** Estado de la oferta leído del servidor (la oportunidad del listado puede traerlo viejo justo tras el GO). */
export function useTenderOfferStatus(opportunityId: string, request: TenderRequest, revision: number, enabled = true): TenderOfferStatus | null {
  const [status, setStatus] = useState<TenderOfferStatus | null>(null);
  useEffect(() => { setStatus(null); }, [opportunityId]);
  useEffect(() => {
    let active = true;
    if (!enabled) return () => { active = false; };
    loadTenderOfferStatus(request, opportunityId)
      .then(payload => { if (active) setStatus(payload.status); })
      .catch(() => { if (active) setStatus(current => current); });
    return () => { active = false; };
  }, [opportunityId, request, revision, enabled]);
  return status;
}

export function tenderWorkspaceMoment(status: TenderOfferStatus | null): TenderWorkspaceMoment {
  return status && POST_GO_STATUSES.has(status) ? 'preparar' : 'decidir';
}

// --- Cabecera y pestañas ------------------------------------------------------------------------------

export function TenderWorkspaceHeader({ entity, owner, city, amountLabel, closeDate, offerStatus, report, actions }: {
  entity: string; owner: string; city: string; amountLabel: string; closeDate: string | null;
  offerStatus: TenderOfferStatus | null; report: Agt002InitialReport | null; actions?: ReactNode;
}) {
  const days = daysUntil(closeDate);
  const verdict = report ? initialReportVerdict(report.recommendation.kind) : null;
  const moment = tenderWorkspaceMoment(offerStatus);
  return <header className="tw-header">
    <div className="tw-header-main">
      <span className={`tw-state tw-state-${moment}`}>{offerStatus ? OFFER_STATUS_LABEL[offerStatus] : 'Cargando estado…'}</span>
      <h2>{entity}</h2>
      <p>{[owner, city, amountLabel].filter(Boolean).join(' · ')}</p>
      {moment === 'decidir' && verdict && <p className={`tw-verdict tone-${verdict.tone}`}><strong>Vig-IA: {verdict.label}</strong> · confianza {initialReportLabels.confidence(report!.recommendation.confidence)}</p>}
    </div>
    <div className={`tw-close ${days !== null && days <= 3 ? 'is-urgent' : ''}`}>
      <small>Cierre</small>
      <strong>{formatDay(closeDate)}</strong>
      <span>{countdownLabel(closeDate)}</span>
    </div>
    {actions && <div className="tw-header-actions">{actions}</div>}
  </header>;
}

export function TenderWorkspaceTabs({ tab, moment, onChange, onBack, sourceUrl }: {
  tab: TenderWorkspaceTab; moment: TenderWorkspaceMoment; onChange: (tab: TenderWorkspaceTab) => void; onBack: () => void; sourceUrl?: string | null;
}) {
  // Orden del proceso (Juan, 2026-10-13): Documentos · Análisis · Preparar · Historial. Antes del GO el análisis
  // vive en Decidir. Se entra siempre a la pestaña de trabajo; las demás se abren desde aquí.
  const tabs: { id: TenderWorkspaceTab; label: string }[] = [
    { id: 'documentos', label: 'Documentos' },
    ...(moment === 'preparar' ? [{ id: 'analisis' as const, label: 'Análisis' }] : []),
    { id: 'principal', label: moment === 'preparar' ? 'Preparar' : 'Decidir' },
    { id: 'historial', label: 'Historial' },
  ];
  return <nav className="tw-tabs" aria-label="Secciones de la licitación">
    <button type="button" className="tw-back" onClick={onBack}>← Oportunidades</button>
    <div className="tw-tab-list" role="tablist">
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => onChange(item.id)}>{item.label}</button>)}
    </div>
    {sourceUrl && <a className="tw-source" href={sourceUrl} target="_blank" rel="noreferrer">Fuente oficial ↗</a>}
  </nav>;
}

/**
 * Llamado a la acción (Juan, 2026-10-13): desde cualquier pestaña se ve cuál es el siguiente paso y se llega
 * con un clic. En la pestaña de trabajo lo muestra la propia vista (Decidir o Preparar).
 */
export function TenderNextStep({ tab, moment, offerStatus, onGo }: { tab: TenderWorkspaceTab; moment: TenderWorkspaceMoment; offerStatus: TenderOfferStatus | null; onGo: (tab: TenderWorkspaceTab) => void }) {
  if (tab === 'principal' || !offerStatus) return null;
  const text = moment === 'decidir'
    ? (offerStatus === 'cerrada_no_go' ? 'La licitación tiene NO GO.' : 'Siguiente paso: decidir si nos presentamos.')
    : offerStatus === 'en_preparacion' ? 'Siguiente paso: preparar la oferta.'
      : offerStatus === 'lista_para_presentar' ? 'Siguiente paso: presentar la oferta y registrarlo.'
        : offerStatus === 'presentada' ? 'Siguiente paso: registrar el resultado de la adjudicación.' : 'Proceso terminado.';
  const action = moment === 'decidir' ? (offerStatus === 'cerrada_no_go' ? null : 'Ir a Decidir') : (['en_preparacion', 'lista_para_presentar', 'presentada'].includes(offerStatus) ? 'Ir a Preparar' : null);
  return <div className="tw-next" role="note"><span>{text}</span>{action && <button type="button" onClick={() => onGo('principal')}>{action} →</button>}</div>;
}

// --- Lista con detalle al lado ------------------------------------------------------------------------

function StatusChip({ status }: { status: RequirementRow['status'] }) {
  return <span className={`tw-chip tw-chip-${status}`}>{REQUIREMENT_STATUS_LABEL[status]}</span>;
}

function sourceLine(source: RequirementRow['sources'][number]) {
  return [source.documentName, source.locator].filter(Boolean).join(' · ');
}

/** Detalle de un requisito tal como lo leyó el análisis. Lo usan las dos vistas. */
function RequirementAnalysisDetail({ row, compact = false }: { row: RequirementRow; compact?: boolean }) {
  return <div className="tw-req-detail-body">
    {!compact && row.actions.length > 0 && <section><h4>Qué hay que hacer</h4>{row.actions.map(action => <p key={action}>{action}</p>)}</section>}
    {row.demand && <section><h4>Qué exige el pliego</h4><p>{row.demand}</p>
      {row.sources.length > 0 && <p className="tw-source-line">{row.sources.map(sourceLine).join(' · ')}</p>}</section>}
    {row.company.length > 0 && <section><h4>Cómo estamos</h4>{row.company.map(text => <p key={text}>{text}</p>)}</section>}
    {row.notes.length > 0 && <section><h4>Lo que advierte el análisis</h4>{row.notes.map(note => <div className="tw-note" key={note.title}>
      <strong>{note.title}</strong>{note.impact && <p>{note.impact}</p>}
    </div>)}</section>}
    {row.openItems.length > 0 && <section><h4>Pendientes</h4><ul>{row.openItems.map(item => <li key={item.text}>{item.text}{item.dueAt ? ` · ${formatDeadline(item.dueAt)}` : ''}</li>)}</ul></section>}
  </div>;
}

type ClarifyContext = { opportunityId: string; request: TenderRequest };

function RequirementBrowser({ rows, selectedKey, onSelect, clarify, clarificationsByRow, onClarified }: {
  rows: RequirementRow[]; selectedKey: string | null; onSelect: (key: string) => void; clarify?: ClarifyContext;
  clarificationsByRow?: Map<string, TenderClarification[]>; onClarified?: () => void;
}) {
  const groups = groupRowsByCategory(rows);
  const selected = rows.find(row => row.key === selectedKey) || rows[0] || null;
  const detailRef = useRef<HTMLDivElement | null>(null);
  return <div className="tw-browser">
    <div className="tw-browser-list" role="listbox" aria-label="Requisitos del pliego">
      {groups.map(group => <div className="tw-browser-group" key={group.category}>
        <small>{group.label} · {group.rows.length}</small>
        {group.rows.map(row => <button type="button" role="option" aria-selected={selected?.key === row.key} key={row.key}
          className={`tw-browser-item ${selected?.key === row.key ? 'is-selected' : ''} ${row.rejection ? 'is-rejection' : ''}`}
          onClick={() => { onSelect(row.key); if (window.matchMedia?.('(max-width: 900px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <span className="tw-browser-item-title">{row.title}</span>
          <span className="tw-browser-item-meta"><StatusChip status={row.status} />{row.rejection && <span className="tw-reject">Causa rechazo</span>}
            {(clarificationsByRow?.get(row.key)?.length || 0) > 0 && <span className="tw-clarified-chip">Aclarado</span>}</span>
        </button>)}
      </div>)}
    </div>
    <div className="tw-browser-detail" ref={detailRef}>
      {selected ? <article>
        <small>{selected.categoryLabel === selected.area ? selected.area : `${selected.categoryLabel} · ${selected.area}`}</small>
        <h3>{selected.title}</h3>
        <p className="tw-browser-detail-meta"><StatusChip status={selected.status} />{selected.rejection && <span className="tw-reject">Causa rechazo</span>}{selected.severityLabel && <span className="tw-muted">Riesgo {selected.severityLabel.toLowerCase()}</span>}</p>
        <RequirementAnalysisDetail row={selected} />
        <TenderClarificationNotes items={clarificationsByRow?.get(selected.key) || []} />
        {clarify && <TenderClarifyInline key={`clarify-${selected.key}`} opportunityId={clarify.opportunityId} request={clarify.request} target={{ kind: 'requirement', id: selected.key, label: selected.title }} onSaved={onClarified} />}
      </article> : <p className="tw-muted">El análisis no trae requisitos.</p>}
    </div>
  </div>;
}

// --- Cronograma ---------------------------------------------------------------------------------------

type ScheduleRow = { key: string; label: string; value: string; day: string; days: number | null; certainty: string };

function scheduleRows(report: Agt002InitialReport): ScheduleRow[] {
  return report.deadlines
    .filter(deadline => deadline.value)
    .map((deadline, index) => {
      const value = deadline.value as string;
      const day = value.slice(0, 10);
      return { key: `${deadline.kind}-${value}-${index}`, label: deadline.label || initialReportLabels.deadlineKind(deadline.kind), value, day, days: daysUntil(day), certainty: deadline.certainty };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

function scheduleWhen(days: number | null) {
  if (days === null) return { text: '', tone: '' };
  if (days < 0) return { text: 'Ya pasó', tone: 'is-past' };
  if (days === 0) return { text: 'Hoy', tone: 'is-today' };
  if (days === 1) return { text: 'Mañana', tone: 'is-soon' };
  return { text: `Faltan ${days} días`, tone: days <= 3 ? 'is-soon' : '' };
}

/**
 * Cronograma del proceso, completo y en orden (Juan, 2026-10-13: "tenemos que tener eso muy claro").
 * Cada trámite con el nombre que le da el documento; el próximo se resalta. Los análisis anteriores al
 * cronograma completo no traen nombres y pueden omitir filas: se avisa.
 */
export function TenderScheduleCard({ report, compact = false }: { report: Agt002InitialReport | null; compact?: boolean }) {
  const [showPast, setShowPast] = useState(false);
  if (!report) return null;
  const rows = scheduleRows(report);
  if (!rows.length) return null;
  const complete = report.deadlines.some(deadline => Boolean(deadline.label));
  const nextKey = rows.find(row => row.days !== null && row.days >= 0)?.key;
  const past = rows.filter(row => row.days !== null && row.days < 0);
  const visible = compact && !showPast ? rows.filter(row => !(row.days !== null && row.days < 0)) : rows;
  return <section className="tw-card tw-schedule" aria-label="Cronograma del proceso">
    <small>Cronograma del proceso</small>
    {!complete && <p className="tw-schedule-warning">Este análisis es anterior al cronograma completo y puede omitir fechas. El cronograma oficial está en el acto de apertura y en SECOP II; Vig-IA lo busca en los documentos si se le pregunta.</p>}
    <ol className="tw-schedule-list">
      {visible.map(row => {
        const when = scheduleWhen(row.days);
        return <li key={row.key} className={`${when.tone} ${row.key === nextKey ? 'is-next' : ''}`}>
          <span className="tw-schedule-date">{formatDeadline(row.value)}</span>
          <span className="tw-schedule-label">{row.label}{row.certainty !== 'CONFIRMED' && <em> · {initialReportLabels.certainty(row.certainty)}, verificar</em>}</span>
          <span className="tw-schedule-when">{row.key === nextKey ? `Próximo · ${when.text}` : when.text}</span>
        </li>;
      })}
    </ol>
    {compact && past.length > 0 && <button type="button" className="tw-link" onClick={() => setShowPast(value => !value)}>{showPast ? 'Ocultar las fechas que ya pasaron' : `Ver también las ${past.length} fechas que ya pasaron`}</button>}
  </section>;
}

// --- Antes del GO: ¿nos presentamos? ------------------------------------------------------------------

/** Antes del GO, con el registro de la decisión; después del GO, el mismo análisis para consulta (sin decisionPanel). */
export function TenderDecideView({ report, decisionPanel, reanalysis, channel, clarify }: { report: Agt002InitialReport | null; decisionPanel?: ReactNode; reanalysis?: ReactNode; channel?: ReactNode; clarify?: ClarifyContext }) {
  const rows = useMemo(() => buildRequirementRows(report), [report]);
  const decisive = useMemo(() => decisiveRequirementRows(rows), [rows]);
  const others = useMemo(() => otherRiskNotes(report, rows), [report, rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const browserRef = useRef<HTMLDivElement | null>(null);
  // Punto 3 de la definición de Juan: cada aclaración junto a su punto y todas juntas en una lista.
  const { clarifications, reload: reloadClarifications } = useTenderClarifications(clarify?.opportunityId, clarify?.request);
  const placement = useMemo(() => placeAgt002Clarifications(clarifications, { requirements: rows, findings: others }), [clarifications, rows, others]);
  const listedClarifications: TenderClarificationPlacement[] = placement.listed;
  const showRequirement = (key: string) => { setSelectedKey(key); browserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  if (!report) return <div className="tw-decide">
    <div className="notice tw-empty">El análisis de Vig-IA todavía no está listo. Su estado se ve en <strong>Documentos</strong>.{decisionPanel ? ' Puede registrar la decisión igual.' : ''}</div>
    {decisionPanel}
  </div>;
  const verdict = initialReportVerdict(report.recommendation.kind);
  return <div className="tw-decide">
    {decisionPanel && <div className="tw-next" role="note"><span>Siguiente paso: revisar lo que puede tumbar la oferta y registrar la decisión GO / NO GO.</span>
      <button type="button" onClick={() => document.getElementById('tender-decision')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ir a la decisión →</button></div>}
    <section className={`tw-card tw-verdict-card tone-${verdict.tone}`}>
      <small>{decisionPanel ? 'Lo que recomienda Vig-IA' : 'Lo que recomendó Vig-IA antes del GO'}</small>
      <h3>{verdict.label}</h3>
      <p>{initialReportRecommendationText(report.recommendation.label)}</p>
      <p className="tw-muted">{initialReportCompanyFit(report)} · confianza {initialReportLabels.confidence(report.recommendation.confidence)} · {rows.length} requisitos revisados</p>
      {reanalysis}
    </section>

    <TenderScheduleCard report={report} />

    {decisive.length > 0 && <section className="tw-card">
      <small>Lo que puede tumbar la oferta</small>
      <ul className="tw-decisive">
        {decisive.map(row => <li key={row.key}><button type="button" onClick={() => showRequirement(row.key)}>
          <span className="tw-browser-item-title">{row.title}</span>
          <span className="tw-browser-item-meta"><StatusChip status={row.status} />{row.rejection && <span className="tw-reject">Causa rechazo</span>}</span>
          {row.actions[0] && <span className="tw-decisive-action">{row.actions[0]}</span>}
        </button></li>)}
      </ul>
    </section>}

    {/* Antes del GO también se le puede preguntar y aclarar a Vig-IA (Juan, 2026-10-20; migración 140). */}
    {channel}

    {decisionPanel}

    <TenderClarificationsCard listed={listedClarifications} onSelectRequirement={showRequirement} />

    <section className="tw-card" ref={browserRef}>
      <small>Requisitos del pliego</small>
      <RequirementBrowser rows={rows} selectedKey={selectedKey} onSelect={setSelectedKey} clarify={clarify}
        clarificationsByRow={placement.byRequirement} onClarified={() => void reloadClarifications()} />
    </section>

    {others.length > 0 && <section className="tw-card tw-secondary">

      {others.length > 0 && <details><summary>Otros riesgos que señala el análisis ({others.length})</summary>
        {others.map(note => <div className="tw-note" key={note.title}><strong>{note.severityLabel} · {note.title}</strong>{note.impact && <p>{note.impact}</p>}
          <TenderClarificationNotes items={(note.id && placement.byFinding.get(note.id)) || []} />
          {clarify && note.id && <TenderClarifyInline opportunityId={clarify.opportunityId} request={clarify.request} target={{ kind: 'finding', id: note.id, label: note.title }} onSaved={() => void reloadClarifications()} />}</div>)}
      </details>}
    </section>}
    <p className="tw-footnote">Análisis hecho con inteligencia artificial sobre los documentos vigentes: orienta, no decide. Verifique contra el pliego original.</p>
  </div>;
}

// --- Después del GO: ¿llegamos a tiempo? --------------------------------------------------------------

const ITEM_STATUS_LABEL: Record<TenderDossierItem['status'], string> = { pendiente: 'Pendiente', en_progreso: 'En progreso', listo: 'Listo', bloqueado: 'Bloqueado' };
const NEXT_STATUS: Partial<Record<TenderOfferStatus, { status: TenderOfferStatus; label: string }[]>> = {
  en_preparacion: [{ status: 'lista_para_presentar', label: 'Marcar lista para presentar' }],
  lista_para_presentar: [{ status: 'presentada', label: 'Registrar oferta presentada' }],
  presentada: [{ status: 'adjudicada', label: 'Registrar adjudicada' }, { status: 'no_adjudicada', label: 'Registrar no adjudicada' }],
};

function itemDueClass(item: TenderDossierItem, today: string) {
  if (item.status === 'listo' || item.applicability === 'no_aplica' || !item.target_date) return '';
  if (item.target_date < today) return 'is-overdue';
  if (item.target_date === today) return 'is-today';
  return '';
}

/** Instrucción guardada como líneas "Qué hacer: …"; se muestra por partes, sin la nota de origen. */
function InstructionBlock({ text }: { text: string }) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  return <div className="tw-req-detail-body">{lines.map(line => {
    const match = line.match(/^(Qué hacer|Qué exige el pliego|Dónde|Estado según el análisis):\s*(.*)$/);
    if (/^Cargado por Vig-IA/.test(line)) return <p className="tw-footnote" key={line}>{line}</p>;
    return match ? <section key={line}><h4>{match[1]}</h4><p>{match[2]}</p></section> : <p key={line}>{line}</p>;
  })}</div>;
}

type ItemDraft = { evidenceKind: 'texto' | 'url'; evidence: string; justification: string };

export function TenderPrepareView({ opportunityId, request, profiles, canApprove, report, closeDate, offerStatus, onOfferStatusChanged, channel, onSeedRequirements }: {
  opportunityId: string; request: TenderRequest; profiles: TenderDossierAssignee[]; canApprove: boolean;
  report: Agt002InitialReport | null; closeDate: string | null; offerStatus: TenderOfferStatus | null;
  onOfferStatusChanged: () => Promise<void> | void; channel?: ReactNode;
  onSeedRequirements: () => Promise<{ inserted: number }>;
}) {
  const [workspace, setWorkspace] = useState<TenderDossierWorkspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>({ evidenceKind: 'texto', evidence: '', justification: '' });
  const [showNoAplica, setShowNoAplica] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const detailRef = useRef<HTMLDivElement | null>(null);
  const versionRef = useRef(0);
  const today = todayInBogota();
  const humanProfiles = profiles.filter(profile => profile.active !== false && profile.identity_type !== 'agent');
  const rowsByKey = useMemo(() => new Map(buildRequirementRows(report).map(row => [`${REQUIREMENT_ITEM_KEY_PREFIX}${row.key}`, row])), [report]);

  const reload = useCallback(async () => {
    const version = ++versionRef.current;
    try {
      const next = await loadTenderDossierWorkspace(request, opportunityId);
      if (version === versionRef.current) { setWorkspace(next); setError(''); }
    } catch (cause) {
      if (version === versionRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [opportunityId, request]);
  useEffect(() => { setWorkspace(null); setSelectedId(null); void reload(); }, [reload]);

  if (!workspace) return <div className="tw-prepare">{error ? <div className="error" role="alert">{error}</div> : <p className="tw-muted">Cargando la preparación…</p>}</div>;

  // Los documentos de la plantilla repetían la lista de documentos para aprobar: no se muestran.
  const groups = groupDossierChecklist(workspace.checklist);
  const tasks = [...groups.open, ...groups.done];
  const requiredItems = workspace.checklist.filter(item => item.required && item.applicability !== 'no_aplica');
  const readyCount = requiredItems.filter(item => item.status === 'listo').length;
  const rejectionOpen = groups.open.filter(item => parseDossierItemTitle(item.title).rejection).length;
  const overdue = groups.open.filter(item => item.target_date && item.target_date < today).length;
  const requiredArtifacts = workspace.artifacts.filter(artifact => artifact.required);
  const unapproved = requiredArtifacts.filter(artifact => !artifact.has_approved_version).length;
  const hasRequirementItems = workspace.checklist.some(item => item.item_key.startsWith(REQUIREMENT_ITEM_KEY_PREFIX) || item.item_key.startsWith('matriz:'));
  const selected = workspace.checklist.find(item => item.id === selectedId) || groups.open[0] || tasks[0] || null;
  const next = offerStatus ? NEXT_STATUS[offerStatus] || [] : [];
  const readyBlocked = !workspace.readiness.ready || !workspace.can_mark_ready;

  const act = async (item: TenderDossierItem, action: Omit<TenderDossierItemActionInput, 'opportunity_id' | 'item_id'>) => {
    setBusy(item.id); setError('');
    try {
      await appendTenderDossierItemAction(request, { opportunity_id: opportunityId, item_id: item.id, ...action });
      await reload();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(null); }
  };
  const select = (item: TenderDossierItem) => {
    setSelectedId(item.id); setDraft({ evidenceKind: 'texto', evidence: '', justification: '' }); setShowNoAplica(false);
    if (window.matchMedia?.('(max-width: 900px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const transition = async (to: TenderOfferStatus) => {
    if (!offerStatus) return;
    setBusy('status'); setError('');
    try {
      await recordTenderOfferStatusTransition(request, { opportunity_id: opportunityId, to_status: to, expected_current_status: offerStatus, note: statusNote.trim() || null });
      setStatusNote('');
      await onOfferStatusChanged();
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const seed = async () => {
    setBusy('seed'); setError('');
    try { await onSeedRequirements(); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };

  const renderRow = (item: TenderDossierItem) => {
    const title = parseDossierItemTitle(item.title);
    const notApplicable = item.applicability === 'no_aplica';
    return <button type="button" key={item.id} role="option" aria-selected={selected?.id === item.id}
      className={`tw-task ${selected?.id === item.id ? 'is-selected' : ''} ${itemDueClass(item, today)} ${title.rejection ? 'is-rejection' : ''}`}
      onClick={() => select(item)}>
      <span className="tw-task-title">{title.label}</span>
      <span className="tw-task-meta">
        <span className={`tw-chip tw-chip-item-${notApplicable ? 'no_aplica' : item.status}`}>{notApplicable ? 'No aplica' : ITEM_STATUS_LABEL[item.status]}</span>
        {title.rejection && <span className="tw-reject">Causa rechazo</span>}
        {title.area && <span>{title.area}</span>}
        <span>{item.assignee_name || 'Sin responsable'}</span>
        <span className="tw-task-date">{formatDay(item.target_date)}</span>
      </span>
    </button>;
  };

  const selectedTitle = selected ? parseDossierItemTitle(selected.title) : null;
  const linkedRow = selected ? rowsByKey.get(selected.item_key) : undefined;
  const disabled = !selected || busy === selected.id || selected.applicability === 'no_aplica';

  const urgent = groups.open[0] || null;
  const urgentTitle = urgent ? parseDossierItemTitle(urgent.title) : null;
  return <div className="tw-prepare">
    {urgent && urgentTitle && <div className="tw-next" role="note">
      <span>Lo más urgente: <strong>{urgentTitle.label}</strong>{urgentTitle.rejection ? ' (causa rechazo)' : ''} · {formatDay(urgent.target_date)}{urgent.assignee_name ? ` · ${urgent.assignee_name}` : ' · sin responsable'}</span>
      <button type="button" onClick={() => select(urgent)}>Abrir la tarea →</button></div>}
    <section className="tw-card tw-progress">
      <div className="tw-progress-figures">
        <div><strong>{readyCount} de {requiredItems.length}</strong><span>tareas listas</span></div>
        <div className={rejectionOpen ? 'is-alert' : ''}><strong>{rejectionOpen}</strong><span>causan rechazo y siguen abiertas</span></div>
        <div className={overdue ? 'is-alert' : ''}><strong>{overdue}</strong><span>con la fecha vencida</span></div>
        <div><strong>{requiredArtifacts.length - unapproved} de {requiredArtifacts.length}</strong><span>documentos aprobados</span></div>
      </div>
      {next.length > 0 && <div className="tw-progress-next">
        {offerStatus === 'en_preparacion' && readyBlocked && <p className="tw-muted">Se podrá marcar lista para presentar cuando todas las tareas obligatorias estén listas o no apliquen y los documentos estén aprobados{!workspace.can_mark_ready ? ' (requiere un perfil de dirección)' : ''}.</p>}
        {(offerStatus !== 'en_preparacion' || !readyBlocked) && canApprove && <input aria-label="Nota del cambio de estado" placeholder="Nota (opcional)" value={statusNote} onChange={event => setStatusNote(event.target.value)} />}
        {next.map(option => <button key={option.status} type="button" disabled={busy === 'status' || !canApprove || (option.status === 'lista_para_presentar' && readyBlocked)} onClick={() => void transition(option.status)}>{option.label}</button>)}
      </div>}
    </section>
    {error && <div className="error" role="alert">{error}</div>}

    <TenderScheduleCard report={report} compact />

    {!hasRequirementItems && report && <div className="notice tw-seed">
      <span>Esta licitación todavía no tiene en su lista los requisitos del análisis.</span>
      <button type="button" disabled={busy === 'seed'} onClick={() => void seed()}>Cargar los requisitos del análisis</button>
    </div>}

    <section className="tw-card">
      <small>Lista de trabajo · ordenada por fecha</small>
      <div className="tw-browser">
        <div className="tw-browser-list" role="listbox" aria-label="Tareas de la oferta">
          {groups.open.map(renderRow)}
          {!groups.open.length && <p className="tw-muted">No quedan tareas abiertas.</p>}
          {groups.done.length > 0 && <details className="tw-fold"><summary>Listas ({groups.done.length})</summary>{groups.done.map(renderRow)}</details>}
          {groups.notApplicable.length > 0 && <details className="tw-fold"><summary>No aplican ({groups.notApplicable.length})</summary>{groups.notApplicable.map(renderRow)}</details>}
        </div>
        <div className="tw-browser-detail" ref={detailRef}>
          {selected && selectedTitle ? <article>
            <small>{selectedTitle.area || 'Tarea'}{selected.required ? ' · obligatoria' : ''}</small>
            <h3>{selectedTitle.label}</h3>
            {selectedTitle.rejection && <p><span className="tw-reject">Causa rechazo</span> Si falta, la oferta queda descartada.</p>}
            <div className="tw-controls">
              <label><span>Estado</span><select value={selected.status} disabled={disabled} onChange={event => void act(selected, { action_type: 'status_changed', to_status: event.target.value as TenderDossierItem['status'] })}>
                {Object.entries(ITEM_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Responsable</span><select value={selected.assignee_id || ''} disabled={disabled} onChange={event => void act(selected, { action_type: 'assigned', assignee_id: event.target.value || null, target_date: selected.target_date || null })}>
                <option value="">Sin asignar</option>{humanProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label>
              <label><span>Fecha</span><input type="date" key={`${selected.id}-${selected.target_date}`} defaultValue={selected.target_date || ''} disabled={disabled}
                onBlur={event => { const value = event.target.value; if (value !== (selected.target_date || '')) void act(selected, { action_type: 'requirement_changed', target_date: value || null }); }} /></label>
            </div>
            {selected.instruction && <InstructionBlock text={selected.instruction} />}
            {linkedRow && (linkedRow.notes.length > 0 || linkedRow.company.length > 0) && <details className="tw-fold"><summary>Ver lo que dice el análisis</summary><RequirementAnalysisDetail row={linkedRow} compact /></details>}
            <section className="tw-evidence">
              <h4>Soporte</h4>
              {selected.latest_evidence ? <p>{selected.latest_evidence.kind === 'url' ? <a href={selected.latest_evidence.url || '#'} target="_blank" rel="noreferrer">{selected.latest_evidence.url}</a> : selected.latest_evidence.text}</p> : <p className="tw-muted">Todavía no hay soporte registrado.</p>}
              <div className="tw-evidence-form">
                <select aria-label="Tipo de soporte" value={draft.evidenceKind} onChange={event => setDraft(current => ({ ...current, evidenceKind: event.target.value as ItemDraft['evidenceKind'] }))}><option value="texto">Texto</option><option value="url">Enlace</option></select>
                <input aria-label="Soporte" value={draft.evidence} placeholder={draft.evidenceKind === 'url' ? 'https://…' : 'Qué se hizo o dónde está el soporte'} onChange={event => setDraft(current => ({ ...current, evidence: event.target.value }))} />
                <button type="button" className="secondary" disabled={busy === selected.id || !draft.evidence.trim()} onClick={async () => {
                  const ok = await act(selected, { action_type: 'evidence_attached', evidence_kind: draft.evidenceKind, evidence_text: draft.evidenceKind === 'texto' ? draft.evidence : null, evidence_url: draft.evidenceKind === 'url' ? draft.evidence : null });
                  if (ok) setDraft(current => ({ ...current, evidence: '' }));
                }}>Guardar soporte</button>
              </div>
            </section>
            <div className="row-actions">
              {selected.applicability === 'no_aplica'
                ? <button type="button" className="secondary" disabled={busy === selected.id} onClick={() => void act(selected, { action_type: 'reopened' })}>Reabrir</button>
                : canApprove && <button type="button" className="secondary" onClick={() => setShowNoAplica(value => !value)}>Marcar que no aplica</button>}
            </div>
            {showNoAplica && <div className="tw-inline-form"><label><span>Por qué no aplica</span><textarea value={draft.justification} onChange={event => setDraft(current => ({ ...current, justification: event.target.value }))} /></label>
              <button type="button" disabled={busy === selected.id || !draft.justification.trim()} onClick={async () => { if (await act(selected, { action_type: 'marked_not_applicable', justification: draft.justification.trim() })) setShowNoAplica(false); }}>Confirmar</button></div>}
          </article> : <p className="tw-muted">La lista está vacía.</p>}
        </div>
      </div>
    </section>

    {channel}
    {!channel && workspace.workbench_enabled && <TenderVigiaChannel opportunityId={opportunityId} request={request} />}

    {requiredArtifacts.length > 0 && <section className="tw-card">
      <small>Documentos que se firman y aprueban</small>
      <TenderDossierArtifacts opportunityId={opportunityId} artifacts={requiredArtifacts} request={request} canApprove={canApprove} onChanged={reload} />
    </section>}
  </div>;
}
