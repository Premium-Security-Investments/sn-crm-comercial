import { useMemo, useState } from 'react';
import './tender-integral-analysis-v3.css';
import type { TenderDocumentAnalysis, TenderIntegralAnalysisUnit, TenderIntegralCategory } from '../types';

type TenderIntegralAnalysisV3ViewProps = { analysis: TenderDocumentAnalysis | null };

type Tone = 'supported' | 'partial' | 'gap' | 'insufficient';
type AxisTone = 'ok' | 'warn' | 'danger';

const PHASES: Array<{ key: TenderIntegralCategory; label: string; short: string }> = [
  { key: 'discard', label: 'Descarte', short: '01' },
  { key: 'habilitating', label: 'Habilitantes', short: '02' },
  { key: 'technical', label: 'Técnico', short: '03' },
  { key: 'financial_execution', label: 'Financiero / ejecución', short: '04' },
  { key: 'strategic', label: 'Estratégico', short: '05' },
];

const CONCLUSION_LABEL: Record<string, string> = {
  supported_with_evidence: 'Sustentado con evidencia',
  partially_supported: 'Sustento parcial',
  gap_evidenced: 'Brecha evidenciada',
  insufficient_evidence: 'Evidencia insuficiente',
  human_validation_required: 'Revisión humana requerida',
};
const CONCLUSION_TONE: Record<string, Tone> = {
  supported_with_evidence: 'supported',
  partially_supported: 'partial',
  gap_evidenced: 'gap',
  insufficient_evidence: 'insufficient',
  human_validation_required: 'partial',
};

const AXIS_LABEL: Record<string, string> = { presence: 'Presencia', review: 'Revisión', validity: 'Vigencia', applicability: 'Aplicabilidad', compliance: 'Sustento' };
const AXIS_VALUE_LABEL: Record<string, string> = {
  present: 'Presente', absent: 'Ausente', unknown: 'Desconocido',
  reviewed: 'Revisada', partially_reviewed: 'Revisión parcial', not_reviewed: 'No revisada',
  valid: 'Vigente', expired: 'Vencida', not_applicable: 'No aplica',
  applicable: 'Aplica',
  supported_pending_human_review: 'Sustento pendiente de validación',
  partially_supported_pending_human_review: 'Sustento parcial pendiente',
  gap_evidenced_pending_human_review: 'Brecha evidenciada pendiente',
};
const AXIS_DANGER_VALUES = new Set(['absent', 'expired', 'gap_evidenced_pending_human_review']);
const AXIS_WARN_VALUES = new Set(['unknown', 'not_reviewed', 'partially_reviewed', 'partially_supported_pending_human_review']);

function axisValueLabel(value: string): string {
  return AXIS_VALUE_LABEL[value] ?? value;
}
function axisTone(value: string): AxisTone {
  if (AXIS_DANGER_VALUES.has(value)) return 'danger';
  if (AXIS_WARN_VALUES.has(value)) return 'warn';
  return 'ok';
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  tender_document: 'Documento del pliego', company_evidence: 'Evidencia empresarial', legal_corpus: 'Corpus jurídico',
  human_evidence: 'Evidencia humana', objective_validation: 'Validación objetiva',
};
const PURPOSE_LABEL: Record<string, string> = {
  requirement_basis: 'Sustento del requisito', company_capacity: 'Capacidad empresarial', legal_basis: 'Fundamento jurídico',
  commercial_context: 'Contexto comercial', milestone_basis: 'Sustento de hito', gap_basis: 'Sustento de brecha',
};

const COMMERCIAL_IMPACT_LABEL: Record<string, string> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', unknown: 'Desconocido' };
const LEGAL_STATUS_LABEL: Record<string, string> = {
  supported: 'Sustentado', partially_supported: 'Parcialmente sustentado', unsupported: 'Sin sustento',
  not_verified: 'No verificado', not_applicable: 'No aplica',
};

function coverageLabel(unit: TenderIntegralAnalysisUnit): string {
  return `${CONCLUSION_LABEL[unit.conclusion.status] ?? unit.conclusion.status}`;
}

export function TenderIntegralAnalysisV3View({ analysis }: TenderIntegralAnalysisV3ViewProps) {
  const integral = analysis?.integral_analysis;
  const units = integral?.analysis_units;
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!units || units.length === 0) return null;
    return units.find(unit => unit.unit_id === selectedUnitId) ?? units[0];
  }, [units, selectedUnitId]);

  if (!integral || !units || units.length === 0 || !selected) return null;

  const phase = PHASES.find(item => item.key === selected.category) ?? PHASES[0];
  const tone = CONCLUSION_TONE[selected.conclusion.status] ?? 'partial';
  const axisEntries: Array<[string, string]> = [
    ['presence', selected.evidence_state.presence],
    ['review', selected.evidence_state.review],
    ['validity', selected.evidence_state.validity],
    ['applicability', selected.evidence_state.applicability],
    ['compliance', selected.evidence_state.compliance],
  ];
  const coverageRatio = `${integral.coverage.analyzed_requirement_ids.length} / ${integral.coverage.expected_requirement_ids.length}`;
  // Phase 4: the server-owned, top-level honest coverage scope for a manifest-driven run. When
  // present, it replaces the misleading generic "Cobertura" ratio (analyzed/expected) with the
  // distinct 20/25, 15 (68), and closed 15/15 + 20/20 figures — never presenting analyzed/expected
  // as total manifest coverage. Always optional: absent for non-manifest V3 runs.
  const scope = analysis?.manifest_scope ?? null;

  return <section className="agt002-v3-preview" aria-labelledby="agt002-v3-title">
    <header className="agt002-v3-overview">
      <div className="agt002-v3-overview-copy">
        <span className="agt002-v3-eyebrow">AGT-002 · Análisis integral</span>
        <h2 id="agt002-v3-title">Análisis integral por requisito</h2>
        <p>Evidencia, brechas y acciones organizadas por requisito. La decisión institucional sigue siendo humana.</p>
      </div>
      <div className="agt002-v3-overview-summary">
        {scope
          ? <span><small>Requisitos analizables</small><strong>{scope.analyzable_requirement_ids.length} / {scope.atomized_entry_count}</strong></span>
          : <span><small>Cobertura</small><strong>{coverageRatio}</strong></span>}
        <span><small>Estado</small><strong>{integral.coverage.material_omissions ? 'Con omisiones' : 'Revisión humana'}</strong></span>
      </div>
      {scope && <dl className="agt002-v3-scope" aria-label="Alcance del manifiesto gobernado">
        <div><dt>Secciones pre-GO del manifiesto</dt><dd>{scope.pre_go_relevant} ({scope.registry_sections} registradas)</dd></div>
        <div><dt>Libros conciliados</dt><dd>Secciones {scope.section_ledger_accounted}/{scope.pre_go_relevant} · Propuestas {scope.proposal_ledger_accounted}/{scope.proposal_ledger_accounted}</dd></div>
        <div><dt>Disposiciones</dt><dd>Candidatas analizadas {scope.dispositions.analyzed_candidate} · Excluidas con razón {scope.dispositions.excluded_with_reason} · No resueltas visibles {scope.dispositions.unresolved_visible}</dd></div>
      </dl>}
      <div className="agt002-v3-overview-footer">
        <div className="agt002-v3-guard"><strong>Validación humana pendiente</strong><span>No decide GO / NO GO · No firma · No envía · No presenta ofertas</span></div>
        <details className="agt002-v3-run-details">
          <summary>Detalles de ejecución</summary>
          <dl className="agt002-v3-run-meta">
            <div><dt>Ejecución</dt><dd>{analysis?.run_id ?? '—'}</dd></div>
            <div><dt>Snapshot</dt><dd>{analysis?.snapshot_id ?? '—'}</dd></div>
          </dl>
        </details>
      </div>
    </header>

    <nav className="agt002-v3-phase-strip" aria-label="Orden institucional del análisis">
      {PHASES.map(item => {
        const phaseUnits = units.filter(unit => unit.category === item.key);
        const alerts = phaseUnits.filter(unit => unit.blocking.effect === 'blocker' || unit.missing_evidence.some(entry => entry.critical)).length;
        return <div key={item.key} className={item.key === selected.category ? 'active' : ''}>
          <span>{item.short}</span><strong>{item.label}</strong><small>{phaseUnits.length} unidad(es){alerts ? ` · ${alerts} crítica(s)` : ''}</small>
        </div>;
      })}
    </nav>

    <div className="agt002-v3-workbench">
      <aside className="agt002-v3-unit-rail" aria-label="Unidades del análisis">
        <header><div><span>Manifiesto cubierto</span><strong>Unidades revisables</strong></div><b>{units.length}</b></header>
        <div className="agt002-v3-unit-list">
          {units.map(unit => {
            const unitTone = CONCLUSION_TONE[unit.conclusion.status] ?? 'partial';
            const critical = unit.blocking.effect === 'blocker' || unit.missing_evidence.some(entry => entry.critical);
            return <button type="button" key={unit.unit_id} className={`${unit.unit_id === selected.unit_id ? 'active' : ''} tone-${unitTone}`} aria-pressed={unit.unit_id === selected.unit_id} onClick={() => setSelectedUnitId(unit.unit_id)}>
              <span className="agt002-v3-unit-top"><code>{unit.unit_id}</code>{critical && <b>Crítica</b>}</span>
              <strong>{unit.title}</strong>
              <small>{coverageLabel(unit)}</small>
            </button>;
          })}
        </div>
      </aside>

      <article className="agt002-v3-detail" aria-live="polite">
        <header className="agt002-v3-detail-head">
          <div><span>{phase.short} · {phase.label}</span><h3>{selected.title}</h3><code>{selected.unit_id}</code></div>
          <b className={`agt002-v3-status tone-${tone}`}>{CONCLUSION_LABEL[selected.conclusion.status] ?? selected.conclusion.status}</b>
        </header>

        <blockquote>{selected.conclusion.summary}</blockquote>

        <section className="agt002-v3-axes" aria-label="Cinco ejes independientes">
          {axisEntries.map(([key, value]) => <div key={key} className={`axis-${axisTone(value)}`}><span>{AXIS_LABEL[key]}</span><strong>{axisValueLabel(value)}</strong></div>)}
        </section>

        <div className="agt002-v3-analysis-grid">
          <section><span className="agt002-v3-section-label">Impacto comercial · {COMMERCIAL_IMPACT_LABEL[selected.commercial_impact.level] ?? selected.commercial_impact.level}</span><p>{selected.commercial_impact.summary}</p></section>
          <section><span className="agt002-v3-section-label">Lectura jurídica · {LEGAL_STATUS_LABEL[selected.legal_assessment.status] ?? selected.legal_assessment.status}</span><p>{selected.legal_assessment.summary}</p></section>
        </div>

        <section className={`agt002-v3-evidence ${selected.evidence_refs.length ? '' : 'is-abstention'}`}>
          <header><div><span className="agt002-v3-section-label">Evidencia citada</span><strong>{selected.evidence_refs.length ? `${selected.evidence_refs.length} referencia(s) permitida(s)` : 'Sin evidencia citada'}</strong></div><span>{selected.evidence_refs.length ? 'Trazable' : 'Falta evidencia'}</span></header>
          {selected.evidence_refs.length ? <ul>{selected.evidence_refs.map(ref => <li key={`${ref.ref}-${ref.purpose}`}><code>{ref.ref}</code><strong>{SOURCE_TYPE_LABEL[ref.source_type] ?? ref.source_type}</strong><p>{PURPOSE_LABEL[ref.purpose] ?? ref.purpose}</p></li>)}</ul> : <p>Sin evidencia citada para esta unidad.</p>}
        </section>

        {selected.missing_evidence.length > 0 && <section className="agt002-v3-evidence is-abstention">
          <header><div><span className="agt002-v3-section-label">Evidencia faltante</span><strong>{selected.missing_evidence.length} faltante(s)</strong></div><span>Abstención explícita</span></header>
          <ul>{selected.missing_evidence.map(item => <li key={item.missing_id}><code>{item.missing_id}</code><strong>{item.critical ? 'Crítica' : 'No crítica'}</strong><p>{item.reason}</p></li>)}</ul>
        </section>}

        <section className="agt002-v3-action">
          <header><div><span className="agt002-v3-section-label">Acción trazable</span><strong>{selected.actions[0]?.summary ?? 'Sin acción registrada para esta unidad.'}</strong></div>{selected.actions[0] && <b>{selected.actions[0].suggested_role}</b>}</header>
          <dl>
            <div><dt>Unidad de origen</dt><dd>{selected.unit_id}</dd></div>
            <div><dt>Condición de cierre</dt><dd>{selected.closure.condition}</dd></div>
          </dl>
        </section>
      </article>
    </div>

    <footer className="agt002-v3-footer"><strong>Análisis integral · AGT-002 v3</strong><span>Contenido del expediente vigente. Toda conclusión permanece pendiente de validación humana.</span></footer>
  </section>;
}
