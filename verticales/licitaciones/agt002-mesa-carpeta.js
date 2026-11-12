// La carpeta del proceso para la Mesa (Juan, 2026-11-12: «Mesa y Vig-IA deben ser iguales a usted»). Arma, desde la
// base, el texto completo de los documentos vigentes de una licitación, ordenado por lo que es cada uno, con un índice
// al principio. El puente la escribe en disco y el modelo la recorre con buscar, leer y listar, como el agente de código.
import { selectCanonicalExtractionsByDocumentVersion } from './tender-document-extraction-persistence.js';
import { AGT002_CARPETA_MAX_ARCHIVOS, AGT002_CARPETA_MAX_BYTES } from '../../agt002-mesa-carpeta-contrato.js';
import { armarAgt002FichaDelProceso, armarAgt002IndiceDeProcesos } from './agt002-ficha-del-proceso.js';
import { esDocumentoDeRespuestas, leerAgt002RespuestasPorObservacion, respuestasPorObservacionMarkdown } from './agt002-respuestas-por-observacion.js';

// Lo que manda primero. Las respuestas, actas e informes de la entidad hoy se clasifican como «otro»: el nombre los separa.
const CARPETAS = Object.freeze([
  ['01_reglas_pliego_y_adendas', doc => doc.document_type === 'pliego' || doc.document_type === 'adenda'],
  ['02_respuestas_actas_e_informes', doc => doc.origin !== 'propio' && doc.origin !== 'tercero' && /respuesta|observaci|acta|informe|evaluaci|resoluci/i.test(doc.name)],
  ['03_anexos_y_formatos', doc => doc.document_type === 'anexo_tecnico' || doc.document_type === 'formatos'],
  ['04_estudios_previos', doc => doc.document_type === 'estudios_previos'],
  ['05_nuestro', doc => doc.origin === 'propio'],
  ['06_terceros', doc => doc.origin === 'tercero'],
  ['07_otros', () => true],
]);
const PRIORIDAD_AL_RECORTAR = ['06_terceros', '07_otros', '04_estudios_previos', '03_anexos_y_formatos', '05_nuestro', '02_respuestas_actas_e_informes'];
// El índice de la carpeta, la ficha y el índice de procesos abiertos van aparte del tope de los documentos.
const MARGEN_INDICE_BYTES = 256 * 1024;

// La política base de la Mesa prohíbe toda herramienta; con carpeta esa regla se cambia por ésta. En producción
// (DEAJ, 12-nov) el modelo obedeció la prohibición, no buscó y repitió el fragmento cortado.
export const AGT002_SIN_HERRAMIENTAS = 'No uses herramientas, navegación, correo, mensajería, archivos externos ni acciones fuera de esta generación estructurada.';
export const AGT002_SOLO_LECTURA_DE_LA_CARPETA = 'Sólo puedes usar las herramientas de lectura (Grep para buscar, Read para leer, Glob para listar) sobre la carpeta del proceso que está en tu directorio de trabajo; no uses navegación, correo, mensajería ni acciones fuera de esta generación estructurada.';

export const AGT002_CARPETA_POLICY = [
  'CARPETA DEL PROCESO. Tu directorio de trabajo tiene el texto completo de todos los documentos vigentes de esta licitación. Empieza por 00_FICHA.md (estado, decisiones de las personas, cronograma y pendientes de este proceso), sigue con 00_INDICE.md (qué documentos hay) y usa 00_PROCESOS_ABIERTOS.md cuando la pregunta toque otras licitaciones o el conjunto. Lo que una persona dijo en la ficha es un hecho del proceso, no lo vuelvas a preguntar.',
  'Antes de responder busca SIEMPRE en la carpeta, aunque context_links o fuentes_resueltas ya traigan fragmentos: esos fragmentos son recortes, pueden venir cortados o mezclar dos columnas, y si un fragmento y la carpeta no coinciden, manda la carpeta.',
  'Trabaja como un analista que lee la fuente: (1) busca con Grep los términos de la pregunta y sus sinónimos en toda la carpeta (por ejemplo sucursal, agencia, sede; consorcio, unión temporal, integrante); (2) lee con Read el bloque completo alrededor de cada hallazgo, no sólo la línea; (3) manda el pliego definitivo y la última adenda sobre el proyecto y los estudios previos; (4) en las respuestas a observaciones busca primero las de SEGURIDAD NACIONAL y di qué decidió la entidad (acoge, no acoge, acepta parcialmente, aclara);',
  '(5) junto a cada documento de respuestas puede haber un archivo «… - por observacion.md» con cada observación ya separada (quién, qué pidió, qué decidió la entidad), las nuestras primero: úsalo primero y confirma la frase en el documento original. Sin ese archivo, esas respuestas vienen de tablas de dos columnas (lo que pidió el observante y lo que respondió la entidad) y el texto puede venir intercalado línea por línea: separa una columna de la otra antes de concluir, y nunca tomes como respuesta a una observación una frase que pertenece a otra;',
  '(6) antes de decir que algo no consta, no está o viene cortado, búscalo otra vez con otras palabras y en las otras carpetas; si después de eso no aparece, dilo y di qué buscaste.',
  'Cita el archivo y la frase literal que sostiene cada conclusión. Lo de 06_terceros es contexto, nunca regla del proceso.',
].join(' ');

function nombreDeArchivo(nombre, usados) {
  const base = String(nombre || 'documento').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/[^0-9A-Za-z._ ()-]+/g, '_').replace(/^[^0-9A-Za-z]+/, '').slice(0, 100) || 'documento';
  let candidato = `${base}.txt`;
  for (let n = 2; usados.has(candidato.toLowerCase()); n += 1) candidato = `${base} (${n}).txt`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

function encabezado(doc, carpeta) {
  return [
    `# ${doc.name}`,
    `Carpeta: ${carpeta} · Tipo en el CRM: ${doc.document_type || 'sin tipo'} · Origen: ${doc.origin || 'sin dato'} · Cargado: ${String(doc.created_at || '').slice(0, 10)}`,
    '',
    '',
  ].join('\n');
}

/**
 * Devuelve { archivos: [{ ruta, texto }] } o null si la licitación no tiene documentos con texto. Si el total pasa el
 * tope, deja fuera primero lo que menos manda y lo dice en el índice.
 */
export async function armarAgt002CarpetaDelProceso(database, { tenderId, now = new Date() }) {
  if (!tenderId) return null;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(now);
  const versiones = await database.from('psi_tender_document_versions')
    .select('id,name,document_type,origin,created_at,extracted_text')
    .eq('tender_id', tenderId).eq('current', true).order('created_at', { ascending: true });
  if (versiones.error) throw versiones.error;
  const docs = versiones.data || [];
  if (!docs.length) return null;
  const extracciones = await database.from('psi_tender_document_extractions')
    .select('id,document_version_id,extractor_version,status,extracted_text,text_hash,char_count,created_at')
    .in('document_version_id', docs.map(doc => doc.id));
  const canonicas = selectCanonicalExtractionsByDocumentVersion(extracciones.error ? [] : extracciones.data || []);

  const usados = new Set();
  let entradas = docs.map(doc => {
    const fila = canonicas.get(doc.id);
    const texto = fila?.status === 'ok' ? fila.extracted_text : doc.extracted_text || '';
    const carpeta = CARPETAS.find(([, aplica]) => aplica(doc))[0];
    return { doc, carpeta, texto };
  }).filter(entrada => typeof entrada.texto === 'string' && entrada.texto.trim().length > 0)
    .map(entrada => ({ ...entrada, ruta: `${entrada.carpeta}/${nombreDeArchivo(entrada.doc.name, usados)}` }));
  if (!entradas.length) return null;

  const omitidos = [];
  const bytesDe = entrada => Buffer.byteLength(encabezado(entrada.doc, entrada.carpeta) + entrada.texto, 'utf8');
  let total = entradas.reduce((suma, entrada) => suma + bytesDe(entrada), 0);
  const tope = AGT002_CARPETA_MAX_BYTES - MARGEN_INDICE_BYTES;
  for (const carpeta of PRIORIDAD_AL_RECORTAR) {
    if (total <= tope && entradas.length < AGT002_CARPETA_MAX_ARCHIVOS) break;
    const candidatas = entradas.filter(entrada => entrada.carpeta === carpeta).sort((a, b) => bytesDe(b) - bytesDe(a));
    for (const entrada of candidatas) {
      if (total <= tope && entradas.length < AGT002_CARPETA_MAX_ARCHIVOS) break;
      entradas = entradas.filter(otra => otra !== entrada);
      total -= bytesDe(entrada);
      omitidos.push(entrada);
    }
  }

  entradas.sort((a, b) => a.ruta.localeCompare(b.ruta, 'es'));
  const indice = [
    '# Índice de la carpeta del proceso',
    '',
    'Una línea por documento vigente: carpeta/archivo, nombre original, tipo y origen en el CRM, fecha de carga y tamaño.',
    'Orden de autoridad: 01 (pliego definitivo y adendas) manda sobre 04 (estudios previos); 02 trae lo que la entidad respondió o decidió; 05 es lo que radicó Seguridad Nacional; 06 son documentos de terceros (contexto, nunca regla).',
    '',
    ...entradas.map(({ ruta, doc, texto }) => `- ${ruta} | ${doc.name} | ${doc.document_type || 'sin tipo'} | ${doc.origin || 'sin dato'} | ${String(doc.created_at || '').slice(0, 10)} | ${texto.length} caracteres`),
    ...(omitidos.length ? ['', `Quedaron fuera por tamaño (${omitidos.length}): ${omitidos.map(({ doc }) => doc.name).join('; ')}.`] : []),
    '',
  ].join('\n');

  // Las respuestas ya separadas por observación (paso 3): junto a su documento original. Sin la 217, nada.
  let separadas = [];
  try {
    const respuestas = entradas.filter(entrada => esDocumentoDeRespuestas(entrada.doc));
    const porDocumento = await leerAgt002RespuestasPorObservacion(database, respuestas.map(entrada => entrada.doc.id));
    separadas = respuestas.filter(entrada => porDocumento.get(entrada.doc.id)?.length).map(entrada => ({
      ruta: entrada.ruta.replace(/\.txt$/, ' - por observacion.md'),
      texto: respuestasPorObservacionMarkdown(entrada.doc.name, porDocumento.get(entrada.doc.id)),
    }));
  } catch (error) { console.warn('agt002_mesa_respuestas_unavailable', { event: 'agt002_mesa_respuestas_unavailable', code: error?.code || 'respuestas_failed' }); }

  // La ficha y el índice de procesos ayudan, pero no son condición: si fallan, la carpeta va sin ellos.
  let ficha = null; let procesos = null;
  try { ficha = await armarAgt002FichaDelProceso(database, { tenderId, hoy }); }
  catch (error) { ficha = null; console.warn('agt002_mesa_ficha_unavailable', { event: 'agt002_mesa_ficha_unavailable', code: error?.code || 'ficha_failed' }); }
  try {
    const { data: tender } = await database.from('psi_public_tenders').select('converted_opportunity_id').eq('id', tenderId).maybeSingle();
    procesos = await armarAgt002IndiceDeProcesos(database, { hoy, actual: tender?.converted_opportunity_id || null });
  } catch (error) { procesos = null; console.warn('agt002_mesa_procesos_unavailable', { event: 'agt002_mesa_procesos_unavailable', code: error?.code || 'procesos_failed' }); }

  return {
    archivos: [
      ...(ficha ? [{ ruta: '00_FICHA.md', texto: ficha }] : []),
      { ruta: '00_INDICE.md', texto: indice },
      ...(procesos ? [{ ruta: '00_PROCESOS_ABIERTOS.md', texto: procesos }] : []),
      ...entradas.map(({ ruta, doc, carpeta, texto }) => ({ ruta, texto: encabezado(doc, carpeta) + texto })),
      ...separadas,
    ],
  };
}
