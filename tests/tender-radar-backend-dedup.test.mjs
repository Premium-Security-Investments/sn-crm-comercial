import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

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
  const { deduplicateTenderProcesses } = new Function('normalizeTenderStatusText', `${body}\nreturn { deduplicateTenderProcesses };`)(value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());

  const rows = [
    { id: 'offer', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001 (Presentación de oferta)', internal_status: 'nueva', last_seen_at: '2026-08-17T12:00:00Z', score: 190 },
    { id: 'interest', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001 (Manifestación de interés)', internal_status: 'en_revision', last_seen_at: '2026-08-16T12:00:00Z', score: 180 },
    { id: 'converted', source: 'SECOP II', entity: 'Municipio de Abejorral', ref: 'LP-001', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-1', last_seen_at: '2026-08-15T12:00:00Z', score: 170 },
    { id: 'unique', source: 'TVEC', entity: 'Entidad Nacional', ref: 'AMP-2', internal_status: 'nueva', score: 80 },
  ];
  const result = deduplicateTenderProcesses(rows);
  assert.deepEqual(result.map(row => row.id), ['converted', 'unique'], `${path}: one visible card per base process must preserve converted/managed state`);
  assert.match(source, /function radarPayload[\s\S]*deduplicateTenderProcesses\(tenders\)/, `${path}: backend payload totals and rows must use the deduplicated process list`);
}

console.log('backend tender process deduplication passed');