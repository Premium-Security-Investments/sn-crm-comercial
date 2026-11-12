// La matriz histórica de requisitos (pestaña «Requisitos», migración 211): el Excel sigue en SharePoint y es la fuente;
// el puente diario lo baja, lo limpia y lo deja en psi_tender_requirement_history, de donde lo lee el CRM. Juan,
// 2026-11-12: «vaya con la tabla» (el contenido de la matriz no va en el código).
//
// Limpieza: una fila por ocurrencia de las hojas Habilitantes y Puntuables, sin las columnas constantes, vacías o
// técnicas (estado metodológico, revisión humana, confianza, huella del pliego, alcance de la fuente, fecha de ingreso)
// y con el proceso de origen sacado de OBSERVACIONES («Fuentes consolidadas: pereira-risaralda-electronica-H-0…») o de
// la huella del pliego. La hoja «Alistamiento SN» no se carga: su lugar lo ocupa la evaluación de la empresa del CRM.
import { createHash } from 'node:crypto';
import { readWorkbook } from './tender-economic-offer-check.js';

export const REQUIREMENT_MATRIX_PATH = '06_Productos_PSI/Licitaciones/01_Base_Maestra_y_Taxonomia/01_Bases_de_datos_historica/Matriz_Historica_Requisitos_Habilitantes_y_Puntuables.xlsx';

// Los nombres de los procesos de la matriz, legibles. Lo que no esté aquí se muestra con el identificador tal cual.
const PROCESS_LABELS = {
  'arauca-arauca-fisica': 'Arauca (Arauca) · vigilancia física',
  'barranquilla-atlantico-electronica': 'Barranquilla (Atlántico) · seguridad electrónica',
  'bogota-distrito-capital-de-bogota-hibrida': 'Bogotá D.C. · vigilancia híbrida',
  'bogota-espol-cctv': 'Bogotá · CCTV',
  'carmen-bolivar-seguridad-electronica': 'El Carmen de Bolívar · seguridad electrónica',
  'cucuta-norte-santander': 'Cúcuta (Norte de Santander)',
  'dosquebradas-risaralda-cctv': 'Dosquebradas (Risaralda) · CCTV',
  'ibague-tolima-hibrida': 'Ibagué (Tolima) · vigilancia híbrida',
  'manizales-caldas-cctv': 'Manizales (Caldas) · CCTV Terminal de Transportes',
  'mocoa-putumayo': 'Mocoa (Putumayo) · instituciones educativas',
  'neiva-huila-vigilancia': 'Neiva (Huila) · vigilancia',
  'pereira-risaralda-electronica': 'Pereira (Risaralda) · seguridad electrónica',
  'piedecuesta-santander-fisica': 'Piedecuesta (Santander) · vigilancia física',
  'pliego-03901ad330': 'Rama Judicial Pereira · vigilancia',
  'pliego-3d1746da7c': 'Pliego sin identificar (3d1746da)',
  'popayan-cauca-fisica': 'Popayán (Cauca) · vigilancia física',
  'riohacha-la-guajira-fisica': 'Riohacha (La Guajira) · vigilancia física',
  'santa-rosa-risaralda': 'Santa Rosa de Cabal (Risaralda)',
  'tunja-boyaca-hibrida': 'Tunja (Boyacá) · vigilancia híbrida',
  'valledupar-cesar-videovigilancia': 'Valledupar (Cesar) · videovigilancia',
  'villamaria-caldas-fisica': 'Villamaría (Caldas) · vigilancia física',
  'yopal-casanare-hibrida': 'Yopal (Casanare) · vigilancia híbrida',
};
const SHEETS = { Habilitantes: 'habilitante', Puntuables: 'puntuable' };
const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};
const column = ref => ref.replace(/\d+$/, '');
// La tabla guarda IDs de hasta 40 caracteres. 63 filas de la matriz los traen más largos y con el mismo comienzo
// («bogota-distrito-capital-de-bogota-hibrida-…»): cortarlos los repetía. Los largos se acortan con una huella.
const shortId = id => (id.length <= 40 ? id : `${id.slice(0, 27)}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`);
const rowOf = ref => Number(ref.match(/\d+$/)?.[0] || 0);

/** Las filas limpias de la matriz a partir de los bytes del .xlsx. Pura. */
export function parseRequirementMatrix(bytes) {
  const rows = [];
  for (const sheet of readWorkbook(bytes)) {
    const kind = SHEETS[sheet.name];
    if (!kind) continue;
    const grid = new Map();
    for (const cell of sheet.cells.values()) {
      const row = rowOf(cell.ref);
      if (!grid.has(row)) grid.set(row, new Map());
      grid.get(row).set(column(cell.ref), cell.value);
    }
    const headerRow = [...grid.keys()].sort((a, b) => a - b).find(row => [...grid.get(row).values()].includes('ID_OCURRENCIA'));
    if (!headerRow) continue;
    const header = new Map([...grid.get(headerRow)].map(([col, name]) => [String(name || ''), col]));
    const get = (cells, name) => (header.has(name) ? cells.get(header.get(name)) : null);
    for (const row of [...grid.keys()].filter(row => row > headerRow).sort((a, b) => a - b)) {
      const cells = grid.get(row);
      const rawId = String(get(cells, 'ID_OCURRENCIA') ?? '').replace(/\s+/g, ' ').trim();
      const id = shortId(rawId);
      const requisito = clip(get(cells, 'REQUISITO'), 500);
      if (!id || !requisito) continue;
      const slugs = [...new Set([...String(get(cells, 'OBSERVACIONES') || '').matchAll(/([a-z0-9]+(?:-[a-z0-9]+)+)-(?:H|P|PUN)-\d+/g)].map(match => match[1]))].sort();
      const sha = String(get(cells, 'SHA256_PLIEGO') || '');
      if (!slugs.length && sha) slugs.push(`pliego-${sha.slice(0, 10)}`);
      // Las filas sin observaciones traen el proceso en el identificador: «RUN04-CO1.REQ.8308809-H-025» (la solicitud
      // de SECOP) o «tunja-boyaca-hibrida-TUNJA-HAB-013».
      const secop = rawId.match(/CO1\.REQ\.\d+/)?.[0];
      const slug = rawId.match(/^([a-z]+(?:-[a-z]+)+)-[A-Z]/)?.[1];
      if (!slugs.length && secop) slugs.push(`SECOP ${secop}`);
      if (!slugs.length && slug) slugs.push(slug);
      const points = get(cells, 'PUNTOS_MAXIMOS_OPCION');
      rows.push({
        id, kind, categoria: clip(get(cells, 'CATEGORIA'), 80) || null, requisito,
        umbral: clip(get(cells, 'UMBRAL_O_CONDICION') ?? get(cells, 'REGLA_DE_PUNTUACION'), 300) || null,
        puntos: points === null || points === undefined || points === '' ? null : clip(points, 20),
        cita: clip(get(cells, 'CITA_TEXTUAL'), 400) || null,
        procesos: slugs.map(slug => PROCESS_LABELS[slug] || slug),
        url: clip(get(cells, 'URL_PROCESO'), 500) || null,
      });
    }
  }
  return rows;
}

/** Deja la tabla igual a la matriz: inserta o actualiza por ID y quita lo que ya no está. Devuelve los conteos. */
export async function syncRequirementHistory(database, rows, { sourceModifiedAt = null, now = () => new Date() } = {}) {
  if (!rows.length) throw new Error('matriz_vacia');
  const loadedAt = now().toISOString();
  const payload = rows.map(row => ({ ...row, source_modified_at: sourceModifiedAt, loaded_at: loadedAt }));
  for (let start = 0; start < payload.length; start += 200) {
    const { error } = await database.from('psi_tender_requirement_history').upsert(payload.slice(start, start + 200), { onConflict: 'id' });
    if (error) throw error;
  }
  const { data: stale, error } = await database.from('psi_tender_requirement_history').select('id').lt('loaded_at', loadedAt);
  if (error) throw error;
  if (stale?.length) {
    const { error: deleteError } = await database.from('psi_tender_requirement_history').delete().in('id', stale.map(row => row.id));
    if (deleteError) throw deleteError;
  }
  return { filas: rows.length, retiradas: stale?.length || 0 };
}

/**
 * El paso del puente diario. `listFolder(path)` → archivos del inventario ({ nombre, modificado_en }); `download(path)`
 * → bytes. Sólo baja el Excel si cambió desde la última copia. Devuelve un evento sin rutas ni contenido.
 */
export async function runRequirementMatrixSync(database, { listFolder, download, path = REQUIREMENT_MATRIX_PATH }) {
  const folder = path.split('/').slice(0, -1).join('/');
  const name = path.split('/').pop();
  const file = (await listFolder(folder)).find(item => item?.nombre === name);
  if (!file) return { event: 'requirement_matrix_missing' };
  const { data: current, error } = await database.from('psi_tender_requirement_history').select('source_modified_at').limit(1);
  if (error) return { event: ['PGRST205', '42P01'].includes(String(error.code || '')) ? 'requirement_matrix_unavailable' : 'requirement_matrix_failed', code: String(error.code || 'lectura') };
  const modifiedAt = file.modificado_en ? new Date(file.modificado_en).toISOString() : null;
  const stored = current?.[0]?.source_modified_at ? new Date(current[0].source_modified_at).toISOString() : null;
  if (modifiedAt && stored === modifiedAt) return { event: 'requirement_matrix_unchanged' };
  const rows = parseRequirementMatrix(await download(path));
  const counts = await syncRequirementHistory(database, rows, { sourceModifiedAt: modifiedAt });
  return { event: 'requirement_matrix_loaded', ...counts };
}
