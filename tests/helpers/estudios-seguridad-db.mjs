// Estudios de Seguridad Física — base de prueba compartida por las pruebas del módulo.
// PGlite con las migraciones reales del módulo y un doble mínimo de supabase-js (tablas y depósito) que traduce a SQL.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const PREPARER = { id: '11111111-1111-4111-8111-111111111111', role: 'colaborador', permissions: ['estudios_seguridad'] };
export const REVIEWER = { id: '44444444-4444-4444-8444-444444444444', role: 'colaborador', permissions: ['estudios_seguridad', 'estudios_seguridad_revisar'] };
export const APPROVER = { id: '55555555-5555-4555-8555-555555555555', role: 'gerencia', permissions: ['estudios_seguridad', 'estudios_seguridad_aprobar'] };
// La 201 (SecurityOps) va después de la 188 aunque haya otras migraciones de otros módulos entre ellas.
const MIGRATIONS = ['178_estudios_seguridad_base.sql', '179_estudios_seguridad_evidencias.sql', '180_estudios_seguridad_aprobacion.sql', '181_estudios_seguridad_agente.sql', '186_estudios_seguridad_archivo.sql', '187_estudios_seguridad_caracterizacion.sql', '188_estudios_seguridad_seguimiento.sql', '201_estudios_seguridad_securityops.sql', '205_estudios_seguridad_metodologia_guia.sql', '206_estudios_seguridad_socializacion_enlace.sql'];

export async function database({ upTo = MIGRATIONS.length } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, role text not null, full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_access_permissions (code text primary key, name text, description text, active boolean);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    insert into public.psi_sales_profiles values ('${PREPARER.id}', 'colaborador', 'Ana Preparadora'), ('${REVIEWER.id}', 'colaborador', 'Rubén Revisor'), ('${APPROVER.id}', 'gerencia', 'Alba Aprobadora');
  `);
  // Seguimiento gerencial existe desde antes del módulo; la 188 lo amplía.
  await pg.exec(readFileSync(new URL('../../supabase/migrations/123_siio_followups.sql', import.meta.url), 'utf8'));
  for (const name of MIGRATIONS.slice(0, upTo)) await pg.exec(readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  return pg;
}

// Doble de supabase-js sobre PGlite: lo justo que usa el módulo (select/eq/order/single/maybeSingle/insert/update/delete).
export function supabaseOver(pg, objects = new Map()) {
  // Depósito en memoria: la clave es "bucket/ruta". Las subidas firmadas se simulan escribiendo en `objects`.
  const storage = {
    from(bucket) {
      const key = path => `${bucket}/${path}`;
      return {
        async createSignedUploadUrl(path) { return { data: { token: `token-${path}`, path }, error: null }; },
        async download(path) { return objects.has(key(path)) ? { data: new Blob([objects.get(key(path))]), error: null } : { data: null, error: new Error('Object not found') }; },
        async remove(paths) { for (const path of paths) objects.delete(key(path)); return { data: paths, error: null }; },
        async createSignedUrls(paths) { return { data: paths.map(path => ({ path, signedUrl: `https://firmado.test/${key(path)}` })), error: null }; },
      };
    },
  };
  return {
    storage,
    objects,
    // rpc con parámetros con nombre, como supabase-js.
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      try {
        // `select * from f(...)` sirve para las dos formas: escalar (una columna con el nombre de la función) y setof (filas).
        const result = await pg.query(`select * from public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(', ')})`, keys.map(key => (args[key] !== null && typeof args[key] === 'object' ? JSON.stringify(args[key]) : args[key])));
        const scalar = result.fields.length === 1 && result.fields[0].name === name;
        return { data: scalar ? result.rows[0]?.[name] ?? null : result.rows, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table) {
      const state = { op: 'select', columns: '*', filters: [], order: [], values: null, returning: false, limit: null, conflict: null };
      const OPS = { in: column => `"${column}" = any($N)`, ilike: column => `"${column}" ilike $N`, is: column => `"${column}" is not distinct from $N` };
      const where = params => state.filters.length ? ` where ${state.filters.map(([column, value, op]) => { params.push(value); return (OPS[op] ? OPS[op](column) : `"${column}" = $N`).replace('$N', `$${params.length}`); }).join(' and ')}` : '';
      const run = async () => {
        const params = [];
        let sql;
        if (state.op === 'insert') {
          // Como supabase-js: un objeto o una lista de objetos con las mismas llaves.
          const rows = Array.isArray(state.values) ? state.values : [state.values];
          const keys = Object.keys(rows[0]);
          const tuples = rows.map(row => `(${keys.map(key => { params.push(row[key] !== null && typeof row[key] === 'object' && !(row[key] instanceof Date) ? JSON.stringify(row[key]) : row[key]); return `$${params.length}`; }).join(', ')})`);
          // upsert(…, { onConflict }) como supabase-js: actualiza las demás columnas.
          const conflict = state.conflict ? ` on conflict ("${state.conflict}") do update set ${keys.filter(key => key !== state.conflict).map(key => `"${key}" = excluded."${key}"`).join(', ')}` : '';
          sql = `insert into public.${table} (${keys.map(key => `"${key}"`).join(', ')}) values ${tuples.join(', ')}${conflict} returning *`;
        } else if (state.op === 'update') {
          const keys = Object.keys(state.values);
          const sets = keys.map(key => { params.push(state.values[key]); return `"${key}" = $${params.length}`; }).join(', ');
          sql = `update public.${table} set ${sets}${where(params)} returning *`;
        } else if (state.op === 'delete') {
          sql = `delete from public.${table}${where(params)} returning *`;
        } else {
          const columns = state.columns === '*' ? '*' : state.columns.split(',').map(column => `"${column.trim()}"`).join(', ');
          sql = `select ${columns} from public.${table}${where(params)}${state.order.length ? ` order by ${state.order.map(([column, asc]) => `"${column}" ${asc ? 'asc' : 'desc'}`).join(', ')}` : ''}${state.limit ? ` limit ${Number(state.limit)}` : ''}`;
        }
        try {
          const result = await pg.query(sql, params);
          return { data: result.rows, error: null };
        } catch (error) {
          return { data: null, error };
        }
      };
      const chain = {
        select(columns = '*') { if (state.op === 'select') state.columns = columns; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.filters.push([column, values, 'in']); return chain; },
        ilike(column, pattern) { state.filters.push([column, pattern, 'ilike']); return chain; },
        is(column, value) { state.filters.push([column, value, 'is']); return chain; },
        limit(count) { state.limit = count; return chain; },
        upsert(values, { onConflict = 'id' } = {}) { state.op = 'insert'; state.values = values; state.conflict = onConflict; return chain; },
        order(column, { ascending = true } = {}) { state.order.push([column, ascending]); return chain; },
        insert(values) { state.op = 'insert'; state.values = values; return chain; },
        update(values) { state.op = 'update'; state.values = values; return chain; },
        delete() { state.op = 'delete'; return chain; },
        async single() { const { data, error } = await run(); return error ? { data: null, error } : data.length === 1 ? { data: data[0], error: null } : { data: null, error: new Error(`single: ${data.length} filas`) }; },
        async maybeSingle() { const { data, error } = await run(); return error ? { data: null, error } : { data: data[0] ?? null, error: null }; },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return chain;
    },
  };
}

