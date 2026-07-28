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
