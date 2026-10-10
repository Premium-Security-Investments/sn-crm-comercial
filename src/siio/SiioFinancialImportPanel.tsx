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

function statusLabel(value: SiioFinancialImport['status']) {
  return ({ recibido: 'Recibido', con_errores: 'Con errores', validado: 'Validado, pendiente de publicar', publicado: 'Publicado', reemplazado: 'Versión anterior' } as const)[value];
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
  const latest = imports[0] || null;
  const failedChecks = useMemo(() => latest?.validations.filter(item => !item.ok) || [], [latest]);

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
    setMessage('Subiendo y validando el libro contable…');
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
        : result.status === 'validado'
          ? `Carga validada: ${result.summary.balance_lines || 0} líneas contables y ${result.summary.metrics || 0} indicadores. ${warningCount ? `${warningCount} advertencia(s) para revisar.` : 'Sin advertencias.'}`
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

  const publish = async (item: SiioFinancialImport) => {
    if (!window.confirm(`¿Publicar el corte de ${formatDate(item.period_month)} en la Torre de Control? La versión publicada anterior de ese periodo quedará conservada como histórica.`)) return;
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
    <header>
      <div><span className="eyebrow">Finanzas · fuente contable</span><h3 id="siio-financial-import-title">Cargue del Excel contable</h3><p>Cada archivo queda como un corte independiente. El sistema valida el balance y los indicadores antes de permitir su publicación.</p></div>
      {latest ? <span className={`badge siio-financial-status status-${latest.status}`}>{statusLabel(latest.status)}</span> : null}
    </header>
    {canImport ? <div className="siio-financial-import-form">
      <label>Periodo<input type="month" value={month} onChange={event => selectMonth(event.target.value)} disabled={busy}/></label>
      <label>Tipo de corte<select value={importType} onChange={event => selectType(event.target.value as typeof importType)} disabled={busy}><option value="cierre_mensual">Cierre mensual</option><option value="parcial_diario">Avance diario del mes</option><option value="reproceso">Corrección de un cierre</option></select></label>
      <label>Fecha de corte<input type="date" value={cutoffDate} onChange={event => setCutoffDate(event.target.value)} disabled={busy || importType === 'cierre_mensual'}/></label>
      <label className="siio-financial-file">Excel contable<input type="file" accept=".xlsm,application/vnd.ms-excel.sheet.macroenabled.12" onChange={event => setFile(event.target.files?.[0] || null)} disabled={busy}/><small>Libro .xlsm, máximo 10 MB. Las hojas privadas se excluyen.</small></label>
      <button type="button" onClick={() => void upload()} disabled={busy || !file}>{busy ? 'Procesando…' : 'Cargar y validar'}</button>
    </div> : <p className="siio-secondary">Tu perfil puede revisar los cortes financieros, pero no cargar ni publicar archivos.</p>}
    {message ? <div className="notice" role="status">{message}</div> : null}
    {error ? <div className="error" role="alert">{error}</div> : null}
    {latest ? <div className="siio-financial-latest">
      <div><small>Archivo</small><strong>{latest.file_name}</strong></div>
      <div><small>Periodo y corte</small><strong>{formatDate(latest.period_month)} · {formatDate(latest.cutoff_date)}</strong></div>
      <div><small>Contenido cargado</small><strong>{latest.import_summary?.balance_lines || 0} líneas · {latest.import_summary?.metrics || 0} indicadores</strong></div>
      <div><small>Validaciones</small><strong>{latest.validations.filter(item => item.ok).length} aprobadas · {failedChecks.length} por revisar</strong></div>
      {failedChecks.length ? <ul>{failedChecks.map(item => <li key={`${item.rule}-${item.detail}`}><strong>{item.severity === 'advertencia' ? 'Advertencia' : 'Bloqueo'}:</strong> {item.detail} ({item.obtained || 'sin valor'})</li>)}</ul> : null}
      {canImport && latest.status === 'validado' && latest.import_type !== 'parcial_diario' ? <button type="button" onClick={() => void publish(latest)} disabled={busy}>Publicar en la Torre de Control</button> : null}
    </div> : <p className="siio-secondary">Aún no hay cargas versionadas. Los indicadores históricos existentes siguen visibles.</p>}
  </section>;
}
