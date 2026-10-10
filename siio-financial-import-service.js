import { createHash, randomUUID } from 'node:crypto';
import {
  compareFinancialStructures,
  parseSiioFinancialWorkbook,
  SIIO_FINANCIAL_IMPORT_BUCKET,
  SIIO_FINANCIAL_IMPORT_MAX_BYTES,
} from './siio-financial-workbook.js';

const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroenabled.12';

function inputError(message, code = 'INVALID_FINANCIAL_IMPORT') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function cleanFinancialImportRequest(body = {}) {
  const fileName = String(body.name || body.file_name || '').trim().replace(/[^a-zA-Z0-9À-ÿ._ -]/g, '_').slice(0, 140);
  const size = Number(body.size ?? body.file_size_bytes);
  const periodMonth = String(body.period_month || '');
  const cutoffDate = String(body.cutoff_date || '');
  const importType = String(body.import_type || 'cierre_mensual');
  const mimeType = String(body.mime_type || XLSM_MIME).toLowerCase();
  if (!fileName || !/\.xlsm$/i.test(fileName)) throw inputError('Seleccione un libro contable .xlsm.');
  if (!Number.isInteger(size) || size <= 0) throw inputError('El archivo contable está vacío o no informa un tamaño válido.');
  if (size > SIIO_FINANCIAL_IMPORT_MAX_BYTES) throw inputError('El archivo contable supera el límite de 10 MB.');
  if (mimeType && mimeType !== XLSM_MIME && mimeType !== 'application/octet-stream') throw inputError('El tipo del archivo no corresponde a un libro .xlsm.');
  if (!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(periodMonth)) throw inputError('El periodo debe ser el primer día del mes.');
  const [periodYear, periodNumber] = periodMonth.split('-').map(Number);
  const nextMonth = Number.isInteger(periodYear) && Number.isInteger(periodNumber)
    ? new Date(Date.UTC(periodYear, periodNumber, 1)).toISOString().slice(0, 10)
    : '';
  if (!calendarDate(cutoffDate) || cutoffDate < periodMonth || cutoffDate >= nextMonth) throw inputError('La fecha de corte no es válida para el periodo indicado.');
  if (!['cierre_mensual', 'parcial_diario', 'reproceso'].includes(importType)) throw inputError('El tipo de corte no es válido.');
  if (importType === 'cierre_mensual') {
    const [year, month] = periodMonth.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (cutoffDate !== monthEnd) throw inputError('Un cierre mensual debe usar el último día del mes como fecha de corte.');
  }
  return { fileName, size, periodMonth, cutoffDate, importType, mimeType: XLSM_MIME };
}

export function financialImportStoragePath(profile, metadata) {
  if (!profile?.id) throw inputError('No se pudo identificar a la persona que carga el archivo.');
  const nonce = randomUUID();
  const key = createHash('sha256').update(`${profile.id}:${nonce}:${metadata.fileName}:${metadata.size}`).digest('hex').slice(0, 32);
  return `financial-imports/${profile.id}/${metadata.periodMonth}/${key}-${metadata.fileName}`;
}

export function assertFinancialImportStoragePath(profile, storagePath) {
  const value = String(storagePath || '');
  if (!profile?.id || !value.startsWith(`financial-imports/${profile.id}/`) || value.includes('..') || value.includes('\\')) throw inputError('La ruta del archivo contable no es válida.');
  return value;
}

function requireResult(result) {
  if (result?.error) throw result.error;
  return result?.data;
}

export async function processFinancialWorkbookImport(database, profile, storagePath, metadata) {
  const safePath = assertFinancialImportStoragePath(profile, storagePath);
  const downloaded = await database.storage.from(SIIO_FINANCIAL_IMPORT_BUCKET).download(safePath);
  const file = requireResult(downloaded);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length !== metadata.size) throw inputError('El tamaño cargado no coincide con el archivo seleccionado.', 'FINANCIAL_IMPORT_SIZE_MISMATCH');
  const parsed = parseSiioFinancialWorkbook(buffer, metadata);
  const previous = requireResult(await database.from('siio_financial_imports')
    .select('structure_summary,structure_signature')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle());
  const structureDiff = compareFinancialStructures(previous?.structure_summary || null, parsed.structure);
  if (structureDiff.changed) {
    parsed.validations.push({
      rule: 'ESTRUCTURA_CAMBIO_ENTRE_VERSIONES',
      severity: 'advertencia',
      ok: false,
      expected: 'misma estructura que el cargue anterior',
      obtained: `${structureDiff.changes.length} cambio(s)`,
      difference: null,
      detail: 'La estructura cambió frente al cargue anterior y requiere revisión de Contabilidad.',
    });
    parsed.summary.warnings += 1;
  }
  const payload = { ...parsed, storage_path: safePath, structure_diff: structureDiff };
  const recorded = requireResult(await database.rpc('siio_import_financial_workbook', { p_payload: payload, p_actor: profile.id }));
  return { ...recorded, summary: parsed.summary, validations: parsed.validations, structure_diff: structureDiff };
}

export async function listFinancialImports(database, limit = 12) {
  const imports = requireResult(await database.from('siio_financial_imports')
    .select('id,file_name,file_sha256,file_size_bytes,version_label,period_month,cutoff_date,import_type,status,parser_version,structure_signature,structure_diff,import_summary,uploaded_at,validated_at,published_at,source_id')
    .order('uploaded_at', { ascending: false })
    .limit(limit)) || [];
  if (!imports.length) return [];
  const validations = requireResult(await database.from('siio_financial_validations')
    .select('import_id,rule,severity,ok,expected,obtained,difference,detail')
    .in('import_id', imports.map(item => item.id))
    .order('id', { ascending: true })) || [];
  const byImport = new Map();
  for (const item of validations) {
    if (!byImport.has(item.import_id)) byImport.set(item.import_id, []);
    byImport.get(item.import_id).push(item);
  }
  return imports.map(item => ({ ...item, validations: byImport.get(item.id) || [] }));
}

export async function publishFinancialImport(database, profile, importId) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(importId || ''))) throw inputError('La carga financiera indicada no es válida.');
  return requireResult(await database.rpc('siio_publish_financial_import', { p_import_id: importId, p_actor: profile.id }));
}

export { SIIO_FINANCIAL_IMPORT_BUCKET, SIIO_FINANCIAL_IMPORT_MAX_BYTES, XLSM_MIME };
