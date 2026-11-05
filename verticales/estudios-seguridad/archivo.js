// Estudios de Seguridad Física, tramo 4 — archivar en SharePoint una versión aprobada (Juan, 2026-11-05).
//
// Lo corre el trabajo del servidor de tareas (ops/estudios-seguridad/run-estudios-seguridad-archivo.mjs), cada minuto.
// Por cada pedido que dejó una aprobación (migración 186): arma el informe con membrete desde la foto congelada, lo
// pasa a PDF, baja las evidencias del depósito comprobando que su huella sea la de la versión, y sube el paquete a
// 99_Del_CRM/Estudios_de_Seguridad/<estudio>/v<N>/. Las dependencias (generar Word, pasar a PDF, subir) se inyectan,
// para probar el orden y las guardas sin tocar Microsoft.
//
// Guardas: nunca sobrescribe (si el archivo ya está, es de un intento anterior de este mismo pedido y se cuenta como
// subido); una evidencia cuya huella no coincide detiene el archivo de esa versión; el registro no lleva rutas ni
// nombres, sólo identificadores y códigos.

import { createHash } from 'node:crypto';
import { canonicalJson } from './flujo.js';
import { EVIDENCE_BUCKET } from './evidencias.js';
import { archiveFileNames, archiveFolderPath, buildStudyReport } from './informe.js';

export const ARCHIVE_ERRORS = Object.freeze({
  version: 'no encontré la versión aprobada',
  informe: 'no se pudo armar el informe',
  pdf: 'no se pudo pasar el informe a PDF',
  evidencia_descarga: 'no pude leer una evidencia guardada en el SIIO',
  evidencia_huella: 'una evidencia no coincide con la huella de la versión aprobada',
  no_subio: 'SharePoint no aceptó un archivo; puede ser la sesión de Microsoft',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Lee la salida de subir.py: "escrito:" + "url:", o "YA EXISTE". */
export function parseUploadOutput(stdout = '') {
  const text = String(stdout);
  if (/YA EXISTE/.test(text)) return { ok: true, url: null, readback: 'existente' };
  if (!/escrito:/.test(text)) return { ok: false };
  return { ok: true, url: text.match(/^url:\s*(https:\/\/\S+)/m)?.[1] || null, readback: /readback: IGUAL/.test(text) ? 'igual' : 'distinto' };
}

class ArchiveFailure extends Error {
  constructor(reason) { super(ARCHIVE_ERRORS[reason]); this.reason = reason; }
}

/**
 * Archiva un pedido. `deps`: { renderDocx(document) → bytes, toPdf(docxBytes) → bytes, upload(relativePath, bytes) → stdout }.
 * Devuelve lo que se registra con psi_finish_security_study_archive.
 */
export async function archiveVersion(database, archive, deps, log = () => {}) {
  const { data: version, error } = await database.from('psi_security_study_versions')
    .select('version, snapshot, snapshot_sha256, approved_by, approved_at').eq('study_id', archive.study_id).eq('version', archive.version).maybeSingle();
  if (error || !version) throw new ArchiveFailure('version');
  const snapshot = version.snapshot;
  const ids = [...new Set([version.approved_by, snapshot.estudio.preparado_por].filter(Boolean))];
  const { data: people } = await database.from('psi_sales_profiles').select('id, full_name').in('id', ids);
  const name = id => (people || []).find(person => person.id === id)?.full_name || null;

  let docx;
  let pdf;
  try {
    docx = await deps.renderDocx(buildStudyReport(snapshot, {
      version: version.version, sha256: version.snapshot_sha256, approvedAt: version.approved_at,
      approverName: name(version.approved_by), preparerName: name(snapshot.estudio.preparado_por),
    }));
  } catch { throw new ArchiveFailure('informe'); }
  try { pdf = await deps.toPdf(docx); } catch { throw new ArchiveFailure('pdf'); }

  const names = archiveFileNames(snapshot, version.version);
  const evidence = [];
  for (const [index, item] of snapshot.evidencias.entries()) {
    const { data: blob, error: downloadError } = await database.storage.from(EVIDENCE_BUCKET).download(item.ruta);
    if (downloadError || !blob) throw new ArchiveFailure('evidencia_descarga');
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (sha256(bytes) !== item.sha256) throw new ArchiveFailure('evidencia_huella');
    evidence.push({ name: names.evidence[index].name, bytes, kind: item.tipo });
  }

  const folder = archiveFolderPath(snapshot, version.version);
  const json = Buffer.from(canonicalJson(snapshot), 'utf8');
  const files = [
    { name: names.pdf, bytes: pdf, kind: 'informe_pdf' },
    { name: names.docx, bytes: docx, kind: 'informe_word' },
    { name: names.json, bytes: json, kind: 'estudio_json' },
    ...evidence,
  ];
  const uploaded = [];
  for (const file of files) {
    const result = parseUploadOutput(await deps.upload(`${folder}/${file.name}`, file.bytes));
    if (!result.ok) throw new ArchiveFailure('no_subio');
    uploaded.push({ nombre: file.name, tipo: file.kind, sha256: sha256(file.bytes), bytes: file.bytes.length, url: result.url, readback: result.readback });
  }
  log({ event: 'estudios_archivo_subido', archive_id: archive.id, archivos: uploaded.length, readback_distinto: uploaded.filter(file => file.readback === 'distinto').length });
  // El estudio JSON debe ser exactamente la versión aprobada: su huella es la de la versión.
  if (sha256(json) !== version.snapshot_sha256) log({ event: 'estudios_archivo_huella_json_distinta', archive_id: archive.id });
  return { folder, reportUrl: uploaded[0].url, files: uploaded };
}

/** Una corrida: toma pedidos y cierra cada uno, bien o con su motivo. Sin pedidos no hace nada más. */
export async function runArchiveBatch(database, deps, log = () => {}) {
  const { data: claimed, error } = await database.rpc('psi_claim_security_study_archives', { p_limit: 3 });
  if (error) throw new Error('claim');
  const archives = Array.isArray(claimed) ? claimed : [];
  if (!archives.length) { log({ event: 'estudios_archivo_sin_pedidos' }); return { processed: 0, ok: 0 }; }
  let ok = 0;
  for (const archive of archives) {
    let result = null;
    let reason = null;
    try { result = await archiveVersion(database, archive, deps, log); } catch (failure) { reason = failure?.reason || 'excepcion'; }
    const { error: finishError } = await database.rpc('psi_finish_security_study_archive', {
      p_id: archive.id, p_ok: Boolean(result), p_folder_path: result?.folder ?? null, p_report_url: result?.reportUrl ?? null,
      p_files: result?.files ?? null, p_error: result ? null : (ARCHIVE_ERRORS[reason] || 'error técnico al archivar'),
    });
    if (finishError) log({ event: 'estudios_archivo_cierre_fallido', archive_id: archive.id });
    if (result) ok += 1; else log({ event: 'estudios_archivo_fallido', archive_id: archive.id, motivo: reason });
  }
  return { processed: archives.length, ok };
}
