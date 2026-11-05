// Estudios de Seguridad Física, tramo 2: fotos y documentos de la visita, por riesgo o del estudio en general.
// El inspector adjunta desde el celular (la cámara aparece como opción) o el computador. El archivo va directo al
// depósito privado con un permiso firmado; el servidor lo verifica antes de registrarlo.
import { useRef, useState } from 'react';
import { supabaseBrowser } from '../supabaseBrowser';
import { completeEvidenceUpload, deleteEvidence, requestEvidenceUpload, type Evidence } from './api';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const MAX_BYTES = 15 * 1024 * 1024;
const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo subir el archivo.');
// Los navegadores de escritorio no muestran HEIC (formato del iPhone): se ofrece como archivo.
const showsInline = (item: Evidence) => item.kind === 'foto' && item.mime_type !== 'image/heic';

export function EvidenceStrip({ studyId, items, urls, riskId = null, editable, label, onChanged }: {
  studyId: string; items: Evidence[]; urls: Record<string, string | null>; riskId?: string | null; editable: boolean; label: string; onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) throw new Error(`"${file.name}" pesa más de 15 MB.`);
        setStatus(`Subiendo ${done + 1} de ${files.length}…`);
        const mime = file.type || (/\.hei[cf]$/i.test(file.name) ? 'image/heic' : '');
        const ticket = await requestEvidenceUpload(studyId, { file_name: file.name, mime_type: mime, size_bytes: file.size, risk_id: riskId });
        const sent = await supabaseBrowser.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: mime });
        if (sent.error) throw sent.error;
        await completeEvidenceUpload(studyId, { path: ticket.path, file_name: file.name, risk_id: riskId, taken_on: new Date(file.lastModified).toISOString().slice(0, 10) });
        done += 1;
      }
      setStatus(done === 1 ? 'Archivo agregado.' : `${done} archivos agregados.`);
    } catch (reason) {
      setError(message(reason));
      setStatus(done ? `${done} archivo(s) se alcanzaron a agregar.` : '');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
      if (done) onChanged();
    }
  };

  const remove = async (item: Evidence) => {
    if (!window.confirm(`¿Quitar "${item.file_name}" del estudio?`)) return;
    try { await deleteEvidence(studyId, item.id); onChanged(); } catch (reason) { setError(message(reason)); }
  };

  return <div className="es-evidence">
    <span className="es-label">{label}</span>
    {items.length ? <ul className="es-evidence-list">{items.map(item => {
      const url = urls[item.id];
      return <li key={item.id} className="es-evidence-item">
        {showsInline(item) && url
          ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={item.caption || item.file_name} loading="lazy" /></a>
          : <a className="es-evidence-file" href={url || undefined} target="_blank" rel="noopener noreferrer">{item.kind === 'documento' ? 'PDF' : 'Foto'}<small>{item.file_name}</small></a>}
        <small className="es-muted">{item.caption || item.file_name}</small>
        {editable ? <button type="button" className="es-link" onClick={() => remove(item)} aria-label={`Quitar ${item.file_name}`}>Quitar</button> : null}
      </li>;
    })}</ul> : <small className="es-muted"> Sin fotos ni documentos.</small>}
    {editable ? <div className="es-actions">
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={event => upload(event.target.files)} aria-label={`Adjuntar a ${label}`} />
      <button type="button" className="secondary" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Subiendo…' : 'Adjuntar foto o PDF'}</button>
      {status ? <small className="es-muted" role="status">{status}</small> : null}
    </div> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </div>;
}
