// Estudios de Seguridad Física, tramo 3: revisión y aprobación. Cada botón aparece sólo si el servidor dice que esta
// persona puede dar ese paso ahora; quien preparó el estudio nunca ve "Revisado" ni "Aprobar".
import { useState } from 'react';
import { ACTION_LABELS, fetchReportDownload, transitionStudy, type StudyStatus, type Workflow, type WorkflowAction } from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar el paso.');
const when = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value));

const BUTTONS: Array<{ action: WorkflowAction; label: string; tone?: 'secondary' | 'danger'; confirm?: string }> = [
  { action: 'enviar', label: 'Enviar a revisión', confirm: 'Mientras esté en revisión el estudio no se puede editar. ¿Enviar?' },
  { action: 'marcar_revisado', label: 'Marcar como revisado' },
  { action: 'aprobar', label: 'Aprobar esta versión', confirm: 'Al aprobar, el estudio queda congelado como una versión que no se puede cambiar, y cada acción con responsable y fecha pasa a Seguimiento gerencial. ¿Aprobar?' },
  { action: 'reabrir', label: 'Reabrir para corregir', tone: 'secondary', confirm: 'El estudio vuelve a borrador; la versión aprobada se conserva y la próxima aprobación será una versión nueva. ¿Reabrir?' },
];

// Dónde quedó cada versión aprobada. El informe se descarga desde el SIIO (Juan, 2026-11-20): el enlace de SharePoint
// exige permisos del sitio de Innovación que los analistas no tienen, y queda como archivo oficial.
function DownloadReport({ studyId, version }: { studyId: string; version: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try {
      const { url } = await fetchReportDownload(studyId, version);
      window.location.assign(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo descargar el informe.'); } finally { setBusy(false); }
  };
  return <>
    <button type="button" onClick={() => void download()} disabled={busy}>{busy ? 'Preparando…' : 'Descargar el informe (PDF)'}</button>
    {error ? <small className="es-error">{error}</small> : null}
  </>;
}

function ArchiveLine({ studyId, version, archive }: { studyId: string; version: number; archive: Workflow['versions'][number]['archive'] }) {
  if (!archive) return null;
  if (archive.status === 'archivado') {
    const word = archive.files.find(file => file.tipo === 'informe_word');
    return <div className="es-archive">
      <DownloadReport studyId={studyId} version={version} />
      {archive.report_url ? <a href={archive.report_url} target="_blank" rel="noopener noreferrer">Ver en SharePoint</a> : <span>Archivado en SharePoint</span>}
      {word?.url ? <a href={word.url} target="_blank" rel="noopener noreferrer">Word</a> : null}
      <small className="es-muted">{archive.files.length} archivos</small>
    </div>;
  }
  // Si SharePoint falló, el PDF puede estar igual en el SIIO: se ofrece la descarga.
  if (archive.status === 'fallido') return <div className="es-archive es-error"><DownloadReport studyId={studyId} version={version} /> No se pudo archivar en SharePoint: {archive.error || 'error técnico'}. IT ya tiene el registro.</div>;
  return <div className="es-archive es-muted">{archive.status === 'procesando' ? 'Subiendo el informe y las evidencias a SharePoint…' : 'El informe se está preparando para subir a SharePoint.'}{archive.error ? ` Último intento: ${archive.error}.` : ''}</div>;
}

export function WorkflowPanel({ studyId, status, preparedBy, workflow, onChanged }: { studyId: string; status: StudyStatus; preparedBy: string; workflow: Workflow; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: WorkflowAction, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    try {
      await transitionStudy(studyId, action, action === 'devolver' ? note : undefined);
      setNote('');
      onChanged();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };
  const can = workflow.can;
  const name = (id: string) => workflow.names[id] || 'Alguien';
  return <section className="es-card es-workflow" aria-label="Revisión y aprobación">
    <h3>Revisión y aprobación</h3>
    <p className="es-muted">Preparó: {name(preparedBy)}. {status === 'en_revision' ? 'Está en manos del revisor técnico.' : status === 'revisado' ? 'Revisado; falta la aprobación.' : status === 'devuelto' ? 'Devuelto: corrija lo observado y envíelo de nuevo.' : status === 'aprobado' ? 'Aprobado: no se puede editar.' : 'En borrador.'}</p>
    <div className="es-actions">
      {BUTTONS.filter(button => can[button.action]).map(button => <button key={button.action} type="button" className={button.tone} disabled={busy} onClick={() => run(button.action, button.confirm)}>{button.label}</button>)}
    </div>
    {can.devolver ? <div className="es-return">
      <label>Observación para devolver
        <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} maxLength={4000} placeholder="Qué debe corregir el preparador" />
      </label>
      <button type="button" className="danger" disabled={busy || note.trim().length < 3} onClick={() => run('devolver')}>Devolver con observaciones</button>
    </div> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    {workflow.followups ? <p className="es-muted">{workflow.followups.total
      ? `Seguimiento gerencial: ${workflow.followups.total} ${workflow.followups.total === 1 ? 'compromiso' : 'compromisos'} de este estudio, ${workflow.followups.abiertos} abiertos y ${workflow.followups.cumplidos} cumplidos. Cerrarlos allá no cierra los riesgos.`
      : 'Ninguna acción del plan tenía responsable y fecha al aprobar, así que no pasó nada a Seguimiento gerencial.'}</p> : null}
    {workflow.versions.length ? <div>
      <span className="es-label">Versiones aprobadas</span>
      <ul className="es-history">{workflow.versions.map(version => <li key={version.id}>
        <strong>Versión {version.version}</strong> · {when(version.approved_at)} · aprobó {name(version.approved_by)}
        <small className="es-muted"> · huella {version.snapshot_sha256.slice(0, 12)}…</small>
        <ArchiveLine studyId={studyId} version={version.version} archive={version.archive} />
      </li>)}</ul>
    </div> : null}
    {workflow.events.length ? <div>
      <span className="es-label">Historial</span>
      <ul className="es-history">{workflow.events.slice().reverse().map(event => <li key={event.id}>
        {ACTION_LABELS[event.action]}{event.version ? ` (versión ${event.version})` : ''} · {name(event.actor_id)} · <small className="es-muted">{when(event.created_at)}</small>
        {event.note ? <blockquote>{event.note}</blockquote> : null}
      </li>)}</ul>
    </div> : null}
  </section>;
}
