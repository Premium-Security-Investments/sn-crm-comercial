// BLOCKER 2 — proyeccion API segura y descarga documental autenticada.
//
// Dos afirmaciones, y solo dos, sobre como sale un documento de licitacion hacia
// el navegador:
//
//   1. EL LISTADO NO LLEVA CAPACIDADES. `publicTenderDocumentProjection` es la
//      ultima barrera y es una lista BLANCA: un registro documental llega mezclado
//      —fila tipada de psi_tender_document_versions mas carga historica libre de
//      psi_sales_interactions.notes—, asi que enumerar lo prohibido dejaria pasar
//      la proxima clave interna. Quedan fuera `storage_path` (ruta privada del
//      bucket), `source_url` (en SECOP, la URL de descarga CON token firmado),
//      `extracted_text` / `metadata` / `error`, y tambien `signed_url`: una URL
//      firmada es una CAPACIDAD de descarga —quien la tiene baja el archivo sin
//      volver a pasar por getAuthContext—, no un campo del expediente. Listar el
//      expediente acunaba una por documento, para todos, aunque el usuario no
//      fuera a abrir ninguno.
//
//   2. LA DESCARGA ES UN GET AUTENTICADO PROPIO:
//      GET /api/tender-documents/:documentId/download. Lo unico que la interfaz
//      recibe es `download_url`, una ruta SAME-ORIGIN que calcula el servidor a
//      partir de identificadores validados y que no concede nada por si misma. La
//      capacidad se emite dentro de esa peticion, ya autenticada y ya autorizada
//      la oportunidad, para ese unico documento, por 120 segundos, y viaja solo en
//      el Location de un 302 marcado `private, no-store`.
//
// Ejecutar: node tests/security/tender-api-projection.test.mjs

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { publicTenderDocumentProjection, tenderDocumentDownloadUrl } from '../../tender-document-extraction-persistence.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const root = new URL('../../', import.meta.url);

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPPORTUNITY_ID = '99999999-9999-4999-8999-999999999999';
const HUMAN_ID = '33333333-3333-4333-8333-333333333333';

// Secretos que jamas pueden aparecer en una respuesta al navegador.
const STORAGE_PATH = `tender-documents/${OPPORTUNITY_ID}/SECOP-DOC-0001/abc123-Pliego.pdf`;
const TOKENIZED_SOURCE_URL = 'https://community.secop.gov.co/Public/Descarga?docId=9&token=FIRMA-SECRETA-1234';
const SECRET_TEXT = 'CONFIDENCIAL: clausulas y precios internos del pliego.';
const SIGNED_URL = 'https://proyecto.supabase.co/storage/v1/object/sign/tender-documents/x?token=CAPACIDAD-FILTRADA';

function assertSameOrigin(url, message) {
  assert.equal(typeof url, 'string', message);
  assert.equal(url.startsWith('/api/'), true, message);
  // Ni esquema, ni `//host`, ni salto de origen encubierto.
  assert.doesNotMatch(url, /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\//, message);
}

// ===========================================================================
// 1. Lista blanca: ninguna capacidad viaja, y la interfaz recibe la ruta
//    same-origin que necesita para pedir la descarga.
// ===========================================================================
{
  const document = {
    // --- lo que la interfaz consume ---
    id: 'version-1',
    name: 'Pliego de condiciones.pdf',
    size: 182_331,
    size_bytes: 182_331,
    mime_type: 'application/pdf',
    document_type: 'pliego',
    current: true,
    uploaded_at: '2026-08-01T10:00:00Z',
    uploaded_by: 'Katherine',
    version: 3,
    content_hash: hash('bytes del pliego'),
    source: 'SECOP II',
    source_document_id: 'SECOP-DOC-0001',
    extraction_status: 'ok',
    extraction_version: 'tender-document-text-extraction@3',
    extraction_parser: 'pdf-parse',
    extraction_char_count: 4211,
    extraction_text_hash: hash(SECRET_TEXT),
    // --- lo que NUNCA puede salir ---
    signed_url: SIGNED_URL,
    storage_path: STORAGE_PATH,
    source_url: TOKENIZED_SOURCE_URL,
    extracted_text: SECRET_TEXT.repeat(50),
    metadata: { raw_dump: SECRET_TEXT, bucket: 'tender-documents' },
    error: 'ENOENT /home/worker/app/tender-documents/x.pdf',
  };

  const projected = publicTenderDocumentProjection(document, { opportunityId: OPPORTUNITY_ID });

  // La descarga existe, pero como ruta a un endpoint autenticado, no como permiso.
  assertSameOrigin(projected.download_url, 'la descarga publica debe ser una ruta same-origin del backend');
  assert.equal(
    projected.download_url,
    `/api/tender-documents/version-1/download?opportunity_id=${OPPORTUNITY_ID}`,
    'la ruta se compone del id del documento y del id de la oportunidad, nada mas',
  );

  assert.equal(projected.id, 'version-1');
  assert.equal(projected.name, 'Pliego de condiciones.pdf');
  assert.equal(projected.document_type, 'pliego');
  assert.equal(projected.current, true);
  assert.equal(projected.size, 182_331);
  assert.equal(projected.uploaded_at, '2026-08-01T10:00:00Z');
  assert.equal(projected.uploaded_by, 'Katherine');
  assert.equal(projected.extraction_status, 'ok');
  assert.equal(projected.extraction_char_count, 4211);
  assert.equal(projected.extraction_text_hash, hash(SECRET_TEXT));

  // Detalles de almacenamiento, bypasses de descarga y capacidades: fuera.
  for (const field of ['signed_url', 'storage_path', 'source_url', 'extracted_text', 'metadata', 'error']) {
    assert.equal(field in projected, false, `la proyeccion publica nunca puede exponer ${field}`);
  }

  const serialized = JSON.stringify(projected);
  for (const secret of [
    SIGNED_URL, STORAGE_PATH, TOKENIZED_SOURCE_URL, SECRET_TEXT,
    'FIRMA-SECRETA-1234', 'CAPACIDAD-FILTRADA', `tender-documents/${OPPORTUNITY_ID}`,
  ]) {
    assert.equal(serialized.includes(secret), false, `la proyeccion publica no puede serializar ${secret}`);
  }
  assert.equal(/token=/.test(serialized), false, 'ninguna respuesta del listado puede llevar un token');
}

// ===========================================================================
// 2. Es lista BLANCA, no negra: una clave interna NUEVA aguas arriba tampoco
//    sale, sin que nadie tenga que acordarse de anadirla a una lista negra.
// ===========================================================================
{
  const projected = publicTenderDocumentProjection({
    id: 'doc-1',
    name: 'Anexo.pdf',
    // Claves internas que hoy no existen pero podrian anadirse manana.
    bucket: 'tender-documents',
    bucket_id: 'private-bucket-9',
    service_role_key: 'sbp_secreto',
    internal_notes: 'ruta interna /srv/app/data',
    raw_url: 'https://storage.internal/raw/doc-1',
    absolute_path: '/home/worker/app/data/doc-1.pdf',
  }, { opportunityId: OPPORTUNITY_ID });
  assert.deepEqual(
    Object.keys(projected).sort(),
    ['download_url', 'extraction_status', 'id', 'name'],
    'solo sobreviven las claves explicitamente publicas mas la ruta de descarga calculada',
  );
  assert.equal(projected.extraction_status, 'legacy');
}

// ===========================================================================
// 3. Payloads HISTORICOS y ANIDADOS. Los documentos legados salen de
//    psi_sales_interactions.notes (JSON libre escrito por versiones anteriores
//    del backend), asi que pueden traer lo interno enterrado a cualquier nivel
//    —y pueden traer su propia `download_url`, que jamas debe ganar.
// ===========================================================================
{
  const legacy = {
    id: 'legacy-1',
    name: 'Anexo historico.pdf',
    document_type: 'anexo',
    current: true,
    uploaded_at: '2024-03-01T00:00:00Z',
    mime_type: 'application/pdf',
    // Capacidades y rutas heredadas del payload historico.
    signed_url: SIGNED_URL,
    download_url: 'https://atacante.example/exfiltrar?doc=legacy-1',
    // Objeto anidado bajo una clave publica.
    source: { label: 'SECOP II', storage_path: STORAGE_PATH, url: TOKENIZED_SOURCE_URL, download_url: 'https://atacante.example/anidado' },
    // Estructuras profundas dentro de una clave publica.
    content_hash: hash('x'),
    version: 1,
    uploaded_by: {
      full_name: 'Sistema',
      audit: [
        { step: 'upload', storage_path: STORAGE_PATH },
        { step: 'sign', nested: { deeper: { source_url: TOKENIZED_SOURCE_URL, extracted_text: SECRET_TEXT, signed_url: SIGNED_URL } } },
      ],
    },
  };

  const projected = publicTenderDocumentProjection(legacy, { opportunityId: OPPORTUNITY_ID });
  const serialized = JSON.stringify(projected);

  assert.equal(projected.name, 'Anexo historico.pdf', 'un documento historico sigue siendo utilizable');
  assert.equal(projected.source.label, 'SECOP II', 'lo publico anidado se conserva');
  assert.equal(
    projected.download_url,
    `/api/tender-documents/legacy-1/download?opportunity_id=${OPPORTUNITY_ID}`,
    'la ruta de descarga la calcula el servidor; la del payload historico se descarta',
  );
  for (const secret of [SIGNED_URL, STORAGE_PATH, TOKENIZED_SOURCE_URL, SECRET_TEXT, 'FIRMA-SECRETA-1234', 'atacante.example']) {
    assert.equal(serialized.includes(secret), false, `un payload historico anidado tampoco puede filtrar ${secret}`);
  }
  assert.equal('storage_path' in projected.source, false);
  assert.equal('url' in projected.source, false);
  assert.equal('download_url' in projected.source, false);

  // Fail-closed: sin oportunidad autorizada no hay ruta, y NUNCA la del payload.
  const orphan = publicTenderDocumentProjection(legacy);
  assert.equal(orphan.download_url, null, 'sin identidad de oportunidad la proyeccion no inventa ni hereda ruta');
}

// ===========================================================================
// 4. Defensivo: nulls, tipos raros y datos legados no pueden hacerla estallar.
// ===========================================================================
{
  assert.deepEqual(publicTenderDocumentProjection(), { extraction_status: 'legacy', download_url: null });
  assert.deepEqual(publicTenderDocumentProjection(null), { extraction_status: 'legacy', download_url: null });
  assert.deepEqual(publicTenderDocumentProjection({}), { extraction_status: 'legacy', download_url: null });
  assert.deepEqual(publicTenderDocumentProjection('no es un objeto'), { extraction_status: 'legacy', download_url: null });

  const withNulls = publicTenderDocumentProjection({ id: 'd', name: null, mime_type: null, current: false, size: 0 }, { opportunityId: OPPORTUNITY_ID });
  assert.equal(withNulls.name, null);
  assert.equal(withNulls.current, false);
  assert.equal(withNulls.size, 0, 'un cero legitimo no puede perderse');

  // Una estructura ciclica no puede colgar el servidor.
  const cyclic = { id: 'd', name: 'ciclo.pdf', source: {} };
  cyclic.source.self = cyclic.source;
  cyclic.source.storage_path = STORAGE_PATH;
  const projectedCyclic = publicTenderDocumentProjection(cyclic, { opportunityId: OPPORTUNITY_ID });
  assert.equal(JSON.stringify(projectedCyclic).includes(STORAGE_PATH), false);

  // `__proto__` en un payload historico no puede contaminar el prototipo.
  const polluted = publicTenderDocumentProjection(JSON.parse('{"id":"d","source":{"__proto__":{"contaminado":true}}}'));
  assert.equal({}.contaminado, undefined, 'la proyeccion no puede contaminar Object.prototype');
  assert.equal(Object.getPrototypeOf(polluted.source), Object.prototype);
}

// ===========================================================================
// 5. Construccion de la ruta: solo identificadores validados y normalizados.
// ===========================================================================
{
  assert.equal(tenderDocumentDownloadUrl(), null, 'sin argumentos no hay ruta');
  assert.equal(tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID }), null, 'sin documento no hay ruta');
  assert.equal(tenderDocumentDownloadUrl({ documentId: 'doc-1' }), null, 'sin oportunidad no hay ruta');
  assert.equal(tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: '' }), null);
  assert.equal(tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: '   ' }), null);
  assert.equal(tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: null }), null);

  // Nada que pueda torcer la ruta produce ruta: ni travesias, ni segmentos, ni
  // consultas inyectadas, ni identificadores desmedidos.
  for (const hostile of [
    '../../otra-oportunidad', 'a/b', 'doc?opportunity_id=' + OTHER_OPPORTUNITY_ID,
    'doc#fragmento', 'doc 1', 'doc\n1', 'https://atacante.example/x', 'x'.repeat(129),
  ]) {
    assert.equal(
      tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: hostile }),
      null,
      `un identificador hostil no puede producir ruta: ${JSON.stringify(hostile)}`,
    );
    assert.equal(
      tenderDocumentDownloadUrl({ opportunityId: hostile, documentId: 'doc-1' }),
      null,
      `una oportunidad hostil no puede producir ruta: ${JSON.stringify(hostile)}`,
    );
  }

  // Las dos identidades vigentes del expediente: uuid tipado y hash historico.
  const typed = tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' });
  assertSameOrigin(typed, 'la ruta del documento tipado es same-origin');
  assert.equal(typed, `/api/tender-documents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/download?opportunity_id=${OPPORTUNITY_ID}`);
  const legacyPath = tenderDocumentDownloadUrl({ opportunityId: OPPORTUNITY_ID, documentId: '0123456789abcdef01234567' });
  assert.equal(legacyPath, `/api/tender-documents/0123456789abcdef01234567/download?opportunity_id=${OPPORTUNITY_ID}`);
}

// ===========================================================================
// 6. Cableado del backend, verificado sobre el codigo real de los dos backends.
// ===========================================================================
const server = readFileSync(new URL('server/index.js', root), 'utf8');
const api = readFileSync(new URL('api/[...path].js', root), 'utf8');
{
  assert.equal(server, api, 'los dos backends deben permanecer byte-identical');

  for (const source of [server, api]) {
    // La respuesta publica pasa siempre por la proyeccion, y la proyeccion recibe
    // la oportunidad ya autorizada: la ruta de descarga es server-owned.
    assert.match(
      source,
      /documents: includeExtractedText \? compatibleDocuments : compatibleDocuments\.map\(document => publicTenderDocumentProjection\(document, \{ opportunityId \}\)\)/,
      'la respuesta publica debe proyectarse con la oportunidad ya autorizada',
    );

    // Ni el listado ni ninguna lectura interna acunan URLs firmadas: la capacidad
    // por documento desaparecio junto con la opcion que la habilitaba.
    const records = source.match(/async function getTenderDocumentRecords[\s\S]*?\n}\n\n/);
    assert.ok(records, 'debe existir el constructor compartido de la respuesta documental');
    assert.equal(records[0].includes('createSignedUrl'), false, 'el listado del expediente no puede firmar ninguna URL');
    assert.equal(records[0].includes('signed_url'), false, 'el listado del expediente no puede emitir signed_url');
    assert.equal(source.includes('includeSignedUrls'), false, 'la capacidad de firmar N URLs en una lectura ya no debe existir');
    assert.doesNotMatch(source, /createSignedUrl\(doc\.storage_path/, 'no puede quedar ninguna firma masiva por documento');
    assert.doesNotMatch(source, /getPublicUrl\(/, 'ningun documento del expediente puede exponerse por URL publica de bucket');

    // Solo tres firmas en todo el backend, cada una para UN objeto ya autorizado:
    // ficha empresarial, adjunto de respuesta humana y descarga documental.
    assert.equal(
      source.split('createSignedUrl(').length - 1,
      3,
      'solo la ficha empresarial, el adjunto de respuesta y la descarga documental pueden firmar',
    );

    // Contrato ajeno que no se toca: los adjuntos de respuestas humanas siguen
    // descargandose por su propia URL firmada.
    assert.match(source, /createSignedUrl\(tenderQuestionResponseAttachmentBucketRelativePath/, 'los adjuntos de respuestas humanas conservan su contrato');

    // El endpoint de descarga: existe, y hace las cosas en el unico orden seguro.
    assert.match(source, /const TENDER_DOCUMENT_DOWNLOAD_TTL_SECONDS = 120;/, 'la capacidad de descarga dura 120 segundos');
    const route = source.match(/app\.get\('\/api\/tender-documents\/:documentId\/download'[\s\S]*?\n}\);/);
    assert.ok(route, 'debe existir el GET autenticado de descarga documental');
    const body = route[0];
    for (const step of ['getAuthContext(req)', 'requireDb()', 'requireTenderAnalysisFoundation(database)', 'ensureTenderOpportunity(database, opportunityId, currentProfile)']) {
      assert.ok(body.includes(step), `la descarga debe pasar por ${step}`);
    }
    assert.ok(
      body.indexOf('ensureTenderOpportunity') < body.indexOf('findTenderDocumentForDownload'),
      'la oportunidad se autoriza antes de resolver el documento',
    );
    assert.ok(
      body.indexOf('ensureTenderOpportunity') < body.indexOf('createSignedUrl'),
      'la oportunidad se autoriza antes de emitir la capacidad',
    );
    assert.match(body, /createSignedUrl\(objectKey, TENDER_DOCUMENT_DOWNLOAD_TTL_SECONDS, \{ download: downloadName \}\)/, 'se firma solo el objeto pedido, con nombre de descarga y TTL corto');
    assert.match(body, /'Cache-Control': 'private, no-store'/, 'la respuesta de descarga no puede quedar cacheada');
    assert.match(body, /res\.status\(302\)\.end\(\)/, 'la descarga responde 302 sin cuerpo');
    assert.equal(body.includes('res.json('), false, 'la descarga nunca devuelve JSON con la URL, la ruta ni el token');

    // Resolucion acotada a la oportunidad, sobre las dos fuentes vigentes.
    const resolver = source.match(/async function findTenderDocumentForDownload[\s\S]*?\n}\n/);
    assert.ok(resolver, 'debe existir el resolutor acotado a la oportunidad');
    assert.match(resolver[0], /\.eq\('opportunity_id', opportunityId\)/, 'la version tipada se busca dentro de la oportunidad');
    assert.match(resolver[0], /psi_sales_interactions[\s\S]*?\.eq\('opportunity_id', opportunityId\)/, 'la carga historica se busca dentro de la oportunidad');

    // La ruta guardada tiene que caer dentro del prefijo de la oportunidad.
    const guard = source.match(/function tenderDocumentObjectKeyForOpportunity[\s\S]*?\n}\n/);
    assert.ok(guard, 'debe existir la validacion de la clave de almacenamiento');
    assert.match(guard[0], /includes\('\.\.'\)/, 'una travesia heredada de un payload antiguo no se firma');
    assert.match(guard[0], /startsWith\(prefix\)/, 'solo se firma dentro del prefijo de la oportunidad');

    // Nada de esto se persiste ni entra en el expediente inmutable.
    assert.equal(body.includes('registerTenderDocumentSnapshot'), false, 'la descarga no toca el snapshot');
    assert.equal(body.includes('insert('), false, 'la descarga no persiste nada');
  }
}

// ===========================================================================
// 7. Comportamiento real del endpoint contra los dos backends: autenticacion,
//    autorizacion por oportunidad, 302 sin cuerpo, TTL 120 y fail-closed.
// ===========================================================================
const TEST_SERVICE_KEY = 'test-service-key';
const TYPED_DOCUMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TYPED_STORAGE_PATH = `tender-documents/${OPPORTUNITY_ID}/SECOP-DOC-0001/${'a'.repeat(64)}-Pliego.pdf`;
const FOREIGN_DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const FOREIGN_STORAGE_PATH = `tender-documents/${OTHER_OPPORTUNITY_ID}/SECOP-DOC-9999/${'b'.repeat(64)}-Reservado.pdf`;
const LEGACY_DOCUMENT_ID = '0123456789abcdef01234567';
const LEGACY_STORAGE_PATH = `${OPPORTUNITY_ID}/${LEGACY_DOCUMENT_ID}-Anexo historico.pdf`;
const STOLEN_DOCUMENT_ID = 'ffffffffffffffffffffffff';
const TRAVERSAL_DOCUMENT_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

const TYPED_VERSIONS = [
  { id: TYPED_DOCUMENT_ID, opportunity_id: OPPORTUNITY_ID, name: 'Pliego de condiciones.pdf', storage_path: TYPED_STORAGE_PATH },
  { id: FOREIGN_DOCUMENT_ID, opportunity_id: OTHER_OPPORTUNITY_ID, name: 'Reservado.pdf', storage_path: FOREIGN_STORAGE_PATH },
];

const INTERACTIONS = {
  [OPPORTUNITY_ID]: [{
    id: 'upload-1',
    created_at: '2024-03-01T00:00:00.000Z',
    notes: JSON.stringify({
      kind: 'tender_document_upload',
      documents: [
        { id: LEGACY_DOCUMENT_ID, name: 'Anexo historico.pdf', current: true, storage_path: LEGACY_STORAGE_PATH },
        // Payload historico envenenado: apunta al bucket de OTRA oportunidad.
        { id: STOLEN_DOCUMENT_ID, name: 'Robado.pdf', current: true, storage_path: FOREIGN_STORAGE_PATH },
        // Payload historico con travesia de directorios.
        { id: TRAVERSAL_DOCUMENT_ID, name: 'Travesia.pdf', current: true, storage_path: `${OPPORTUNITY_ID}/../${OTHER_OPPORTUNITY_ID}/Reservado.pdf` },
      ],
    }),
  }],
  [OTHER_OPPORTUNITY_ID]: [],
};

const actor = {
  user: { id: 'human-auth', email: 'licitaciones@example.test' },
  profile: { id: HUMAN_ID, full_name: 'Licitaciones', microsoft_email: 'licitaciones@example.test', auth_user_id: 'human-auth', role: 'admin', active: true, identity_type: 'human' },
  areas: [{ area_code: 'licitaciones', subarea_code: null }],
  permissions: [{ permission_code: 'licitaciones' }],
};

const state = { signedReads: [] };

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function eqParam(url, name) {
  return String(url.searchParams.get(name) || '').replace(/^eq\./, '');
}
async function listen(server_) {
  await new Promise(resolve => server_.listen(0, '127.0.0.1', resolve));
  return server_.address().port;
}
function requestRaw(port, path, token) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port, path, method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on('error', reject);
    request.end();
  });
}

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return token === 'human-token' ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    return eqParam(url, 'auth_user_id') === actor.user.id ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, actor.areas);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, actor.permissions);
  // Guardia de fundacion documental (migracion 025).
  if (url.pathname === '/rest/v1/psi_tender_document_snapshots') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_tender_analysis_runs') return json(res, 200, []);
  if (url.pathname === '/rest/v1/rpc/psi_tender_analysis_foundation_ready') return json(res, 200, true);
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const id = eqParam(url, 'id');
    if (![OPPORTUNITY_ID, OTHER_OPPORTUNITY_ID].includes(id)) return json(res, 406, { code: 'PGRST116', message: 'not found' });
    return json(res, 200, { id, owner_id: HUMAN_ID, customer_segment: 'cliente_nuevo' });
  }
  if (url.pathname === '/rest/v1/v_psi_sales_opportunity_enriched') {
    const id = eqParam(url, 'id');
    if (![OPPORTUNITY_ID, OTHER_OPPORTUNITY_ID].includes(id)) return json(res, 406, { code: 'PGRST116', message: 'not found' });
    return json(res, 200, { id, owner_id: HUMAN_ID, company_name: 'Entidad', service_type_code: 'licitacion_publica' });
  }
  if (url.pathname === '/rest/v1/psi_tender_document_versions') {
    const opportunityId = eqParam(url, 'opportunity_id');
    return json(res, 200, TYPED_VERSIONS.filter(row => row.opportunity_id === opportunityId));
  }
  if (url.pathname === '/rest/v1/psi_sales_interactions') {
    return json(res, 200, INTERACTIONS[eqParam(url, 'opportunity_id')] || []);
  }
  const signedRead = url.pathname.match(/^\/storage\/v1\/object\/sign\/tender-documents\/(.+)$/);
  if (signedRead && req.method === 'POST') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const parsed = JSON.parse(payload || '{}');
      state.signedReads.push({ path: decodeURIComponent(signedRead[1]), expiresIn: parsed.expiresIn });
      json(res, 200, { signedURL: `${url.pathname.replace('/storage/v1', '')}?token=read-token` });
    });
  }
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
process.env.VERCEL = '1';

const originalConsoleError = console.error;
let appServer = null;
try {
  console.error = () => {};
  const modules = [await import('../../server/index.js'), await import('../../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    state.signedReads.length = 0;
    appServer = http.createServer(module.default);
    const port = await listen(appServer);
    const download = (documentId, opportunityId, token = 'human-token') =>
      requestRaw(port, `/api/tender-documents/${encodeURIComponent(documentId)}/download${opportunityId ? `?opportunity_id=${encodeURIComponent(opportunityId)}` : ''}`, token);
    try {
      // Sin sesion no hay descarga, ni siquiera un indicio de que el documento exista.
      const anonymous = await download(TYPED_DOCUMENT_ID, OPPORTUNITY_ID, null);
      assert.equal(anonymous.status, 401, `backend ${index} exige sesion para descargar`);
      assert.equal(state.signedReads.length, 0, `backend ${index} no firma nada antes de autenticar`);

      // Sin oportunidad no hay capacidad que emitir.
      const withoutOpportunity = await download(TYPED_DOCUMENT_ID, '');
      assert.equal(withoutOpportunity.status, 400, `backend ${index} exige la oportunidad`);
      assert.equal(state.signedReads.length, 0, `backend ${index} no firma sin oportunidad`);

      // Documento de OTRA oportunidad pedido bajo esta: no existe aqui.
      const foreign = await download(FOREIGN_DOCUMENT_ID, OPPORTUNITY_ID);
      assert.equal(foreign.status, 404, `backend ${index} no cruza documentos entre oportunidades`);

      // Documento inexistente: el mismo error, sin filtrar existencia ajena.
      const missing = await download('no-existe', OPPORTUNITY_ID);
      assert.equal(missing.status, 404, `backend ${index} responde 404 a un documento inexistente`);
      assert.deepEqual(
        JSON.parse(missing.text),
        JSON.parse(foreign.text),
        `backend ${index} responde identico a "no existe" y a "no es tuyo"`,
      );
      assert.equal(state.signedReads.length, 0, `backend ${index} no firma nada de otra oportunidad`);

      // Payload historico envenenado y travesia de directorios: fail-closed.
      for (const hostile of [STOLEN_DOCUMENT_ID, TRAVERSAL_DOCUMENT_ID]) {
        const stolen = await download(hostile, OPPORTUNITY_ID);
        assert.equal(stolen.status, 404, `backend ${index} rechaza la ruta heredada fuera de la oportunidad (${hostile})`);
      }
      assert.equal(state.signedReads.length, 0, `backend ${index} nunca firma una ruta fuera del prefijo de la oportunidad`);

      // Documento tipado vigente: 302 hacia una capacidad corta, sin cuerpo.
      const typed = await download(TYPED_DOCUMENT_ID, OPPORTUNITY_ID);
      assert.equal(typed.status, 302, `backend ${index} responde 302 a la descarga autorizada`);
      assert.equal(typed.headers['cache-control'], 'private, no-store', `backend ${index} marca la respuesta como no cacheable`);
      assert.equal(typed.text, '', `backend ${index} no devuelve cuerpo con la descarga`);
      assert.equal(state.signedReads.length, 1, `backend ${index} firma exactamente un objeto`);
      assert.equal(state.signedReads[0].path, TYPED_STORAGE_PATH, `backend ${index} firma solo el documento pedido`);
      assert.equal(state.signedReads[0].expiresIn, 120, `backend ${index} emite la capacidad con TTL de 120 segundos`);
      const location = new URL(typed.headers.location);
      assert.equal(location.origin, `http://127.0.0.1:${fakePort}`, `backend ${index} redirige al almacenamiento firmado`);
      assert.equal(location.searchParams.get('token'), 'read-token', `backend ${index} entrega la capacidad en el Location`);
      assert.equal(location.searchParams.get('download'), 'Pliego de condiciones.pdf', `backend ${index} fuerza el nombre de descarga`);

      // Documento legado vigente: mismo contrato.
      const legacy = await download(LEGACY_DOCUMENT_ID, OPPORTUNITY_ID);
      assert.equal(legacy.status, 302, `backend ${index} sigue sirviendo los documentos legados`);
      assert.equal(legacy.headers['cache-control'], 'private, no-store', `backend ${index} tampoco cachea la descarga legada`);
      assert.equal(state.signedReads.length, 2, `backend ${index} firma un solo objeto por descarga`);
      assert.equal(state.signedReads[1].path, LEGACY_STORAGE_PATH, `backend ${index} firma la ruta legada de esta oportunidad`);
      assert.equal(state.signedReads[1].expiresIn, 120, `backend ${index} usa el mismo TTL corto para lo legado`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
      appServer = null;
    }
  }
} finally {
  console.error = originalConsoleError;
  if (appServer) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('tests/security/tender-api-projection.test.mjs OK');
