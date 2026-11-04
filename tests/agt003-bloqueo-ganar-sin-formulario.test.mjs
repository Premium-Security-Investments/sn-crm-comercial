// AGT-003 — etapa 3 del formulario de cierre, segunda mitad: sin formulario completo no se gana (Juan, 2026-11-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closureFormWinVerdict } from '../src/vigia/closure-form.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('el veredicto explica qué falta', () => {
  const missing = closureFormWinVerdict({ form: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'AGT003_CLOSURE_FORM_MISSING');
  assert.match(missing.message, /falta el formulario de cierre/);
  const incomplete = closureFormWinVerdict({ form: { legal_rep_name: 'Ana' }, sites: [], posts: [] });
  assert.equal(incomplete.code, 'AGT003_CLOSURE_FORM_INCOMPLETE');
  assert.match(incomplete.message, /falta completar el formulario de cierre/);
});

test('todas las puertas a "aprobado" consultan el formulario, en los dos backends', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const src = read(file);
    assert.match(src, /async function requireClosureFormForWin\(database, opportunityId\) \{/);
    assert.match(src, /const verdict = closureFormWinVerdict\(\{ form: stored, sites: children\.sites, posts: children\.posts \}\);/);
    // La decisión: botón "Decidir" y chat (mover_etapa usa la misma función).
    const decision = src.slice(src.indexOf('async function recordOpportunityDecision('));
    assert.match(decision.slice(0, decision.indexOf('\n}\n')),
      /const params = normalizeDecisionRequest\(body\);\n {2}if \(params\.p_decision === 'advance' && params\.p_stage_code === 'aprobado'\) await requireClosureFormForWin\(database, id\);\n {2}const \{ data, error \} = await database\.rpc\('psi_record_opportunity_decision'/,
      'se revisa ANTES de la RPC');
    // Las tres ediciones de la ficha (PUT /api/opportunities/:id, PUT /api/opportunity y la del chat).
    assert.equal((src.match(/if \(!isPublicTender && payload\.stage_code === 'aprobado' && existing\.stage_code !== 'aprobado'\) await requireClosureFormForWin\(database, existing\.id\);/g) || []).length, 3);
    // Las dos creaciones (POST /api/opportunities y la del chat): no se nace ganada.
    assert.equal((src.match(/const isPublicTender = payload\.service_type_code === 'licitacion_publica';\n +rejectWinOnCreate\(payload, isPublicTender\);/g) || []).length, 2);
    assert.match(src, /Una oportunidad no se puede crear ya ganada: créela en otra etapa, llene el formulario de cierre y después márquela como ganada\./);
  }
});

test('las licitaciones no pasan por el bloqueo', () => {
  const src = read('../server/index.js');
  const fn = src.slice(src.indexOf('function rejectWinOnCreate('));
  assert.match(fn.slice(0, fn.indexOf('\n}\n')), /if \(isPublicTender \|\| payload\.stage_code !== 'aprobado'\) return;/);
});

test('al crear, la pantalla no ofrece "Aprobado" (salvo licitaciones)', () => {
  const ui = read('../src/main.tsx');
  assert.match(ui, /options=\{data\.stages\.filter\(s => id \|\| form\.service_type_code === 'licitacion_publica' \|\| s\.code !== 'aprobado'\)\.map\(s=>\[s\.code,s\.name\]\)\}/);
});
