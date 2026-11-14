// Estudios de Seguridad Física: la estadística de delitos del municipio, traída de los datos abiertos de la Policía
// (Juan, 2026-11-14: "esto me gusta"). Hasta ahora el analista la escribía a mano.
//
// Fuente: los conjuntos que el Ministerio de Defensa publica cada mes en datos.gov.co con las cifras de la Policía
// Nacional (un conjunto por delito, con fecha del hecho y código DANE del municipio; medidos en casos o víctimas). Se
// cuentan los 12 meses que terminan en el último corte publicado, y los 12 anteriores para comparar. Las filas que trae
// esta función se reemplazan cada vez que se pide; las escritas a mano no se tocan.
//
// No se adivina el municipio: si el nombre de la ciudad existe en varios departamentos, se devuelven las opciones.

const BASE = 'https://www.datos.gov.co/resource';
export const FUENTE_POLICIA = 'Policía Nacional, datos abiertos (MinDefensa, datos.gov.co)';
// Los delitos que pesan en un estudio de seguridad física. El id es el del conjunto en datos.gov.co.
export const DELITOS_POLICIA = Object.freeze([
  Object.freeze({ id: '4rxi-8m8d', nombre: 'Hurto a personas' }),
  Object.freeze({ id: '7i2x-h5vp', nombre: 'Hurto a comercio' }),
  Object.freeze({ id: '7mn7-vzqp', nombre: 'Hurto a residencias' }),
  Object.freeze({ id: 'csb4-y6v2', nombre: 'Hurto a vehículos' }),
  Object.freeze({ id: 'i7h7-wmjc', nombre: 'Hurto a entidades financieras' }),
  Object.freeze({ id: 'sutf-7dyz', nombre: 'Piratería terrestre' }),
  Object.freeze({ id: 'm8fd-ahd9', nombre: 'Homicidio' }),
  Object.freeze({ id: 'jr6v-i33g', nombre: 'Lesiones personales' }),
  Object.freeze({ id: 'q2ib-t9am', nombre: 'Extorsión' }),
  Object.freeze({ id: 'd7zw-hpf4', nombre: 'Secuestro' }),
  Object.freeze({ id: 'yi5j-5fe9', nombre: 'Terrorismo' }),
]);
const REFERENCIA = DELITOS_POLICIA[0].id;
const TIMEOUT_MS = 20_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** El nombre como lo escribe la fuente: mayúsculas, sin tildes, con la Ñ. */
export function nombreMunicipio(city) {
  return String(city || '').trim().toUpperCase().replace(/Ñ/g, '\u0000').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0000/g, 'Ñ').replace(/\s+/g, ' ');
}
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`;

async function consultar(fetchImpl, dataset, params) {
  const url = new URL(`${BASE}/${dataset}.json`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw fail(`Los datos abiertos de la Policía no respondieron (HTTP ${response.status}).`, 503);
    return await response.json();
  } catch (error) {
    if (error?.status) throw error;
    throw fail('No se pudo consultar los datos abiertos de la Policía. Intente de nuevo en un momento.', 503);
  } finally { clearTimeout(timer); }
}

/** Los municipios de la fuente que corresponden a la ciudad (normalmente uno). */
export async function buscarMunicipio(city, { fetchImpl = fetch } = {}) {
  const nombre = nombreMunicipio(city);
  if (nombre.length < 3) return [];
  const filas = await consultar(fetchImpl, REFERENCIA, {
    $select: 'cod_muni,municipio,departamento',
    $where: `upper(municipio) = ${sqlText(nombre)} OR upper(municipio) like ${sqlText(`${nombre} %`)}`,
    $group: 'cod_muni,municipio,departamento',
    $limit: '20',
  });
  const todos = (filas || []).filter(fila => /^\d{5}$/.test(fila.cod_muni || '')).map(fila => ({ cod_muni: fila.cod_muni, municipio: fila.municipio, departamento: fila.departamento }));
  // El nombre exacto gana ("SAN JOSE" no trae "SAN JOSE DEL GUAVIARE"); el prefijo sirve para "BOGOTA" → "BOGOTA D.C.".
  const exactos = todos.filter(item => item.municipio === nombre || item.municipio === `${nombre} D.C.`);
  return exactos.length ? exactos : todos;
}

const dia = value => String(value || '').slice(0, 10);
function haceUnAno(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Las cifras de cada delito en el municipio: los 12 meses hasta el último corte publicado y los 12 anteriores.
 * Devuelve { corte, desde, filas: [{ delito, cantidad, anterior }] }.
 */
export async function estadisticaDelMunicipio(codMuni, { fetchImpl = fetch } = {}) {
  if (!/^\d{5}$/.test(String(codMuni || ''))) throw fail('Código de municipio inválido.');
  const [{ corte } = {}] = await consultar(fetchImpl, REFERENCIA, { $select: 'max(fecha_hecho) as corte' });
  const fin = dia(corte);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fin)) throw fail('La fuente no dice hasta qué fecha tiene datos.', 503);
  const desde = haceUnAno(fin);
  const antes = haceUnAno(desde);
  const suma = async (dataset, from, to) => {
    const [fila] = await consultar(fetchImpl, dataset, {
      $select: 'sum(cantidad) as n',
      $where: `cod_muni = ${sqlText(codMuni)} AND fecha_hecho > ${sqlText(`${from}T00:00:00`)} AND fecha_hecho <= ${sqlText(`${to}T00:00:00`)}`,
    });
    return Math.round(Number(fila?.n) || 0);
  };
  const filas = await Promise.all(DELITOS_POLICIA.map(async delito => ({
    delito: delito.nombre, cantidad: await suma(delito.id, desde, fin), anterior: await suma(delito.id, antes, desde),
  })));
  return { corte: fin, desde, filas };
}

const tendencia = (actual, anterior) => (anterior === 0 ? (actual ? 'antes 0' : '') : actual === anterior ? 'igual al año anterior'
  : `${actual > anterior ? '+' : '−'}${Math.round(Math.abs(actual - anterior) / anterior * 100)} % frente al año anterior`);

/**
 * Trae la estadística al estudio (en borrador o devuelto). Si la ciudad es ambigua y no llega `cod_muni`, devuelve las
 * opciones sin escribir nada. Reemplaza sólo las filas que vinieron de esta fuente.
 */
export async function traerEstadisticaPolicia(db, studyId, body = {}, { fetchImpl = fetch, editableStudy } = {}) {
  const study = await editableStudy(db, studyId);
  let municipio = null;
  if (body.cod_muni) {
    const opciones = await buscarMunicipio(body.municipio || study.site_city, { fetchImpl });
    municipio = opciones.find(item => item.cod_muni === body.cod_muni) || { cod_muni: String(body.cod_muni), municipio: body.municipio || study.site_city, departamento: null };
  } else {
    if (!study.site_city) throw fail('El estudio no tiene ciudad: escríbala en la sede para traer la estadística.');
    const opciones = await buscarMunicipio(study.site_city, { fetchImpl });
    if (!opciones.length) throw fail(`La Policía no tiene datos con el municipio "${study.site_city}". Revise cómo está escrita la ciudad.`, 404);
    if (opciones.length > 1) return { escoger: true, opciones };
    [municipio] = opciones;
  }
  const { corte, desde, filas } = await estadisticaDelMunicipio(municipio.cod_muni, { fetchImpl });
  const fuente = `${FUENTE_POLICIA}: ${municipio.municipio}${municipio.departamento ? ` (${municipio.departamento})` : ''}, ${desde} a ${corte}`.slice(0, 300);
  const table = 'psi_security_study_crime_stats';
  const { data: existing, error: readError } = await db.from(table).select('id, source, position').eq('study_id', study.id);
  if (readError) throw readError;
  const previas = (existing || []).filter(row => String(row.source || '').startsWith(FUENTE_POLICIA));
  if (previas.length) {
    const { error } = await db.from(table).delete().in('id', previas.map(row => row.id));
    if (error) throw error;
  }
  let position = Math.max(0, ...(existing || []).filter(row => !previas.includes(row)).map(row => row.position));
  const rows = filas.map(fila => ({
    study_id: study.id, crime: `${fila.delito}${tendencia(fila.cantidad, fila.anterior) ? ` (${tendencia(fila.cantidad, fila.anterior)})` : ''}`.slice(0, 160),
    count: fila.cantidad, source: fuente, cutoff_date: corte, position: ++position,
  }));
  const { data, error } = await db.from(table).insert(rows).select('*');
  if (error) throw error;
  return { municipio, corte, desde, filas: data || [], reemplazadas: previas.length };
}
