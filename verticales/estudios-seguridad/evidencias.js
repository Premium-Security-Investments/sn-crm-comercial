// Estudios de Seguridad Física, tramo 2 — fotos y evidencias de la visita (Juan, 2026-11-05).
//
// Tres pasos, como las demás cargas del SIIO: el servidor da un permiso firmado para subir (ruta propia del estudio),
// el navegador sube el archivo directo al depósito, y el servidor confirma. Al confirmar descarga el archivo, mira sus
// primeros bytes para saber qué es de verdad (no se cree la extensión ni lo que dice el navegador) y calcula su
// sha256. Sólo entonces lo registra. Así una evidencia registrada siempre existe, es del tipo que dice y tiene huella.

import { createHash, randomUUID } from 'node:crypto';

export const EVIDENCE_TABLE = 'psi_security_study_evidence';
export const EVIDENCE_BUCKET = 'security-study-evidence';
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
export const EVIDENCE_URL_TTL_SECONDS = 10 * 60;

const EDITABLE_STATUSES = new Set(['borrador', 'devuelto']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Para qué sirve el archivo (migración 187). El mapa de la sede y el logo del cliente van impresos en el informe, por
// eso sólo JPG o PNG, y no se amarran a un riesgo ni a una zona.
const PURPOSES = new Set(['evidencia', 'mapa', 'logo']);
const PRINTABLE = new Set(['image/jpeg', 'image/png']);
function cleanPurpose(body) {
  const purpose = body.purpose ?? 'evidencia';
  if (!PURPOSES.has(purpose)) throw invalid('Propósito del archivo inválido.');
  if (purpose !== 'evidencia' && (body.risk_id || body.zone_id)) throw invalid('El mapa y el logo son del estudio, no de un riesgo o una zona.');
  return purpose;
}
const MIME_KIND = Object.freeze({
  'image/jpeg': 'foto', 'image/png': 'foto', 'image/webp': 'foto', 'image/heic': 'foto', 'application/pdf': 'documento',
});

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function uuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${field}: identificador inválido.`);
  return value;
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// Qué es el archivo según sus primeros bytes. null si no es ninguno de los permitidos.
export function sniffMime(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'application/pdf';
  const ascii = (start, end) => String.fromCharCode(...b.subarray(start, end));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(8, 12))) return 'image/heic';
  return null;
}

// Nombre seguro para la ruta: sin carpetas, sin caracteres raros, con largo acotado. El original va en file_name.
export function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '').slice(-80);
  return clean || 'archivo';
}

async function editableStudy(db, studyId) {
  const study = await must(db.from('psi_security_studies').select('id, status').eq('id', uuid(studyId, 'Estudio')).maybeSingle());
  if (!study) throw invalid('Estudio no encontrado.', 404);
  if (!EDITABLE_STATUSES.has(study.status)) throw invalid('El estudio no está en borrador: no se puede modificar.', 409);
  return study;
}

async function cleanTarget(db, studyId, body) {
  const zoneId = body.zone_id ? uuid(body.zone_id, 'Zona') : null;
  const riskId = body.risk_id ? uuid(body.risk_id, 'Riesgo') : null;
  if (zoneId && riskId) throw invalid('Una evidencia se amarra a una zona o a un riesgo, no a ambos.');
  if (zoneId && !(await must(db.from('psi_security_study_zones').select('id').eq('id', zoneId).eq('study_id', studyId).maybeSingle()))) throw invalid('Zona: no existe en este estudio.', 404);
  if (riskId && !(await must(db.from('psi_security_study_risks').select('id').eq('id', riskId).eq('study_id', studyId).maybeSingle()))) throw invalid('Riesgo: no existe en este estudio.', 404);
  return { zone_id: zoneId, risk_id: riskId };
}

// Paso 1: permiso firmado para subir un archivo a la carpeta del estudio.
export async function requestEvidenceUpload(db, studyId, body = {}) {
  const study = await editableStudy(db, studyId);
  const mime = typeof body.mime_type === 'string' ? body.mime_type : '';
  if (!MIME_KIND[mime]) throw invalid('Solo se aceptan fotos (JPG, PNG, WEBP o HEIC) y PDF.');
  if (cleanPurpose(body) !== 'evidencia' && !PRINTABLE.has(mime)) throw invalid('El mapa y el logo deben ser JPG o PNG.');
  const size = Number(body.size_bytes);
  if (!Number.isInteger(size) || size <= 0) throw invalid('Tamaño del archivo inválido.');
  if (size > MAX_EVIDENCE_BYTES) throw invalid('El archivo pesa más de 15 MB.');
  await cleanTarget(db, study.id, body);
  const path = `${study.id}/${randomUUID()}-${safeFileName(body.file_name)}`;
  const data = await must(db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path));
  return { bucket: EVIDENCE_BUCKET, path, token: data.token };
}

// Paso 3: confirmar. El archivo tiene que estar en la carpeta del estudio, ser lo que dice y pesar lo permitido.
export async function completeEvidenceUpload(db, studyId, body = {}, profile, now = new Date()) {
  const study = await editableStudy(db, studyId);
  const path = typeof body.path === 'string' ? body.path : '';
  if (!path.startsWith(`${study.id}/`) || path.includes('..') || path.length > 400) throw invalid('Ruta de la evidencia inválida.');
  const purpose = cleanPurpose(body);
  const target = await cleanTarget(db, study.id, body);
  const blob = await must(db.storage.from(EVIDENCE_BUCKET).download(path));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const remove = () => db.storage.from(EVIDENCE_BUCKET).remove([path]).catch(() => null);
  if (bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) { await remove(); throw invalid('El archivo está vacío o pesa más de 15 MB.'); }
  const mime = sniffMime(bytes);
  if (!mime) { await remove(); throw invalid('El archivo no es una foto ni un PDF válido.'); }
  if (purpose !== 'evidencia' && !PRINTABLE.has(mime)) { await remove(); throw invalid('El mapa y el logo deben ser JPG o PNG.'); }
  const caption = typeof body.caption === 'string' ? body.caption.replace(/\s+/g, ' ').trim().slice(0, 500) || null : null;
  const takenOn = typeof body.taken_on === 'string' && ISO_DATE.test(body.taken_on) ? body.taken_on : null;
  const fileName = String(body.file_name || '').split(/[\\/]/).pop().trim().slice(0, 200) || safeFileName(path);
  return must(db.from(EVIDENCE_TABLE).insert({
    study_id: study.id, ...target, purpose, kind: MIME_KIND[mime], storage_path: path, file_name: fileName, mime_type: mime,
    size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), caption, taken_on: takenOn,
    uploaded_by: profile.id, created_at: now.toISOString(),
  }).select('*').single());
}

export async function deleteEvidence(db, studyId, evidenceId) {
  const study = await editableStudy(db, studyId);
  const row = await must(db.from(EVIDENCE_TABLE).select('*').eq('id', uuid(evidenceId, 'Evidencia')).eq('study_id', study.id).maybeSingle());
  if (!row) throw invalid('Evidencia: no existe en este estudio.', 404);
  await must(db.from(EVIDENCE_TABLE).delete().eq('id', row.id));
  // Si el archivo no se puede borrar queda huérfano en el depósito, pero el registro ya no lo muestra.
  await db.storage.from(EVIDENCE_BUCKET).remove([row.storage_path]).catch(() => null);
  return { deleted: row.id };
}

// Enlaces de vida corta para ver las evidencias del estudio. El depósito es privado.
export async function evidenceUrls(db, studyId) {
  const rows = await must(db.from(EVIDENCE_TABLE).select('id, storage_path').eq('study_id', uuid(studyId, 'Estudio')));
  if (!rows?.length) return { urls: {}, expires_in: EVIDENCE_URL_TTL_SECONDS };
  const signed = await must(db.storage.from(EVIDENCE_BUCKET).createSignedUrls(rows.map(row => row.storage_path), EVIDENCE_URL_TTL_SECONDS));
  const byPath = new Map((signed || []).map(item => [item.path, item.signedUrl]));
  return { urls: Object.fromEntries(rows.map(row => [row.id, byPath.get(row.storage_path) || null])), expires_in: EVIDENCE_URL_TTL_SECONDS };
}

// Lista para la ficha. Tolera que la migración 179 todavía no se haya aplicado: sin tabla, el estudio se sigue
// viendo y la pantalla avisa que las evidencias no están disponibles.
export async function listEvidence(db, studyId) {
  const { data, error } = await db.from(EVIDENCE_TABLE).select('*').eq('study_id', studyId).order('created_at', { ascending: true });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || '')) return { evidence: [], available: false };
    throw error;
  }
  return { evidence: data || [], available: true };
}
