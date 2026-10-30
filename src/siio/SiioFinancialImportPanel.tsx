import { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import { supabaseBrowser } from '../supabaseBrowser';
import type { SiioFinancialImport } from './types';

const MAX_BYTES = 10 * 1024 * 1024;
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroenabled.12';

function monthEnd(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return '';
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
}

function formatMonth(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatMoment(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(value));
}

function statusLabel(value: SiioFinancialImport['status']) {
  return ({ recibido: 'Recibido', con_errores: 'Con errores', listo_revision: 'Listo para tu revisión', validado: 'Validado por una persona', publicado: 'Publicado', reemplazado: 'Versión anterior' } as const)[value];
}

type UploadTicket = { path: string; token: string };
type ProcessResult = { id: string; status: string; duplicate: boolean; summary: Record<string, number>; validations: SiioFinancialImport['validations'] };

export function SiioFinancialImportPanel({ canImport, onPublished }: { canImport: boolean; onPublished: () => Promise<void> }) {
  const initialMonth = new Date().toISOString().slice(0, 7);
  const [imports, setImports] = useState<SiioFinancialImport[]>([]);
  const [month, setMonth] = useState(initialMonth);
  const [cutoffDate, setCutoffDate] = useState(monthEnd(initialMonth));
  const [importType, setImportType] = useState<'cierre_mensual' | 'parcial_diario' | 'reproceso'>('cierre_mensual');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const visibleImports = useMemo(() => imports.slice(0, 6), [imports]);
  const published = useMemo(() => imports.find(item => item.status === 'publicado') || null, [imports]);
  const pendingCount = useMemo(() => imports.filter(item => item.status === 'listo_revision' || (item.status === 'validado' && item.import_type !== 'parcial_diario')).length, [imports]);
  const publishedWarnings = published?.validations.filter(check => !check.ok).length || 0;
  // Collapsed by default: the panel only matters while loading or when a cut is waiting for a person.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (pendingCount) setExpanded(true); }, [pendingCount]);

  const loadImports = async () => {
    try {
      setImports(await api<SiioFinancialImport[]>('/api/siio/financial-imports'));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => { void loadImports(); }, []);

  const selectType = (value: typeof importType) => {
    setImportType(value);
    if (value === 'cierre_mensual') setCutoffDate(monthEnd(month));
  };

  const selectMonth = (value: string) => {
    setMonth(value);
    if (importType === 'cierre_mensual') setCutoffDate(monthEnd(value));
  };

  const upload = async () => {
    if (!file) return setError('Seleccione el Excel contable que va a cargar.');
    if (!/\.xlsm$/i.test(file.name)) return setError('El archivo debe ser un libro .xlsm.');
    if (file.size > MAX_BYTES) return setError('El archivo supera el límite de 10 MB.');
    setBusy(true);
    setError('');
    setMessage('Subiendo el libro y haciendo las comprobaciones automáticas…');
    const metadata = {
      name: file.name,
      size: file.size,
      mime_type: file.type || XLSM_MIME,
      period_month: `${month}-01`,
      cutoff_date: cutoffDate,
      import_type: importType,
    };
    try {
      const ticket = await api<UploadTicket>('/api/siio/financial-imports/upload-url', { method: 'POST', body: JSON.stringify(metadata) });
      const uploaded = await supabaseBrowser.storage.from('siio-financial-imports').uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: XLSM_MIME });
      if (uploaded.error) throw uploaded.error;
      const result = await api<ProcessResult>('/api/siio/financial-imports/process-upload', { method: 'POST', body: JSON.stringify({ ...metadata, storage_path: ticket.path }) });
      const warningCount = result.validations.filter(item => item.severity === 'advertencia' && !item.ok).length;
      setMessage(result.duplicate
        ? 'Este mismo archivo ya estaba cargado; se conservó la versión existente.'
        : result.status === 'listo_revision'
          ? `Controles automáticos aprobados: ${result.summary.balance_lines || 0} líneas contables y ${result.summary.metrics || 0} indicadores. ${warningCount ? `${warningCount} advertencia(s) para revisar.` : 'Sin advertencias.'} Falta la validación de una persona.`
          : 'La carga se guardó con errores bloqueantes y no puede publicarse.');
      setFile(null);
      await loadImports();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const validate = async (item: SiioFinancialImport) => {
    if (!window.confirm(`¿Confirmas que revisaste el corte de ${formatMonth(item.period_month)} y que sus cifras pueden avanzar? Tu usuario y la fecha quedarán registrados.`)) return;
    setBusy(true);
    setError('');
    setMessage('Registrando tu validación…');
    try {
      await api(`/api/siio/financial-imports/${item.id}/validate`, { method: 'POST', body: '{}' });
      await loadImports();
      setMessage(item.import_type === 'parcial_diario' ? 'Validación registrada. El avance diario ya puede alimentar la Torre.' : 'Validación registrada. El cierre quedó listo para publicación.');
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : String(validationError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const publish = async (item: SiioFinancialImport) => {
    if (!window.confirm(`¿Publicar el corte de ${formatMonth(item.period_month)} en la Torre de Control? La versión publicada anterior de ese periodo quedará conservada como histórica.`)) return;
    setBusy(true);
    setError('');
    setMessage('Publicando el corte validado…');
    try {
      await api(`/api/siio/financial-imports/${item.id}/publish`, { method: 'POST', body: '{}' });
      await Promise.all([loadImports(), onPublished()]);
      setMessage('Corte publicado. La Torre de Control ya consulta esta versión.');
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : String(publishError));
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  return <section className="card siio-financial-import-panel" aria-labelledby="siio-financial-import-title">
    <button type="button" className="siio-financial-summary" aria-expanded={expanded} aria-controls="siio-financial-import-body" onClick={() => setExpanded(value => !value)}>
      <span className="siio-financial-summary-text">
        <span className="eyebrow">Fuente contable</span>
        <strong id="siio-financial-import-title">{published ? `Último corte publicado: ${formatMonth(published.period_month)}` : 'Sin cortes publicados'}</strong>
        <small>
          {published ? `${published.file_name} · corte ${formatDate(published.cutoff_date)}` : 'Cargue manual del Excel contable'}
          {publishedWarnings ? ` · ${publishedWarnings} ${publishedWarnings === 1 ? 'advertencia' : 'advertencias'}` : ''}
          {pendingCount ? ` · ${pendingCount} ${pendingCount === 1 ? 'corte espera' : 'cortes esperan'} validación o publicación` : ''}
        </small>
      </span>
      <span className="siio-financial-summary-action">{expanded ? 'Ocultar' : 'Ver cargues'}</span>
    </button>
    {expanded ? <div id="siio-financial-import-body" className="siio-financial-body">
    <p>Cada archivo queda como un corte independiente. El sistema hace comprobaciones automáticas; después una persona autorizada valida el corte y lo publica en la Torre.</p>
    {canImport ? <div className="siio-financial-section">
      <h4>Nuevo cargue</h4>
      <div className="siio-financial-import-form">
        <label>Periodo del archivo<input type="month" value={month} onChange={event => selectMonth(event.target.value)} disabled={busy}/></label>
        <label>Tipo de corte<select value={importType} onChange={event => selectType(event.target.value as typeof importType)} disabled={busy}><option value="cierre_mensual">Cierre mensual</option><option value="parcial_diario">Avance diario del mes</option><option value="reproceso">Corrección de un cierre</option></select></label>
        <label>Fecha de corte<input type="date" value={cutoffDate} onChange={event => setCutoffDate(event.target.value)} disabled={busy || importType === 'cierre_mensual'}/></label>
        <label className="siio-financial-file">Excel contable<input type="file" accept=".xlsm,application/vnd.ms-excel.sheet.macroenabled.12" onChange={event => setFile(event.target.files?.[0] || null)} disabled={busy}/><small>Libro .xlsm, máximo 10 MB. Las hojas privadas se excluyen.</small></label>
        <button type="button" onClick={() => void upload()} disabled={busy || !file}>{busy ? 'Procesando…' : 'Cargar y comprobar'}</button>
      </div>
    </div> : <p className="siio-secondary">Tu perfil puede revisar los cortes financieros, pero no cargar ni publicar archivos.</p>}
    {message ? <div className="notice" role="status">{message}</div> : null}
    {error ? <div className="error" role="alert">{error}</div> : null}
    <div className="siio-financial-section">
      <h4>Cortes cargados</h4>
      {visibleImports.length ? visibleImports.map(item => {
        const failedChecks = item.validations.filter(check => !check.ok);
        return <article className="siio-financial-latest" key={item.id}>
          <div><small>Archivo</small><strong>{item.file_name}</strong><span className={`badge siio-financial-status status-${item.status}`}>{statusLabel(item.status)}</span></div>
          <div><small>Periodo y corte</small><strong>{formatMonth(item.period_month)} · corte {formatDate(item.cutoff_date)}</strong></div>
          <div><small>Contenido cargado</small><strong>{item.import_summary?.balance_lines || 0} líneas · {item.import_summary?.metrics || 0} indicadores</strong></div>
          <div><small>Comprobaciones automáticas</small><strong>{item.validations.filter(check => check.ok).length} aprobadas · {failedChecks.length} por revisar</strong></div>
          {failedChecks.length ? <ul>{failedChecks.map(check => <li key={`${check.rule}-${check.detail}`}><strong>{check.severity === 'bloqueante' ? 'Bloqueo' : check.severity === 'advertencia' ? 'Advertencia' : 'Nota'}:</strong> {check.detail} ({check.obtained || 'sin valor'})</li>)}</ul> : null}
          <p className="siio-financial-trail">{[
            `Cargado por ${item.uploaded_by_name || 'persona registrada'} el ${formatMoment(item.uploaded_at)}`,
            item.validated_at ? `Validado por ${item.validated_by_name || 'persona registrada'} el ${formatMoment(item.validated_at)}` : null,
            item.published_at ? `Publicado por ${item.published_by_name || 'persona registrada'} el ${formatMoment(item.published_at)}` : null,
          ].filter(Boolean).join(' · ')}{item.validated_by_uploader ? <strong> · La misma persona cargó y validó este corte.</strong> : null}</p>
          {canImport && item.status === 'listo_revision' ? <button type="button" onClick={() => void validate(item)} disabled={busy}>Validar este corte</button> : null}
          {canImport && item.status === 'validado' && item.import_type !== 'parcial_diario' ? <button type="button" onClick={() => void publish(item)} disabled={busy}>Publicar en la Torre de Control</button> : null}
        </article>;
      }) : <p className="siio-secondary">Aún no hay cargas versionadas. Los indicadores históricos existentes siguen visibles.</p>}
    </div>
    </div> : null}
  </section>;
}
