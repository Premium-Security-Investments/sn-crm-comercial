// AGT-002 actionable review — closed authorization matrix (design §7).
// RED reason: ACTIONS does not yet expose the five new actionable-review /
// knowledge codes, so `ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE` and
// its siblings are `undefined`; every scenario below that expects `can()` to
// return `true` for those keys fails because `can()` short-circuits on
// `KNOWN_ACTIONS.has(undefined)` (false) and returns `false` for everything.
import assert from 'node:assert/strict';
import { ACTIONS, can } from '../access-control.js';

const NEW_ACTION_CODES = {
  LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE: 'licitaciones.actionable_review.contribute',
  LICITACIONES_ACTIONABLE_REVIEW_RESOLVE: 'licitaciones.actionable_review.resolve',
  LICITACIONES_KNOWLEDGE_PROPOSE: 'licitaciones.knowledge.propose',
  LICITACIONES_KNOWLEDGE_REVIEW: 'licitaciones.knowledge.review',
  LICITACIONES_KNOWLEDGE_PUBLISH: 'licitaciones.knowledge.publish',
};

const profile = (role, overrides = {}) => ({
  id: `user-${role}`,
  role,
  active: true,
  areas: [],
  permissions: ['licitaciones'],
  ...overrides,
});
const human = (role, overrides = {}) => profile(role, { identity_type: 'human', ...overrides });
const agentProfile = (overrides = {}) => ({
  id: 'agent-1',
  active: true,
  identity_type: 'agent',
  areas: [],
  permissions: ['licitaciones'],
  ...overrides,
});

// The server resolves this resource shape itself (never trusts client fields):
// area/subarea scope the opportunity's Licitaciones subarea for `director`,
// `owner_id` is the opportunity owner for `comercial`, and `assigned_profile_id`
// is the server-owned assignment relation for `colaborador` (design §7.1: "la
// relación de asignación existente que corresponda al recurso").
const OWNER = 'comercial-owner-1';
const ASSIGNED = 'colaborador-assigned-1';
function resource(overrides = {}) {
  return {
    area_code: 'comercial',
    subarea_code: 'licitaciones',
    owner_id: OWNER,
    assigned_profile_id: ASSIGNED,
    ...overrides,
  };
}

// --- §7.1: exact new action codes -------------------------------------------
await (async function newActionsExistWithExactCodes() {
  for (const [key, value] of Object.entries(NEW_ACTION_CODES)) {
    assert.equal(ACTIONS[key], value, `ACTIONS.${key} must equal '${value}'`);
  }
})();

await (async function noFallbackToWorkbenchUse() {
  // A profile that only has LICITACIONES_WORKBENCH_USE-shaped access (role
  // outside the matrix, e.g. a bare 'junta' without explicit read permission)
  // must not be granted any of the five new actions via a legacy fallback.
  const junta = human('junta');
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(junta, code, resource()), false, `junta must not fall back to workbench access for ${code}`);
  }
})();

// --- §7.2 matrix: admin/gerencia are global -------------------------------
await (async function adminAndGerenciaAreGlobalForAllFiveActions() {
  for (const role of ['admin', 'gerencia']) {
    for (const code of Object.values(NEW_ACTION_CODES)) {
      assert.equal(can(human(role), code, resource()), true, `${role} must globally hold ${code}`);
      // Global means no scope/ownership/assignment dependency at all.
      assert.equal(
        can(human(role), code, resource({ area_code: 'siio', subarea_code: null, owner_id: 'someone-else', assigned_profile_id: 'nobody' })),
        true,
        `${role} must hold ${code} regardless of resource scope/ownership`,
      );
    }
  }
})();

// --- director: scope-gated on comercial/licitaciones -------------------------
await (async function directorIsScopeGated() {
  const scoped = human('director', { areas: [{ area_code: 'comercial', subarea_code: 'licitaciones' }] });
  const wrongSubarea = human('director', { areas: [{ area_code: 'comercial', subarea_code: 'ventas' }] });
  const wrongArea = human('director', { areas: [{ area_code: 'siio', subarea_code: null }] });
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(scoped, code, resource()), true, `scoped director must hold ${code}`);
    assert.equal(can(wrongSubarea, code, resource()), false, `director scoped to a different subarea must not hold ${code}`);
    assert.equal(can(wrongArea, code, resource()), false, `director scoped to a different area must not hold ${code}`);
  }
})();

// --- comercial: owner-gated, contribute/propose only, never resolve/review/publish
await (async function comercialIsOwnerGatedAndWriteLimited() {
  const owner = human('comercial', { id: OWNER });
  const notOwner = human('comercial', { id: 'someone-else' });
  assert.equal(can(owner, ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE, resource()), true);
  assert.equal(can(owner, ACTIONS.LICITACIONES_KNOWLEDGE_PROPOSE, resource()), true);
  for (const code of [ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_RESOLVE, ACTIONS.LICITACIONES_KNOWLEDGE_REVIEW, ACTIONS.LICITACIONES_KNOWLEDGE_PUBLISH]) {
    assert.equal(can(owner, code, resource()), false, `owner comercial must never hold ${code}`);
  }
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(notOwner, code, resource()), false, `non-owner comercial must not hold ${code}`);
  }
})();

// --- colaborador: assignment-gated, contribute/propose only ------------------
await (async function colaboradorIsAssignmentGatedAndWriteLimited() {
  const assigned = human('colaborador', { id: ASSIGNED });
  const notAssigned = human('colaborador', { id: 'someone-else' });
  assert.equal(can(assigned, ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE, resource()), true);
  assert.equal(can(assigned, ACTIONS.LICITACIONES_KNOWLEDGE_PROPOSE, resource()), true);
  for (const code of [ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_RESOLVE, ACTIONS.LICITACIONES_KNOWLEDGE_REVIEW, ACTIONS.LICITACIONES_KNOWLEDGE_PUBLISH]) {
    assert.equal(can(assigned, code, resource()), false, `assigned colaborador must never hold ${code}`);
  }
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(notAssigned, code, resource()), false, `unassigned colaborador must not hold ${code}`);
  }
  // Mere area coincidence (no explicit assignment relation) never substitutes
  // for assignment — a colaborador in the same area as an unassigned resource
  // still fails.
  const sameAreaButUnassigned = human('colaborador', { id: 'someone-else', areas: [{ area_code: 'comercial', subarea_code: 'licitaciones' }] });
  assert.equal(can(sameAreaButUnassigned, ACTIONS.LICITACIONES_ACTIONABLE_REVIEW_CONTRIBUTE, resource()), false);
})();

// --- junta: read-only elsewhere, never any of the five write/propose actions
await (async function juntaNeverHoldsAnyOfTheFiveActions() {
  const withExplicitReadPermission = human('junta', { permissions: ['licitaciones', 'junta_lectura_licitaciones'] });
  const withoutExplicitReadPermission = human('junta');
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(withExplicitReadPermission, code, resource()), false, `junta must not hold ${code} even with explicit read permission`);
    assert.equal(can(withoutExplicitReadPermission, code, resource()), false, `junta must not hold ${code} by default`);
  }
})();

// --- agent identities never receive any of the five actions ------------------
await (async function agentsNeverReceiveAnyOfTheFiveActions() {
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(agentProfile(), code, resource()), false, `agent must not hold ${code}`);
    assert.equal(
      can(agentProfile({ id: OWNER }), code, resource()),
      false,
      `agent must not hold ${code} even if its id coincides with owner_id`,
    );
  }
})();

// --- inactive profile fails closed regardless of role/scope/ownership --------
await (async function inactiveProfileFailsClosedForAllFiveActions() {
  for (const code of Object.values(NEW_ACTION_CODES)) {
    assert.equal(can(human('admin', { active: false }), code, resource()), false);
    assert.equal(can(human('comercial', { id: OWNER, active: false }), code, resource()), false);
  }
})();

// --- missing the base 'licitaciones' permission fails closed for every role,
// including admin/gerencia (design §7.1: "que incorpora permiso licitaciones").
await (async function missingLicitacionesPermissionFailsClosedForEveryRole() {
  for (const role of ['admin', 'gerencia', 'director', 'comercial', 'colaborador']) {
    const withoutPermission = human(role, {
      permissions: [],
      areas: role === 'director' ? [{ area_code: 'comercial', subarea_code: 'licitaciones' }] : [],
      id: role === 'comercial' ? OWNER : (role === 'colaborador' ? ASSIGNED : `user-${role}`),
    });
    for (const code of Object.values(NEW_ACTION_CODES)) {
      assert.equal(can(withoutPermission, code, resource()), false, `${role} without 'licitaciones' permission must not hold ${code}`);
    }
  }
})();

console.log('AGT-002 actionable review authorization matrix (RED — actions/switch missing) passed');
