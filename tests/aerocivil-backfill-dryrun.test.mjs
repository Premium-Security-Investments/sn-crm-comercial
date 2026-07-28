import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planAerocivilBackfill } from '../aerocivil-backfill-dryrun.js';

function legacyDocument(index, overrides = {}) {
  return {
    id: `legacy-doc-${index}`,
    name: `Documento ${index}.pdf`,
    storage_path: `opportunity/doc-${index}.pdf`,
    size: 1024 + index,
    mime_type: 'application/pdf',
    content_hash: `sha256-${index}`,
    extracted_text: `Contenido extraído ${index}`,
    source: 'AEROCIVIL',
    source_url: `https://www.aerocivil.gov.co/documentos/${index}.pdf`,
    source_document_id: `aerocivil-${index}`,
    ...overrides,
  };
}

const forty = [{ id: 'interaction-1', interaction_type: 'documento', notes: JSON.stringify({ kind: 'tender_document_upload', source: 'AEROCIVIL', documents: Array.from({ length: 40 }, (_, index) => legacyDocument(index + 1)) }) }];
const complete = planAerocivilBackfill({ interactions: forty });
assert.equal(complete.expected, 40);
assert.equal(complete.found, 40);
assert.equal(complete.ready.length, 40);
assert.equal(complete.excluded.length, 0);

const emptyText = planAerocivilBackfill({ interactions: [{ id: 'interaction-2', notes: { kind: 'tender_document_upload', documents: [legacyDocument(41, { extracted_text: '   ' })] } }] });
assert.equal(emptyText.ready.length, 0);
assert.equal(emptyText.excluded[0].reason, 'empty_text');

const fallbackIdentity = planAerocivilBackfill({ interactions: [{ id: 'interaction-3', notes: { kind: 'tender_document_upload', documents: [legacyDocument(42, { source_document_id: null })] } }] });
assert.equal(fallbackIdentity.ready[0].source_document_id, 'legacy:sha256-42');

const idIdentity = planAerocivilBackfill({ interactions: [{ id: 'interaction-4', notes: { kind: 'tender_document_upload', documents: [legacyDocument(43, { source_document_id: null, content_hash: null })] } }] });
assert.equal(idIdentity.ready[0].source_document_id, 'legacy:legacy-doc-43');

const moduleSource = readFileSync(new URL('../aerocivil-backfill-dryrun.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /psi_record_tender_document_version|\.insert\(|\.update\(|\.delete\(/, 'El planificador puro no puede tener dependencias de escritura');
const scriptSource = readFileSync(new URL('../scripts/aerocivil-backfill-dryrun.mjs', import.meta.url), 'utf8');
assert.match(scriptSource, /opportunity-uuid/i);
assert.match(scriptSource, /tender-uuid/i);
assert.match(scriptSource, /method:\s*'GET'/);
assert.doesNotMatch(scriptSource, /method:\s*'(POST|PUT|PATCH|DELETE)'|\/rpc\//, 'El script dry-run solo puede leer');

console.log('aerocivil backfill dry-run planner passed');
