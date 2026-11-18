// Estudios de Seguridad Física: estadística de delitos desde los datos abiertos de la Policía (Juan, 2026-11-14:
// "esto me gusta"). Con la fuente simulada: el municipio no se adivina, se cuentan 12 meses al último corte de cada
// delito con su comparación, y al volver a traer se reemplaza sólo lo de esta fuente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addCharacterizationRow, editableStudy, loadCharacterization } from '../verticales/estudios-seguridad/caracterizacion.js';
import { createStudy } from '../verticales/estudios-seguridad/estudios.js';
import { DELITOS_POLICIA, FUENTE_POLICIA, buscarMunicipio, nombreMunicipio, traerEstadisticaPolicia } from '../verticales/estudios-seguridad/estadistica-policia.js';
import { PREPARER, database, supabaseOver } from './helpers/estudios-seguridad-db.mjs';

const STUDY = {
  title: 'Estudio con estadística', client_source: 'avancys', client_ref: '900123456', client_name: 'Cliente de prueba S.A.S.',
  site_source: 'manual', site_name: 'Bodega', site_city: 'Pereira', scope: 'Bodega.', visit_date: '2026-11-10',
};
const MUNICIPIOS = [
  { cod_muni: '66001', municipio: 'PEREIRA', departamento: 'RISARALDA' },
  { cod_muni: '17665', municipio: 'SAN JOSE', departamento: 'CALDAS' },
  { cod_muni: '27660', municipio: 'SAN JOSE DEL PALMAR', departamento: 'CHOCO' },
  { cod_muni: '99999', municipio: 'LA UNION', departamento: 'NARIÑO' },
  { cod_muni: '88888', municipio: 'LA UNION', departamento: 'VALLE DEL CAUCA' },
];
const RESIDENCIAS = DELITOS_POLICIA.find(item => item.nombre === 'Hurto a residencias');
function fuente() {
  const pedidos = [];
  const fetchImpl = async url => {
    const select = url.searchParams.get('$select');
    const where = url.searchParams.get('$where') || '';
    pedidos.push({ dataset: url.pathname.split('/').pop(), select, where });
    let body;
    if (select.startsWith('cod_muni')) {
      const nombre = /= '([^']+)'/.exec(where)[1];
      body = MUNICIPIOS.filter(item => item.municipio === nombre || item.municipio.startsWith(`${nombre} `));
    } else if (select.startsWith('max')) {
      // Hurto a residencias va un mes atrasado y su último hecho no cae en fin de mes: se cuenta hasta el 31 de agosto.
      body = [{ corte: url.pathname.includes(RESIDENCIAS.id) ? '2026-08-14T00:00:00.000' : '2026-09-30T00:00:00.000' }];
    } else {
      const actual = where.includes("> '2025-09-30") || where.includes("> '2025-08-31");
      const indice = DELITOS_POLICIA.findIndex(item => url.pathname.includes(item.id));
      body = [{ n: String(actual ? 100 + indice : 100) }];
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, pedidos };
}

test('el nombre como lo escribe la fuente, y el exacto gana', async () => {
  assert.equal(nombreMunicipio(' Medellín '), 'MEDELLIN');
  assert.equal(nombreMunicipio('San José de la Montaña'), 'SAN JOSE DE LA MONTAÑA');
  const { fetchImpl } = fuente();
  assert.deepEqual((await buscarMunicipio('San José', { fetchImpl })).map(item => item.cod_muni), ['17665'], 'no trae San José del Palmar');
  assert.equal((await buscarMunicipio('La Unión', { fetchImpl })).length, 2, 'dos departamentos: hay que escoger');
});

test('trae 12 meses al corte con la comparación; reemplaza sólo lo suyo; ciudad ambigua no escribe', async () => {
  const pg = await database();
  const db = supabaseOver(pg);
  const study = await createStudy(db, STUDY, PREPARER);
  await addCharacterizationRow(db, study.id, 'estadisticas', { crime: 'Hurto en el barrio (Policía del cuadrante)', count: 7, source: 'Cuadrante 4' });
  const { fetchImpl, pedidos } = fuente();
  const result = await traerEstadisticaPolicia(db, study.id, {}, { fetchImpl, editableStudy });
  assert.equal(result.municipio.cod_muni, '66001');
  assert.equal(result.filas.length, DELITOS_POLICIA.length);
  assert.ok(pedidos.some(item => item.where.includes("cod_muni = '66001'")));
  let rows = (await loadCharacterization(db, study.id)).estadisticas;
  const hurto = rows.find(row => row.crime.startsWith('Hurto a personas'));
  assert.equal(hurto.count, 100);
  assert.equal(hurto.crime, 'Hurto a personas (igual al año anterior)');
  assert.equal(rows.find(row => row.crime.startsWith('Hurto a comercio')).crime, 'Hurto a comercio (+1 % frente al año anterior)');
  assert.ok(hurto.source.startsWith(FUENTE_POLICIA) && hurto.source.includes('PEREIRA (RISARALDA), 2025-09-30 a 2026-09-30'));
  assert.equal(String(hurto.cutoff_date).slice(0, 10) === '2026-09-30' || hurto.cutoff_date instanceof Date, true);

  // Cada delito con su propio corte: al atrasado no le falta un mes, y la pantalla lo nombra.
  const residencias = rows.find(row => row.crime.startsWith('Hurto a residencias'));
  const dia = value => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
  assert.equal(dia(residencias.cutoff_date), '2026-08-31');
  assert.equal(dia(hurto.cutoff_date), '2026-09-30');
  assert.ok(residencias.source.includes('2025-08-31 a 2026-08-31'));
  assert.ok(pedidos.some(item => item.dataset === `${RESIDENCIAS.id}.json` && item.where.includes("fecha_hecho > '2025-08-31T00:00:00' AND fecha_hecho <= '2026-08-31T00:00:00'")));
  assert.equal(residencias.crime, `Hurto a residencias (+${Math.round(DELITOS_POLICIA.indexOf(RESIDENCIAS))} % frente al año anterior)`);
  assert.equal(result.corte, '2026-09-30');
  assert.deepEqual(result.atrasados, [{ delito: 'Hurto a residencias', corte: '2026-08-31' }]);

  const again = await traerEstadisticaPolicia(db, study.id, {}, { fetchImpl, editableStudy });
  assert.equal(again.reemplazadas, DELITOS_POLICIA.length);
  rows = (await loadCharacterization(db, study.id)).estadisticas;
  assert.equal(rows.length, DELITOS_POLICIA.length + 1, 'no se duplica y la fila escrita a mano se queda');
  assert.ok(rows.some(row => row.source === 'Cuadrante 4'));

  const ambigua = await createStudy(db, { ...STUDY, site_city: 'La Unión' }, PREPARER);
  assert.deepEqual((await traerEstadisticaPolicia(db, ambigua.id, {}, { fetchImpl, editableStudy })).escoger, true);
  assert.equal((await loadCharacterization(db, ambigua.id)).estadisticas.length, 0, 'sin escoger no escribe nada');
  const escogida = await traerEstadisticaPolicia(db, ambigua.id, { cod_muni: '88888', municipio: 'La Unión' }, { fetchImpl, editableStudy });
  assert.equal(escogida.municipio.departamento, 'VALLE DEL CAUCA');
});
