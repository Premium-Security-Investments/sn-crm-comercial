// El mapeo del repositorio y el que escribe la migración tienen que decir lo mismo: si se separan,
// el script de verificación mide una cosa y la aplicación trae otra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { MAPEO_AVANCYS } from '../../src/programacion/integracion/mapeo-avancys.ts';

// Cualquier migración puede tocar la fila 'avancys' de integraciones; se leen todas las que la
// nombren, para que agregar una ciudad en una migración nueva no haga fallar esta prueba.
const SQL = readdirSync('supabase/programacion-migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`supabase/programacion-migrations/${f}`, 'utf8'))
  .filter((t) => t.includes('integraciones'))
  .join('\n');

// Una migración puede nombrar el campo entre comillas simples ('subzone_id') o dobles, cuando va
// dentro de un valor jsonb. Las dos formas cuentan.
const nombra = (campo: string) => SQL.includes(`'${campo}'`) || SQL.includes(`"${campo}"`);

test('las migraciones declaran los mismos campos de Odoo que el mapeo del repositorio', () => {
  for (const entidad of ['empleados', 'clientes'] as const) {
    const cfg = MAPEO_AVANCYS[entidad];
    assert.ok(SQL.includes(`'${cfg.modelo}'`), `la migración no nombra el modelo ${cfg.modelo}`);
    for (const [dato, campo] of Object.entries(cfg.campos)) {
      assert.ok(SQL.includes(`'${dato}', '${campo}'`) || nombra(campo), `la migración no mapea ${entidad}.${dato} a ${campo}`);
    }
    for (const campo of Object.values(cfg.lugar?.campos ?? {})) {
      assert.ok(nombra(campo), `la migración no nombra el campo de lugar ${campo}`);
    }
  }
});

test('cada ciudad de Programación tiene filtro declarado en la migración', () => {
  for (const [ciudad, filtro] of Object.entries(MAPEO_AVANCYS.ciudades)) {
    assert.ok(nombra(ciudad), `la migración no declara la ciudad ${ciudad}`);
    for (const g of filtro.grupos ?? []) assert.ok(nombra(g), `falta el grupo ${g} de ${ciudad}`);
  }
});

test('el mapeo de patrones nombra los tres modelos y la migración también', () => {
  for (const m of Object.values(MAPEO_AVANCYS.patrones)) {
    assert.ok(nombra(m), `ninguna migración nombra el modelo de patrones ${m}`);
  }
});

test('ningún empleado se filtra por dominio sobre el documento', () => {
  assert.deepEqual(MAPEO_AVANCYS.empleados.dominio, []);
});
