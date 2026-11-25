// Juan, 2026-11-25: "sí, permitamos editar el WhatsApp". Cada persona edita sólo su propio WhatsApp desde el menú del
// perfil; lo demás del perfil sigue en Usuarios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('servidor: PUT /api/me/whatsapp sólo cambia el WhatsApp del perfil de la sesión; espejo idéntico', () => {
  const server = read('../server/index.js');
  assert.equal(server, read('../api/[...path].js'));
  const start = server.indexOf("app.put('/api/me/whatsapp'");
  assert.ok(start > 0);
  const handler = server.slice(start, server.indexOf('\n});', start));
  assert.match(handler, /const \{ profile: currentProfile \} = await getAuthContext\(req\);/);
  assert.match(handler, /\.update\(\{ whatsapp_phone, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', currentProfile\.id\)/, 'sólo el propio perfil');
  assert.doesNotMatch(handler, /req\.(query|body)\??\.id/, 'el perfil nunca sale de la petición');
  assert.doesNotMatch(handler, /full_name|microsoft_email|role|commercial_area/, 'sólo el WhatsApp');
});

test('el número se acepta como lo escribe un comercial y se guarda en formato internacional', async () => {
  const src = read('../server/index.js');
  const pick = name => src.slice(src.indexOf(`export function ${name}`), src.indexOf('\n}\n', src.indexOf(`export function ${name}`)) + 2);
  const accessValidationError = message => Object.assign(new Error(message), { status: 400 });
  const mod = new Function('accessValidationError', `${pick('normalizeWhatsappPhone').replace('export ', '')}\n${pick('selfWhatsappPhone').replace('export ', '')}\nreturn selfWhatsappPhone;`);
  const selfWhatsappPhone = mod(accessValidationError);
  assert.equal(selfWhatsappPhone('300 123 4567'), '+573001234567');
  assert.equal(selfWhatsappPhone('(300) 123-4567'), '+573001234567');
  assert.equal(selfWhatsappPhone('57 300 123 4567'), '+573001234567');
  assert.equal(selfWhatsappPhone('+57 300 123 4567'), '+573001234567');
  assert.equal(selfWhatsappPhone('+1 305 555 0100'), '+13055550100');
  assert.equal(selfWhatsappPhone(''), null, 'vacío lo quita');
  assert.throws(() => selfWhatsappPhone('12345'), /Escriba el celular con sus 10 dígitos/);
});

test('el menú del perfil ofrece editar el WhatsApp propio y no a los agentes', () => {
  const menu = read('../src/shell/UserMenu.tsx');
  assert.match(menu, /'Agregar mi WhatsApp'/);
  assert.match(menu, /Sale en las propuestas que descarga en Cotizar/);
  const main = read('../src/main.tsx');
  assert.match(main, /onSaveWhatsapp=\{realProfile && realProfile\.identity_type !== 'agent' \? async value => \{ await api\('\/api\/me\/whatsapp', \{ method: 'PUT'/);
});
