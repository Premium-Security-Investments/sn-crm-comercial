// Estudios de Seguridad Física — el informe de una versión aprobada, al nivel del real de HADA (tramos 4 a 6).
//
// Se arma SIEMPRE desde la foto congelada de la versión (psi_security_study_versions.snapshot), nunca desde el estudio
// vivo. Sigue la estructura del informe que la empresa entrega hoy (ESTUDIO DE SEGURIDAD HADA 2026, docs/plans/
// 2026-11-04-estudios-seguridad-fisica-mvp.md §2.1): portada, índice, introducción con marco legal y metodología,
// caracterización de la sede, diagnóstico con evaluación general y medición comparativa, una ficha por riesgo con su
// foto y su mapa de calor, plan estratégico, mapa de criticidad general, cadena de mando, seguimiento y firma del
// analista. Cada sección sale sólo si hay datos; la evaluación general se calcula, no se escribe a mano (el PDF de
// HADA la dejó cortada).
//
// Devuelve el informe como DATOS para verticales/estudios-seguridad/render-informe.js. Aquí también se decide dónde
// queda el paquete en SharePoint: siempre bajo 99_Del_CRM/Estudios_de_Seguridad/.

import { METODOLOGIAS, METODOLOGIA_V1, nivelDeMagnitud } from './metodologia.js';
import { ESCALAS, PLANTILLAS, controlWord } from './plantilla.js';

export const ARCHIVE_BASE_PATH = '99_Del_CRM/Estudios_de_Seguridad';
const NIVEL = Object.freeze({ bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico', aceptable: 'Aceptable', tolerable: 'Tolerable', inaceptable: 'Inaceptable' });
// De más grave a menos grave; cada estudio sólo usa los niveles de su metodología.
const CONFIANZA = Object.freeze({ alta: 'Alta', media: 'Media', baja: 'Baja' });
const NIVEL_ORDER = ['critico', 'inaceptable', 'alto', 'tolerable', 'moderado', 'aceptable', 'bajo'];
const PRIORIDAD = Object.freeze({ alta: 'Alta', media: 'Media', baja: 'Baja' });
const ESTADO_ACCION = Object.freeze({ pendiente: 'Pendiente', en_curso: 'En curso', cumplida: 'Cumplida', descartada: 'Descartada' });
const MODALIDAD = Object.freeze({ vigilancia: 'Vigilancia', guia_canino: 'Guía canino', supervision: 'Supervisión', monitoreo: 'Monitoreo', otro: 'Otro' });
const CONTACTO = Object.freeze({ apoyo: 'Entidad de apoyo', empresa: 'Seguridad Nacional', interventor: 'Interventor del contrato' });
const PROPOSITO = Object.freeze({ mapa: 'Mapa', logo: 'Logo' });
const MAX_CELL = 1500;

const clip = (value, max = MAX_CELL) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const level = tramo => `${tramo.magnitud} · ${NIVEL[tramo.nivel] || tramo.nivel}${tramo.minimoPorImpacto ? ' (mínimo por impacto crítico)' : ''}`;
const bogota = (value, options) => {
  if (!value) return 'sin fecha';
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat('es-CO', { ...options, timeZone: 'America/Bogota' }).format(date);
};
const longDate = value => bogota(value, { dateStyle: 'long' });
const monthYear = value => {
  const text = bogota(value, { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const ratingWords = control => (control?.calidad ? [controlWord('calidad', control.calidad), controlWord('eficacia', control.eficacia), controlWord('eficiencia', control.eficiencia)].join(' · ') : '');
const rating = control => (control?.calidad ? ` (${ratingWords(control)})` : '');
const percent = value => `${Math.round(value * 1000) / 10} %`.replace('.', ',');

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
      name: `evidencias/${String(index + 1).padStart(2, '0')}_${item.riesgo && riskNumber.has(item.riesgo) ? `R${riskNumber.get(item.riesgo)}` : PROPOSITO[item.proposito] || 'General'}_${sharepointSafeName(item.archivo, 80)}`,
    })),
  };
}

/**
 * Mapa de calor 5×5 como tabla de colores: filas de probabilidad (Muy alta arriba), columnas de impacto. Cada celda
 * se colorea con el nivel de la metodología v1 para probabilidad × impacto y lista los códigos que caen en ella.
 */
export function heatmapBlock(marks, { compact = true, metodologia = METODOLOGIA_V1 } = {}) {
  const header = [{ text: 'Probabilidad / Impacto', axis: true }, ...ESCALAS.impacto.map(name => ({ text: name, axis: true }))];
  const rows = [];
  for (let probability = 5; probability >= 1; probability--) {
    const row = [{ text: ESCALAS.probabilidad[probability - 1], axis: true }];
    for (let impact = 1; impact <= 5; impact++) {
      const codes = marks.filter(mark => mark.probabilidad === probability && mark.impacto === impact).map(mark => mark.code);
      row.push({ text: codes.join(' '), level: nivelDeMagnitud(probability * impact, metodologia), bold: true, center: true });
    }
    rows.push(row);
  }
  return { kind: 'table', compact, header, rows };
}

/** La evaluación general, calculada: nunca queda a medias. */
export function generalEvaluation(risks) {
  if (!risks.length) return 'El estudio no tiene riesgos valorados.';
  const count = key => NIVEL_ORDER.map(nivel => [nivel, risks.filter(risk => risk.valoracion[key].nivel === nivel).length]).filter(([, n]) => n);
  const phrase = key => count(key).map(([nivel, n]) => `${n} en nivel ${NIVEL[nivel].toLowerCase()}`).join(', ');
  const actual = risks.reduce((sum, risk) => sum + risk.valoracion.actual.magnitud, 0);
  const residual = risks.reduce((sum, risk) => sum + risk.valoracion.residual.magnitud, 0);
  const worst = NIVEL_ORDER.find(nivel => risks.some(risk => risk.valoracion.residual.nivel === nivel));
  return `Con el dispositivo y los controles existentes, de los ${risks.length} riesgos identificados ${phrase('actual')}. `
    + `Al implementar los controles y acciones recomendados, el riesgo residual estimado quedaría con ${phrase('residual')}; `
    + `la magnitud total bajaría de ${actual} a ${residual} puntos (${percent(actual ? (actual - residual) / actual : 0)} menos) `
    + `y el nivel residual estimado más alto es ${NIVEL[worst].toLowerCase()}.`;
}

// Del plan estratégico de la sede Medellín (noviembre de 2026; Juan, 2026-11-11: "adelante con … las mejoras del
// informe"): tres grupos de prioridad según el nivel actual, con el criterio de seguimiento de cada uno.
// Con la guía (3 niveles) cada grupo es un nivel: inaceptable, tolerable y aceptable; con la v1, crítico, alto y el resto.
export const PRIORITY_GROUPS = Object.freeze([
  Object.freeze({ nombre: 'Atención preferente', niveles: ['critico', 'inaceptable'], criterio: 'Registrar acciones con responsable, fecha y evidencia de cierre, y volver a valorar.' }),
  Object.freeze({ nombre: 'Intervención programada', niveles: ['alto', 'tolerable'], criterio: 'Programar los controles propuestos y verificar su cumplimiento.' }),
  Object.freeze({ nombre: 'Mantenimiento preventivo', niveles: ['moderado', 'bajo', 'aceptable'], criterio: 'Mantener las medidas y vigilar los cambios del entorno.' }),
]);

/** Riesgos por grupo de prioridad, de mayor a menor magnitud actual. */
export function treatmentPriorities(risks, metodologia = METODOLOGIA_V1) {
  const own = new Set(metodologia.niveles.map(item => item.codigo));
  return PRIORITY_GROUPS.map(group => ({
    ...group,
    criterio: `Riesgo actual ${group.niveles.filter(code => own.has(code)).map(code => NIVEL[code].toLowerCase()).join(' o ')}. ${group.criterio}`,
    riesgos: risks.filter(risk => group.niveles.includes(risk.valoracion.actual.nivel))
      .sort((a, b) => b.valoracion.actual.magnitud - a.valoracion.actual.magnitud || a.numero - b.numero),
  }));
}

/**
 * La foto de la versión → el informe como datos. `meta`: { version, sha256, approvedAt, approverName, preparerName, reviewerName }.
 * `images`: { [evidenciaId]: { base64, mime, width, height } } — sólo las que el archivo pudo preparar (JPG/PNG
 * reducidos); una evidencia sin imagen preparada se cita por nombre y huella.
 */
// Migración 201: los antecedentes del puesto en SecurityOps, con fuente y fecha de corte. Sólo conteos y los reportes
// de riesgo escritos para esto («Alerta de Riesgos» y el «Estudio de seguridad» del historial del puesto).
const TIPO_NOVEDAD = { general: 'generales', seguridad: 'de seguridad', tecnologia: 'de tecnología', infraestructura: 'de infraestructura', dotacion: 'de dotación', panico: 'de pánico', judicializacion: 'de judicialización', otro: 'otras' };
const TIPO_VISITA = { supervision: 'de supervisión', aprovisionamiento: 'de aprovisionamiento', soporte_tecnico: 'de soporte técnico' };
const counts = (map, words) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n} ${words[key] || key}`).join(', ');

function secopsSource(secops, ref) {
  const match = /^securityops:(alerta|nota):(.+)$/.exec(String(ref || ''));
  if (!secops || !match) return null;
  const item = ((match[1] === 'alerta' ? secops.alertas : secops.notas) || []).find(entry => entry.id === match[2]);
  if (!item) return null;
  return match[1] === 'alerta'
    ? `la Alerta de Riesgos de SecurityOps del ${item.fecha ? longDate(item.fecha) : 'puesto'}`
    : `la nota «${item.titulo || 'Estudio de seguridad'}» del historial del puesto en SecurityOps${item.fecha ? ` (${longDate(item.fecha)})` : ''}`;
}

function secopsSection(secops, { h2, p, list, blocks }) {
  if (!secops) return;
  const r = secops.resumen || {};
  h2('Antecedentes operativos del puesto (SecurityOps)');
  p(clip(`Fuente: SecurityOps, puesto «${secops.puesto?.nombre || ''}»${secops.puesto?.direccion ? `, ${secops.puesto.direccion}` : ''}. Periodo: ${secops.ventana?.desde ? longDate(secops.ventana.desde) : '—'} a ${secops.ventana?.hasta ? longDate(secops.ventana.hasta) : '—'}; datos con corte al ${secops.corte ? longDate(secops.corte) : '—'}.`, 900));
  const rows = [
    ['Novedades reportadas', `${r.novedades?.total ?? 0}${r.novedades?.total ? ` (${counts(r.novedades.por_tipo, TIPO_NOVEDAD)})` : ''}`],
    ['Novedades de prioridad alta o crítica', String(r.novedades?.altas ?? 0)],
    ['Rondas registradas', `${r.rondas?.total ?? 0}${r.rondas?.completitud_promedio != null ? `, con ${r.rondas.completitud_promedio} % de puntos marcados en promedio` : ''}`],
    ['Visitas al puesto', `${r.visitas?.total ?? 0}${r.visitas?.total ? ` (${counts(r.visitas.por_tipo, TIPO_VISITA)})` : ''}${r.visitas?.ultima ? `; la última el ${longDate(r.visitas.ultima)}` : ''}`],
    ['Fallas de medios técnicos reportadas', `${r.fallas?.total ?? 0}${r.fallas?.abiertas ? `, ${r.fallas.abiertas} abiertas al corte` : ''}`],
    ['Visitas técnicas', String(r.visitas_tecnicas?.total ?? 0)],
  ];
  blocks.push({ kind: 'table', header: ['Indicador', 'Últimos 12 meses'], rows: rows.map(row => row.map(value => clip(value, 400))) });
  const failures = (secops.fallas || []).filter(item => item.titulo).slice(0, 12);
  if (failures.length) list(failures.map(item => clip(`${item.fecha ? longDate(item.fecha) : ''} · ${item.titulo}${item.abierta ? ' (abierta)' : ''}`, 300)));
  if (secops.alertas?.length) {
    h2('Alertas de riesgo reportadas en campo');
    blocks.push({ kind: 'table', header: ['Fecha', 'Riesgo', 'Descripción', 'Recomendaciones'], rows: secops.alertas.slice(0, 40).map(item => [item.fecha ? longDate(item.fecha) : '—', clip(item.riesgo, 300), clip(item.descripcion, 1200) || '—', clip(item.recomendaciones, 1200) || '—']) });
  }
  if (secops.notas?.length) {
    h2('Notas de coordinación para el estudio');
    for (const note of secops.notas.slice(0, 20)) {
      p(clip(`${note.fecha ? `${longDate(note.fecha)} · ` : ''}${note.titulo || 'Estudio de seguridad'}${note.realizado_por ? ` — ${note.realizado_por}` : ''}`, 400));
      if (note.detalle) p(clip(note.detalle, 4000));
      if (note.recomendaciones) p(clip(`Recomendaciones: ${note.recomendaciones}`, 4000));
    }
  }
}

// Los cargos del flujo (Juan, 2026-11-11): prepara el analista de riesgos, revisa el coordinador, aprueba el jefe de
// operaciones.
export const SIGNATURE_ROLES = Object.freeze({ elaboro: 'Analista de riesgos', reviso: 'Coordinador', aprobo: 'Jefe de operaciones' });

// El párrafo de metodología dice la regla con que se calculó ESTE estudio.
function methodologyText(id) {
  const scales = `probabilidad (${ESCALAS.probabilidad.join(', ')}) e impacto (${ESCALAS.impacto.join(', ')}), de 1 a 5`;
  if (METODOLOGIAS[id]?.probabilidadResidualEscogida) {
    return `Metodología ${id}. Sigue los principios y el proceso de gestión del riesgo de la NTC-ISO 31000:2018 y usa técnicas de apreciación del riesgo descritas en la NTC-IEC/ISO 31010 (adopción de IEC 31010:2019): listas de verificación, análisis de controles y matriz de consecuencia y probabilidad con escalas definidas, junto con la guía de calificación de la matriz 5 × 5 de Seguridad Nacional. Estas normas son guías y no son certificables; este documento no constituye una certificación. Matriz cruzada de ${scales}. Cada nivel de probabilidad tiene un significado definido: ${ESCALAS.probabilidadSignificado.map((text, index) => `${index + 1}, ${text}`).join('; ')}. La plataforma sugiere la probabilidad con la estadística de delitos de la zona y las novedades registradas en el puesto durante 12 meses; cuando el analista escoge otra, deja escrito por qué, y cada calificación declara su nivel de confianza y sus supuestos. La valoración inicial es probabilidad × impacto. Cada control se califica por su calidad, su eficacia y su eficiencia, de 1 a 5; su efectividad es calidad × eficacia × eficiencia ÷ 125. El riesgo actual es la valoración inicial descontada una vez por la efectividad del control existente, redondeada al entero superior. El riesgo residual es la probabilidad residual que se espera después de implementar los controles propuestos, multiplicada por el mismo impacto: es una estimación, no un resultado verificado. Las magnitudes van de 1 a 25 y sirven para ordenar los riesgos, no como una medida exacta. Niveles: 1 a 6 aceptable, 7 a 14 tolerable y 15 a 25 inaceptable; un riesgo de impacto crítico (5) es como mínimo tolerable y lleva plan de contingencia, aunque sea poco probable.`;
  }
  return `Metodología ${id}, basada en la NTC-ISO 31000 de 2018: matriz cruzada de probabilidad por impacto. Cada riesgo se califica con una ${scales}, con dos impactos (sobre la empresa o sede y sobre las personas; cuenta el mayor). Cada control se califica por su calidad, su eficacia y su eficiencia, de 1 a 5; su efectividad (producto / 125, con tope del 90 %) reduce la probabilidad una sola vez. El riesgo actual considera los controles existentes; el residual, además, los controles propuestos: es una estimación de lo que se espera al implementarlos, no un resultado verificado. Niveles: 1 a 5 bajo, 6 a 10 moderado, 11 a 15 alto y 16 a 25 crítico.`;
}

export function buildStudyReport(snapshot, meta, images = {}) {
  const study = snapshot.estudio;
  const metodologia = METODOLOGIAS[study.metodologia] || METODOLOGIA_V1;
  const heatmap = marks => heatmapBlock(marks, { metodologia });
  const template = PLANTILLAS[study.plantilla];
  const catalog = new Map((template?.riesgos || []).map(item => [item.codigo, item.nombre]));
  const zones = new Map(snapshot.zonas.map(zone => [zone.id, zone.nombre]));
  const risks = [...snapshot.riesgos].sort((a, b) => a.numero - b.numero);
  const riskNumber = new Map(risks.map(risk => [risk.id, risk.numero]));
  const caracter = snapshot.caracterizacion || {};
  const stats = snapshot.estadistica || [];
  const contacts = snapshot.contactos || [];
  const posts = snapshot.dispositivo || [];
  const evidence = snapshot.evidencias || [];
  const imageOf = item => (item && images[item.id] ? { kind: 'image', ...images[item.id] } : null);
  const logo = evidence.filter(item => item.proposito === 'logo').map(imageOf).filter(Boolean).pop();
  const maps = evidence.filter(item => item.proposito === 'mapa');
  const clientName = study.cliente.nombre;
  const blocks = [];
  const h1 = text => blocks.push({ kind: 'h1', text });
  const h2 = text => blocks.push({ kind: 'h2', text });
  const p = text => blocks.push({ kind: 'paragraph', text });
  const list = items => { if (items.length) blocks.push({ kind: 'list', items: items.slice(0, 100) }); };
  const contents = [];
  const chapter = title => { contents.push(title); h1(title); };

  // Portada.
  if (logo) blocks.push({ ...logo, maxWidthIn: 4.2, maxHeightIn: 2.8 });
  blocks.push({ kind: 'center', text: monthYear(meta.approvedAt), cover: true });
  blocks.push({ kind: 'center', text: 'ESTUDIO DE SEGURIDAD FÍSICA', large: true, bold: true });
  blocks.push({ kind: 'center', text: 'Plan Estratégico de Seguridad y Gestión de Riesgos', cover: true, bold: true });
  blocks.push({ kind: 'center', text: `Para la empresa ${clientName}`, cover: true, bold: true });
  blocks.push({ kind: 'center', text: [study.sede.nombre, study.sede.ciudad].filter(Boolean).join(' · '), cover: true });
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'center', text: 'Elaborado por la Dirección Nacional de Operaciones y Gestión de Riesgos — Seguridad Nacional Ltda.', cover: true });
  blocks.push({ kind: 'center', text: `${study.codigo} · versión ${meta.version} · aprobada el ${longDate(meta.approvedAt)}`, cover: true });
  const indexAt = blocks.length;
  blocks.push({ kind: 'page_break' });

  // Introducción.
  chapter('Introducción');
  if (caracter.descripcion_cliente) p(clip(caracter.descripcion_cliente, 5000));
  h2('Objetivo');
  p(`El presente estudio, realizado por Seguridad Nacional Ltda., tiene como objetivo definir las estrategias conjuntas necesarias para disminuir los riesgos a los que están expuestos el personal, los procesos y los activos de ${clientName}, a fin de apoyar las actividades de prevención y de gestión de riesgos que aseguren operaciones seguras, disminuyan la materialización de los riesgos y permitan la continuidad del negocio.`);
  h2('Objetivos específicos');
  list([
    'Determinar la probabilidad de ocurrencia de cada riesgo, así como su impacto y sus consecuencias.',
    'Identificar los riesgos que pueden afectar a las personas, las instalaciones, la información y los activos.',
    'Valorar la efectividad de los controles existentes y proponer los controles y acciones que reduzcan el riesgo.',
    'Facilitar el diseño de un plan de protección integral y de su seguimiento.',
    'Identificar la respuesta ante las posibles amenazas con el apoyo de la Fuerza Pública y del esquema de seguridad privada.',
  ]);
  h2('Alcance');
  p(clip(study.alcance, 5000) || `El estudio cubre las instalaciones de ${clientName} en ${study.sede.nombre}.`);
  h2('Marco legal');
  list([
    'Decreto 356 de 1994, Estatuto de Vigilancia y Seguridad Privada.',
    'Decreto 1072 de 2015, Sistema de Gestión de la Seguridad y Salud en el Trabajo.',
    'Norma ISO 45001 de 2018, Seguridad y Salud en el Trabajo.',
    'Norma NTC-ISO 31000 de 2018, Gestión del Riesgo.',
    'Norma NTC-IEC/ISO 31010, Técnicas de evaluación del riesgo (adopción de IEC 31010:2019).',
    'Ley 1581 de 2012 y Decreto 1377 de 2013, protección de datos personales.',
  ]);
  h2('Metodología');
  p(methodologyText(study.metodologia));
  blocks.push(heatmap([]));
  blocks.push({ kind: 'center', text: 'Niveles de riesgo según probabilidad e impacto.', cover: false });

  // Capítulo I-A: caracterización.
  chapter('Contexto externo e interno');
  if (caracter.ubicacion) { h2('Ubicación y vía de aproximación'); p(clip(caracter.ubicacion, 5000)); }
  if (caracter.latitud != null && caracter.longitud != null) p(`Coordenadas: ${caracter.latitud}, ${caracter.longitud}.`);
  for (const item of maps) {
    const img = imageOf(item);
    if (img) blocks.push({ ...img, maxWidthIn: 6.2, maxHeightIn: 4.6, caption: clip(item.leyenda || 'Ubicación de las instalaciones.', 300) });
  }
  if (caracter.contexto_externo) { h2('Contexto externo'); p(clip(caracter.contexto_externo, 5800)); }
  if (stats.length) {
    blocks.push({ kind: 'table', header: ['Delito', 'Cantidad', 'Fuente', 'Fecha de corte'], rows: stats.slice(0, 60).map(row => [clip(row.delito, 160), Number(row.cantidad).toLocaleString('es-CO'), clip(row.fuente, 300), row.fecha_corte ? longDate(row.fecha_corte) : '—']) });
  }
  if (caracter.grupos_delincuenciales) { h2('Grupos y organizaciones delincuenciales'); p(clip(caracter.grupos_delincuenciales, 5000)); }
  if (caracter.fuentes?.length) { h2('Fuentes'); list(caracter.fuentes.slice(0, 15).map(fuente => clip(`${fuente.nombre}${fuente.fecha ? ` (${longDate(fuente.fecha)})` : ''}${fuente.url ? ` · ${fuente.url}` : ''}`, 600))); }
  if (caracter.contexto_interno) { h2('Contexto interno'); p(clip(caracter.contexto_interno, 5800)); }
  secopsSection(snapshot.securityops, { h2, p, list, blocks });
  const support = contacts.filter(row => row.tipo === 'apoyo');
  if (support.length) {
    h2('Entidades de apoyo');
    blocks.push({ kind: 'table', header: ['Entidad', 'Detalle', 'Teléfono'], rows: support.slice(0, 60).map(row => [clip(row.entidad, 160), clip(row.detalle) || '—', clip(row.telefono) || '—']) });
  }
  if (posts.length) {
    h2('Dispositivo de seguridad');
    blocks.push({ kind: 'table', header: ['Servicio', 'Modalidad', 'Horario', 'Armado', 'Cantidad'], rows: posts.slice(0, 60).map(row => [
      clip(row.servicio, 200), MODALIDAD[row.modalidad] || row.modalidad, clip(row.horario) || '—', row.armado === true ? 'Sí' : row.armado === false ? 'No' : '—', String(row.cantidad),
    ]) });
  }
  const clientProcesses = [...new Set(risks.map(risk => risk.proceso_cliente).filter(Boolean))];
  if (clientProcesses.length) { h2('Procesos internos analizados'); p(`Se analizaron ${clientProcesses.length} procesos de ${clientName}:`); list(clientProcesses.map(item => clip(item, 120))); }

  // Capítulo I-B: diagnóstico.
  chapter('Diagnóstico y evaluación de riesgos');
  h2('Identificación de riesgos');
  p(`Se identificaron ${risks.length} riesgos en ${new Set(risks.map(risk => risk.zona).filter(Boolean)).size || 'los'} escenarios físicos${clientProcesses.length ? ` y ${clientProcesses.length} procesos` : ''}.`);
  list(risks.map(risk => clip(`R${risk.numero}. ${risk.riesgo}`, 300)));
  h2('Evaluación general');
  p(generalEvaluation(risks));
  if (risks.length) {
    h2('Medición comparativa del riesgo');
    blocks.push({ kind: 'table', header: ['Código', 'Proceso', 'Riesgo', 'Actual', 'Residual estimado', 'Reducción', 'Resultado'], rows: risks.slice(0, 120).map(risk => {
      const actual = risk.valoracion.actual.magnitud;
      const residual = risk.valoracion.residual.magnitud;
      return [`R${risk.numero}`, clip(risk.proceso_cliente) || '—', clip(risk.riesgo, 200), { text: level(risk.valoracion.actual), level: risk.valoracion.actual.nivel }, { text: level(risk.valoracion.residual), level: risk.valoracion.residual.nivel },
        `${actual - residual} (${percent(actual ? (actual - residual) / actual : 0)})`, residual < actual ? 'Disminuiría' : 'Se mantiene'];
    }) });
  }

  // Fichas: una por riesgo, como en el informe real.
  for (const risk of risks) {
    blocks.push({ kind: 'page_break' });
    h1(clip(`R${risk.numero} · ${risk.riesgo}`, 300));
    const ce = risk.control_existente || {};
    blocks.push({ kind: 'table', header: ['Dato', 'Valor'], rows: [
      ['Escenario físico', zones.get(risk.zona) || 'Sin zona'],
      ['Proceso', risk.proceso_cliente || '—'],
      ['Factor de riesgo', risk.factor || '—'],
      ['Riesgo del catálogo', risk.catalogo ? `${risk.catalogo} · ${catalog.get(risk.catalogo) || ''}` : 'Riesgo propio'],
      ['Probabilidad actual · impacto', `${ESCALAS.probabilidad[risk.valoracion.actual.probabilidad - 1]} (${risk.valoracion.actual.probabilidad}) · ${ESCALAS.impacto[risk.valoracion.impacto - 1]} (${risk.valoracion.impacto})`],
      ['Valoración inicial (probabilidad × impacto)', String(risk.valoracion.inherente?.magnitud ?? risk.valoracion.actual.probabilidad * risk.valoracion.impacto)],
      ...(METODOLOGIAS[study.metodologia]?.probabilidadResidualEscogida ? [
        ['Probabilidad sugerida por los datos', risk.probabilidad_sugerida ? `${risk.probabilidad_sugerida} · ${ESCALAS.probabilidadSignificado[risk.probabilidad_sugerida - 1]}` : 'Sin dato de respaldo: juicio del analista'],
        ...(risk.justificacion_probabilidad ? [['Por qué esta probabilidad', risk.justificacion_probabilidad]] : []),
        ['Confianza de la calificación', CONFIANZA[risk.confianza] || 'Sin declarar'],
        ...(risk.supuestos ? [['Supuestos', risk.supuestos]] : []),
      ] : []),
      ['Calidad · eficacia · eficiencia del control', ratingWords(ce) || 'Sin calificar'],
      ['Efectividad del control existente', percent(risk.valoracion.actual.efectividadControl)],
      ['Magnitud del riesgo actual', { text: level(risk.valoracion.actual), level: risk.valoracion.actual.nivel }],
      ['Magnitud del riesgo residual (estimada)', { text: level(risk.valoracion.residual), level: risk.valoracion.residual.nivel }],
    ].map(row => row.map(value => (typeof value === 'string' ? clip(value, 400) : value))) });
    const photos = evidence.filter(item => item.riesgo === risk.id && item.tipo === 'foto');
    const photo = photos.map(imageOf).find(Boolean);
    if (photo) blocks.push({ ...photo, maxWidthIn: 3.8, maxHeightIn: 2.4, caption: clip(photos.find(item => images[item.id])?.leyenda || 'Foto de evidencia.', 300) });
    const impact = risk.valoracion.impacto;
    blocks.push(heatmap([
      { probabilidad: risk.valoracion.actual.probabilidad, impacto: impact, code: `R${risk.numero}` },
      { probabilidad: risk.valoracion.residual.probabilidad, impacto: impact, code: `R${risk.numero}R` },
    ]));
    blocks.push({ kind: 'center', text: `Mapa del riesgo: R${risk.numero} actual y R${risk.numero}R residual estimado.` });
    h2('Controles actuales y existentes');
    p(clip(ce.descripcion, 5000) || 'No se registraron controles existentes.');
    h2('Causas de materialización del riesgo');
    p(clip(risk.causas, 5000) || 'No registradas.');
    if (risk.consecuencias) { h2('Consecuencias'); p(clip(risk.consecuencias, 5000)); }
    h2('Recomendaciones de seguridad');
    const actions = snapshot.acciones.filter(action => action.riesgo === risk.id && action.estado !== 'descartada');
    const recommendations = [
      ...(risk.control_propuesto?.descripcion ? [`${clip(risk.control_propuesto.descripcion, 1500)}${rating(risk.control_propuesto)}`] : []),
      ...actions.map(action => clip(`${action.accion} — ${action.responsable || 'sin responsable'}, ${action.fecha_compromiso ? longDate(action.fecha_compromiso) : 'sin fecha'}`, 1600)),
    ];
    if (recommendations.length) list(recommendations); else p('Sin recomendaciones registradas.');
    if (risk.origen === 'agente') blocks.push({ kind: 'center', text: 'Registrado a partir de la nota de campo, con apoyo de Vig-IA, y calificado por una persona.' });
    if (risk.origen === 'securityops') {
      const source = secopsSource(snapshot.securityops, risk.fuente);
      blocks.push({ kind: 'center', text: clip(`Registrado a partir de ${source || 'un reporte de SecurityOps'}, y calificado por una persona.`, 400) });
    }
  }

  // Capítulo I-C: plan estratégico.
  blocks.push({ kind: 'page_break' });
  chapter('Diseño del plan estratégico de seguridad');
  h2('1. Reducir la probabilidad del riesgo');
  list(['Diseñar y adecuar las políticas para el control de personal propio, tercerizado y ocasional.', 'Implementar las mejoras humanas, físicas, tecnológicas y procedimentales recomendadas en cada riesgo.']);
  h2('2. Mitigar las consecuencias del riesgo');
  list(['Diseñar, socializar y verificar los protocolos de atención inmediata ante eventos indeseados o perturbadores.', 'Revisar y ajustar los planes de emergencia, contingencia y continuidad del negocio, con simulacros y pruebas de vulnerabilidad.', 'Coordinar y establecer alianzas con las autoridades y entidades de apoyo.']);
  h2('3. Mantener y controlar el nivel de criticidad');
  list(['Implementar indicadores de gestión para el control y seguimiento de la operación de seguridad.', 'Realizar comités de seguridad para evaluar los avances del plan.']);
  h2('Priorización del tratamiento');
  blocks.push({ kind: 'table', header: ['Prioridad', 'Riesgos', 'Criterio de seguimiento'], rows: treatmentPriorities(risks, metodologia).map(group => [
    group.nombre, group.riesgos.length ? clip(group.riesgos.map(risk => `R${risk.numero} (${risk.valoracion.actual.magnitud})`).join(', '), 800) : 'Ninguno', group.criterio,
  ]) });
  const plan = snapshot.acciones.filter(action => action.estado !== 'descartada').slice(0, 120);
  if (plan.length) {
    h2('Plan de tratamiento');
    blocks.push({ kind: 'table', header: ['Riesgo', 'Acción', 'Responsable', 'Fecha compromiso', 'Prioridad', 'Estado'], rows: plan.map(action => [
      riskNumber.has(action.riesgo) ? `R${riskNumber.get(action.riesgo)}` : '—', clip(action.accion, 600), `${clip(action.responsable) || 'Sin responsable'}${action.a_cargo === 'cliente' ? ' (cliente)' : ''}`,
      action.fecha_compromiso ? longDate(action.fecha_compromiso) : 'Sin fecha', PRIORIDAD[action.prioridad] || action.prioridad, ESTADO_ACCION[action.estado] || action.estado,
    ]) });
  }

  h2('Control documental y trazabilidad');
  p('El cumplimiento del plan se demuestra con evidencia, no con la declaración de que la medida se tomó. Para cerrar cada acción se espera, según corresponda:');
  list([
    'Actas de inspección, revisión y mantenimiento de la infraestructura y de los sistemas tecnológicos.',
    'Registros de ingreso y salida, manejo de visitantes, inventarios y custodia documental.',
    'Pruebas funcionales de los sistemas de alarma, videovigilancia y comunicaciones.',
    'Registros de capacitación, simulacros y socialización de protocolos.',
    'Fotografías o soportes del antes y el después de la medida implementada.',
  ]);
  p('Cada acción con responsable y fecha queda como compromiso en el Seguimiento gerencial del SIIO hasta su cierre con evidencia. Un cambio de calificación de un riesgo se hace en una nueva versión de este estudio, que conserva la anterior con su huella.');

  chapter('Mapa de criticidad general');
  h2('Riesgo actual');
  blocks.push(heatmap(risks.map(risk => ({ probabilidad: risk.valoracion.actual.probabilidad, impacto: risk.valoracion.impacto, code: `${risk.numero}A` }))));
  h2('Riesgo residual estimado');
  blocks.push(heatmap(risks.map(risk => ({ probabilidad: risk.valoracion.residual.probabilidad, impacto: risk.valoracion.impacto, code: `${risk.numero}R` }))));
  blocks.push({ kind: 'center', text: 'Los números corresponden al código de cada riesgo (A: actual, R: residual estimado si se implementan los controles propuestos).' });

  // Cadena de mando y seguimiento.
  chapter('Escalonamiento o cadena de mando');
  p(`El personal del servicio de vigilancia, o en su defecto quien detecte la novedad, informará de inmediato al responsable designado por ${clientName}, que reportará el hecho al área a cargo del esquema de seguridad y solicitará el apoyo pertinente; de ser necesario, se solicitará el acompañamiento de las autoridades competentes. El manejo de la situación lo hará el esquema de seguridad, a través del coordinador operativo del contrato por parte de Seguridad Nacional Ltda., con línea directa con el interventor del contrato por parte de ${clientName}, con manejo confidencial de la información.`);
  const chain = contacts.filter(row => row.tipo !== 'apoyo');
  if (chain.length) {
    blocks.push({ kind: 'table', header: ['Quién', 'Cargo o detalle', 'Teléfono', 'Correo'], rows: chain.slice(0, 40).map(row => [`${CONTACTO[row.tipo]}: ${clip(row.entidad, 160)}`, clip(row.detalle) || '—', clip(row.telefono) || '—', clip(row.correo) || '—']) });
  }
  chapter('Informes, registro y seguimiento');
  p(`Una vez socializado el estudio en comité de seguridad con las directivas de ${clientName}, se dispondrá de un plan de trabajo conjunto para su seguimiento. Los avances se revisarán de manera bimensual en comité de seguridad, con base en el plan de tratamiento y en los indicadores de gestión.`);

  if (evidence.length) {
    h2('Evidencias del estudio');
    blocks.push({ kind: 'table', header: ['Archivo', 'Riesgo', 'Tipo', 'Huella (sha256)'], rows: evidence.slice(0, 120).map(item => [
      clip(item.archivo, 200), riskNumber.has(item.riesgo) ? `R${riskNumber.get(item.riesgo)}` : PROPOSITO[item.proposito] || 'General', item.tipo === 'documento' ? 'Documento' : 'Foto', String(item.sha256).slice(0, 16),
    ]) });
    p('Todas las fotos y documentos están en la carpeta "evidencias" junto a este informe, con la misma huella.');
  }

  p(`Se reitera la voluntad de servicio y el compromiso de Seguridad Nacional Ltda. con ${clientName}, como socios estratégicos en soluciones integrales de seguridad.`);
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'signature', text: 'Cordialmente,' });
  blocks.push({ kind: 'spacer' });
  // Firma quien aprueba (jefe de operaciones); el informe dice también quién lo elaboró y quién lo revisó.
  blocks.push({ kind: 'signature', text: `**${meta.approverName || 'Sin nombre registrado'}**\n${SIGNATURE_ROLES.aprobo} — Seguridad Nacional Ltda.` });
  blocks.push({ kind: 'spacer' });
  blocks.push({ kind: 'signature', text: `Elaboró: ${meta.preparerName || 'sin nombre registrado'}, ${SIGNATURE_ROLES.elaboro.toLowerCase()}.\nRevisó: ${meta.reviewerName || 'sin nombre registrado'}, ${SIGNATURE_ROLES.reviso.toLowerCase()}.\nAprobó la versión ${meta.version}: ${meta.approverName || 'sin nombre registrado'}, ${SIGNATURE_ROLES.aprobo.toLowerCase()}.\nHuella de la versión (sha256): ${meta.sha256}` });

  // Índice después de la portada, con los capítulos que sí salieron.
  blocks.splice(indexAt + 1, 0, { kind: 'h1', text: 'Contenido' }, { kind: 'list', items: [...contents.map((title, index) => `${index + 1}. ${title}`), ...(risks.length ? [`Fichas de riesgo: R1 a R${risks.length}`] : [])] }, { kind: 'page_break' });

  return { blocks };
}
