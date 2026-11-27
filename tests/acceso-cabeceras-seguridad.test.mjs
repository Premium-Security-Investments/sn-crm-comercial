import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// El servidor exige estas variables al cargarse; CRM_SKIP_LISTEN evita su propio puerto: aquí se levanta uno de prueba.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://tyfzjqzcpgwcjnxozaaf.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
process.env.CRM_SKIP_LISTEN = '1';
const { default: app } = await import('../server/index.js');
const { cspDirectives } = await import('../verticales/acceso/cabeceras-seguridad.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const avisos = [];
const warnOriginal = console.warn;
console.warn = (...args) => { if (args[0] === 'siio_csp_report') avisos.push(args[1]); else warnOriginal(...args); };

test('respuesta de la API: cabeceras de seguridad y sin X-Powered-By', async () => {
  const res = await fetch(`${base}/api/acceso/securityops`);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
});

test('CSP en modo solo reportar (no bloquea) y con los orígenes del inventario', async () => {
  const res = await fetch(`${base}/api/acceso/securityops`);
  assert.equal(res.headers.get('content-security-policy'), null, 'todavía no bloquea');
  const csp = res.headers.get('content-security-policy-report-only');
  assert.ok(csp);
  for (const parte of [
    "default-src 'self'",
    "script-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'https://tyfzjqzcpgwcjnxozaaf.supabase.co',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'report-uri /api/csp-report',
  ]) assert.ok(csp.includes(parte), `falta «${parte}» en ${csp}`);
  assert.ok(!csp.includes("'unsafe-eval'"));
});

test('el origen de Supabase sale de la variable, no de un valor fijo', () => {
  const d = cspDirectives({ NEXT_PUBLIC_SUPABASE_URL: 'https://otro.supabase.co/rest/v1' });
  assert.ok(d.connectSrc.includes('https://otro.supabase.co'));
});

test('receptor de reportes: registra lo esencial y responde 204', async () => {
  avisos.length = 0;
  const res = await fetch(`${base}/api/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://siio.sn.premiumsecurity.ai/#/tenders?x=1', 'effective-directive': 'connect-src', 'blocked-uri': 'https://evil.example/x' } }),
  });
  assert.equal(res.status, 204);
  assert.deepEqual(avisos, [{ directiva: 'connect-src', bloqueado: 'https://evil.example/x', pagina: 'https://siio.sn.premiumsecurity.ai' }]);
});

test('receptor de reportes: basura o demasiado grande no rompe nada', async () => {
  avisos.length = 0;
  const basura = await fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: '{no es json' });
  assert.equal(basura.status, 204);
  assert.equal(await basura.text(), '', 'sin detalles internos');
  const grande = await fetch(`${base}/api/csp-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(50_000) }) });
  assert.equal(grande.status, 204);
  assert.equal(avisos.length, 0);
});
