import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PARAMETROS, RUBROS, RUBROS_TECNOLOGIA, guardarParametro, limpiarValor, listarParametros, periodoValido } from '../verticales/gerencial/siio-parametros.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const porClave = clave => PARAMETROS.find(parametro => parametro.clave === clave);
const gerencia = { id: '00000000-0000-0000-0000-0000000000aa', role: 'gerencia', full_name: 'Persona de prueba' };

// Lo mínimo del cliente de Supabase que usa el módulo, sobre una lista en memoria.
function baseFalsa(filas = []) {
  let siguiente = 1;
  const db = {
    filas,
    from(tabla) {
      const filtros = [];
      let operacion = { tipo: 'select' };
      const coincide = fila => filtros.every(([campo, valor]) => (valor === null ? fila[campo] == null : fila[campo] === valor));
      const builder = {
        select(_campos, opciones) { if (operacion.tipo === 'select') operacion = { tipo: 'select', ...opciones }; return builder; },
        eq(campo, valor) { filtros.push([campo, valor]); return builder; },
        is(campo, valor) { filtros.push([campo, valor]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        update(cambio) { operacion = { tipo: 'update', cambio }; return builder; },
        insert(fila) { operacion = { tipo: 'insert', fila }; return builder; },
        maybeSingle() { return Promise.resolve(builder.resolver(true)); },
        single() { return Promise.resolve(builder.resolver(true)); },
        then(ok, ko) { return Promise.resolve(builder.resolver(false)).then(ok, ko); },
        resolver(una) {
          if (tabla === 'psi_cliente_provision') return { count: 3, data: null, error: null };
          if (operacion.tipo === 'insert') {
            const fila = { id: `v${siguiente++}`, reemplazado_at: null, ...operacion.fila };
            filas.push(fila);
            return { data: fila, error: null };
          }
          const elegidas = filas.filter(coincide);
          if (operacion.tipo === 'update') { elegidas.forEach(fila => Object.assign(fila, operacion.cambio)); return { data: null, error: null }; }
          return { data: una ? elegidas[0] || null : elegidas, error: null };
        },
      };
      return builder;
    },
  };
  return db;
}

test('el catálogo tiene los 11 puntos acordados, numerados y con encargado', () => {
  assert.deepEqual(PARAMETROS.map(parametro => parametro.numero), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(PARAMETROS.every(parametro => parametro.encargado && parametro.frecuencia && parametro.para));
  assert.equal(RUBROS.length, 18);
  // Tecnología tiene sus propios rubros (21–40 en el Excel), no los de vigilancia.
  assert.deepEqual(RUBROS_TECNOLOGIA.map(rubro => rubro.numero), Array.from({ length: 20 }, (_, i) => 21 + i));
  // Los dos que ya tienen su pantalla sólo se señalan.
  assert.deepEqual(PARAMETROS.filter(parametro => parametro.forma === 'externo').map(parametro => parametro.clave), ['clientes_mes_vencido', 'historico']);
  // Las claves guardables son exactamente las que acepta la migración.
  const sql = read('supabase/migrations/219_siio_parametros.sql');
  for (const parametro of PARAMETROS.filter(item => item.forma !== 'externo')) assert.match(sql, new RegExp(`'${parametro.clave}'`));
});

test('el periodo sigue la frecuencia: año, mes o ninguno', () => {
  assert.equal(periodoValido(porClave('presupuesto_rubros'), '2026'), '2026');
  assert.throws(() => periodoValido(porClave('presupuesto_rubros'), '2026-11'), /Año inválido/);
  assert.equal(periodoValido(porClave('metas_mes'), '2026-11'), '2026-11');
  assert.throws(() => periodoValido(porClave('metas_mes'), '2026-13'), /Mes inválido/);
  assert.equal(periodoValido(porClave('creditos'), '2026'), '');
});

test('el valor se limpia según la forma y rechaza lo que no cuadra', () => {
  const metas = limpiarValor(porClave('metas_mes'), { ingresos: '1000', margen_operacional: '8,5', otro: 'x' });
  assert.deepEqual(metas, { ingresos: 1000, margen_operacional: 8.5 });
  assert.throws(() => limpiarValor(porClave('metas_mes'), {}), /No hay datos/);
  assert.throws(() => limpiarValor(porClave('aumento_tarifa'), { vigilancia: 150 }), /entre −100 y 100/);
  const creditos = limpiarValor(porClave('creditos'), [{ banco: ' Banco A ', concepto: 'Capital de trabajo', tasa: 12, fecha_final: '2028-01-31' }, {}]);
  assert.deepEqual(creditos, [{ banco: 'Banco A', concepto: 'Capital de trabajo', tasa: 12, fecha_final: '2028-01-31' }]);
  assert.throws(() => limpiarValor(porClave('creditos'), [{ banco: 'Banco A' }]), /Fila 1: Concepto: dato obligatorio/);
  assert.throws(() => limpiarValor(porClave('ajustes_cierre'), [{ linea: 'no_existe', valor: 1, motivo: 'x' }]), /opción no válida/);
  const presupuesto = limpiarValor(porClave('presupuesto_rubros'), { vigilancia: { salarios: '10' }, tecnologia: { materia_prima: 35, otro: 1 } });
  assert.equal(Object.keys(presupuesto.vigilancia).length, 18);
  assert.equal(Object.keys(presupuesto.tecnologia).length, 20);
  assert.equal(presupuesto.vigilancia.salarios, 10);
  assert.equal(presupuesto.tecnologia.materia_prima, 35);
  assert.equal(presupuesto.tecnologia.otro, undefined);
  assert.throws(() => limpiarValor(porClave('presupuesto_rubros'), { tecnologia: { seguros: 140 } }), /Tecnología, Seguros/);
  assert.throws(() => limpiarValor(porClave('historico'), {}), /otra pantalla/);
});

test('guardar deja una versión nueva y marca la anterior como reemplazada; sólo admin y gerencia', async () => {
  const db = baseFalsa();
  await guardarParametro(db, 'aumento_tarifa', { periodo: '2026', valor: { vigilancia: 5 } }, gerencia, new Date('2026-11-13T10:00:00Z'));
  await guardarParametro(db, 'aumento_tarifa', { periodo: '2026', valor: { vigilancia: 6 }, nota: 'revisado' }, gerencia, new Date('2026-11-13T11:00:00Z'));
  await guardarParametro(db, 'aumento_tarifa', { periodo: '2027', valor: { vigilancia: 7 } }, gerencia, new Date('2026-11-13T12:00:00Z'));
  assert.equal(db.filas.length, 3);
  const vigentes = db.filas.filter(fila => !fila.reemplazado_at);
  assert.deepEqual(vigentes.map(fila => [fila.periodo, fila.valor.vigilancia]), [['2026', 6], ['2027', 7]]);
  assert.equal(db.filas[0].reemplazado_at, '2026-11-13T11:00:00.000Z');
  assert.equal(vigentes[0].creado_por_nombre, 'Persona de prueba');
  assert.equal(vigentes[0].nota, 'revisado');
  await assert.rejects(guardarParametro(db, 'aumento_tarifa', { periodo: '2026', valor: { vigilancia: 1 } }, { id: 'x', role: 'consulta' }), error => error.status === 403);
  await assert.rejects(guardarParametro(db, 'clientes_mes_vencido', { valor: {} }, gerencia), /Parámetro no válido/);
  const lista = await listarParametros(db, { id: 'x', role: 'consulta' });
  assert.equal(lista.puede_editar, false);
  assert.equal(lista.clientes_mes_vencido, 3);
  assert.equal(lista.catalogo.length, 11);
});

test('migración 219: sólo el servidor, un vigente por clave y periodo, y se puede repetir', async () => {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role; create table public.psi_sales_profiles (id uuid primary key);');
  const sql = read('supabase/migrations/219_siio_parametros.sql');
  await pg.exec(sql);
  await pg.exec(sql);
  await pg.exec(`insert into public.siio_parametros (clave, periodo, valor) values ('metas_mes', '2026-11', '{"ingresos": 1}')`);
  await assert.rejects(pg.exec(`insert into public.siio_parametros (clave, periodo, valor) values ('metas_mes', '2026-11', '{"ingresos": 2}')`));
  await pg.exec(`update public.siio_parametros set reemplazado_at = now() where clave = 'metas_mes'`);
  await pg.exec(`insert into public.siio_parametros (clave, periodo, valor) values ('metas_mes', '2026-11', '{"ingresos": 2}')`);
  await assert.rejects(pg.exec(`insert into public.siio_parametros (clave, periodo, valor) values ('otra_cosa', '', '{}')`));
  await assert.rejects(pg.exec(`insert into public.siio_parametros (clave, periodo, valor) values ('metas_mes', '2026-13', '{}')`));
  const grants = await pg.query("select grantee from information_schema.role_table_grants where table_name = 'siio_parametros'");
  assert.ok(grants.rows.every(row => row.grantee === 'service_role' || row.grantee === 'postgres'), JSON.stringify(grants.rows));
  await pg.exec(read('supabase/rollbacks/219_siio_parametros_rollback.sql'));
});

test('la pestaña va entre Vig-IA y Fuentes y detalle, y el servidor la expone', () => {
  const vista = read('src/siio/SiioExecutiveView.tsx');
  assert.match(vista, /\['vigia', 'Vig-IA'\], \['parametros', 'Parámetros'\], \['fuentes', 'Fuentes y detalle'\]/);
  const server = read('server/index.js');
  assert.match(server, /app\.get\('\/api\/siio\/parametros'/);
  assert.match(server, /app\.put\('\/api\/siio\/parametros\/:clave'/);
});
