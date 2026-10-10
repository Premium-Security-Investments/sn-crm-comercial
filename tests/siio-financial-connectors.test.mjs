import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFinancialSource, financialSourceReadiness, validateFinancialSource } from '../siio-financial-connectors.js';

const mime = 'application/vnd.ms-excel.sheet.macroenabled.12';
const options = { periodMonth: '2026-04-01', cutoffDate: '2026-04-15', env: { TEST_ACCESS_TOKEN: 'test-private-token', TEST_ODOO_KEY: 'test-private-odoo-key' } };
const drive = { id: 'finanzas-drive', provider: 'google_drive', enabled: true, fileId: 'file12345', auth: { type: 'access_token', tokenEnv: 'TEST_ACCESS_TOKEN' } };
const graph = { id: 'finanzas-sharepoint', provider: 'sharepoint', enabled: true, driveId: 'drive12345', itemId: 'item12345', auth: { type: 'access_token', tokenEnv: 'TEST_ACCESS_TOKEN' } };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const bytes = Buffer.from('test-workbook-bytes');
const parsed = { status: 'listo_revision', validations: [], summary: {}, structure: { sheets: [] }, metrics: [] };
const parser = (buffer, metadata) => { assert.deepEqual(buffer, bytes); assert.equal(metadata.importType, 'parcial_diario'); return parsed; };
function driveFetch({ changed = false, size = bytes.length, error, body = bytes, md5 = true } = {}) {
  let reads = 0;
  return async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer test-private-token');
    if (error) return new Response(JSON.stringify({ token: options.env.TEST_ACCESS_TOKEN }), { status: error });
    if (url.includes('alt=media')) return new Response(body);
    return json({ id: drive.fileId, name: 'PYG.xlsm', mimeType: mime, size: String(size), version: changed && reads++ ? '2' : '1', modifiedTime: '2026-04-15T10:00:00Z', md5Checksum: md5 ? createHash('md5').update(bytes).digest('hex') : undefined, trashed: false });
  };
}
test('Drive reads metadata/content/metadata, verifies bytes and keeps provenance without credentials', async () => {
  const result = await readFinancialSource(drive, { ...options, fetchImpl: driveFetch(), parseWorkbook: parser });
  assert.equal(result.provenance.file_id, drive.fileId);
  assert.equal(result.provenance.revision, '1');
  assert.equal(result.cutoff_date, options.cutoffDate);
  assert.equal(result.content_sha256.length, 64);
  assert.equal(result.status, 'listo_revision');
  assert.ok(!JSON.stringify(result).includes('test-private-token'));
});
test('Drive rejects a revision that changes while downloading', async () => {
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ changed: true }), parseWorkbook: parser }), { code: 'SOURCE_CHANGED_DURING_READ' });
});
test('Drive rejects size/hash mismatches and unsupported workbook names', async () => {
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ size: bytes.length + 1 }) }), { code: 'SOURCE_CONTENT_MISMATCH' });
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ body: Buffer.alloc(bytes.length) }) }), { code: 'SOURCE_CONTENT_MISMATCH' });
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: async () => json({ id: drive.fileId, name: 'PYG.xlsx', mimeType: mime, size: 2, version: '1' }) }), { code: 'UNSUPPORTED_WORKBOOK_FORMAT' });
});
test('download limits apply to declared sizes and streaming bodies', async () => {
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ size: 10485761 }) }), { code: 'INVALID_WORKBOOK_SIZE' });
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ body: Buffer.alloc(10485761), md5: false }) }), { code: 'SOURCE_TOO_LARGE' });
});
test('remote auth errors and network exceptions never echo credentials', async () => {
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: driveFetch({ error: 403 }) }), { message: 'SOURCE_ACCESS_DENIED' });
  await assert.rejects(readFinancialSource(drive, { ...options, fetchImpl: async () => { throw new Error('secret=test-private-token'); } }), { message: 'SOURCE_NETWORK_FAILED' });
});
test('invalid business cutoff is rejected before any network request', async () => {
  let calls = 0;
  await assert.rejects(readFinancialSource(drive, { ...options, cutoffDate: '2026-05-01', fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
});
test('SharePoint follows only an approved preauthenticated URL and strips bearer token', async () => {
  let downloads = 0;
  const fetchImpl = async (url, request) => {
    if (url.startsWith('https://tenant.sharepoint.com/')) {
      assert.equal(request.headers, undefined); downloads++; return new Response(bytes);
    }
    assert.equal(request.headers.Authorization, 'Bearer test-private-token');
    if (url.endsWith('/content')) return new Response(null, { status: 302, headers: { Location: 'https://tenant.sharepoint.com/download?preauthenticated=test' } });
    return json({ id: graph.itemId, name: 'PYG.xlsm', size: bytes.length, eTag: 'revision1', file: { mimeType: mime }, lastModifiedDateTime: '2026-04-15T10:00:00Z' });
  };
  const result = await readFinancialSource(graph, { ...options, fetchImpl, parseWorkbook: parser });
  assert.equal(downloads, 1); assert.equal(result.provenance.revision, 'revision1');
  assert.ok(!JSON.stringify(result).includes('preauthenticated'));
});
test('SharePoint rejects an unrelated redirect before fetching it', async () => {
  let evilCalls = 0;
  const fetchImpl = async url => {
    if (url.startsWith('https://evil.example')) evilCalls++;
    if (url.endsWith('/content')) return new Response(null, { status: 302, headers: { Location: 'https://evil.example/private' } });
    return json({ id: graph.itemId, name: 'PYG.xlsm', size: bytes.length, eTag: '1', file: { mimeType: mime } });
  };
  await assert.rejects(readFinancialSource(graph, { ...options, fetchImpl }), { code: 'INVALID_DOWNLOAD_REDIRECT' });
  assert.equal(evilCalls, 0);
});
test('Drive link configuration resolves the stable file ID and resource key', async () => {
  const source = { ...drive, fileId: '', fileUrl: 'https://drive.google.com/file/d/file12345/view?resourcekey=key123' };
  const fetchImpl = async (url, request) => {
    assert.equal(request.headers['X-Goog-Drive-Resource-Keys'], 'file12345/key123');
    return driveFetch()(url, request);
  };
  assert.equal((await readFinancialSource(source, { ...options, fetchImpl, parseWorkbook: parser })).provenance.file_id, 'file12345');
  assert.throws(() => validateFinancialSource({ ...drive, fileUrl: 'https://drive.google.com/file/d/otherfile/view' }), { code: 'INVALID_DRIVE_LINK' });
});
test('SharePoint resolves a direct link via paginated read-only site/library/item endpoints', async () => {
  const source = { ...graph, driveId: '', itemId: '', shareUrl: 'https://tenant.sharepoint.com/:x:/r/sites/Finance/Shared%20Documents/PYG.xlsm?web=1' };
  const fetchImpl = async (url, request) => {
    assert.equal(request.method, undefined);
    assert.ok(!url.includes('/shares/'));
    assert.equal(request.headers.Prefer, undefined);
    if (url.includes('/sites/tenant.sharepoint.com:')) return json({ id: 'site12345' });
    if (url.includes('/sites/site12345/drives')) return json({ value: [{ id: 'unrelated', webUrl: 'https://tenant.sharepoint.com/sites/Other/Documents' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives-page2' });
    if (url.endsWith('/drives-page2')) return json({ value: [{ id: graph.driveId, webUrl: 'https://tenant.sharepoint.com/sites/Finance/Shared%20Documents' }] });
    if (url.includes('/root:/PYG.xlsm')) return json({ id: graph.itemId });
    assert.ok(url.includes(`/drives/${graph.driveId}/items/${graph.itemId}`));
    if (url.endsWith('/content')) return new Response(bytes);
    return json({ id: graph.itemId, name: 'PYG.xlsm', size: bytes.length, eTag: '1', file: { mimeType: mime } });
  };
  const result = await readFinancialSource(source, { ...options, fetchImpl, parseWorkbook: parser });
  assert.equal(result.provenance.file_id, graph.itemId);
});
test('opaque SharePoint sharing links fail without requesting write-capable share redemption', async () => {
  let calls = 0;
  const source = { ...graph, driveId: '', itemId: '', shareUrl: 'https://tenant.sharepoint.com/:x:/s/Finance/opaqueToken' };
  await assert.rejects(readFinancialSource(source, { ...options, fetchImpl: async () => { calls++; } }), { code: 'SHAREPOINT_FILE_IDS_REQUIRED' });
  assert.equal(calls, 0);
});
test('Google token refresh uses configured environment references, then only GETs the file', async () => {
  const source = { ...drive, auth: { type: 'google_refresh', clientIdEnv: 'TEST_CLIENT_ID', clientSecretEnv: 'TEST_CLIENT_SECRET', refreshTokenEnv: 'TEST_REFRESH_TOKEN' } };
  let refreshed = 0;
  const fetchImpl = async (url, request) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(request.body);
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), 'refresh-private'); refreshed++;
      return json({ access_token: 'test-private-token' });
    }
    assert.equal(request.method, undefined);
    return driveFetch()(url, request);
  };
  await readFinancialSource(source, { ...options, env: { TEST_CLIENT_ID: 'client', TEST_CLIENT_SECRET: 'client-private', TEST_REFRESH_TOKEN: 'refresh-private' }, fetchImpl, parseWorkbook: parser });
  assert.equal(refreshed, 1);
});
test('Microsoft credentials acquire an application token without exposing it in receipts', async () => {
  const source = { ...graph, auth: { type: 'microsoft_client_credentials', tenantIdEnv: 'TEST_TENANT_ID', clientIdEnv: 'TEST_CLIENT_ID', clientSecretEnv: 'TEST_CLIENT_SECRET' } };
  const fetchImpl = async (url, request) => {
    if (url.includes('login.microsoftonline.com')) {
      const form = new URLSearchParams(request.body);
      assert.equal(form.get('grant_type'), 'client_credentials');
      assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');
      return json({ access_token: 'graph-private' });
    }
    assert.equal(request.headers.Authorization, 'Bearer graph-private');
    if (url.endsWith('/content')) return new Response(bytes);
    return json({ id: graph.itemId, name: 'PYG.xlsm', size: bytes.length, eTag: '1', file: { mimeType: mime } });
  };
  const result = await readFinancialSource(source, { ...options, env: { TEST_TENANT_ID: 'tenant-id', TEST_CLIENT_ID: 'client', TEST_CLIENT_SECRET: 'private' }, fetchImpl, parseWorkbook: parser });
  assert.ok(!JSON.stringify(result).includes('graph-private'));
});

const schema = Object.fromEntries(Object.entries({ account_id: 'many2one', company_id: 'many2one', date: 'date', parent_state: 'selection', debit: 'monetary', credit: 'monetary', write_date: 'datetime' }).map(([field, type]) => [field, { type }]));
const erp = protocol => ({ id: 'finanzas-avancys', provider: 'odoo', enabled: true, protocol, url: 'https://avancys.example', database: 'test-db', username: 'readonly', companyId: 7, apiKeyEnv: 'TEST_ODOO_KEY' });
function odooFetch(protocol, { changed = false, tooMany = false, missingSchema = false, denied = false, unbalanced = false } = {}) {
  let marks = 0;
  return async (url, request) => {
    const body = JSON.parse(request.body);
    let model, method, args;
    if (protocol === 'jsonrpc') {
      assert.equal(url, 'https://avancys.example/jsonrpc');
      assert.equal(body.params.args[0], 'test-db');
      if (body.params.service === 'common') { assert.equal(body.params.args[1], 'readonly'); return json({ jsonrpc: '2.0', id: body.id, result: 41 }); }
      assert.equal(body.params.method, 'execute_kw');
      assert.equal(body.params.args[1], 41); assert.equal(body.params.args[2], 'test-private-odoo-key');
      [, , , model, method] = body.params.args;
      const positional = body.params.args[5]; args = body.params.args[6];
      if (method === 'read') args.ids = positional[0];
      if (['search_count', 'search_read', 'read_group'].includes(method)) args.domain = positional[0];
      if (method === 'read_group') { args.fields = positional[1]; args.groupby = positional[2]; }
    } else {
      assert.equal(request.headers.Authorization, 'Bearer test-private-odoo-key');
      assert.equal(request.headers['X-Odoo-Database'], 'test-db');
      [model, method] = new URL(url).pathname.split('/').slice(3); args = body;
    }
    assert.deepEqual(args.context.allowed_company_ids, [7]);
    assert.ok(['read', 'fields_get', 'search_count', 'search_read', 'read_group'].includes(method));
    let result;
    if (model === 'res.company') result = [{ id: 7, currency_id: [9, 'COP'] }];
    else if (model === 'account.account') {
      assert.deepEqual(args.fields, ['id', 'code', 'name']);
      result = [{ id: 10, code: '1105', name: 'Caja' }, { id: 20, code: '2105', name: 'Obligaciones' }];
    } else {
      assert.equal(model, 'account.move.line');
      if (method === 'fields_get') result = missingSchema ? {} : schema;
      else {
        assert.ok(args.domain.some(([field, op, value]) => field === 'company_id' && op === '=' && value === 7));
        assert.ok(args.domain.some(([field, op, value]) => field === 'parent_state' && op === '=' && value === 'posted'));
        assert.ok(args.domain.some(([field, op, value]) => field === 'date' && op === '<=' && value === options.cutoffDate));
        if (method === 'search_count') result = 4;
        if (method === 'search_read') {
          assert.deepEqual(args.fields, ['id', 'write_date']);
          result = [{ id: 4, write_date: changed && marks++ ? '2026-04-15 12:00:00' : '2026-04-15 10:00:00' }];
        }
        if (method === 'read_group') {
          assert.deepEqual(args.fields, ['account_id', 'debit:sum', 'credit:sum']);
          assert.deepEqual(args.groupby, ['account_id']);
          const prior = args.domain.some(([field, op]) => field === 'date' && op === '<');
          result = [{ account_id: [10, 'ignored'], debit: prior ? 100.25 : 50.12, credit: 0 }, { account_id: [20, 'ignored'], debit: 0, credit: prior ? 100.25 : unbalanced ? 40.12 : 50.12 }];
          if (tooMany) result = Array.from({ length: 5001 }, (_, index) => ({ account_id: [index + 1, 'x'], debit: 0, credit: 0 }));
        }
      }
    }
    if (denied) return new Response('private-response', { status: 403 });
    return json(protocol === 'jsonrpc' ? { jsonrpc: '2.0', id: body.id, result } : result);
  };
}
for (const protocol of ['jsonrpc', 'json2']) {
  test(`Odoo ${protocol} scopes posted accounts by company and stages a deterministic balance without personal data`, async () => {
    const result = await readFinancialSource(erp(protocol), { ...options, fetchImpl: odooFetch(protocol) });
    assert.equal(result.payload.lines[0].previous_balance, '100.2500');
    assert.equal(result.payload.lines[0].final_balance, '150.3700');
    assert.equal(result.payload.lines[1].final_balance, '-150.3700');
    assert.equal(result.payload.totals.difference, '0.0000');
    assert.equal(result.payload.totals.final_balance, '0.0000');
    assert.ok(result.validations.every(item => item.ok));
    assert.equal(result.status, 'mapping_required');
    assert.equal(result.payload.currency_id, 9);
    assert.ok(!JSON.stringify(result).includes('test-private-odoo-key'));
    const again = await readFinancialSource(erp(protocol), { ...options, fetchImpl: odooFetch(protocol) });
    assert.equal(result.content_sha256, again.content_sha256);
  });
}
test('Odoo marks unbalanced accounting as blocking instead of deriving executive indicators', async () => {
  const result = await readFinancialSource(erp('json2'), { ...options, fetchImpl: odooFetch('json2', { unbalanced: true }) });
  assert.equal(result.validations.find(item => item.rule === 'ERP_MOVEMENTS_BALANCE').ok, false);
  assert.equal(result.payload.totals.difference, '10.0000');
  assert.equal(result.payload.metrics, undefined);
});
test('Odoo refuses changed datasets, unsupported schemas, insufficient permission and truncation', async () => {
  for (const [settings, code] of [[{ changed: true }, 'SOURCE_CHANGED_DURING_READ'], [{ missingSchema: true }, 'ODOO_ACCOUNT_SCHEMA_UNSUPPORTED'], [{ denied: true }, 'SOURCE_ACCESS_DENIED'], [{ tooMany: true }, 'ODOO_TOO_MANY_ACCOUNTS']]) {
    await assert.rejects(readFinancialSource(erp('json2'), { ...options, fetchImpl: odooFetch('json2', settings) }), { code });
  }
});
test('configuration supports disabled placeholders, fails closed for missing secrets, forbids arbitrary methods and inline tokens', async () => {
  assert.equal(financialSourceReadiness({ ...erp('json2'), enabled: false, url: '', database: '', companyId: null }, {}).state, 'disabled');
  assert.equal(financialSourceReadiness(drive, {}).state, 'missing_credentials');
  assert.throws(() => validateFinancialSource({ ...erp('json2'), url: 'http://avancys.example' }), { code: 'INVALID_SOURCE_URL' });
  assert.throws(() => validateFinancialSource({ ...erp('json2'), method: 'write' }), { code: 'UNKNOWN_SOURCE_SETTING' });
  assert.throws(() => validateFinancialSource({ ...drive, auth: { ...drive.auth, token: 'inline-secret' } }), { code: 'UNKNOWN_AUTH_SETTING' });
  let calls = 0;
  await assert.rejects(readFinancialSource({ ...drive, enabled: false }, { ...options, fetchImpl: async () => { calls++; } }), { code: 'SOURCE_DISABLED' });
  await assert.rejects(readFinancialSource(drive, { ...options, env: {}, fetchImpl: async () => { calls++; } }), { code: 'MISSING_CREDENTIAL' });
  assert.equal(calls, 0);
});
