import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TENDER_DISQUALIFYING_TERMS,
  TENDER_NON_COMMERCIAL_ACT_TERMS,
  TENDER_NON_SECURITY_CONTEXT_TERMS,
} from '../tender-relevance-terms.js';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
const { isTenderTrackable } = await import('../server/index.js');

assert.ok(TENDER_NON_SECURITY_CONTEXT_TERMS.includes('vigilancia epidemiologica'));
assert.ok(TENDER_NON_COMMERCIAL_ACT_TERMS.includes('aunar esfuerzos'));
assert.ok(TENDER_DISQUALIFYING_TERMS.includes('interventoria'));
assert.equal(Object.isFrozen(TENDER_DISQUALIFYING_TERMS), true);
assert.equal(Object.isFrozen(TENDER_NON_SECURITY_CONTEXT_TERMS), true);
assert.equal(Object.isFrozen(TENDER_NON_COMMERCIAL_ACT_TERMS), true);

const backend = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
assert.match(backend, /from '\.\.\/tender-relevance-terms\.js'/);
assert.doesNotMatch(backend, /const tenderDisqualifyingTerms = \[/);

assert.equal(isTenderTrackable({ title: 'Servicio de vigilancia armada', status: 'abierto' }), true);
assert.equal(isTenderTrackable({ title: 'Interventoria tecnica', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Vigilancia epidemiologica en salud publica', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Aunar esfuerzos institucionales', status: 'abierto' }), false);
assert.equal(isTenderTrackable({ title: 'Servicio de vigilancia armada', status: 'cancelado' }), false);
