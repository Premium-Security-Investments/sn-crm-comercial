// Estudios de Seguridad Física, tramo 4 — el informe de una versión aprobada (Juan, 2026-11-05).
//
// Se arma SIEMPRE desde la foto congelada de la versión (psi_security_study_versions.snapshot), nunca desde el
// estudio vivo: si el estudio se reabre y cambia, el informe de la versión 1 sigue diciendo lo que se aprobó. Es una
// función pura que devuelve el documento como DATOS para el generador con membrete de la empresa
// (verticales/licitaciones/agt002-document-render.js), que no acepta XML ni rutas.
//
// Aquí también se decide dónde queda el paquete en SharePoint: siempre bajo 99_Del_CRM/Estudios_de_Seguridad/, con
// nombres limpios de los caracteres que SharePoint no admite.

import { PLANTILLAS } from './plantilla.js';

export const ARCHIVE_BASE_PATH = '99_Del_CRM/Estudios_de_Seguridad';
const NIVEL = Object.freeze({ bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico' });
const NIVEL_ORDER = ['critico', 'alto', 'moderado', 'bajo'];
const PRIORIDAD = Object.freeze({ alta: 'Alta', media: 'Media', baja: 'Baja' });
const ESTADO_ACCION = Object.freeze({ pendiente: 'Pendiente', en_curso: 'En curso', cumplida: 'Cumplida', descartada: 'Descartada' });
const MAX_CELL = 1500;

const clip = (value, max = MAX_CELL) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const level = tramo => `${tramo.magnitud} · ${NIVEL[tramo.nivel] || tramo.nivel}`;
const longDate = value => {
  if (!value) return 'sin fecha';
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(date);
};
const rating = control => (control?.calidad ? ` (calidad ${control.calidad}, eficacia ${control.eficacia}, eficiencia ${control.eficiencia})` : '');

/** Nombre de carpeta o archivo apto para SharePoint: sin \ / : * ? " < > | # %, sin puntos ni espacios al final. */
export function sharepointSafeName(value, max = 120) {
  const clean = String(value || '').normalize('NFC').replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, max).replace(/[.\s]+$/, '');
  return clean || 'sin-nombre';
}

export function archiveFolderPath(snapshot, version) {
  const study = snapshot.estudio;
  const name = sharepointSafeName(`${study.codigo} ${study.cliente.nombre} - ${study.sede.nombre}`, 150);
  return `${ARCHIVE_BASE_PATH}/${name}/v${version}`;
}

/** Los archivos del paquete, con nombres fijos por código y versión. Las evidencias, numeradas y con su riesgo. */
export function archiveFileNames(snapshot, version) {
  const code = sharepointSafeName(snapshot.estudio.codigo, 40);
  const riskNumber = new Map(snapshot.riesgos.map(risk => [risk.id, risk.numero]));
  return {
    pdf: `Informe_${code}_v${version}.pdf`,
    docx: `Informe_${code}_v${version}.docx`,
    json: `Estudio_${code}_v${version}.json`,
    evidence: snapshot.evidencias.map((item, index) => ({
      id: item.id,
      name: `evidencias/${String(index + 1).padStart(2, '0')}_${item.riesgo && riskNumber.has(item.riesgo) ? `R${riskNumber.get(item.riesgo)}` : 'General'}_${sharepointSafeName(item.archivo, 80)}`,
    })),
  };
}

/**
 * La foto de la versión → el documento con membrete. `meta`: { version, sha256, approvedAt, approverName, preparerName }.
 * Los límites del generador (bloques, filas, columnas) se respetan: con más de 80 riesgos la matriz se corta y lo dice.
 */
export function buildStudyReport(snapshot, meta) {
  const study = snapshot.estudio;
  const template = PLANTILLAS[study.plantilla];
  const catalog = new Map((template?.riesgos || []).map(item => [item.codigo, item.nombre]));
  const processes = new Map((template?.procesos || []).map(item => [item.codigo, item.nombre]));
  const zones = new Map(snapshot.zonas.map(zone => [zone.id, zone.nombre]));
  const risks = [...snapshot.riesgos].sort((a, b) => a.numero - b.numero);
  const riskNumber = new Map(risks.map(risk => [risk.id, risk.numero]));
  const blocks = [];
  const heading = text => blocks.push({ kind: 'heading', text });
  const paragraph = text => blocks.push({ kind: 'paragraph', text });

  heading('1. Datos del estudio');
  blocks.push({ kind: 'table', header: ['Dato', 'Valor'], rows: [
    ['Código', study.codigo],
    ['Cliente', study.cliente.nombre + (study.cliente.nit ? ` · NIT ${study.cliente.nit}` : '')],
    ['Sede', [study.sede.nombre, study.sede.ciudad, study.sede.direccion].filter(Boolean).join(' · ')],
    ['Fecha de la visita', longDate(study.fecha_visita)],
    ['Versión aprobada', `${meta.version} · ${longDate(meta.approvedAt)}`],
    ['Preparó', meta.preparerName || 'Sin nombre registrado'],
    ['Aprobó', meta.approverName || 'Sin nombre registrado'],
    ['Huella de la versión (sha256)', meta.sha256],
  ].map(row => row.map(cell => clip(cell))) });

  heading('2. Alcance');
  paragraph(clip(study.alcance, 3800) || 'Sin alcance registrado.');

  heading('3. Metodología');
  paragraph(`Metodología ${study.metodologia}. Cada riesgo se califica con probabilidad de 1 a 5 y con dos impactos de 1 a 5 —sobre la empresa o sede y sobre las personas—, y cuenta el mayor. El control se califica por calidad, eficacia y eficiencia (de 1 a 5, efectividad = producto / 125, con tope de 0,9) y reduce la probabilidad una sola vez. Niveles: 1–5 bajo, 6–10 moderado, 11–15 alto, 16–25 crítico. El riesgo actual considera el control existente; el residual, además, el control propuesto.`);

  heading('4. Resumen de la valoración');
  const count = (key, nivel) => risks.filter(risk => risk.valoracion[key].nivel === nivel).length;
  blocks.push({ kind: 'table', header: ['Nivel', 'Riesgo actual', 'Riesgo residual'], rows: NIVEL_ORDER.map(nivel => [NIVEL[nivel], String(count('actual', nivel)), String(count('residual', nivel))]) });
  paragraph(`Total de riesgos valorados: ${risks.length}.`);

  heading('5. Matriz de riesgos');
  const matrix = risks.slice(0, 80);
  if (matrix.length) {
    blocks.push({ kind: 'table', header: ['N.º', 'Riesgo', 'Zona', 'Inherente', 'Actual', 'Residual'], rows: matrix.map(risk => [
      `R${risk.numero}`, clip(risk.riesgo, 300), clip(zones.get(risk.zona) || '—', 120),
      level(risk.valoracion.inherente), level(risk.valoracion.actual), level(risk.valoracion.residual),
    ]) });
  } else paragraph('El estudio no tiene riesgos registrados.');
  if (risks.length > matrix.length) paragraph(`La matriz muestra los primeros ${matrix.length} riesgos; el detalle completo está en el archivo del estudio (JSON) de esta versión.`);

  heading('6. Detalle por riesgo');
  for (const risk of risks.slice(0, 60)) {
    blocks.push({ kind: 'heading', text: clip(`R${risk.numero} · ${risk.riesgo}`, 300) });
    blocks.push({ kind: 'list', items: [
      `Zona: ${zones.get(risk.zona) || 'sin zona'}`,
      `Catálogo: ${risk.catalogo ? `${risk.catalogo} · ${catalog.get(risk.catalogo) || ''}` : 'riesgo propio'}${risk.proceso ? ` · proceso ${risk.proceso} · ${processes.get(risk.proceso) || ''}` : ''}`,
      `Causas: ${clip(risk.causas) || 'no registradas'}`,
      `Consecuencias: ${clip(risk.consecuencias) || 'no registradas'}`,
      `Control existente: ${clip(risk.control_existente?.descripcion) || 'no registrado'}${rating(risk.control_existente)}`,
      `Control propuesto: ${clip(risk.control_propuesto?.descripcion) || 'no registrado'}${rating(risk.control_propuesto)}`,
      `Valoración: probabilidad ${risk.probabilidad}, impacto empresa ${risk.impacto_empresa}, impacto personas ${risk.impacto_personas} → inherente ${level(risk.valoracion.inherente)}, actual ${level(risk.valoracion.actual)}, residual ${level(risk.valoracion.residual)}.`,
      ...(risk.origen === 'agente' ? ['Registrado a partir de la nota de campo, con apoyo de Vig-IA, y calificado por una persona.'] : []),
    ].map(item => clip(item, 1600)) });
  }
  if (risks.length > 60) paragraph(`El detalle de los riesgos R${risks[60].numero} en adelante está en el archivo del estudio (JSON) de esta versión.`);

  heading('7. Plan de tratamiento');
  const actions = snapshot.acciones.filter(action => action.estado !== 'descartada').slice(0, 80);
  if (actions.length) {
    blocks.push({ kind: 'table', header: ['Riesgo', 'Acción', 'Responsable', 'Fecha compromiso', 'Prioridad', 'Estado'], rows: actions.map(action => [
      riskNumber.has(action.riesgo) ? `R${riskNumber.get(action.riesgo)}` : '—', clip(action.accion, 600), clip(action.responsable) || 'Sin responsable',
      action.fecha_compromiso ? longDate(action.fecha_compromiso) : 'Sin fecha', PRIORIDAD[action.prioridad] || action.prioridad, ESTADO_ACCION[action.estado] || action.estado,
    ]) });
  } else paragraph('No hay acciones registradas.');

  heading('8. Evidencias');
  if (snapshot.evidencias.length) {
    blocks.push({ kind: 'table', header: ['Archivo', 'Riesgo', 'Tipo', 'Huella (sha256)'], rows: snapshot.evidencias.slice(0, 80).map(item => [
      clip(item.archivo, 200), riskNumber.has(item.riesgo) ? `R${riskNumber.get(item.riesgo)}` : 'General', item.tipo === 'documento' ? 'Documento' : 'Foto', String(item.sha256).slice(0, 16),
    ]) });
    paragraph('Las fotos y documentos están en la carpeta "evidencias", junto a este informe, con la misma huella.');
  } else paragraph('No se adjuntaron fotos ni documentos.');

  return {
    title: 'ESTUDIO DE SEGURIDAD FÍSICA',
    city_date: `${study.sede.ciudad || 'Colombia'}, ${longDate(meta.approvedAt)}`,
    subject: clip(`${study.codigo} · ${study.cliente.nombre} · ${study.sede.nombre} · versión ${meta.version}`, 400),
    blocks,
    signature: [meta.approverName || 'Aprobador', 'Aprobó la versión'],
  };
}
