// OCR de los PDF escaneados (F8, segunda mitad; Juan, 2026-11-08). Un PDF escaneado llega sin texto: el extractor de la
// carga (Vercel, sin OCR, con tope de 3 minutos) lo deja como «gap» y Vig-IA no lo lee. Este paso corre en el servidor de
// tareas, dentro del mismo trabajo que arranca los análisis (agt002-auto-initial, cada 2 minutos), ANTES de admitirlos:
// así el texto ya está cuando el análisis pedido por la carga arranca. No es un trabajo nuevo (Juan pidió no multiplicar
// tareas repetitivas).
//
// El texto se guarda como una extracción nueva de la misma versión (`psi_tender_document_extractions`), con un
// `extractor_version` de generación mayor que la del extractor de texto: la lectura canónica la prefiere sobre el «gap».
// Si el OCR tampoco saca texto, se guarda un «gap» del OCR para no reintentar cada 2 minutos.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { selectCanonicalExtractionsByDocumentVersion } from './tender-document-extraction-persistence.js';
import { TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION } from './tender-document-text-extraction.js';

const run = promisify(execFile);
const generation = Number(/@(\d+)$/.exec(TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION)?.[1] || 0);
// `-osd`: la segunda versión endereza las páginas escaneadas de lado y descarta lo ilegible (2026-11-08: un CDP de la
// Rama de Pereira escaneado girado salió como texto sin sentido). Cambiar el nombre hace que se vuelva a leer lo que leyó
// la primera versión. Generación +2: tiene que ganarle también a lo que dejó la primera (`@4`), incluso a un «ok» ilegible.
export const TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION = `tender-document-ocr-tesseract-osd@${generation + 2}`;
export const TENDER_DOCUMENT_OCR_PARSER = 'tesseract-spa';
const MIN_CHARS = 80;
const isPdf = version => /pdf/i.test(String(version.mime_type || '')) || /\.pdf$/i.test(String(version.name || ''));

/** Versiones vigentes de PDF cuya lectura canónica no tiene texto y que el OCR no ha intentado. Pura. */
export function selectOcrCandidates(versions, extractionRows, { limit = 3 } = {}) {
  const canonical = selectCanonicalExtractionsByDocumentVersion(extractionRows);
  const ocrTried = new Set(extractionRows.filter(row => row.extractor_version === TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION).map(row => row.document_version_id));
  const olderOcr = new Set(extractionRows.filter(row => String(row.extractor_version || '').startsWith('tender-document-ocr-') && row.extractor_version !== TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION).map(row => row.document_version_id));
  return versions
    .filter(version => version.current && isPdf(version) && version.storage_path && !ocrTried.has(version.id))
    .filter(version => {
      const row = canonical.get(version.id);
      if (olderOcr.has(version.id)) return true;
      if (row) return row.status === 'gap';
      return String(version.extracted_text || '').trim().length < MIN_CHARS;
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

/** PDF → texto con pdftoppm + tesseract (español). Página por página, con tope de páginas y de tiempo. */
export async function ocrPdfBuffer(buffer, { maxPages = 40, dpi = 200, timeoutMs = 600_000, runner = run } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
  try {
    const pdf = join(dir, 'in.pdf');
    await writeFile(pdf, buffer);
    await runner('pdftoppm', ['-r', String(dpi), '-l', String(maxPages), '-png', pdf, join(dir, 'p')], { timeout: timeoutMs });
    const pages = (await readdir(dir)).filter(name => name.endsWith('.png')).sort();
    const texts = [];
    for (const page of pages) {
      const image = await uprightPage(join(dir, page), runner);
      const { stdout } = await runner('tesseract', [image, 'stdout', '-l', 'spa'], { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
      texts.push(String(stdout || '').trim());
    }
    return { text: texts.map((text, index) => `--- página ${index + 1} ---\n${text}`).join('\n\n').trim(), pages: pages.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Orientación de la página (tesseract --psm 0). Si viene girada con confianza, se endereza con Pillow; si no se puede
// estimar (poco texto), se lee como viene.
async function uprightPage(path, runner) {
  try {
    const { stdout } = await runner('tesseract', [path, 'stdout', '--psm', '0'], { timeout: 60_000 });
    const rotate = Number(/Rotate:\s*(\d+)/.exec(stdout)?.[1] || 0);
    const confidence = Number(/Orientation confidence:\s*([\d.]+)/.exec(stdout)?.[1] || 0);
    if (!rotate || confidence < 1.5) return path;
    const out = path.replace(/\.png$/, '-up.png');
    await runner('python3', ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).rotate(-int(sys.argv[3]), expand=True).save(sys.argv[2])', path, out, String(rotate)], { timeout: 60_000 });
    return out;
  } catch {
    return path;
  }
}

const STOPWORDS = new Set(['de', 'la', 'el', 'que', 'en', 'los', 'del', 'las', 'por', 'con', 'para', 'una', 'se', 'al', 'y', 'a', 'o', 'no', 'su']);
/** ¿Se puede leer? Proporción de palabras comunes del español entre las palabras del texto. */
export function ocrLooksReadable(text) {
  const words = String(text || '').toLowerCase().match(/[a-záéíóúüñ]+/g) || [];
  if (words.length < 20) return words.join('').length >= MIN_CHARS;
  const common = words.filter(word => STOPWORDS.has(word)).length;
  return common / words.length >= 0.08;
}

function extractionParams(version, { text, pages }) {
  const body = text.replace(/--- página \d+ ---/g, '').trim();
  const ok = body.length >= MIN_CHARS && ocrLooksReadable(body);
  const base = {
    p_opportunity_id: version.opportunity_id, p_tender_id: version.tender_id, p_document_version_id: version.id,
    p_extractor_version: TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION, p_parser: TENDER_DOCUMENT_OCR_PARSER,
    p_metadata: { ocr: true, pages, engine: 'tesseract', language: 'spa' }, p_actor_id: version.actor_id,
  };
  if (!ok) return { ...base, p_status: 'gap', p_extracted_text: null, p_text_hash: null, p_char_count: 0, p_text_byte_count: 0, p_gap_reason: body.length >= MIN_CHARS ? 'ocr_ilegible' : 'ocr_sin_texto' };
  return {
    ...base, p_status: 'ok', p_extracted_text: text, p_text_hash: createHash('sha256').update(text, 'utf8').digest('hex'),
    p_char_count: [...text].length, p_text_byte_count: Buffer.byteLength(text, 'utf8'), p_gap_reason: null,
  };
}

/** Un pase: hasta `limit` PDF sin texto de licitaciones no archivadas. Devuelve eventos; nunca lanza por un documento. */
export async function runTenderDocumentOcrPass(database, { limit = 3, bucket = 'tender-documents', ocr = ocrPdfBuffer, onText = null } = {}) {
  const { data: opportunities, error: oppError } = await database.from('psi_sales_opportunities').select('id')
    .eq('service_type_code', 'licitacion_publica').is('archived_at', null);
  if (oppError) throw oppError;
  const ids = (opportunities || []).map(row => row.id);
  if (!ids.length) return [{ event: 'tender_ocr_idle' }];
  const { data: versions, error: vError } = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,tender_id,name,mime_type,storage_path,current,extracted_text,actor_id,created_at,origin').eq('current', true).in('opportunity_id', ids);
  if (vError) throw vError;
  const pdfIds = (versions || []).filter(isPdf).map(row => row.id);
  if (!pdfIds.length) return [{ event: 'tender_ocr_idle' }];
  const { data: extractions, error: eError } = await database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,extracted_text,text_hash,char_count,created_at').in('document_version_id', pdfIds);
  if (eError) throw eError;
  const candidates = selectOcrCandidates(versions || [], extractions || [], { limit });
  if (!candidates.length) return [{ event: 'tender_ocr_idle' }];
  const events = [];
  for (const version of candidates) {
    try {
      const { data: blob, error } = await database.storage.from(bucket).download(version.storage_path);
      if (error) throw error;
      const result = await ocr(Buffer.from(await blob.arrayBuffer()));
      const params = extractionParams(version, result);
      const { error: rpcError } = await database.rpc('psi_record_tender_document_extraction', params);
      if (rpcError) throw rpcError;
      events.push({ event: 'tender_ocr_recorded', document_version_id: version.id, opportunity_id: version.opportunity_id, status: params.p_status, pages: result.pages, chars: params.p_char_count });
      if (params.p_status === 'ok' && typeof onText === 'function') await onText(version, params.p_extracted_text);
    } catch (cause) {
      events.push({ event: 'tender_ocr_failed', document_version_id: version.id, code: String(cause?.code || cause?.message || 'error').slice(0, 80) });
    }
  }
  return events;
}
