// Mejora 11 (Juan, 2026-11-10: «deje eso así organizado en el plan»; 2026-11-11: «vamos con su orden»; migración 203).
//
// La carpeta de radicación estándar de cada proceso, revisada contra 20 procesos en SharePoint: la plantilla de octubre
// (8 raíces, ~20 subcarpetas) quedó casi vacía donde se usó, porque el análisis, la matriz y la Mesa viven en el CRM. En
// SharePoint va sólo lo que el CRM no guarda: la oferta. Lo que funcionó en Terminal fue Borradores → PARA RADICAR →
// Radicado; Competidores se queda porque con los Anexos 9 de Terminal se estimó el precio de mercado.
//
// Módulo puro: la estructura, el índice de 03_PARA_RADICAR y la comparación con 04_Radicado. Quien escribe en SharePoint
// es el trabajo del servidor (ops/agt002-sharepoint-bridge), con sus guardas: nunca sobrescribe y relee lo que escribe.

export const FILING_STRUCTURE = Object.freeze([
  { folder: '01_Observaciones', leeme: 'Las observaciones que presentamos al pliego y las respuestas de la Entidad.' },
  { folder: '02_Borradores', leeme: 'Anexos y documentos en trabajo. Lo que esté aquí NO se radica.' },
  { folder: '03_PARA_RADICAR', leeme: 'Sólo lo final y firmado, listo para subir a SECOP, en sus subcarpetas. El índice y lo que falta se ven en el CRM, pestaña Preparar del proceso.' },
  { folder: '03_PARA_RADICAR/01_Anexos_firmados', leeme: 'Los anexos y formatos del pliego, diligenciados y firmados.' },
  { folder: '03_PARA_RADICAR/02_Juridicos', leeme: 'Existencia y representación, RUT, antecedentes, REDAM, certificaciones jurídicas.' },
  { folder: '03_PARA_RADICAR/03_Financieros_y_RUP', leeme: 'RUP vigente, estados financieros y lo que pida la capacidad financiera.' },
  { folder: '03_PARA_RADICAR/04_Tecnicos_habilitantes', leeme: 'Licencias, resoluciones de la Superintendencia, permisos de comunicaciones y demás requisitos técnicos.' },
  { folder: '03_PARA_RADICAR/05_Experiencia', leeme: 'Los certificados de los contratos que se acreditan como experiencia.' },
  { folder: '03_PARA_RADICAR/06_Ponderables', leeme: 'Lo que da puntaje: certificaciones de calidad, factores diferenciales y demás.' },
  { folder: '03_PARA_RADICAR/07_Garantia', leeme: 'La garantía de seriedad de la oferta y su recibo de pago.' },
  { folder: '04_Radicado', leeme: 'Lo que efectivamente quedó subido en SECOP, bajado después del cierre. El CRM lo compara con 03_PARA_RADICAR.' },
  { folder: '05_Competidores', leeme: 'Ofertas y anexos económicos de los demás oferentes, para leer la competencia y el precio de mercado.' },
]);
export const FILING_LEEME_NAME = '00_LEEME.md';
export const PARA_RADICAR = '03_PARA_RADICAR';
export const RADICADO = '04_Radicado';
// Sólo los GO registrados desde que existe la mejora; los procesos viejos, con el botón.
export const FILING_GO_CUTOFF = '2026-11-11T18:00:00Z';

/** El texto del 00_LEEME de una carpeta. */
export function filingLeeme({ folder, leeme }, { processLabel }) {
  return `# ${folder.split('/').pop()}\n\n${leeme}\n\nProceso: ${processLabel}\n\nCarpeta creada por la plataforma (mejora 11). No se borra ni se reemplaza nada de lo que haya aquí.\n`;
}

/** El nombre de la carpeta del proceso cuando no existe: «ENTIDAD - REFERENCIA», como las de 03_Procesos_Activos. */
export function filingProcessFolderName(tender) {
  const clean = value => String(value || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = [clean(tender?.entity).toUpperCase(), clean(tender?.ref)].filter(Boolean).join(' - ');
  return name.slice(0, 180) || null;
}

const SUBFOLDERS = FILING_STRUCTURE.filter(entry => entry.folder.startsWith(`${PARA_RADICAR}/`)).map(entry => entry.folder.split('/')[1]);
const isLeeme = name => /^00_(LEEME|INDICE)/i.test(String(name || ''));

/**
 * El índice de 03_PARA_RADICAR: por subcarpeta, los archivos (sin los LEEME), y las subcarpetas vacías. `files` es la
 * salida del inventario ({ ruta, nombre, bytes, modificado_en }) con rutas relativas a la carpeta del proceso. Pura.
 */
export function buildFilingIndex(files) {
  const all = (Array.isArray(files) ? files : []).filter(file => !isLeeme(file?.nombre));
  const inPara = all.filter(file => String(file.ruta || '').startsWith(`${PARA_RADICAR}/`));
  const sections = SUBFOLDERS.map(sub => {
    const items = inPara.filter(file => String(file.ruta).startsWith(`${PARA_RADICAR}/${sub}/`))
      .map(file => ({ nombre: file.nombre, bytes: file.bytes || 0, modificado_en: file.modificado_en || null }));
    return { carpeta: sub, archivos: items };
  });
  const loose = inPara.filter(file => !SUBFOLDERS.some(sub => String(file.ruta).startsWith(`${PARA_RADICAR}/${sub}/`)))
    .map(file => ({ nombre: file.nombre, bytes: file.bytes || 0, modificado_en: file.modificado_en || null }));
  return { secciones: sections, sueltos: loose, vacias: sections.filter(section => !section.archivos.length).map(section => section.carpeta), total: inPara.length };
}

/**
 * La clave para comparar un documento preparado con el radicado: sin extensión, sin el «_1»/«_2» que agrega SECOP al
 * bajarlo, sin tildes ni signos (en Terminal se preparó «ANEXO_01…docx» y se radicó «ANEXO_01…_1.pdf»).
 */
export function filingKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '').replace(/[_\s-]+\d$/, '').replace(/[^a-z0-9]+/g, '');
}

/** Lo preparado contra lo radicado: qué no se radicó, qué se radicó sin estar preparado y qué coincide. Pura. */
export function compareFiling(files) {
  const all = (Array.isArray(files) ? files : []).filter(file => !isLeeme(file?.nombre));
  const prepared = all.filter(file => String(file.ruta || '').startsWith(`${PARA_RADICAR}/`));
  const filed = all.filter(file => String(file.ruta || '').startsWith(`${RADICADO}/`));
  if (!filed.length) return null;
  const filedKeys = new Map(filed.map(file => [filingKey(file.nombre), file]));
  const preparedKeys = new Map(prepared.map(file => [filingKey(file.nombre), file]));
  return {
    preparados: prepared.length,
    radicados: filed.length,
    coinciden: prepared.filter(file => filedKeys.has(filingKey(file.nombre))).length,
    no_radicados: prepared.filter(file => !filedKeys.has(filingKey(file.nombre))).map(file => ({ nombre: file.nombre, carpeta: String(file.ruta).split('/')[1] || null })),
    radicados_sin_preparar: filed.filter(file => !preparedKeys.has(filingKey(file.nombre))).map(file => ({ nombre: file.nombre })),
  };
}

/** La fotografía que se guarda: el índice y, si ya hay radicado, la comparación. Pura. */
export function filingSnapshot(files, { observedAt }) {
  return { observado_en: observedAt, indice: buildFilingIndex(files), comparacion: compareFiling(files) };
}
