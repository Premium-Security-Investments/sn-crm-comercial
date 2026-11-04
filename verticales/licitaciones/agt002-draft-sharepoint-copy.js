// AGT-002 — dónde va en SharePoint la copia de trabajo de un borrador (mejora 5, migración 177).
//
// Sólo se sube lo que una persona pidió con el botón "Subir a SharePoint". Va a la carpeta del proceso, dentro de
// `99_Del_CRM/Borradores_Vig-IA/`: la misma carpeta aparte en la que el puente CRM → SharePoint ya escribe, nunca las
// carpetas numeradas del expediente, que son trabajo curado de una persona. El nombre lleva la versión, así que una
// versión nueva no pisa a la anterior, y la subida nunca sobrescribe.
//
// Módulo puro.

import { AGT002_CRM_TO_SHAREPOINT_FOLDER } from './agt002-crm-to-sharepoint.js';
import { agt002DocumentFileName } from './agt002-document-render.js';

export const AGT002_DRAFTS_SHAREPOINT_SUBFOLDER = 'Borradores_Vig-IA';

/** Nombre del archivo en SharePoint: el del Word del CRM, con la versión del documento. */
export function agt002DraftSharepointFileName({ fileName, version }) {
  const base = agt002DocumentFileName(fileName).replace(/\.docx$/i, '');
  return `${base}_v${Number.isInteger(version) ? version : Number(version) || 1}.docx`;
}

export function agt002DraftSharepointPath({ processesPath, folder, fileName, version }) {
  return [processesPath, folder, AGT002_CRM_TO_SHAREPOINT_FOLDER, AGT002_DRAFTS_SHAREPOINT_SUBFOLDER, agt002DraftSharepointFileName({ fileName, version })]
    .map(part => String(part).replace(/^\/+|\/+$/g, ''))
    .join('/');
}

/**
 * Lee la salida de `subir.py` (herramienta compartida de AGT-000). Sale con código 1 cuando el readback difiere, y con
 * un .docx difiere SIEMPRE porque SharePoint lo reescribe: "escrito:" en la salida es la prueba de que subió.
 */
export function agt002ParseUploadOutput(stdout = '') {
  const text = String(stdout);
  if (/YA EXISTE/.test(text)) return { ok: false, reason: 'ya_existe' };
  if (!/escrito:/.test(text)) return { ok: false, reason: 'no_subio' };
  const url = text.match(/^url:\s*(https:\/\/\S+)/m)?.[1] || null;
  return { ok: true, url, readback: /readback: IGUAL/.test(text) ? 'igual' : 'distinto' };
}

/** El motivo que lee la persona cuando falla: corto, sin rutas. */
export const AGT002_DRAFT_SHAREPOINT_ERRORS = Object.freeze({
  sin_carpeta: 'no encontré la carpeta de este proceso en SharePoint',
  carpeta_ambigua: 'hay más de una carpeta en SharePoint que podría ser de este proceso',
  ya_existe: 'ya hay un archivo con ese nombre en la carpeta; no se sobrescribe',
  descarga: 'no pude leer el Word guardado en el CRM',
  no_subio: 'SharePoint no aceptó el archivo',
  sin_listado: 'no pude leer las carpetas de SharePoint; puede ser la sesión de Microsoft',
});
