import { createHash } from 'node:crypto';
import { cleanFinancialImportRequest } from './siio-financial-import-service.js';
import { parseSiioFinancialWorkbook } from './siio-financial-workbook.js';

const MAX_FILE_BYTES = 10485760;
const MAX_JSON_BYTES = 8388608;
const MAX_ACCOUNTS = 5000;
const XLSM = 'application/vnd.ms-excel.sheet.macroenabled.12';
const PROVIDERS = new Set(['google_drive', 'sharepoint', 'odoo']);
export class FinancialConnectorError extends Error {
  constructor(code) { super(code); this.name = 'FinancialConnectorError'; this.code = code; }
}
const fail = code => { throw new FinancialConnectorError(code); };
const hash = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
const required = (value, code) => typeof value === 'string' && value.trim() ? value.trim() : fail(code);
function httpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_SOURCE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('INVALID_SOURCE_URL');
  return url;
}
function envName(value) {
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(value || '')) fail('INVALID_SECRET_REFERENCE');
  return value;
}
const secret = (env, name) => required(env[envName(name)], 'MISSING_CREDENTIAL');
export function validateFinancialSource(source) {
  if (!source || !/^[a-z][a-z0-9_-]{2,63}$/.test(source.id || '') || !PROVIDERS.has(source.provider)) fail('INVALID_SOURCE_CONFIG');
  if (typeof source.enabled !== 'boolean') fail('INVALID_SOURCE_CONFIG');
  if (source.provider === 'odoo') {
    if (!['jsonrpc', 'json2'].includes(source.protocol)) fail('INVALID_ODOO_PROTOCOL');
    if (source.enabled) {
      const url = httpsUrl(required(source.url, 'MISSING_SOURCE_URL'));
      if (url.pathname !== '/') fail('INVALID_SOURCE_URL');
      required(source.database, 'MISSING_ODOO_DATABASE');
      if (!Number.isSafeInteger(source.companyId) || source.companyId <= 0) fail('MISSING_ODOO_COMPANY');
      if (source.protocol === 'jsonrpc') required(source.username, 'MISSING_ODOO_USERNAME');
    }
    envName(source.apiKeyEnv);
  } else {
    if (!source.auth || !['access_token', 'google_refresh', 'microsoft_client_credentials'].includes(source.auth.type)) fail('INVALID_AUTH_CONFIG');
    const authKeys = { access_token: ['type', 'tokenEnv'], google_refresh: ['type', 'clientIdEnv', 'clientSecretEnv', 'refreshTokenEnv'], microsoft_client_credentials: ['type', 'tenantIdEnv', 'clientIdEnv', 'clientSecretEnv'] };
    if (Object.keys(source.auth).some(key => !authKeys[source.auth.type].includes(key))) fail('UNKNOWN_AUTH_SETTING');
    if (source.auth.type === 'access_token') envName(source.auth.tokenEnv);
    if (source.auth.type === 'google_refresh') {
      if (source.provider !== 'google_drive') fail('INVALID_AUTH_CONFIG');
      for (const field of ['clientIdEnv', 'clientSecretEnv', 'refreshTokenEnv']) envName(source.auth[field]);
    }
    if (source.auth.type === 'microsoft_client_credentials') {
      if (source.provider !== 'sharepoint') fail('INVALID_AUTH_CONFIG');
      for (const field of ['tenantIdEnv', 'clientIdEnv', 'clientSecretEnv']) envName(source.auth[field]);
    }
    if (source.provider === 'google_drive' && source.fileUrl) {
      let link;
      try { link = new URL(source.fileUrl); } catch { fail('INVALID_DRIVE_LINK'); }
      if (link.protocol !== 'https:' || link.hostname !== 'drive.google.com' || link.username || link.password) fail('INVALID_DRIVE_LINK');
      const fileId = /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(link.pathname)?.[1] || (['/open', '/uc'].includes(link.pathname) ? link.searchParams.get('id') : null);
      if (!/^[A-Za-z0-9_-]{5,200}$/.test(fileId || '') || (source.fileId && source.fileId !== fileId)) fail('INVALID_DRIVE_LINK');
      source = { ...source, fileId, resourceKey: source.resourceKey || link.searchParams.get('resourcekey') || undefined };
    }
    if (source.enabled && source.provider === 'google_drive' && !/^[A-Za-z0-9_-]{5,200}$/.test(source.fileId || '')) fail('MISSING_DRIVE_FILE_ID');
    if (source.enabled && source.provider === 'sharepoint') {
      if (source.shareUrl) {
        let link;
        try { link = new URL(source.shareUrl); } catch { fail('INVALID_SHAREPOINT_LINK'); }
        if (link.protocol !== 'https:' || link.username || link.password || !/^[a-z0-9.-]+\.sharepoint\.com$/i.test(link.hostname) || source.driveId || source.itemId) fail('INVALID_SHAREPOINT_LINK');
      } else {
        required(source.driveId, 'MISSING_SHAREPOINT_DRIVE_ID');
        required(source.itemId, 'MISSING_SHAREPOINT_ITEM_ID');
      }
    }
  }
  // No URL download, domain, model, method or credentials can be supplied by a caller.
  const allowed = new Set(['id', 'provider', 'enabled', 'auth', 'fileId', 'fileUrl', 'resourceKey', 'driveId', 'itemId', 'shareUrl', 'url', 'database', 'username', 'companyId', 'protocol', 'apiKeyEnv']);
  if (Object.keys(source).some(key => !allowed.has(key))) fail('UNKNOWN_SOURCE_SETTING');
  return structuredClone(source);
}
export function financialSourceReadiness(source, env = process.env) {
  const config = validateFinancialSource(source);
  const refs = config.provider === 'odoo' ? [config.apiKeyEnv] : Object.entries(config.auth).filter(([key]) => key.endsWith('Env')).map(([, value]) => value);
  return { id: config.id, provider: config.provider, enabled: config.enabled, state: !config.enabled ? 'disabled' : refs.every(ref => Boolean(env[ref])) ? 'configured_unverified' : 'missing_credentials', missingCredentialNames: refs.filter(ref => !env[ref]) };
}

function transport(fetchImpl) {
  return async function request(url, options = {}, limit = MAX_JSON_BYTES, kind = 'json') {
    const signal = AbortSignal.timeout(30000);
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400) {
        if (kind === 'redirect') return response;
        fail('UNEXPECTED_REDIRECT');
      }
      if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'SOURCE_ACCESS_DENIED' : response.status === 429 ? 'SOURCE_RATE_LIMITED' : 'SOURCE_HTTP_FAILED');
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) > limit) fail('SOURCE_TOO_LARGE');
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body || []) {
        length += chunk.length;
        if (length > limit) { await response.body.cancel?.().catch(() => {}); fail('SOURCE_TOO_LARGE'); }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (kind !== 'json') return body;
      try { return JSON.parse(body.toString('utf8')); } catch { fail('INVALID_SOURCE_RESPONSE'); }
    } catch (error) {
      if (error instanceof FinancialConnectorError) throw error;
      fail(signal.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_NETWORK_FAILED');
    }
  };
}
async function accessToken(source, env, request) {
  const auth = source.auth;
  if (auth.type === 'access_token') return secret(env, auth.tokenEnv);
  let url, values;
  if (auth.type === 'google_refresh') {
    url = 'https://oauth2.googleapis.com/token';
    values = { grant_type: 'refresh_token', client_id: secret(env, auth.clientIdEnv), client_secret: secret(env, auth.clientSecretEnv), refresh_token: secret(env, auth.refreshTokenEnv) };
  } else {
    const tenant = secret(env, auth.tenantIdEnv);
    if (!/^[A-Za-z0-9.-]+$/.test(tenant)) fail('INVALID_MICROSOFT_TENANT');
    url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    values = { grant_type: 'client_credentials', client_id: secret(env, auth.clientIdEnv), client_secret: secret(env, auth.clientSecretEnv), scope: 'https://graph.microsoft.com/.default' };
  }
  const result = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString() });
  return required(result.access_token, 'INVALID_TOKEN_RESPONSE');
}
function checkFile(metadata) {
  if (!/\.xlsm$/i.test(metadata.name || '') || String(metadata.mimeType || '').toLowerCase() !== XLSM) fail('UNSUPPORTED_WORKBOOK_FORMAT');
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) fail('INVALID_WORKBOOK_SIZE');
  if (!metadata.revision || metadata.deleted) fail('INVALID_FILE_METADATA');
}
async function downloadWorkbook(source, env, request) {
  const token = await accessToken(source, env, request);
  const headers = { Authorization: `Bearer ${token}` };
  let metadataUrl, contentUrl, readMetadata;
  if (source.provider === 'google_drive') {
    const root = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(source.fileId)}`;
    metadataUrl = `${root}?supportsAllDrives=true&fields=id,name,mimeType,size,version,modifiedTime,md5Checksum,trashed`;
    contentUrl = `${root}?alt=media&supportsAllDrives=true`;
    if (source.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${source.fileId}/${source.resourceKey}`;
    readMetadata = data => ({ id: data.id, name: data.name, mimeType: data.mimeType, size: data.size, revision: String(data.version || ''), modifiedAt: data.modifiedTime, md5: data.md5Checksum, deleted: data.trashed });
  } else {
    let driveId = source.driveId, itemId = source.itemId;
    if (source.shareUrl) {
      const link = new URL(source.shareUrl);
      const filePath = decodeURIComponent(link.pathname.replace(/^\/:x:\/r(?=\/)/, ''));
      const sitePath = /^(\/(?:sites|teams)\/[^/]+)\//.exec(filePath)?.[1];
      // Opaque share tokens require write-capable /shares permissions. Use a
      // direct library path or explicit IDs instead; never redeem a share link.
      if (!sitePath || !/\.xlsm$/i.test(filePath)) fail('SHAREPOINT_FILE_IDS_REQUIRED');
      const site = await request(`https://graph.microsoft.com/v1.0/sites/${link.hostname}:${sitePath.split('/').map(encodeURIComponent).join('/')}?$select=id`, { headers });
      if (!site.id) fail('INVALID_SHAREPOINT_SITE');
      const drives = [];
      let next = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(site.id)}/drives?$select=id,webUrl`;
      let pages = 0;
      while (next) {
        if (++pages > 20) fail('SHAREPOINT_TOO_MANY_LIBRARIES');
        const page = await request(next, { headers });
        if (!Array.isArray(page.value)) fail('INVALID_SHAREPOINT_LIBRARIES');
        drives.push(...page.value);
        next = page['@odata.nextLink'];
        if (next) {
          const nextUrl = new URL(next);
          if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'graph.microsoft.com' || nextUrl.username || nextUrl.password) fail('INVALID_PAGINATION_LINK');
        }
      }
      const matches = drives.flatMap(drive => {
        let url;
        try { url = new URL(drive.webUrl); } catch { return []; }
        const prefix = decodeURIComponent(url.pathname).replace(/\/$/, '') + '/';
        return url.hostname === link.hostname && filePath.startsWith(prefix) ? [{ id: drive.id, prefix }] : [];
      }).sort((a, b) => b.prefix.length - a.prefix.length);
      if (!matches.length || !matches[0].id) fail('SHAREPOINT_LIBRARY_NOT_FOUND');
      driveId = matches[0].id;
      const relative = filePath.slice(matches[0].prefix.length).split('/').map(encodeURIComponent).join('/');
      const item = await request(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${relative}?$select=id`, { headers });
      itemId = required(item.id, 'SHAREPOINT_FILE_NOT_FOUND');
    }
    const root = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
    source = { ...source, itemId };
    metadataUrl = `${root}?$select=id,name,size,eTag,lastModifiedDateTime,file,deleted`;
    contentUrl = `${root}/content`;
    readMetadata = data => ({ id: data.id, name: data.name, mimeType: data.file?.mimeType, size: data.size, revision: data.eTag, modifiedAt: data.lastModifiedDateTime, deleted: Boolean(data.deleted) });
  }
  const before = readMetadata(await request(metadataUrl, { headers }));
  if (!before.id || before.id !== (source.provider === 'google_drive' ? source.fileId : source.itemId)) fail('SOURCE_ID_MISMATCH');
  checkFile(before);
  let body = await request(contentUrl, { headers }, MAX_FILE_BYTES, source.provider === 'sharepoint' ? 'redirect' : 'bytes');
  if (source.provider === 'sharepoint' && !Buffer.isBuffer(body)) {
    // The Graph preauthenticated URL must never receive the Graph bearer token.
    let url;
    try { url = new URL(body.headers.get('location')); } catch { fail('INVALID_DOWNLOAD_REDIRECT'); }
    if (url.protocol !== 'https:' || url.username || url.password || !/^[a-z0-9.-]+\.sharepoint(?:-df)?\.com$/i.test(url.hostname)) fail('INVALID_DOWNLOAD_REDIRECT');
    body = await request(url.href, {}, MAX_FILE_BYTES, 'bytes');
  }
  const after = readMetadata(await request(metadataUrl, { headers }));
  if (before.revision !== after.revision || before.id !== after.id || before.size !== after.size || before.name !== after.name || before.mimeType !== after.mimeType || before.md5 !== after.md5 || before.deleted !== after.deleted) fail('SOURCE_CHANGED_DURING_READ');
  if (body.length !== Number(before.size) || (before.md5 && hash(body, 'md5') !== before.md5)) fail('SOURCE_CONTENT_MISMATCH');
  return { body, metadata: before };
}

function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e14) fail('INVALID_ACCOUNT_AMOUNT');
  const rounded = value.toFixed(4);
  const negative = rounded.startsWith('-');
  const digits = rounded.replace('-', '').replace('.', '');
  return BigInt(digits) * (negative ? -1n : 1n);
}
function decimal(value) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(5, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
async function readOdooBalance(source, env, request, periodMonth, cutoffDate) {
  const apiKey = secret(env, source.apiKeyEnv);
  const root = httpsUrl(source.url).origin;
  let uid, serial = 0;
  const rpc = async (service, method, args) => {
    const id = ++serial;
    const data = await request(`${root}/jsonrpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id }) });
    if (data.error) fail('ODOO_RPC_FAILED');
    if (data.id !== id || !Object.hasOwn(data, 'result')) fail('INVALID_ODOO_RESPONSE');
    return data.result;
  };
  if (source.protocol === 'jsonrpc') {
    uid = await rpc('common', 'authenticate', [source.database, source.username, apiKey, {}]);
    if (!Number.isSafeInteger(uid) || uid <= 0) fail('ODOO_AUTHENTICATION_FAILED');
  }
  const read = async (model, method, kwargs) => {
    const allowed = { 'account.move.line': ['fields_get', 'search_count', 'search_read', 'read_group'], 'account.account': ['read'], 'res.company': ['read'] };
    if (!allowed[model]?.includes(method)) fail('ODOO_METHOD_NOT_ALLOWED');
    const args = { ...kwargs, context: { allowed_company_ids: [source.companyId] } };
    if (source.protocol === 'json2') {
      return request(`${root}/json/2/${model}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Odoo-Database': source.database, 'User-Agent': 'SIIO-Gerencia/financial-connectors-v1' }, body: JSON.stringify(args) });
    }
    let positional = [];
    if (method === 'read') { positional = [args.ids]; delete args.ids; }
    if (['search_count', 'search_read', 'read_group'].includes(method)) { positional = [args.domain]; delete args.domain; }
    if (method === 'read_group') { positional.push(args.fields, args.groupby); delete args.fields; delete args.groupby; }
    return rpc('object', 'execute_kw', [source.database, uid, apiKey, model, method, positional, args]);
  };
  const company = await read('res.company', 'read', { ids: [source.companyId], fields: ['id', 'currency_id'] });
  if (!Array.isArray(company) || company.length !== 1 || company[0].id !== source.companyId || !Array.isArray(company[0].currency_id) || !Number.isSafeInteger(company[0].currency_id[0]) || company[0].currency_id[0] <= 0) fail('ODOO_COMPANY_NOT_ACCESSIBLE');
  const types = { account_id: 'many2one', company_id: 'many2one', date: 'date', parent_state: 'selection', debit: 'monetary', credit: 'monetary', write_date: 'datetime' };
  const fields = await read('account.move.line', 'fields_get', { allfields: Object.keys(types), attributes: ['type'] });
  for (const [field, type] of Object.entries(types)) if (fields?.[field]?.type !== type) fail('ODOO_ACCOUNT_SCHEMA_UNSUPPORTED');
  const baseDomain = [['company_id', '=', source.companyId], ['parent_state', '=', 'posted'], ['date', '<=', cutoffDate]];
  const watermark = async () => {
    const count = await read('account.move.line', 'search_count', { domain: baseDomain });
    const latest = await read('account.move.line', 'search_read', { domain: baseDomain, fields: ['id', 'write_date'], order: 'write_date desc,id desc', limit: 1 });
    if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(latest) || latest.length > 1 || (count > 0 && !latest[0]?.write_date)) fail('INVALID_ODOO_WATERMARK');
    return { count, latest: latest.map(row => ({ id: row.id, write_date: row.write_date })) };
  };
  const before = await watermark();
  const groups = async domain => {
    const result = await read('account.move.line', 'read_group', { domain, fields: ['account_id', 'debit:sum', 'credit:sum'], groupby: ['account_id'], lazy: false, limit: MAX_ACCOUNTS + 1 });
    if (!Array.isArray(result) || result.length > MAX_ACCOUNTS) fail('ODOO_TOO_MANY_ACCOUNTS');
    const seen = new Set();
    for (const row of result) {
      const id = row.account_id?.[0];
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) fail('INVALID_ODOO_ACCOUNT_GROUP');
      seen.add(id); money(row.debit); money(row.credit);
    }
    return result;
  };
  const opening = await groups([...baseDomain, ['date', '<', periodMonth]]);
  const movements = await groups([...baseDomain, ['date', '>=', periodMonth]]);
  const ids = [...new Set([...opening, ...movements].map(row => row.account_id[0]))].sort((a, b) => a - b);
  if (ids.length > MAX_ACCOUNTS) fail('ODOO_TOO_MANY_ACCOUNTS');
  const accounts = ids.length ? await read('account.account', 'read', { ids, fields: ['id', 'code', 'name'] }) : [];
  if (!Array.isArray(accounts) || accounts.length !== ids.length || new Set(accounts.map(row => row.id)).size !== ids.length || accounts.some(row => !ids.includes(row.id) || typeof row.code !== 'string' || typeof row.name !== 'string')) fail('ODOO_ACCOUNT_MAPPING_INCOMPLETE');
  const after = await watermark();
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('SOURCE_CHANGED_DURING_READ');
  const prior = new Map(opening.map(row => [row.account_id[0], money(row.debit) - money(row.credit)]));
  const current = new Map(movements.map(row => [row.account_id[0], { debit: money(row.debit), credit: money(row.credit) }]));
  let totalDebit = 0n, totalCredit = 0n, totalOpening = 0n;
  const balance = accounts.sort((a, b) => a.code.localeCompare(b.code) || a.id - b.id).map(account => {
    const start = prior.get(account.id) || 0n;
    const { debit = 0n, credit = 0n } = current.get(account.id) || {};
    totalDebit += debit; totalCredit += credit; totalOpening += start;
    return { account_id: account.id, account: account.code, account_name: account.name, previous_balance: decimal(start), debits: decimal(debit), credits: decimal(credit), final_balance: decimal(start + debit - credit) };
  });
  if (!balance.length) fail('ODOO_NO_POSTED_BALANCE');
  const data = { contract: 'siio-odoo-trial-balance/v1', company_id: source.companyId, currency_id: company[0].currency_id[0], period_month: periodMonth, cutoff_date: cutoffDate, lines: balance, totals: { previous_balance: decimal(totalOpening), debits: decimal(totalDebit), credits: decimal(totalCredit), difference: decimal(totalDebit - totalCredit), final_balance: decimal(totalOpening + totalDebit - totalCredit) } };
  return { data, revision: hash(JSON.stringify(before)), differences: [totalOpening, totalDebit - totalCredit, totalOpening + totalDebit - totalCredit] };
}

export async function readFinancialSource(source, { periodMonth, cutoffDate, env = process.env, fetchImpl = globalThis.fetch, parseWorkbook = parseSiioFinancialWorkbook } = {}) {
  const config = validateFinancialSource(source);
  if (!config.enabled) fail('SOURCE_DISABLED');
  // A cutoff is explicit business data; never infer it from file modification time.
  try { cleanFinancialImportRequest({ name: 'source.xlsm', size: 1, period_month: periodMonth, cutoff_date: cutoffDate, import_type: 'parcial_diario' }); }
  catch { fail('INVALID_FINANCIAL_CUTOFF'); }
  const request = transport(fetchImpl);
  if (config.provider === 'odoo') {
    const result = await readOdooBalance(config, env, request, periodMonth, cutoffDate);
    return { source_id: config.id, provider: config.provider, format: 'odoo_trial_balance', content_sha256: hash(JSON.stringify(result.data)), provenance: { protocol: config.protocol, company_id: config.companyId, revision: result.revision }, period_month: periodMonth, cutoff_date: cutoffDate, status: 'mapping_required', validations: result.differences.map((difference, index) => ({ rule: ['ERP_OPENING_BALANCE', 'ERP_MOVEMENTS_BALANCE', 'ERP_FINAL_BALANCE'][index], severity: 'bloqueante', ok: difference <= 100n && difference >= -100n, difference: decimal(difference), tolerance: '0.0100' })), payload: result.data };
  }
  const { body, metadata } = await downloadWorkbook(config, env, request);
  let payload;
  try { payload = parseWorkbook(body, { fileName: metadata.name, periodMonth, cutoffDate, importType: 'parcial_diario' }); }
  catch { fail('WORKBOOK_PARSE_FAILED'); }
  return { source_id: config.id, provider: config.provider, format: 'workbook', content_sha256: hash(body), provenance: { file_id: metadata.id, revision: metadata.revision, modified_at: metadata.modifiedAt }, period_month: periodMonth, cutoff_date: cutoffDate, status: payload.status, validations: payload.validations, payload };
}
