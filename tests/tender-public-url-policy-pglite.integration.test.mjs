import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/026_tender_document_versions.sql', import.meta.url), 'utf8');
const functionSql = migration.match(/create or replace function public\.psi_is_public_https_url[\s\S]*?\$\$;/i)?.[0];
assert.ok(functionSql, 'La función de política URL debe poder extraerse de 026.');

const db = new PGlite();
await db.exec(functionSql);
const check = async url => (await db.query('select public.psi_is_public_https_url($1::text) as safe', [url])).rows[0].safe;

for (const safe of ['https://www.secop.gov.co/proceso/1', 'https://1.1.1.1/documento', 'https://[2606:4700:4700::1111]/x']) {
  assert.equal(await check(safe), true, `Debe admitir ${safe}`);
}
for (const unsafe of [
  'http://secop.gov.co/x', 'https://user:password@secop.gov.co/x', 'https://secop.gov.co:8443/x',
  'https://localhost/x', 'https://127.1/x', 'https://2130706433/x', 'https://0x7f000001/x', 'https://10.0.0.1/x', 'https://100.64.0.1/x', 'https://192.0.2.1/x',
  'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[fc00::1]/x',
  'https://[fe80::1]/x', 'https://[2001:db8::1]/x',
]) {
  assert.equal(await check(unsafe), false, `Debe rechazar ${unsafe}`);
}

await db.close();
console.log('PGlite public HTTPS URL policy passed');
