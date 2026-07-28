import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadVigiaApprovedAssets, validateVigiaApprovedAssetManifest } from '../vigia-approved-assets.js';

const now = '2030-02-01T10:00:00.000Z';
const valid = {
  version: 'vigia-approved-assets-v1',
  status: 'active',
  assets: [
    {
      asset_id: 'asset-001',
      title: 'Brochure corporativo aprobado',
      asset_type: 'brochure',
      url: 'https://psi.sharepoint.com/sites/comercial/brochure.pdf',
      status: 'approved',
      valid_until: null,
      tags: ['corporativo'],
    },
    {
      asset_id: 'asset-expired',
      title: 'Caso vencido',
      asset_type: 'case-study',
      url: 'https://psi.sharepoint.com/sites/comercial/caso.pdf',
      status: 'approved',
      valid_until: '2029-12-31T23:59:59.000Z',
      tags: ['caso'],
    },
  ],
};

assert.deepEqual(validateVigiaApprovedAssetManifest(valid, { now }), [valid.assets[0]], 'expired assets are excluded');
assert.deepEqual(validateVigiaApprovedAssetManifest({ version: 'vigia-approved-assets-v1', status: 'active', assets: [] }, { now }), []);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, assets: [{ ...valid.assets[0], url: 'http://psi.sharepoint.com/a.pdf' }] }, { now }), /HTTPS/i);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, assets: [{ ...valid.assets[0], url: 'https://evil.example.com/a.pdf' }] }, { now }), /SharePoint/i);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, assets: [{ ...valid.assets[0], url: 'https://psi.sharepoint.com/a.pdf?sig=secret' }] }, { now }), /query|consulta|firmad/i);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, assets: [valid.assets[0], { ...valid.assets[0] }] }, { now }), /duplicado/i);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, assets: [{ ...valid.assets[0], status: 'draft' }] }, { now }), /approved/i);
assert.throws(() => validateVigiaApprovedAssetManifest({ ...valid, unexpected: true }, { now }), /cerrad|inesperad/i);

const dir = mkdtempSync(path.join(tmpdir(), 'vigia-assets-'));
const file = path.join(dir, 'manifest.json');
writeFileSync(file, `${JSON.stringify(valid)}\n`);
assert.deepEqual(loadVigiaApprovedAssets({ path: file, now }), [valid.assets[0]]);

console.log('Vig-IA approved asset manifest passed');
