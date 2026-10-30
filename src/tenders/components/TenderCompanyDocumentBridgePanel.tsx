import { useEffect, useState } from 'react';
import './tender-dossier.css';
import { formatDateOnly } from '../../dateOnly';
import { loadTenderCompanyDocumentBridge } from '../api';
import { TENDER_COMPANY_DOCUMENT_STATE_LABELS, sortTenderCompanyDocumentRows, tenderCompanyDocumentStateTone } from '../companyDocumentBridgeView';
import type { TenderCompanyDocumentBridge, TenderRequest } from '../types';

/**
 * Lo que la empresa ya tiene, contrastado con el cierre de ESTA licitación (encargo de Juan, 2026-10-30: "el después
 * del GO... presentar los documentos de manera ágil").
 *
 * La mayoría de lo que se radica no se redacta: son documentos corporativos que ya existen. Hasta hoy había que
 * buscarlos a mano en cada proceso y decidir a ojo si llegaban vigentes al cierre. Este panel lo dice de una vez, y
 * **sirve antes del GO**: saber qué falta es justo lo que ayuda a decidir.
 *
 * Dos cosas que el panel no hace, a propósito: no inventa vigencias —sin fecha declarada dice "por confirmar" y
 * muestra lo que el registro de evidencia dejó escrito— y no pesa igual un trámite que un hecho inscrito. Un papel
 * vencido se reexpide en minutos; un hecho que ningún trámite cambia es el que tumba la oferta.
 */
export function TenderCompanyDocumentBridgePanel({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [bridge, setBridge] = useState<TenderCompanyDocumentBridge | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setBridge(null);
    void (async () => {
      try {
        const payload = await loadTenderCompanyDocumentBridge(request, opportunityId);
        if (active) setBridge(payload);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [opportunityId, request]);

  if (loading) return <section className="card stack" aria-busy="true"><p className="muted">Cruzando los documentos de la empresa con el cierre…</p></section>;
  if (error) return <section className="card stack"><div className="error" role="alert">{error}</div></section>;
  if (!bridge) return null;

  const { summary } = bridge;
  const pendientes = summary.total - summary.listo_al_cierre;
  return <section className="card stack tender-company-bridge" aria-labelledby="tender-company-bridge-heading">
    <div>
      <h3 id="tender-company-bridge-heading">Documentos de la empresa para esta licitación</h3>
      <p className="muted">
        {bridge.close_date
          ? <>Cierre {formatDateOnly(bridge.close_date)}{bridge.close_date_source === 'oportunidad' ? ' (fecha de la oportunidad, no de la licitación)' : ''}. {pendientes} de {summary.total} requisitos corporativos piden algo antes de radicar.</>
          : <>Esta licitación no tiene fecha de cierre declarada, así que la vigencia no se puede contrastar.</>}
      </p>
    </div>
    <div className="tender-card-tags">
      <span className="badge tender-fit-alto">{summary.listo_al_cierre} listos al cierre</span>
      {summary.hechos_inscritos_en_riesgo > 0 && <span className="badge tender-fit-bajo">{summary.hechos_inscritos_en_riesgo} hechos inscritos en riesgo</span>}
      {summary.tramites_por_hacer > 0 && <span className="badge tender-fit-por_validar">{summary.tramites_por_hacer} trámites por hacer</span>}
      {summary.vigencia_por_confirmar > 0 && <span className="badge badge-muted">{summary.vigencia_por_confirmar} por confirmar</span>}
    </div>
    <ul className="stack tender-company-bridge-rows">
      {sortTenderCompanyDocumentRows(bridge.rows).map(row => <li key={row.key} className="tender-company-bridge-row">
        <div className="tender-card-tags">
          <span className={`badge ${tenderCompanyDocumentStateTone(row.state)}`}>{TENDER_COMPANY_DOCUMENT_STATE_LABELS[row.state]}</span>
          <span className="badge badge-muted">{row.kind_label}</span>
          <span className="badge badge-muted">{row.folder}</span>
        </div>
        <strong>{row.label}</strong>
        <p className="muted">
          {row.document
            ? <>{row.document.display_name}{row.document.issued_at ? ` · expedido ${formatDateOnly(row.document.issued_at)}` : ''}{row.expires_at ? ` · vence ${formatDateOnly(row.expires_at)}${row.expiry_source === 'registro_de_evidencia' ? ' (según la ficha de empresa)' : ''}` : ''}</>
            : <>Sin soporte cargado en la ficha de empresa · Responsable: {row.owner}</>}
        </p>
        {row.supporting_documents.length > 1 && <p className="muted">{row.supporting_documents.length} soportes vigentes para este requisito.</p>}
        {row.age_note && <p className="muted">{row.age_note} Si el pliego exige una expedición más reciente, hay que volver a pedirlo.</p>}
        {!row.expires_at && row.vigencia_text && <p className="muted">Ficha de empresa: {row.vigencia_text}</p>}
        {row.action && <p><strong>Qué hacer:</strong> {row.action}</p>}
      </li>)}
    </ul>
    {bridge.unmatched_documents.length > 0 && <details>
      <summary>{bridge.unmatched_documents.length} documentos corporativos sin requisito asociado</summary>
      <ul>{bridge.unmatched_documents.map(document => <li key={document.id}>{document.display_name} <span className="muted">({document.document_type})</span></li>)}</ul>
    </details>}
  </section>;
}
