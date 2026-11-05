// Estudios de Seguridad Física — base de prueba compartida por las pruebas del módulo.
// PGlite con las migraciones reales del módulo y un doble mínimo de supabase-js (tablas y depósito) que traduce a SQL.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const PREPARER = { id: '11111111-1111-4111-8111-111111111111', role: 'colaborador' };
const MIGRATIONS = ['178_estudios_seguridad_base.sql', '179_estudios_seguridad_evidencias.sql'];

export async function database({ upTo = MIGRATIONS.length } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, role text not null);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_access_permissions (code text primary key, name text, description text, active boolean);
    create table public.psi_profile_permissions (profile_id uuid, permission_code text);
    insert into public.psi_sales_profiles values ('${PREPARER.id}', 'colaborador');
  `);
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
    from(table) {
      const state = { op: 'select', columns: '*', filters: [], order: [], values: null, returning: false };
      const where = params => state.filters.length ? ` where ${state.filters.map(([column, value]) => { params.push(value); return `"${column}" = $${params.length}`; }).join(' and ')}` : '';
      const run = async () => {
        const params = [];
        let sql;
        if (state.op === 'insert') {
          const keys = Object.keys(state.values);
          sql = `insert into public.${table} (${keys.map(key => `"${key}"`).join(', ')}) values (${keys.map((key, i) => { params.push(state.values[key]); return `$${i + 1}`; }).join(', ')}) returning *`;
        } else if (state.op === 'update') {
          const keys = Object.keys(state.values);
          const sets = keys.map(key => { params.push(state.values[key]); return `"${key}" = $${params.length}`; }).join(', ');
          sql = `update public.${table} set ${sets}${where(params)} returning *`;
        } else if (state.op === 'delete') {
          sql = `delete from public.${table}${where(params)} returning *`;
        } else {
          const columns = state.columns === '*' ? '*' : state.columns.split(',').map(column => `"${column.trim()}"`).join(', ');
          sql = `select ${columns} from public.${table}${where(params)}${state.order.length ? ` order by ${state.order.map(([column, asc]) => `"${column}" ${asc ? 'asc' : 'desc'}`).join(', ')}` : ''}`;
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

