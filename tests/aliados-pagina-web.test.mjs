// La página web de los aliados y lo que Vig-IA lee en ella (Juan, 2026-11-26; migración 240).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeCfEmail, fetchPage, htmlToText, isPrivateAddress, normalizeWebsite, normalizeWebsiteInfo, pickInternalLinks,
  readSite, saveAndReadAllyWebsite, WEBSITE_OUTPUT_SCHEMA,
} from '../verticales/licitaciones/aliados-pagina-web.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const html = body => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), arrayBuffer: async () => Buffer.from(body) });

test('normalizeWebsite completa https y rechaza lo que no es una web pública', () => {
  assert.equal(normalizeWebsite('intergroup.com.co'), 'https://intergroup.com.co/');
  assert.equal(normalizeWebsite(' https://seproltda.com/#inicio '), 'https://seproltda.com/');
  assert.equal(normalizeWebsite(''), null);
  for (const bad of ['ftp://x.com', 'https://user:pw@x.com', 'https://x.com:8080', 'javascript:alert(1)', 'localhost']) {
    assert.throws(() => normalizeWebsite(bad), /no es válida/, bad);
  }
});

test('isPrivateAddress cierra la red interna del servidor', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('fetchPage no abre direcciones internas ni sigue redirecciones hacia ellas', async () => {
  await assert.rejects(() => fetchPage('http://metadata.google.internal/', { fetchImpl: async () => html('x'), lookup: publicLookup }), /no es una página pública/);
  await assert.rejects(() => fetchPage('https://x.com/', { fetchImpl: async () => html('x'), lookup: async () => [{ address: '10.0.0.5' }] }), /no es una página pública/);
  const redirect = { status: 302, ok: false, headers: new Headers({ location: 'http://169.254.169.254/latest' }), arrayBuffer: async () => Buffer.alloc(0) };
  await assert.rejects(() => fetchPage('https://x.com/', { fetchImpl: async () => redirect, lookup: publicLookup }), /no es una página pública/);
});

test('decodeCfEmail y htmlToText dejan a la vista los correos escondidos, mailto, tel y WhatsApp', () => {
  // «comercial@tacseguridad.com» con llave 0x42.
  const email = 'comercial@tacseguridad.com';
  const hex = '42' + [...email].map(ch => (ch.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCfEmail(hex), email);
  const text = htmlToText(`<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Sedes</h1><p>Bogot&aacute; &ndash; Calle 28</p>
    <a href="/cdn-cgi/l/email-protection#${hex}">[email&#160;protected]</a><a href="tel:+573154018460">Llamar</a><a href="https://wa.me/573142105900">WA</a><a href="mailto:contacto@x.co">c</a></body></html>`);
  assert.match(text, /Bogotá – Calle 28/);
  assert.doesNotMatch(text, /alert|\.x\{/);
  assert.match(text, /comercial@tacseguridad\.com/);
  assert.match(text, /tel:\+573154018460/);
  assert.match(text, /wa\.me\/573142105900/);
  assert.match(text, /mailto:contacto@x\.co/);
});

test('pickInternalLinks toma sólo páginas útiles del mismo sitio', () => {
  const links = pickInternalLinks(`<a href="/contactanos/">Contáctanos</a><a href="https://www.x.com/sedes">Sedes</a><a href="/blog/post">Blog</a>
    <a href="https://otra.com/contacto">Otra</a><a href="/servicios/">Servicios</a><a href="/contactanos/">Repetida</a><a href="/doc.pdf">Documentos</a>`, 'https://x.com/');
  assert.deepEqual(links, ['https://x.com/contactanos/', 'https://www.x.com/sedes', 'https://x.com/servicios/']);
  // Con el cupo lleno, contacto y sedes ganan a los servicios (Inter Group, 26-nov: se quedaba sin la página de sedes).
  const many = pickInternalLinks(`<a href="/servicio-a/">Servicio A</a><a href="/servicio-b/">Servicio B</a><a href="/nosotros/">Nosotros</a><a href="/sedes/">Sedes</a>`, 'https://x.com/', 2);
  assert.deepEqual(many, ['https://x.com/sedes/', 'https://x.com/nosotros/']);
});

test('readSite lee la portada y las páginas útiles, y falla claro si no hay texto', async () => {
  const pages = {
    'https://x.com/': '<p>Seguridad X Ltda. Vigilancia y seguridad privada con licencia de la Supervigilancia, oficinas en Cali y Bogotá.</p><a href="/sedes/">Sedes</a>',
    'https://x.com/sedes/': '<p>Cali: Cra 74a No. 11a-57 · Bogotá: Calle 28 No. 13a-24</p>',
  };
  const read = await readSite('https://x.com/', { fetchImpl: async url => html(pages[url] || ''), lookup: publicLookup });
  assert.deepEqual(read.map(page => page.url), ['https://x.com/', 'https://x.com/sedes/']);
  await assert.rejects(() => readSite('https://x.com/', { fetchImpl: async () => html('<img src="a.png">'), lookup: publicLookup }), /no tiene texto legible/);
});

test('normalizeWebsiteInfo recorta, rellena lo que falta y no deja pasar campos fuera del esquema', () => {
  const info = normalizeWebsiteInfo({ misma_empresa: 'quizá', razon_social: '  X  ', sedes: [{ ciudad: 'Bogotá', tipo: 'regional' }, {}], modalidades: { armada: 'si', canina: 'tal vez' }, extra: 'no', telefonos: ['1', '', 2] }, { pages: [{ url: 'https://x.com/' }] });
  assert.equal(info.misma_empresa, 'no_seguro');
  assert.equal(info.razon_social, 'X');
  assert.deepEqual(info.sedes, [{ ciudad: 'Bogotá', tipo: 'regional', direccion: '', telefono: '', correo: '' }]);
  assert.deepEqual(info.modalidades, { armada: 'si', sin_armas: 'no_dice', canina: 'no_dice', medios_tecnologicos: 'no_dice', escoltas: 'no_dice' });
  assert.deepEqual(info.telefonos, ['1']);
  assert.deepEqual(info.paginas_leidas, ['https://x.com/']);
  assert.equal('extra' in info, false);
  assert.deepEqual(Object.keys(WEBSITE_OUTPUT_SCHEMA.properties).sort(), WEBSITE_OUTPUT_SCHEMA.required.slice().sort());
});

function fakeDb() {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { nit: args.p_nit, name: 'SEGURIDAD X LTDA', website: args.p_website, website_info: args.p_info ?? null }, error: null }; },
  };
}
const ON = {
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'sonnet',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/v1/agt002-preview/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(40),
  AGT002_WORKBENCH_AGENT_ID: 'a0020000-0000-4000-8000-000000000002', AGT002_WORKBENCH_WORKER_ID: 'prueba',
};

test('saveAndReadAllyWebsite guarda la web, la lee con Vig-IA y deja lo leído sin aprobación', async () => {
  const database = fakeDb();
  const bridgeClient = { run: async request => {
    assert.equal(request.outputSchema, WEBSITE_OUTPUT_SCHEMA);
    assert.equal(request.timeoutMs, 90_000);
    assert.equal(request.input.empresa_registrada.nit, '901428196');
    assert.equal(request.input.paginas[0].url, 'https://x.com/');
    return { content: JSON.stringify({ misma_empresa: 'si', razon_social: 'Seguridad X', sedes: [{ ciudad: 'Cali', tipo: 'principal', direccion: 'Cra 1', telefono: '', correo: '' }], resumen: 'Cali.' }) };
  } };
  const result = await saveAndReadAllyWebsite(database, {
    actorId: 'u1', nit: '901.428.196', website: 'x.com', environment: ON, bridgeClient, log: () => {},
    fetchImpl: async () => html('<p>Seguridad X Ltda. Vigilancia y seguridad privada con licencia de la Supervigilancia en Cali.</p>'), lookup: publicLookup,
  });
  assert.equal(result.read, 'ok');
  assert.deepEqual(database.calls.map(call => call.name), ['psi_save_vigilance_website', 'psi_save_vigilance_website_reading']);
  assert.equal(database.calls[0].args.p_website, 'https://x.com/');
  const reading = database.calls[1].args;
  assert.equal(reading.p_website, 'https://x.com/');
  assert.equal(reading.p_error, null);
  assert.equal(reading.p_info.sedes[0].ciudad, 'Cali');
});

test('saveAndReadAllyWebsite: si la web no abre, la dirección queda y el error se registra', async () => {
  const database = fakeDb();
  const result = await saveAndReadAllyWebsite(database, {
    actorId: 'u1', nit: '830094607', website: 'https://seproltda.com/', environment: ON, log: () => {},
    bridgeClient: { run: async () => { throw new Error('no debía llamarse'); } },
    fetchImpl: async () => ({ status: 503, ok: false, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) }), lookup: publicLookup,
  });
  assert.equal(result.read, 'error');
  assert.match(result.error, /No se pudo abrir/);
  assert.equal(database.calls[1].args.p_info, null);
  assert.match(database.calls[1].args.p_error, /No se pudo abrir/);
});

test('saveAndReadAllyWebsite: quitar la web no llama a Vig-IA; una dirección inválida no se guarda', async () => {
  const database = fakeDb();
  const result = await saveAndReadAllyWebsite(database, { actorId: 'u1', nit: '830094607', website: '', environment: ON, log: () => {} });
  assert.equal(result.read, 'no');
  assert.deepEqual(database.calls.map(call => call.name), ['psi_save_vigilance_website']);
  await assert.rejects(() => saveAndReadAllyWebsite(fakeDb(), { actorId: 'u1', nit: '830094607', website: 'ftp://x.com' }), /no es válida/);
});

test('la migración 240 crea las funciones con permisos sólo para el servidor', () => {
  const sql = readFileSync(new URL('../supabase/migrations/240_aliados_pagina_web.sql', import.meta.url), 'utf8');
  for (const signature of ['psi_save_vigilance_website(uuid, text, text)', 'psi_save_vigilance_website_reading(uuid, text, text, jsonb, text)']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')} to service_role`));
  }
  assert.match(sql, /perform public\.psi_assert_allies_actor\(p_actor_id\)/);
});
