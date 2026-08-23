import './tender-integral-analysis-v3.css';
import {
  tenderIntegralAnalysisSummary,
  tenderIntegralCategoryLabel,
  tenderIntegralPhaseGroups,
  tenderIntegralUnitConditionAnchor,
  tenderRequirementInventoryReady,
  type TenderIntegralUnitPresentation,
} from '../tenderIntegralAnalysisPresentation';
import type { TenderDocumentAnalysis, TenderManifestUnresolvedEntry } from '../types';

// AGT-002 · respaldo técnico del análisis, en dos capas (task-4-brief).
// Primera capa: lectura humana completa por requisito, con los campos gobernados verbatim y los
// enums traducidos por diccionario cerrado. Nunca imprime unit_id, requirement_id, localizadores,
// hashes, offsets ni nombres de tablas. Segunda capa (`Ver trazabilidad técnica`): la trazabilidad
// íntegra, donde sí viven los códigos crudos. Toda la derivación (resumen, fases, traducciones y
// la relación con una condición gobernada) vive en `tenderIntegralAnalysisPresentation`: este
// componente no calcula conclusiones ni aplica heurísticas de texto.

type TenderIntegralAnalysisV3ViewProps = { analysis: TenderDocumentAnalysis | null };

type Tone = 'supported' | 'partial' | 'gap' | 'insufficient' | 'unknown';

// Sólo tono visual, cerrado sobre el enum real; el rótulo visible siempre viene del helper.
const CONCLUSION_TONE: Record<string, Tone> = {
  supported_with_evidence: 'supported',
  partially_supported: 'partial',
  gap_evidenced: 'gap',
  insufficient_evidence: 'insufficient',
  human_validation_required: 'partial',
};

function supportText(card: TenderIntegralUnitPresentation): string {
  if (card.citedEvidenceCount === 0) return 'Sin referencias citadas.';
  return `${card.citedEvidenceCount} referencia(s) citada(s) · ${card.evidenceSourceLabels.join(' · ')}`;
}

function UnitTrace({ card }: { card: TenderIntegralUnitPresentation }) {
  const technical = card.technical;
  return <details className="agt002-v3-trace">
    <summary>Ver trazabilidad técnica</summary>
    <dl className="agt002-v3-trace-meta">
      <div><dt>unit_id</dt><dd><code>{technical.unitId}</code></dd></div>
      <div><dt>requirement_id</dt><dd><code>{technical.requirementId ?? '—'}</code></dd></div>
      <div><dt>category</dt><dd><code>{technical.category}</code></dd></div>
      <div><dt>conclusion.status</dt><dd><code>{technical.conclusionStatus}</code> · confianza <code>{technical.confidence}</code></dd></div>
      <div><dt>unit_kind · sequence · assessment_mode</dt><dd><code>{technical.unitKind}</code> · <code>{technical.sequence}</code> · <code>{technical.assessmentMode}</code></dd></div>
      <div><dt>commercial_impact</dt><dd><code>{technical.commercialImpactLevel}</code> · <code>{technical.commercialImpactDimension}</code></dd></div>
      <div><dt>blocking</dt><dd><code>{technical.blocking.effect}</code> · <code>{technical.blocking.curability}</code> · {technical.blocking.reason}</dd></div>
      <div><dt>escalation</dt><dd><code>{technical.escalation.level}</code> · {technical.escalation.reason}</dd></div>
      <div><dt>milestone</dt><dd><code>{technical.milestone.status}</code> · <code>{technical.milestone.type}</code> · {technical.milestone.summary} {technical.milestone.at ?? '—'} <code>{technical.milestone.sourceRef ?? '—'}</code></dd></div>
      <div><dt>legal_assessment</dt><dd><code>{technical.legalStatus}</code> · {technical.legalStatusLabel} · {technical.legalSummary} {technical.legalBasisRefs.length > 0 ? <code>{technical.legalBasisRefs.join(' · ')}</code> : null}</dd></div>
      <div><dt>closure</dt><dd><code>{technical.closure.status}</code> · {technical.closure.condition} {technical.closure.evidenceRequired.length > 0 ? <code>{technical.closure.evidenceRequired.join(' · ')}</code> : null}</dd></div>
      <div><dt>human_validation</dt><dd><code>{technical.humanValidation.status}</code> · {technical.humanValidation.reason}</dd></div>
    </dl>
    <div className="agt002-v3-trace-block">
      <span className="agt002-v3-section-label">evidence_state · cinco ejes independientes</span>
      <ul>{technical.evidenceState.map(axis => <li key={axis.axis}>
        <strong>{axis.axisLabel}</strong> <code>{axis.value}</code> · {axis.valueLabel}
      </li>)}</ul>
    </div>
    <div className="agt002-v3-trace-block">
      <span className="agt002-v3-section-label">evidence_refs · localizadores y propósitos</span>
      {technical.evidenceRefs.length > 0
        ? <ul>{technical.evidenceRefs.map(ref => <li key={`${ref.ref}-${ref.purpose}`}>
            <code>{ref.ref}</code> <code>{ref.sourceType}</code> · {ref.sourceTypeLabel} · <code>{ref.purpose}</code> · {ref.purposeLabel}
          </li>)}</ul>
        : <p>Sin referencias citadas en esta unidad.</p>}
    </div>
    <div className="agt002-v3-trace-block">
      <span className="agt002-v3-section-label">missing_evidence</span>
      {technical.missingEvidence.length > 0
        ? <ul>{technical.missingEvidence.map(item => <li key={item.missingId}>
            <code>{item.missingId}</code> <code>{item.neededSourceType}</code> <code>{item.evidenceClassId ?? '—'}</code> · {item.critical ? 'crítica' : 'no crítica'} · {item.reason}
          </li>)}</ul>
        : <p>Sin evidencia pendiente registrada.</p>}
    </div>
  </details>;
}

function UnitReading({ card, conditionAnchor }: { card: TenderIntegralUnitPresentation; conditionAnchor: string | null }) {
  const tone = CONCLUSION_TONE[card.technical.conclusionStatus] ?? 'unknown';
  return <article className="agt002-v3-requirement">
    <header>
      <div><span className="agt002-v3-section-label">Requisito</span><h4>{card.title}</h4></div>
      <b className={`agt002-v3-status tone-${tone}`}>{card.conclusionLabel}</b>
    </header>
    <dl>
      <div><dt>Estado</dt><dd>{card.conclusionLabel}</dd></div>
      <div><dt>Conclusión</dt><dd>{card.conclusionSummary}</dd></div>
      <div><dt>Soporte</dt><dd>{supportText(card)}</dd></div>
      <div><dt>Qué falta</dt><dd>{card.missingEvidenceReasons.length > 0
        ? <ul>{card.missingEvidenceReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        : 'Sin evidencia pendiente registrada.'}</dd></div>
      <div><dt>Impacto comercial</dt><dd>{card.commercialImpactLabel} · {card.commercialImpactSummary}</dd></div>
      <div><dt>Acción</dt><dd>{card.primaryActionSummary ?? 'Sin acción registrada para este requisito.'}</dd></div>
    </dl>
    {conditionAnchor ? <p className="agt002-v3-condition-link"><a href={`#${conditionAnchor}`}>Ver condición principal</a></p> : null}
    <UnitTrace card={card} />
  </article>;
}

function UnresolvedEntryReading({ entry }: { entry: TenderManifestUnresolvedEntry }) {
  return <li>
    <strong>{entry.label}</strong>
    <span>{tenderIntegralCategoryLabel(entry.category)}</span>
    <p>Sin evidencia suficiente para el análisis automático · requiere revisión humana.</p>
    <details className="agt002-v3-trace">
      <summary>Ver trazabilidad técnica</summary>
      <dl className="agt002-v3-trace-meta">
        <div><dt>requirement_id</dt><dd><code>{entry.requirement_id}</code></dd></div>
        <div><dt>category</dt><dd><code>{entry.category ?? '—'}</code></dd></div>
        <div><dt>origin</dt><dd><code>{entry.origin}</code></dd></div>
        <div><dt>status</dt><dd><code>{entry.status}</code></dd></div>
      </dl>
    </details>
  </li>;
}

export function TenderIntegralAnalysisV3View({ analysis }: TenderIntegralAnalysisV3ViewProps) {
  // Consumo opcional (invariante previo): sin payload V3 esta vista no rinde nada en absoluto.
  // No se sustituye por el aviso de inventario: un expediente sin análisis integral no tiene
  // cobertura que pausar.
  const integral = analysis?.integral_analysis;
  const units = integral?.analysis_units;
  if (!integral || !units || units.length === 0) return null;

  const inventory = analysis?.evidence_coverage?.tender_requirement_inventory ?? null;
  // Fail-closed gate (ver tenderRequirementInventoryReady): un payload V3 sin inventario
  // verificable del expediente vigente, o con inventario presente pero `decision_ready` !==
  // true, se muestra sólo como trazabilidad pausada, nunca como cobertura integral. Ninguna
  // derivación de cobertura (resumen, fases, unidades) ocurre antes de este punto. El inventario
  // P0 fija `decision_ready: false` en toda corrida real de hoy, así que el V3 completo
  // permanece pausado hasta que un analizador posterior marque el inventario listo.
  if (!tenderRequirementInventoryReady(inventory)) {
    return <section className="agt002-v3-preview" aria-labelledby="agt002-inventory-title">
      <header className="agt002-v3-overview">
        <div className="agt002-v3-overview-copy">
          <span className="agt002-v3-eyebrow">AGT-002 · Inventario del expediente</span>
          <h2 id="agt002-inventory-title">Cobertura integral no disponible</h2>
          <p>Este análisis no tiene todavía una cobertura integral lista para decisión: falta un inventario verificable de los requisitos del expediente vigente, o el inventario existente aún no está marcado como listo. Se conserva sólo como trazabilidad y no representa cobertura integral.</p>
        </div>
        <div className="agt002-v3-overview-summary">
          <span><small>Estado</small><strong>Análisis pausado</strong></span>
          <span><small>Decisión</small><strong>Revisión humana</strong></span>
        </div>
      </header>
    </section>;
  }

  const summary = tenderIntegralAnalysisSummary(integral);
  const phases = tenderIntegralPhaseGroups(integral);
  const review = analysis?.decision_review ?? null;
  const conditionAnchorByUnitId = new Map(units.map(unit => [unit.unit_id, tenderIntegralUnitConditionAnchor(unit, review)]));
  const coverageRatio = `${integral.coverage.analyzed_requirement_ids.length} / ${integral.coverage.expected_requirement_ids.length}`;
  // Alcance honesto del manifiesto gobernado, cuando la corrida lo trae; nunca se presenta
  // analyzed/expected como cobertura total del manifiesto.
  const scope = analysis?.manifest_scope ?? null;
  // Entradas del manifiesto que el motor nunca alimentó al modelo: hermanas del análisis, jamás
  // mezcladas con las unidades analizadas.
  const unresolvedEntries = analysis?.manifest_unresolved_entries ?? null;

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
      <div className="agt002-v3-summary-blocks">
        <div>
          <span className="agt002-v3-section-label">Resumen por estado de conclusión</span>
          <dl className="agt002-v3-summary">
            <div><dt>Requisitos analizados</dt><dd>{summary.totalUnits}</dd></div>
            {summary.byConclusion.map(bucket => <div key={bucket.label}><dt>{bucket.label}</dt><dd>{bucket.count}</dd></div>)}
          </dl>
        </div>
        <div>
          <span className="agt002-v3-section-label">Indicadores de evidencia (no excluyentes)</span>
          <dl className="agt002-v3-indicators">
            <div><dt>Unidades con referencias citadas</dt><dd>{summary.unitsWithCitedEvidence}</dd></div>
            <div><dt>Referencias citadas en total</dt><dd>{summary.citedReferenceCount}</dd></div>
            <div><dt>Unidades con evidencia pendiente</dt><dd>{summary.unitsWithPendingEvidence}</dd></div>
            <div><dt>Pendientes de evidencia en total</dt><dd>{summary.pendingEvidenceCount}</dd></div>
          </dl>
          <p>Una misma unidad puede citar evidencia y tener pendientes a la vez: los dos indicadores se leen por separado.</p>
        </div>
      </div>
      <div className="agt002-v3-overview-footer">
        <div className="agt002-v3-guard"><strong>Validación humana pendiente</strong><span>No decide GO / NO GO · No firma · No envía · No presenta ofertas</span></div>
        <details className="agt002-v3-run-details">
          <summary>Ver trazabilidad técnica</summary>
          <dl className="agt002-v3-run-meta">
            <div><dt>Ejecución</dt><dd>{analysis?.run_id ?? '—'}</dd></div>
            <div><dt>Snapshot</dt><dd>{analysis?.snapshot_id ?? '—'}</dd></div>
          </dl>
        </details>
      </div>
    </header>

    {unresolvedEntries && unresolvedEntries.length > 0 && <section className="agt002-v3-unresolved" aria-labelledby="agt002-v3-unresolved-title">
      <header>
        <div><span className="agt002-v3-section-label">Manifiesto gobernado</span><h3 id="agt002-v3-unresolved-title">Pendientes sin evidencia suficiente</h3></div>
        <strong>{unresolvedEntries.length} pendiente(s)</strong>
      </header>
      <ul>{unresolvedEntries.map(entry => <UnresolvedEntryReading key={entry.requirement_id} entry={entry} />)}</ul>
    </section>}

    <div className="agt002-v3-workbench">
      {phases.map(group => <details key={group.key} className="agt002-v3-phase" data-phase={group.key} open={group.hasPendingEvidence}>
        <summary>
          <strong>{group.label}</strong>
          <small>{group.units.length} requisito(s){group.pendingEvidenceCount > 0 ? ` · ${group.pendingEvidenceCount} pendiente(s) de evidencia` : ''}</small>
        </summary>
        {group.units.length > 0
          ? <div className="agt002-v3-requirements">
              {group.units.map(card => <UnitReading key={card.key} card={card} conditionAnchor={conditionAnchorByUnitId.get(card.key) ?? null} />)}
            </div>
          : <p className="agt002-v3-empty-phase">Sin requisitos clasificados en esta fase.</p>}
      </details>)}
    </div>

    <footer className="agt002-v3-footer"><strong>Análisis integral · AGT-002 v3</strong><span>Contenido del expediente vigente. Toda conclusión permanece pendiente de validación humana.</span></footer>
  </section>;
}
