// Licitaciones: el permiso manda, no el rol (Juan, 2026-10-29). Fija la migración 163 y su espejo en el ACL, para que
// nadie vuelva a dejar a la encargada —que es `comercial`— con las pantallas abiertas y un 42501 de la base.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS, can } from '../access-control.js';
import { canApproveTenderGoNoGo } from '../src/tenders/permissions.ts';

const migration = readFileSync(new URL('../supabase/migrations/163_licitaciones_sin_limite_por_rol.sql', import.meta.url), 'utf8');
const accessControl = readFileSync(new URL('../access-control.js', import.meta.url), 'utf8');

// Las ocho funciones de la base que limitaban por rol. `psi_record_tender_dossier_artifact_review` NO está: ya
// aceptaba la custodia documental además del rol, así que la encargada nunca estuvo bloqueada ahí.
const FUNCIONES = [
  'public.psi_record_tender_go_no_go_core_039(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
  'public.psi_transition_tender_offer_status_core_042(uuid,uuid,text,text,text)',
  'public.psi_archive_tender_opportunity(uuid,uuid,text,text)',
  'public.psi_upsert_tender_closure_acta(uuid,uuid,jsonb,timestamptz)',
  'public.psi_confirm_tender_closure_acta(uuid,uuid,timestamptz)',
  'public.psi_reopen_tender_closure_acta(uuid,uuid,timestamptz)',
  'public.psi_assert_tender_dossier_actor(uuid,boolean)',
  'public.psi_profile_has_tender_permission(uuid,boolean)',
];

const firmas = [...migration.matchAll(/'sig', '([^']+)'/g)].map(match => match[1]);
assert.deepEqual(firmas, FUNCIONES, 'la migración reescribe exactamente esas ocho funciones, en ese orden');
assert.ok(
  !firmas.some(firma => firma.includes('psi_record_tender_dossier_artifact_review')),
  'la revisión de versiones del expediente no se toca: ya aceptaba custodia documental',
);

// Reescribe desde la definición viva y falla cerrado si el guardia esperado no está exactamente una vez.
assert.match(migration, /pg_get_functiondef/);
assert.match(migration, /raise exception 'La autorización esperada de % aparece % veces/);
assert.match(migration, /v_hits <> 1/);
assert.match(migration, /Quedaron funciones de Licitaciones limitadas por rol/);

// Cada reemplazo sólo agrega `comercial`: ni toca `consulta` ni afloja el guardia de identidad.
const reemplazos = [...migration.matchAll(/'repl', '([^']*(?:''[^']*)*)'/g)].map(match => match[1]);
assert.ok(reemplazos.length === FUNCIONES.length, `se esperaban ${FUNCIONES.length} reemplazos, hay ${reemplazos.length}`);
for (const reemplazo of reemplazos) {
  assert.ok(reemplazo.includes("''comercial''"), `el reemplazo debe agregar comercial: ${reemplazo}`);
}
// Sólo la parte ejecutable: los comentarios de cabecera sí nombran lo que NO se toca.
const sql = migration.split('\n').map(line => line.replace(/--.*$/, '')).join('\n');
assert.ok(!sql.includes("''consulta''"), 'el rol de solo consulta nunca opera Licitaciones');
assert.ok(!/identity_type/.test(sql), 'la migración no toca el guardia de identidad humana');

// El ACL ya no narrowea por rol: aprobar depende del acceso a Licitaciones.
assert.doesNotMatch(
  accessControl,
  /LICITACIONES_GO_NO_GO_APPROVE:\n\s*return canHumanTenderAction\(profile\) && hasHumanRole/,
  'el ACL no debe volver a exigir rol elevado para aprobar',
);

const perfil = (role, permissions = ['licitaciones']) => ({
  id: `user-${role}`, role, active: true, identity_type: 'human', permissions, areas: [],
});
for (const action of [ACTIONS.LICITACIONES_GO_NO_GO_APPROVE, ACTIONS.LICITACIONES_DISCARD_APPROVE]) {
  assert.equal(can(perfil('comercial'), action, {}), true, `la encargada comercial debe poder ${action}`);
  assert.equal(can(perfil('admin'), action, {}), true, `admin debe poder ${action}`);
  assert.equal(can(perfil('comercial', []), action, {}), false, `sin el permiso nadie debe poder ${action}`);
  assert.equal(can(perfil('consulta'), action, {}), false, `solo consulta nunca debe poder ${action}`);
  assert.equal(can(perfil('colaborador'), action, {}), false, `un colaborador nunca debe poder ${action}`);
  assert.equal(
    can({ ...perfil('admin'), identity_type: 'agent' }, action, { technical_authorized: true }),
    false,
    `ninguna identidad de agente debe poder ${action}`,
  );
}

// La UI dice lo mismo que el servidor.
assert.equal(canApproveTenderGoNoGo(perfil('comercial')), true);
assert.equal(canApproveTenderGoNoGo(perfil('consulta')), false);
assert.equal(canApproveTenderGoNoGo(perfil('comercial', [])), false);

console.log('licitaciones-sin-limite-por-rol: ok');
