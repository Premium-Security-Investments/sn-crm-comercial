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
// Las listas largas de identificadores van en tandas. Con 423 PDF vigentes, un solo `.in()` arma una URL de ~16 KB que
// la conexión corta («fetch failed»): el OCR de lo escaneado falló en cada pase desde el 2026-11-15 a las 19:01 sin
// leer nada (visto el 17-nov). 100 identificadores son ~4 KB.
export const TENDER_OCR_IDS_PER_QUERY = 100;
export async function selectByIdsInChunks(query, ids, size = TENDER_OCR_IDS_PER_QUERY) {
  const rows = [];
  for (let start = 0; start < ids.length; start += size) {
    const { data, error } = await query().in('document_version_id', ids.slice(start, start + size));
    if (error) return { data: null, error };
    rows.push(...(data || []));
  }
  return { data: rows, error: null };
}
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

// ---- Huella de los pases (2026-11-20) ------------------------------------------------------------------------------
// Elegir candidatos exige leer el texto de todas las lecturas (la regla de buena forma compara el hash con el texto), y
// eso, cada 2 minutos y casi siempre para nada, era la carga más pesada de la base del CRM. La huella son conteos y
// fechas, sin texto: si no cambió desde el último pase que no encontró nada, no hay candidatos nuevos y el pase se salta.
export const HUELLAS_TABLE = 'psi_agt002_pase_huellas';
export const PASE_COMPLETO_CADA_MS = 60 * 60_000;

async function contarYUltima(database, tabla, filtrar = consulta => consulta) {
  const { count, error } = await filtrar(database.from(tabla).select('id', { count: 'exact', head: true }));
  if (error) throw error;
  const { data, error: e2 } = await filtrar(database.from(tabla).select('created_at')).order('created_at', { ascending: false }).limit(1);
  if (e2) throw e2;
  return `${count ?? 0}:${data?.[0]?.created_at || '-'}`;
}

export async function huellaDeDocumentos(database, ids, extractor) {
  const versiones = await contarYUltima(database, 'psi_tender_document_versions', consulta => consulta.eq('current', true).in('opportunity_id', ids));
  const lecturas = await contarYUltima(database, 'psi_tender_document_extractions');
  const oportunidades = createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 16);
  return `${extractor}|o:${ids.length}:${oportunidades}|v:${versiones}|e:${lecturas}`;
}

/** true si el último pase completo de `pase` no encontró candidatos con esta misma huella y fue hace menos de una hora. */
export async function paseSinCambios(database, pase, huella, ahora = Date.now()) {
  try {
    const { data, error } = await database.from(HUELLAS_TABLE).select('huella,completo_en').eq('pase', pase).limit(1);
    if (error || !data?.length) return false;
    return data[0].huella === huella && ahora - Date.parse(data[0].completo_en) < PASE_COMPLETO_CADA_MS;
  } catch {
    return false;
  }
}

export async function recordarPaseSinCandidatos(database, pase, huella, ahora = new Date()) {
  try {
    await database.from(HUELLAS_TABLE).upsert({ pase, huella, completo_en: ahora.toISOString() }, { onConflict: 'pase' });
  } catch { /* sin tabla, el pase siguiente corre completo: igual que antes */ }
}

async function olvidarPase(database, pase) {
  try { await database.from(HUELLAS_TABLE).delete().eq('pase', pase); } catch { /* nada */ }
}

/** Un pase: hasta `limit` PDF sin texto de licitaciones no archivadas. Devuelve eventos; nunca lanza por un documento. */
export async function runTenderDocumentOcrPass(database, { limit = 3, bucket = 'tender-documents', ocr = ocrPdfBuffer, onText = null } = {}) {
  const { data: opportunities, error: oppError } = await database.from('psi_sales_opportunities').select('id')
    .eq('service_type_code', 'licitacion_publica').is('archived_at', null);
  if (oppError) throw oppError;
  const ids = (opportunities || []).map(row => row.id);
  if (!ids.length) return [{ event: 'tender_ocr_idle' }];
  const huella = await huellaDeDocumentos(database, ids, TENDER_DOCUMENT_OCR_EXTRACTOR_VERSION).catch(() => null);
  if (huella && await paseSinCambios(database, 'ocr', huella)) return [{ event: 'tender_ocr_idle', sin_cambios: true }];
  const { data: versions, error: vError } = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,tender_id,name,mime_type,storage_path,current,extracted_text,actor_id,created_at,origin').eq('current', true).in('opportunity_id', ids);
  if (vError) throw vError;
  const pdfIds = (versions || []).filter(isPdf).map(row => row.id);
  if (!pdfIds.length) {
    if (huella) await recordarPaseSinCandidatos(database, 'ocr', huella);
    return [{ event: 'tender_ocr_idle' }];
  }
  const { data: extractions, error: eError } = await selectByIdsInChunks(() => database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,extracted_text,text_hash,char_count,created_at'), pdfIds);
  if (eError) throw eError;
  const candidates = selectOcrCandidates(versions || [], extractions || [], { limit });
  if (!candidates.length) {
    if (huella) await recordarPaseSinCandidatos(database, 'ocr', huella);
    return [{ event: 'tender_ocr_idle' }];
  }
  // Con candidatos, el pase siguiente vuelve a mirar todo: puede quedar trabajo después de estos.
  await olvidarPase(database, 'ocr');
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

// --- Texto dentro de las imágenes de una carta de un tercero (Juan, 2026-11-17) ------------------------------------
// Una carta de otro proponente puede traer el nombre de la empresa sólo en el logo del membrete: el 17-nov, la de
// Seguridad Atlas al pliego definitivo de la DEAJ decía «Atlas» únicamente en la imagen, y Vig-IA la reportó «sin empresa
// identificada». El agente la identificó mirando la página. Este paso le da a Vig-IA esa misma lectura: el texto de las
// imágenes del PDF (logo, pie de página, sellos), leído con OCR y agregado DESPUÉS del texto del documento, que no se
// toca. Sólo para documentos de terceros: ahí es donde importa quién escribe. Corre en el mismo pase que el OCR, antes de
// admitir análisis.
export const TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION = `tender-document-texto-e-imagenes@${generation + 3}`;
export const TENDER_DOCUMENT_IMAGE_TEXT_PARSER = 'pdf-parse+tesseract-imagenes';
export const TENDER_DOCUMENT_IMAGE_TEXT_HEADING = '--- Texto dentro de las imágenes del documento (membrete, logos, sellos), leído con OCR ---';
const MIN_IMAGE_SIDE = 60;

/**
 * Versiones vigentes de PDF de un tercero cuya lectura canónica es la del extractor de texto (con texto) y a las que no
 * se les han leído las imágenes. Lo escaneado ya lo cubre el OCR de página completa. Pura.
 */
export function selectImageTextCandidates(versions, extractionRows, { limit = 3 } = {}) {
  const canonical = selectCanonicalExtractionsByDocumentVersion(extractionRows);
  const tried = new Set(extractionRows.filter(row => row.extractor_version === TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION).map(row => row.document_version_id));
  return versions
    .filter(version => version.current && version.origin === 'tercero' && isPdf(version) && version.storage_path && !tried.has(version.id))
    .filter(version => {
      const row = canonical.get(version.id);
      return row?.status === 'ok' && row.extractor_version === TENDER_DOCUMENT_TEXT_EXTRACTOR_VERSION && String(row.extracted_text || '').trim();
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

/** Las imágenes incrustadas del PDF → texto (pdfimages + tesseract). Se descartan los íconos diminutos. */
export async function ocrPdfImages(buffer, { maxPages = 5, timeoutMs = 300_000, runner = run } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ocr-img-'));
  try {
    const pdf = join(dir, 'in.pdf');
    await writeFile(pdf, buffer);
    await runner('pdfimages', ['-l', String(maxPages), '-png', pdf, join(dir, 'i')], { timeout: timeoutMs });
    const images = (await readdir(dir)).filter(name => name.endsWith('.png')).sort();
    const texts = [];
    for (const image of images) {
      const path = join(dir, image);
      try {
        const { stdout: size } = await runner('python3', ['-c', 'import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)', path], { timeout: 30_000 });
        const [width, height] = String(size).trim().split(/\s+/).map(Number);
        if (!(width >= MIN_IMAGE_SIDE && height >= MIN_IMAGE_SIDE)) continue;
        const { stdout } = await runner('tesseract', [path, 'stdout', '-l', 'spa'], { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
        const text = String(stdout || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        if (text) texts.push(text);
      } catch { /* una imagen que no se lee no frena las demás */ }
    }
    return { text: texts.join('\n\n'), images: images.length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** El texto del documento, intacto, y después lo que dicen sus imágenes (si dicen algo legible). Pura. */
export function combineTextAndImageText(documentText, imageText) {
  const extra = String(imageText || '').trim();
  const words = extra.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/g) || [];
  if (!words.length) return documentText;
  return `${documentText.trimEnd()}\n\n${TENDER_DOCUMENT_IMAGE_TEXT_HEADING}\n${extra}`;
}

/**
 * Un pase: hasta `limit` cartas de terceros en PDF. Siempre deja una extracción de esta versión, con o sin texto de
 * imágenes, para no volver a intentarlo cada 2 minutos. Devuelve eventos; nunca lanza por un documento.
 */
export async function runTenderDocumentImageTextPass(database, { limit = 3, bucket = 'tender-documents', ocr = ocrPdfImages } = {}) {
  const { data: opportunities, error: oppError } = await database.from('psi_sales_opportunities').select('id')
    .eq('service_type_code', 'licitacion_publica').is('archived_at', null);
  if (oppError) throw oppError;
  const ids = (opportunities || []).map(row => row.id);
  if (!ids.length) return [{ event: 'tender_image_text_idle' }];
  const huella = await huellaDeDocumentos(database, ids, TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION).catch(() => null);
  if (huella && await paseSinCambios(database, 'imagenes', huella)) return [{ event: 'tender_image_text_idle', sin_cambios: true }];
  const { data: versions, error: vError } = await database.from('psi_tender_document_versions')
    .select('id,opportunity_id,tender_id,name,mime_type,storage_path,current,actor_id,created_at,origin')
    .eq('current', true).eq('origin', 'tercero').in('opportunity_id', ids);
  if (vError) throw vError;
  const pdfIds = (versions || []).filter(isPdf).map(row => row.id);
  if (!pdfIds.length) {
    if (huella) await recordarPaseSinCandidatos(database, 'imagenes', huella);
    return [{ event: 'tender_image_text_idle' }];
  }
  const { data: extractions, error: eError } = await selectByIdsInChunks(() => database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,extracted_text,text_hash,char_count,created_at'), pdfIds);
  if (eError) throw eError;
  const candidates = selectImageTextCandidates(versions || [], extractions || [], { limit });
  if (!candidates.length) {
    if (huella) await recordarPaseSinCandidatos(database, 'imagenes', huella);
    return [{ event: 'tender_image_text_idle' }];
  }
  await olvidarPase(database, 'imagenes');
  const canonical = selectCanonicalExtractionsByDocumentVersion(extractions || []);
  const events = [];
  for (const version of candidates) {
    try {
      const { data: blob, error } = await database.storage.from(bucket).download(version.storage_path);
      if (error) throw error;
      const result = await ocr(Buffer.from(await blob.arrayBuffer()));
      const text = combineTextAndImageText(canonical.get(version.id).extracted_text, result.text);
      const { error: rpcError } = await database.rpc('psi_record_tender_document_extraction', {
        p_opportunity_id: version.opportunity_id, p_tender_id: version.tender_id, p_document_version_id: version.id,
        p_extractor_version: TENDER_DOCUMENT_IMAGE_TEXT_EXTRACTOR_VERSION, p_parser: TENDER_DOCUMENT_IMAGE_TEXT_PARSER,
        p_metadata: { imagenes: result.images, texto_en_imagenes: text.length > canonical.get(version.id).extracted_text.length, engine: 'tesseract', language: 'spa' },
        p_actor_id: version.actor_id, p_status: 'ok', p_extracted_text: text,
        p_text_hash: createHash('sha256').update(text, 'utf8').digest('hex'),
        p_char_count: [...text].length, p_text_byte_count: Buffer.byteLength(text, 'utf8'), p_gap_reason: null,
      });
      if (rpcError) throw rpcError;
      events.push({ event: 'tender_image_text_recorded', document_version_id: version.id, opportunity_id: version.opportunity_id, images: result.images, added_chars: text.length - canonical.get(version.id).extracted_text.length });
    } catch (cause) {
      events.push({ event: 'tender_image_text_failed', document_version_id: version.id, code: String(cause?.code || cause?.message || 'error').slice(0, 80) });
    }
  }
  return events;
}

/**
 * Mejora 9 (migración 199): el mismo OCR para los certificados de experiencia subidos en Empresa que llegaron escaneados.
 * Guarda el texto (o «sin_texto») en la experiencia; `onText` dispara la revisión de Vig-IA. Sin la 199, no hace nada.
 */
export async function runExperienceCertificateOcrPass(database, { limit = 2, bucket = 'tender-documents', ocr = ocrPdfBuffer, onText = null } = {}) {
  const { data: rows, error } = await database.from('psi_company_experience').select('id,certificate_storage_path,certificate_file_name')
    .not('certificate_storage_path', 'is', null).is('certificate_text_source', null)
    .order('certificate_uploaded_at', { ascending: true }).limit(limit);
  if (error) {
    if (['42703', 'PGRST204'].includes(String(error.code))) return [{ event: 'experience_certificate_ocr_unavailable' }];
    throw error;
  }
  if (!rows?.length) return [{ event: 'experience_certificate_ocr_idle' }];
  const events = [];
  for (const row of rows) {
    try {
      const { data: blob, error: downloadError } = await database.storage.from(bucket).download(row.certificate_storage_path);
      if (downloadError) throw downloadError;
      const result = await ocr(Buffer.from(await blob.arrayBuffer()));
      const body = String(result.text || '').replace(/--- página \d+ ---/g, '').trim();
      const ok = body.length >= MIN_CHARS && ocrLooksReadable(body);
      const { error: saveError } = await database.from('psi_company_experience')
        .update({ certificate_text: ok ? String(result.text).slice(0, 200000) : null, certificate_text_source: ok ? 'ocr' : 'sin_texto' }).eq('id', row.id);
      if (saveError) throw saveError;
      events.push({ event: 'experience_certificate_ocr_recorded', experience_id: row.id, readable: ok, pages: result.pages });
      if (ok && typeof onText === 'function') events.push({ event: 'experience_certificate_review', experience_id: row.id, ...(await onText(row)) });
    } catch (cause) {
      events.push({ event: 'experience_certificate_ocr_failed', experience_id: row.id, code: String(cause?.code || cause?.message || 'error').slice(0, 80) });
    }
  }
  return events;
}
