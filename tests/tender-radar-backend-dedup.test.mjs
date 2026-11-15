import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { compareTenderFamilyRecency, tenderProcessFamilyKey } from '../verticales/licitaciones/tender-process-family.js';

const backendPaths = ['../server/index.js', '../api/[...path].js'];

function extract(source, path, label, regex) {
  const match = source.match(regex);
  assert.ok(match, `${path} must define ${label}`);
  return match[0];
}

for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const body = [
    extract(source, path, 'normTenderText', /function normTenderText\(value\) \{ return normalizeTenderStatusText\(value\); \}\n/),
    extract(source, path, 'canonicalTenderProcessReference', /function canonicalTenderProcessReference\([\s\S]*?\n\}\n/),
    extract(source, path, 'canonicalTenderProcessKey', /function canonicalTenderProcessKey\([\s\S]*?\n\}\n/),
    extract(source, path, 'tenderProcessStatusRank', /function tenderProcessStatusRank\([\s\S]*?\n\}\n/),
    extract(source, path, 'deduplicateTenderProcesses', /function deduplicateTenderProcesses\([\s\S]*?\n\}\n/),
  ].join('');
  const { deduplicateTenderProcesses } = new Function('normalizeTenderStatusText', 'tenderProcessFamilyKey', 'compareTenderFamilyRecency', `${body}\nreturn { deduplicateTenderProcesses };`)(value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), tenderProcessFamilyKey, compareTenderFamilyRecency);

  const rows = [
    { id: 'offer', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001 (Presentación de oferta)', internal_status: 'nueva', last_seen_at: '2026-08-17T12:00:00Z', score: 190 },
    { id: 'interest', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001 (Manifestación de interés)', internal_status: 'en_revision', last_seen_at: '2026-08-16T12:00:00Z', score: 180 },
    { id: 'converted', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-1', last_seen_at: '2026-08-15T12:00:00Z', score: 170 },
    { id: 'unique', source: 'TVEC', entity: 'Entidad Nacional', ref: 'AMP-2', internal_status: 'nueva', score: 80 },
  ];
  const result = deduplicateTenderProcesses(rows);
  assert.deepEqual(result.map(row => row.id), ['converted', 'unique'], `${path}: one visible card per base process must preserve converted/managed state`);
  // Republicación SECOP II: misma familia (referencia sólo difiere en puntuación) → sólo la versión más reciente.
  const republished = deduplicateTenderProcesses([
    { id: 'old', source: 'SECOP II', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026', process_id: 'CO1.REQ.100', published: '2026-09-20T00:00:00Z', internal_status: 'nueva', score: 200 },
    { id: 'new', source: 'SECOP II', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026*', process_id: 'CO1.REQ.200', published: '2026-10-01T00:00:00Z', internal_status: 'nueva', score: 150 },
  ]);
  assert.deepEqual(republished.map(row => row.id), ['new'], `${path}: a republished SECOP II process must show only its newest version`);
  const reviewed = deduplicateTenderProcesses([
    { id: 'old', source: 'SECOP II', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026', process_id: 'CO1.REQ.100', published: '2026-09-20T00:00:00Z', internal_status: 'en_revision', score: 200 },
    { id: 'new', source: 'SECOP II', entity: 'GOBERNACION DE SUCRE', ref: 'CP-SDSD-440-2026*', process_id: 'CO1.REQ.200', published: '2026-10-01T00:00:00Z', internal_status: 'nueva', score: 150 },
  ]);
  assert.deepEqual(reviewed.map(row => row.id).sort(), ['new', 'old'], `${path}: a row under review is never hidden behind a newer version`);
  assert.match(source, /function radarPayload[\s\S]*deduplicateTenderProcesses\(tenders\)/, `${path}: backend payload totals and rows must use the deduplicated process list`);
}

console.log('backend tender process deduplication passed');
// Juan, 2026-11-15: Notariado salía dos veces porque la referencia venía escrita distinto con el mismo CO1.REQ.
for (const path of backendPaths) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const body = ['normTenderText', 'canonicalTenderProcessReference', 'canonicalTenderProcessKey', 'tenderProcessStatusRank', 'deduplicateTenderProcesses']
    .map(name => source.match(name === 'normTenderText' ? /function normTenderText\(value\) \{ return normalizeTenderStatusText\(value\); \}\n/ : new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`))[0]).join('');
  const { deduplicateTenderProcesses } = new Function('normalizeTenderStatusText', 'tenderProcessFamilyKey', 'compareTenderFamilyRecency', `${body}\nreturn { deduplicateTenderProcesses };`)(value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), tenderProcessFamilyKey, compareTenderFamilyRecency);
  const result = deduplicateTenderProcesses([
    { id: 'convertida', source: 'SECOP II', entity: 'SUPERINTENDENCIA DE NOTARIADO Y REGISTRO', ref: 'LP-005-2026', process_id: 'CO1.REQ.11343818', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'o' },
    { id: 'radar', source: 'SECOP II', entity: 'SUPERINTENDENCIA DE NOTARIADO Y REGISTRO', ref: 'LP 005 DE 2026', process_id: 'CO1.REQ.11343818', internal_status: 'nueva' },
    { id: 'otro', source: 'SECOP II', entity: 'SUPERINTENDENCIA DE NOTARIADO Y REGISTRO', ref: 'LICITACIÓN PÚBLICA No. 005 DE 2026', process_id: 'CO1.REQ.10632400', internal_status: 'nueva' },
  ]);
  assert.deepEqual(result.map(row => row.id), ['convertida', 'otro'], `${path}: el mismo CO1.REQ es un solo proceso aunque la referencia cambie`);
}
