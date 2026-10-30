// WhatsApp en el perfil de usuario del SIIO (migración 133).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

process.env.VERCEL = '1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
const { normalizeWhatsappPhone } = await import('../server/index.js');

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

test('la API acepta vacío o E.164 y rechaza otros formatos', () => {
  assert.equal(normalizeWhatsappPhone(undefined), null);
  assert.equal(normalizeWhatsappPhone('  '), null);
  assert.equal(normalizeWhatsappPhone(' +573001234567 '), '+573001234567');
  assert.throws(() => normalizeWhatsappPhone('3001234567'));
  assert.throws(() => normalizeWhatsappPhone('+57 300 123 4567'));
});

test('server/index.js y api/[...path].js siguen idénticos', () => {
  assert.equal(leer('../server/index.js'), leer('../api/[...path].js'));
});

test('al editar sin el campo se conserva el número guardado', () => {
  assert.match(leer('../server/index.js'), /req\.body\.whatsapp_phone === undefined \? \(existingProfile\.whatsapp_phone \?\? null\)/);
});

test('la migración 133 conserva el acceso a Programación del rol consulta (130) y guarda el WhatsApp', () => {
  const m = leer('../supabase/migrations/133_siio_whatsapp_perfil.sql');
  assert.match(m, /add column if not exists whatsapp_phone/);
  assert.match(m, /psi_sales_profiles_whatsapp_phone_e164_check/);
  assert.match(m, /'licitaciones','modulo_programacion'\)/);
  assert.match(m, /whatsapp_phone = nullif\(btrim\(p_profile->>'whatsapp_phone'\), ''\)/);
});

test('el formulario de usuarios tiene el campo y normaliza celulares de Colombia', () => {
  const src = leer('../src/main.tsx');
  assert.match(src, /<label>WhatsApp<input type="tel"/);
  assert.match(src, /whatsapp_phone: whatsapp/);
  assert.match(src, /\^3\\d\{9\}\$/);
});
