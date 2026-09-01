import { readFileSync } from 'node:fs';

const MANIFEST_KEYS = ['version', 'status', 'assets'];
const ASSET_KEYS = ['asset_id', 'title', 'asset_type', 'url', 'status', 'valid_until', 'tags'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneAsset(asset) {
  return Object.freeze({ ...asset, tags: Object.freeze([...asset.tags]) });
}

function validateAsset(asset, ids) {
  if (!exactKeys(asset, ASSET_KEYS)) throw new Error('Cada activo debe ser un objeto cerrado sin claves inesperadas.');
  if (!nonEmptyString(asset.asset_id) || ids.has(asset.asset_id)) throw new Error(`asset_id inválido o duplicado: ${asset.asset_id || '[vacío]'}.`);
  ids.add(asset.asset_id);
  if (!nonEmptyString(asset.title) || !nonEmptyString(asset.asset_type)) throw new Error('Cada activo requiere título y tipo.');
  if (asset.status !== 'approved') throw new Error('Sólo se permiten activos con estado approved.');
  if (!Array.isArray(asset.tags) || asset.tags.length > 20 || !asset.tags.every(nonEmptyString)) throw new Error('Los tags del activo deben ser textos acotados.');
  let url;
  try { url = new URL(asset.url); } catch { throw new Error('El activo requiere URL HTTPS SharePoint válida.'); }
  if (url.protocol !== 'https:') throw new Error('El activo requiere URL HTTPS.');
  if (!url.hostname.toLowerCase().endsWith('.sharepoint.com')) throw new Error('El activo debe residir en un host SharePoint aprobado.');
  if (url.search || url.hash) throw new Error('La URL del activo no puede contener query, consulta firmada ni fragmento.');
  if (asset.valid_until !== null && Number.isNaN(Date.parse(asset.valid_until))) throw new Error('valid_until debe ser date-time o null.');
}

export function validateVigiaApprovedAssetManifest(value, { now = new Date().toISOString() } = {}) {
  if (!exactKeys(value, MANIFEST_KEYS)) throw new Error('El manifiesto debe ser cerrado y no incluir claves inesperadas.');
  if (value.version !== 'vigia-approved-assets-v1' || value.status !== 'active' || !Array.isArray(value.assets)) {
    throw new Error('El manifiesto de activos no está activo o usa una versión inválida.');
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) throw new Error('now debe ser una fecha válida.');
  const ids = new Set();
  for (const asset of value.assets) validateAsset(asset, ids);
  return Object.freeze(value.assets
    .filter(asset => asset.valid_until === null || Date.parse(asset.valid_until) >= nowMs)
    .map(cloneAsset));
}

export function loadVigiaApprovedAssets({ path, now = new Date().toISOString() }) {
  if (!nonEmptyString(path)) throw new Error('La ruta del manifiesto de activos es obligatoria.');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`No fue posible cargar el manifiesto aprobado de Vig-IA: ${error.message}`);
  }
  return validateVigiaApprovedAssetManifest(manifest, { now });
}

const DEFAULT_MANIFEST_PATH = new URL('./config/vigia-approved-assets.v1.json', import.meta.url).pathname;

// Same legacy shape/host/URL rules as `validateAsset`, applied to assets
// adapted from the published-knowledge DB projection (§16.3) so both sources
// share one contract before being combined.
function assertKnowledgeSelectorAssetShape(asset) {
  if (!exactKeys(asset, ASSET_KEYS)) throw new Error('El activo del selector debe ser un objeto cerrado sin claves inesperadas.');
  if (!nonEmptyString(asset.asset_id)) throw new Error('El activo del selector requiere asset_id.');
  if (!nonEmptyString(asset.title) || !nonEmptyString(asset.asset_type)) throw new Error('El activo del selector requiere título y tipo.');
  if (asset.status !== 'approved') throw new Error('El selector sólo admite activos con estado approved.');
  if (!Array.isArray(asset.tags) || asset.tags.length > 20 || !asset.tags.every(nonEmptyString)) throw new Error('Los tags del activo del selector deben ser textos acotados.');
  let url;
  try { url = new URL(asset.url); } catch { throw new Error('El activo del selector requiere URL HTTPS SharePoint válida.'); }
  if (url.protocol !== 'https:') throw new Error('El activo del selector requiere URL HTTPS.');
  if (!url.hostname.toLowerCase().endsWith('.sharepoint.com')) throw new Error('El activo del selector debe residir en un host SharePoint aprobado.');
  if (url.search || url.hash) throw new Error('La URL del activo del selector no puede contener query ni fragmento.');
  if (asset.valid_until !== null && Number.isNaN(Date.parse(asset.valid_until))) throw new Error('valid_until del selector debe ser date-time o null.');
}

function shapeKnowledgeSelectorAsset(row) {
  const asset = {
    asset_id: row.asset_id,
    title: row.title,
    asset_type: row.asset_type,
    url: row.url,
    status: row.status,
    valid_until: row.valid_until ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
  assertKnowledgeSelectorAssetShape(asset);
  return cloneAsset(asset);
}

// §16.3 lifecycle/governance filters, applied before adaptation and in
// addition to whatever the server-side query already excluded: fail closed
// on an explicit disqualifying value, but do not reject a row for lacking a
// column the legacy static manifest never had.
function isEligibleKnowledgeRow(row, asOfMs) {
  if (!isRecord(row)) return false;
  if (row.status !== 'approved') return false;
  if (row.confidentiality !== undefined && row.confidentiality !== 'interno') return false;
  if (row.agent_reuse_allowed !== undefined && row.agent_reuse_allowed !== true) return false;
  if (row.content_hash !== undefined && row.content_hash !== null && !/^[0-9a-f]{64}$/i.test(String(row.content_hash))) return false;
  if (row.valid_from !== undefined && row.valid_from !== null) {
    const validFromMs = Date.parse(row.valid_from);
    if (Number.isNaN(validFromMs) || validFromMs > asOfMs) return false;
  }
  if (row.valid_until !== undefined && row.valid_until !== null) {
    const validUntilMs = Date.parse(row.valid_until);
    if (Number.isNaN(validUntilMs) || validUntilMs < asOfMs) return false;
  }
  if (row.review_on !== undefined && row.review_on !== null) {
    const reviewOnMs = Date.parse(row.review_on);
    if (Number.isNaN(reviewOnMs) || reviewOnMs <= asOfMs) return false;
  }
  return true;
}

// Async, server-side replacement for the sync JSON-only loader (§16.3):
// unions the published-knowledge DB projection with the legacy static
// manifest, filters lifecycle/confidentiality/reuse/vigency before adapting
// either source, rejects a duplicate asset_id within or across sources, and
// orders bytewise by asset_id for a deterministic result. Fails closed on
// any query or validation error instead of serving a partial mix.
export async function selectVigiaApprovedAssets({ db, asOf, jsonPath, staticAssets } = {}) {
  if (!db || typeof db.queryEligiblePublishedKnowledgeAssets !== 'function') {
    throw new Error('El selector de activos aprobados de Vig-IA requiere una fuente db con queryEligiblePublishedKnowledgeAssets.');
  }
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) throw new Error('El selector de activos aprobados de Vig-IA requiere un asOf válido.');

  const rows = await db.queryEligiblePublishedKnowledgeAssets({ asOf });
  const dbAssets = (Array.isArray(rows) ? rows : [])
    .filter(row => isEligibleKnowledgeRow(row, asOfMs))
    .map(shapeKnowledgeSelectorAsset);

  const jsonAssets = Array.isArray(staticAssets)
    ? staticAssets.map(shapeKnowledgeSelectorAsset)
    : loadVigiaApprovedAssets({ path: nonEmptyString(jsonPath) ? jsonPath : DEFAULT_MANIFEST_PATH, now: asOf });

  const combined = [...dbAssets, ...jsonAssets];
  const ids = new Set();
  for (const asset of combined) {
    if (ids.has(asset.asset_id)) throw new Error(`asset_id duplicado entre fuentes del selector de activos aprobados: ${asset.asset_id}.`);
    ids.add(asset.asset_id);
  }
  combined.sort((a, b) => (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0));
  return Object.freeze(combined);
}
