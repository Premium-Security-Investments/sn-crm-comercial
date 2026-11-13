// Formatos viejos de Office (Juan, 2026-11-13: «arreglemos eso de los ZIP como usted crea que es mejor para que no pase
// en el futuro»). Defensoría del Pueblo entró al análisis con 12 de 13 documentos: «7. FORMATOS Y FORMULARIOS.zip» traía
// cuatro .doc y .xls (Word y Excel anteriores a 2007) que el extractor de la carga (Vercel) no lee, y un paquete con una
// entrada sin leer queda entero como «gap» para no hacerlo pasar por completo.
//
// Igual que el OCR de los escaneados, la segunda lectura corre en el servidor de tareas, que sí tiene LibreOffice, dentro
// del trabajo que arranca los análisis (agt002-auto-initial), ANTES de admitirlos. Convierte .doc/.rtf/.odt a .docx y
// .xls/.ods a .xlsx —sueltos o dentro del zip— y vuelve a pasar el resultado por el mismo extractor de siempre, con sus
// mismas reglas: si algo sigue sin leerse, el paquete sigue siendo «gap». Se guarda como una extracción nueva de la misma
// versión con una generación mayor que la del extractor de la carga, así que la lectura canónica la prefiere.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { selectCanonicalExtractionsByDocumentVersion } from './tender-document-extraction-persistence.js';
import { TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION, archiveEntryDisplayName, extractTenderDocumentText, isArchiveSystemEntry } from './tender-document-text-extraction.js';

const run = promisify(execFile);
const generation = Number(/@(\d+)$/.exec(TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION)?.[1] || 0);
export const TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION = `tender-document-legacy-office@${generation + 1}`;

const TARGET = Object.freeze({ doc: 'docx', rtf: 'docx', odt: 'docx', xls: 'xlsx', ods: 'xlsx' });
const extensionOf = name => /\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1]?.toLowerCase() || '';
export const isLegacyOffice = name => Object.hasOwn(TARGET, extensionOf(name));
const isZip = version => /\.zip$/i.test(String(version.name || '')) || /zip/i.test(String(version.mime_type || ''));

/**
 * ¿Lo arregla una conversión? Un documento suelto en formato viejo, o un zip cuyo único defecto son entradas en formato
 * viejo (o archivos de bloqueo de Office). Pura.
 */
export function legacyOfficeRepairable(version, extraction) {
  if (!extraction || extraction.status !== 'gap') return false;
  const reason = extraction.metadata?.gap_reason;
  if (reason === 'unsupported_type') return isLegacyOffice(version.name);
  if (reason !== 'archive_incomplete_extraction' || !isZip(version)) return false;
  const gaps = Array.isArray(extraction.metadata?.internal_gaps) ? extraction.metadata.internal_gaps : [];
  return gaps.length > 0 && gaps.some(gap => isLegacyOffice(gap.entry_name))
    && gaps.every(gap => (gap.gap_reason === 'unsupported_type' && isLegacyOffice(gap.entry_name)) || isArchiveSystemEntry(gap.entry_name));
}

/** Versiones vigentes cuya lectura canónica es un «gap» que la conversión arregla y que esta lectura no ha intentado. Pura. */
export function selectLegacyOfficeCandidates(versions, extractionRows, { limit = 2 } = {}) {
  const canonical = selectCanonicalExtractionsByDocumentVersion(extractionRows);
  const tried = new Set(extractionRows.filter(row => row.extractor_version === TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION).map(row => row.document_version_id));
  return versions
    .filter(version => version.current && version.storage_path && !tried.has(version.id))
    .filter(version => legacyOfficeRepairable(version, canonical.get(version.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

/** Un archivo en formato viejo → el mismo en formato actual, con LibreOffice sin interfaz y un perfil temporal propio. */
export async function convertLegacyOffice(buffer, name, { runner = run, timeoutMs = 120_000 } = {}) {
  const extension = extensionOf(name);
  const target = TARGET[extension];
  if (!target) throw Object.assign(new Error('formato no convertible'), { code: 'LEGACY_OFFICE_UNSUPPORTED' });
  const dir = await mkdtemp(join(tmpdir(), 'office-'));
  try {
    const input = join(dir, `in.${extension}`);
    await writeFile(input, buffer);
    await runner('soffice', [`-env:UserInstallation=file://${join(dir, 'perfil')}`, '--headless', '--convert-to', target, '--outdir', dir, input], { timeout: timeoutMs });
    return await readFile(join(dir, `in.${target}`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * El zip con sus entradas viejas convertidas («Carta.doc» pasa a «Carta.docx»); lo demás, igual. Sólo se llama sobre un
 * paquete que el extractor ya revisó (rutas, número de entradas y expansión) y dejó como «gap» por formato.
 */
export async function upgradeLegacyOfficeArchive(buffer, { convert = convertLegacyOffice } = {}) {
  const source = new AdmZip(buffer);
  const out = new AdmZip();
  const converted = [];
  for (const entry of source.getEntries()) {
    if (entry.isDirectory) continue;
    // Con el nombre ya decodificado (CP437 o UTF-8 sin marca): el zip nuevo se escribe en UTF-8 y se lee bien.
    const original = archiveEntryDisplayName(entry);
    if (!isArchiveSystemEntry(original) && isLegacyOffice(original)) {
      out.addFile(original.replace(/\.[a-z0-9]+$/i, `.${TARGET[extensionOf(original)]}`), await convert(entry.getData(), original));
      converted.push(original);
      continue;
    }
    out.addFile(original, entry.getData());
  }
  return { buffer: out.toBuffer(), converted };
}

/** El documento convertido y leído con el extractor de siempre. */
export async function readLegacyOfficeDocument(version, buffer, { convert = convertLegacyOffice } = {}) {
  if (isZip(version)) {
    const upgraded = await upgradeLegacyOfficeArchive(buffer, { convert });
    return { result: await extractTenderDocumentText(upgraded.buffer, version.name, 'application/zip'), converted: upgraded.converted };
  }
  const target = TARGET[extensionOf(version.name)];
  const converted = await convert(buffer, version.name);
  return { result: await extractTenderDocumentText(converted, String(version.name).replace(/\.[a-z0-9]+$/i, `.${target}`)), converted: [version.name] };
}

function extractionParams(version, { result, converted }) {
  const ok = result.status === 'ok';
  return {
    p_opportunity_id: version.opportunity_id, p_tender_id: version.tender_id, p_document_version_id: version.id,
    p_extractor_version: TENDER_DOCUMENT_LEGACY_OFFICE_EXTRACTOR_VERSION, p_parser: `libreoffice+${result.parser}`,
    p_metadata: { ...result.metadata, legacy_office: true, converted }, p_actor_id: version.actor_id,
    p_status: ok ? 'ok' : 'gap', p_extracted_text: ok ? result.text : null, p_text_hash: ok ? result.text_hash : null,
    p_char_count: ok ? [...result.text].length : 0, p_text_byte_count: ok ? Buffer.byteLength(result.text, 'utf8') : 0,
    p_gap_reason: ok ? null : result.metadata?.gap_reason || 'extraction_error',
  };
}

/** Un pase: hasta `limit` documentos de licitaciones no archivadas. Devuelve eventos; nunca lanza por un documento. */
export async function runTenderDocumentLegacyOfficePass(database, { limit = 2, bucket = 'tender-documents', convert = convertLegacyOffice } = {}) {
  const { data: opportunities, error: oppError } = await database.from('psi_sales_opportunities').select('id')
    .eq('service_type_code', 'licitacion_publica').is('archived_at', null);
  if (oppError) throw oppError;
  const ids = (opportunities || []).map(row => row.id);
  if (!ids.length) return [{ event: 'tender_legacy_office_idle' }];
  const { data: versions, error: vError } = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,tender_id,name,mime_type,storage_path,current,actor_id,created_at').eq('current', true).in('opportunity_id', ids);
  if (vError) throw vError;
  const relevant = (versions || []).filter(version => isZip(version) || isLegacyOffice(version.name));
  if (!relevant.length) return [{ event: 'tender_legacy_office_idle' }];
  const { data: extractions, error: eError } = await database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,char_count,metadata,created_at').in('document_version_id', relevant.map(row => row.id));
  if (eError) throw eError;
  const candidates = selectLegacyOfficeCandidates(relevant, extractions || [], { limit });
  if (!candidates.length) return [{ event: 'tender_legacy_office_idle' }];
  const events = [];
  for (const version of candidates) {
    try {
      const { data: blob, error } = await database.storage.from(bucket).download(version.storage_path);
      if (error) throw error;
      const read = await readLegacyOfficeDocument(version, Buffer.from(await blob.arrayBuffer()), { convert });
      const params = extractionParams(version, read);
      const { error: rpcError } = await database.rpc('psi_record_tender_document_extraction', params);
      if (rpcError) throw rpcError;
      events.push({ event: 'tender_legacy_office_recorded', document_version_id: version.id, opportunity_id: version.opportunity_id, status: params.p_status, converted: read.converted.length, chars: params.p_char_count });
    } catch (cause) {
      const code = String(cause?.code || cause?.message || 'error').slice(0, 80);
      // Se deja constancia del intento para no reintentar cada 2 minutos un archivo que LibreOffice no abre.
      const failed = extractionParams(version, { result: { status: 'gap', parser: 'none', metadata: { gap_reason: 'legacy_office_conversion_failed', error: code } }, converted: [] });
      const { error: rpcError } = await database.rpc('psi_record_tender_document_extraction', failed);
      events.push({ event: 'tender_legacy_office_failed', document_version_id: version.id, code, recorded: !rpcError });
    }
  }
  return events;
}
