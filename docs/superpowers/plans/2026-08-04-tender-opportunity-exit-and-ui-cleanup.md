# Tender Opportunity Exit and UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve “Sacar de oportunidad” as an atomic return to Radar, add an atomic “Pasar a seguimiento” exit, repair unversioned legacy tenders such as AEROCIVIL, and remove internal analysis noise from the operational UI.

**Architecture:** A new migration replaces the old discard-only transition with one destination-aware RPC while preserving the linked CRM record for audit and reconversion. The server exposes one validated exit handler in both Node and Vercel backends, and the React detail page invokes it through two explicit actions. Tender `internal_status` remains the source of truth for Radar/Seguimiento/Oportunidades visibility; the CRM opportunity is moved out of the active pipeline and reactivated atomically if the tender is converted again.

**Tech Stack:** PostgreSQL/Supabase RPC, Node.js/Express, React 19 + TypeScript, PGlite integration tests, Node static contract tests, Vite.

## Global Constraints

- “Sacar de oportunidad” keeps its exact user-facing name and returns the tender to Radar (`internal_status = 'nueva'`).
- “Pasar a seguimiento” is additional and moves the tender to Seguimiento (`internal_status = 'en_revision'`).
- Neither action sets the tender to `descartada`.
- Preserve documents, analysis, events, interactions, and the existing `converted_opportunity_id` link.
- Re-conversion reuses and reactivates the existing CRM opportunity; it must not create a duplicate.
- Preserve optimistic concurrency for versioned rows; backfill only legacy null tokens.
- Do not expose UUIDs, producer/model names, raw evidence IDs, or technical processing metadata in the operational UI.
- Do not trigger a new Vig-IA analysis, GO/NO GO decision, E5 registration, worker, migration, push, merge, or deploy during implementation without its corresponding authorized gate.
- Run Node tests sequentially (`--test-concurrency=1`) because the host has 5 GiB available.

---

## File Structure

- `supabase/migrations/058_tender_opportunity_exit_destinations.sql`: data repair, event constraint, destination-aware exit RPC, reconversion reactivation, and active tender-opportunity listing contract.
- `supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql`: restore the prior RPC/listing behavior without deleting business data.
- `tender-tracking-rpc.js`: validated JavaScript wrapper for the new RPC.
- `server/index.js` and `api/[...path].js`: identical handler and route contracts.
- `src/main.tsx`: two explicit actions, busy/error handling, and destination navigation.
- `src/tenders/components/TenderAnalysisSection.tsx`: compact evidence summary and removal of technical accordions/citations.
- `src/styles.css`: compact coverage strip and action layout; removal of obsolete accordion rules.
- `tests/tender-opportunity-exit-migration.test.mjs`: static SQL safety and contract.
- `tests/tender-opportunity-exit-pglite.integration.test.mjs`: transactional states, idempotency, rollback, concurrency, legacy repair, and reconversion.
- `tests/tender-opportunity-exit-rpc-contract.test.mjs`: wrapper arguments and timestamp preservation.
- `tests/tender-opportunity-exit-api.test.mjs`: auth, validation, status mapping, and backend parity.
- `tests/tender-opportunity-exit-ui.test.mjs`: exact buttons, prompts, destinations, disabled state, and navigation.
- `tests/agt002-evidence-coverage-ui.test.mjs`: replace obsolete accordion/list expectations with the compact strip contract.
- `tests/agt002-legal-findings-ui.test.mjs`: ensure useful legal findings remain while internal metadata disappears.

---

### Task 1: Atomic destination-aware database transition

**Files:**
- Create: `supabase/migrations/058_tender_opportunity_exit_destinations.sql`
- Create: `supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql`
- Create: `tests/tender-opportunity-exit-migration.test.mjs`
- Create: `tests/tender-opportunity-exit-pglite.integration.test.mjs`

**Interfaces:**
- Consumes: `psi_public_tenders`, `psi_sales_opportunities`, `psi_sales_interactions`, `psi_tender_tracking_events`, and the role checks from migration 018.
- Produces: `public.psi_exit_tender_opportunity(p_opportunity_id uuid, p_actor_id uuid, p_destination text, p_note text, p_expected_tracking_updated_at timestamptz) returns jsonb`.

- [ ] **Step 1: Write the static migration contract test**

Create assertions requiring:

```js
assert.match(sql, /update public\.psi_public_tenders[\s\S]*tracking_updated_at = coalesce\(/i);
assert.match(sql, /p_destination not in \('radar', 'seguimiento'\)/i);
assert.match(sql, /when 'radar' then 'nueva'/i);
assert.match(sql, /when 'seguimiento' then 'en_revision'/i);
assert.match(sql, /converted_opportunity_id = v_opportunity\.id/i);
assert.doesNotMatch(sql, /set internal_status = 'descartada'/i);
assert.match(sql, /'returned_to_radar'/i);
assert.match(sql, /'returned_to_tracking'/i);
assert.match(sql, /grant execute on function public\.psi_exit_tender_opportunity/i);
```

- [ ] **Step 2: Write failing PGlite scenarios**

Create a minimal schema mirroring the existing tracking integration test and assert:

```js
const radar = await exit(db, 'radar', exactToken);
assert.equal(radar.result.internal_status, 'nueva');
assert.equal(radar.result.converted_opportunity_id, ids.opportunity);
assert.equal(await eventTypes(db), 'returned_to_radar');

const tracking = await exit(db, 'seguimiento', exactToken);
assert.equal(tracking.result.internal_status, 'en_revision');
assert.equal(tracking.result.tracking_status, 'pendiente_revision');
assert.equal(tracking.result.tracking_owner_id, ids.actor);

await assert.rejects(() => exit(db, 'radar', staleToken), /Seguimiento desactualizado/i);
assert.equal(await eventCount(db), 0);
```

Also test: same-destination retry is idempotent; opposite-destination retry is HTTP/RPC conflict; forced event insert failure rolls back both tables; microsecond token `2026-08-04T12:00:00.123456Z` matches exactly; a converted legacy row with null token receives a non-null backfill; reconversion reuses the same opportunity ID and restores its active stage.

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/tender-opportunity-exit-migration.test.mjs tests/tender-opportunity-exit-pglite.integration.test.mjs
```

Expected: FAIL because migration 058 and `psi_exit_tender_opportunity` do not exist.

- [ ] **Step 4: Implement migration 058**

The migration must use one transaction and this state mapping:

```sql
v_target_status := case p_destination
  when 'radar' then 'nueva'
  when 'seguimiento' then 'en_revision'
end;
v_event_type := case p_destination
  when 'radar' then 'returned_to_radar'
  when 'seguimiento' then 'returned_to_tracking'
end;
```

Repair only unversioned lifecycle rows:

```sql
update public.psi_public_tenders
set tracking_updated_at = coalesce(reviewed_at, updated_at, created_at, now())
where internal_status in ('convertida_oportunidad', 'en_revision')
  and tracking_updated_at is null;
```

Inside the RPC: lock the opportunity then its unique tender; validate actor and `licitacion_publica`; recognize same-destination idempotency before stale-token validation; reject the opposite destination; compare a non-null expected token exactly; set the opportunity to the existing inactive terminal stage without setting the tender to `descartada`; preserve `converted_opportunity_id`; clear tracking fields for Radar; initialize tracking fields for Seguimiento; insert one interaction and one immutable destination event.

Replace `psi_convert_tender_to_opportunity` so an existing `external_source` row is updated with the supplied active `stage_code`, owner, dates, commercial fields, and `next_action_at` semantics before the tender returns to `convertida_oportunidad`.

Replace `psi_list_tender_opportunity_page` with the same bounded/filter logic from migration 023 plus the explicit predicate:

```sql
where t.internal_status = 'convertida_oportunidad'
```

- [ ] **Step 5: Add rollback SQL**

The rollback must drop only the new RPC, restore the 018 conversion function and 023 listing function, restore the prior event-type check, and leave repaired timestamps/business rows untouched.

- [ ] **Step 6: Run database tests and verify GREEN**

Run the command from Step 3 plus:

```bash
node --test --test-concurrency=1 tests/tender-tracking-pglite.integration.test.mjs tests/tender-opportunities-listing-pglite.integration.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/058_tender_opportunity_exit_destinations.sql supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql tests/tender-opportunity-exit-migration.test.mjs tests/tender-opportunity-exit-pglite.integration.test.mjs
git commit -m "feat: add tender opportunity exit transitions"
```

---

### Task 2: Shared RPC wrapper and backend route

**Files:**
- Modify: `tender-tracking-rpc.js:3-77`
- Modify: `server/index.js:1512-1530,2918-2930` and route registration near the existing opportunity-discard route
- Modify: `api/[...path].js` at the parity-equivalent locations
- Create: `tests/tender-opportunity-exit-rpc-contract.test.mjs`
- Create: `tests/tender-opportunity-exit-api.test.mjs`

**Interfaces:**
- Consumes: SQL function from Task 1.
- Produces: `callTenderOpportunityExit(database, opportunityId, { destination, note, expected_tracking_updated_at }, currentProfile)` and `POST /api/tender-opportunity-exit`.

- [ ] **Step 1: Write failing wrapper tests**

Assert exact RPC arguments and opaque timestamp preservation:

```js
await callTenderOpportunityExit(db, opportunityId, {
  destination: 'seguimiento',
  note: 'Esperar adenda',
  expected_tracking_updated_at: '2026-08-04T12:00:00.123456+00:00',
}, { id: actorId });
assert.equal(db.calls[0].name, 'psi_exit_tender_opportunity');
assert.equal(db.calls[0].args.p_expected_tracking_updated_at, '2026-08-04T12:00:00.123456+00:00');
await assert.rejects(() => callTenderOpportunityExit(db, opportunityId, { destination: 'otro' }, { id: actorId }), /destino/i);
```

- [ ] **Step 2: Write failing API tests for both backends**

Exercise both `server/index.js` and `api/[...path].js` using the existing local Supabase HTTP stub pattern. Assert: unauthenticated 401; unauthorized 403; invalid destination 400; RPC stale error maps to 409; success returns the destination and tender; handler reads `id,internal_status,tracking_updated_at` once and forwards the exact value.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
node --test --test-concurrency=1 tests/tender-opportunity-exit-rpc-contract.test.mjs tests/tender-opportunity-exit-api.test.mjs
```

Expected: FAIL because the wrapper and route do not exist.

- [ ] **Step 4: Implement the shared wrapper**

Add:

```js
const OPPORTUNITY_EXIT_DESTINATIONS = new Set(['radar', 'seguimiento']);
export async function callTenderOpportunityExit(database, opportunityId, input, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);
  const destination = String(input?.destination || '').trim();
  if (!OPPORTUNITY_EXIT_DESTINATIONS.has(destination)) throw trackingError('Destino de salida inválido.');
  return rpc(database, 'psi_exit_tender_opportunity', {
    p_opportunity_id: id,
    p_actor_id: actorId,
    p_destination: destination,
    p_note: nullableText(input?.note),
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at, true),
  });
}
```

Remove `callTenderOpportunityDiscard` only after all imports/tests use the new name.

- [ ] **Step 5: Implement one route in both backends**

Create a shared local helper that validates access, fetches the linked tender token, and invokes the wrapper. Register:

```js
app.post('/api/tender-opportunity-exit', async (req, res) => {
  try {
    const { profile } = await getAuthContext(req);
    const result = await exitTenderOpportunity(requireDb(), req.body?.opportunity_id, profile, {
      destination: req.body?.destination,
      note: req.body?.reason,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, /desactualizado/i.test(error?.message || '') ? 409 : error?.status || 400);
  }
});
```

Keep Node and Vercel implementations byte-parity compatible with `scripts/check_backend_parity.mjs`.

- [ ] **Step 6: Run tests and parity check**

```bash
node --test --test-concurrency=1 tests/tender-opportunity-exit-rpc-contract.test.mjs tests/tender-opportunity-exit-api.test.mjs
npm run check:backend-parity
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tender-tracking-rpc.js server/index.js 'api/[...path].js' tests/tender-opportunity-exit-rpc-contract.test.mjs tests/tender-opportunity-exit-api.test.mjs
git commit -m "feat: expose tender opportunity exit API"
```

---

### Task 3: Two explicit opportunity-detail actions

**Files:**
- Modify: `src/main.tsx:785-806`
- Modify: `src/styles.css`
- Create: `tests/tender-opportunity-exit-ui.test.mjs`

**Interfaces:**
- Consumes: `POST /api/tender-opportunity-exit` from Task 2.
- Produces: exact actions “Sacar de oportunidad” and “Pasar a seguimiento”, each navigating to its destination after success.

- [ ] **Step 1: Write failing UI contract tests**

Require exact labels and destinations:

```js
assert.match(main, />Pasar a seguimiento<\/button>/);
assert.match(main, />Sacar de oportunidad<\/button>/);
assert.match(main, /destination:\s*'radar'/);
assert.match(main, /destination:\s*'seguimiento'/);
assert.match(main, /go\('#\/tenders\?view=radar'/);
assert.match(main, /go\('#\/tenders\?view=seguimiento'/);
assert.doesNotMatch(main, /Motivo para sacar de oportunidad \/ descartar/i);
assert.doesNotMatch(main, /Descartar licitación/);
```

Bundle a small extracted helper if needed and assert a 409 produces the friendly reload message.

- [ ] **Step 2: Run test and verify RED**

```bash
node --test --test-concurrency=1 tests/tender-opportunity-exit-ui.test.mjs
```

Expected: FAIL because the new action and copy are absent.

- [ ] **Step 3: Implement a single destination-aware submit function**

Use one busy state and exact copy:

```tsx
const exitTenderOpportunity = async (destination: 'radar' | 'seguimiento') => {
  const promptText = destination === 'radar'
    ? 'Motivo para sacar la oportunidad y devolverla al Radar:'
    : 'Motivo para pasar la oportunidad a Seguimiento:';
  const reason = window.prompt(promptText, '');
  if (reason === null) return;
  setTenderExitDestination(destination);
  try {
    await api('/api/tender-opportunity-exit', {
      method: 'POST',
      body: JSON.stringify({ opportunity_id: o.id, destination, reason }),
    });
    await refresh();
    go(destination === 'radar' ? '#/tenders?view=radar' : '#/tenders?view=seguimiento');
  } finally {
    setTenderExitDestination(null);
  }
};
```

Render two separate buttons; disable both while either action runs. “Pasar a seguimiento” is secondary; “Sacar de oportunidad” keeps the existing visual emphasis but must not use discard copy.

- [ ] **Step 4: Run focused UI test and build**

```bash
node --test --test-concurrency=1 tests/tender-opportunity-exit-ui.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/styles.css tests/tender-opportunity-exit-ui.test.mjs
git commit -m "feat: add tender exit destination actions"
```

---

### Task 4: Remove internal UI noise and compact evidence coverage

**Files:**
- Modify: `src/main.tsx:799-807`
- Modify: `src/tenders/components/TenderAnalysisSection.tsx`
- Modify: `src/styles.css`
- Modify: `tests/agt002-evidence-coverage-ui.test.mjs`
- Modify: `tests/agt002-legal-findings-ui.test.mjs`

**Interfaces:**
- Consumes: existing `TenderEvidenceCoverage` typed data.
- Produces: one non-expandable `.tender-evidence-coverage-strip` with human-readable totals; no raw evidence detail in the operational page.

- [ ] **Step 1: Replace old test expectations with failing compact-strip expectations**

Use exact assertions:

```js
assert.match(analysis, /tender-evidence-coverage-strip/);
assert.match(analysis, /referencias utilizadas/i);
assert.match(analysis, /requisitos con evidencia/i);
assert.doesNotMatch(analysis, /<details[^>]*tender-evidence-coverage/);
assert.doesNotMatch(analysis, /Omitidos/);
assert.doesNotMatch(analysis, /omitted_chunks\.map|selected_chunks\.map/);
assert.doesNotMatch(main, /Detalles técnicos y auditoría/);
for (const hidden of ['Snapshot', 'Productor', 'Estado técnico', 'Cómo funciona', 'Citas de evidencia']) {
  assert.ok(!analysis.includes(hidden) && !main.includes(hidden), `${hidden} no debe mostrarse`);
}
```

Keep legal-finding assertions for official source verification, pending human interpretation, and the single human-authority notice.

- [ ] **Step 2: Run UI tests and verify RED**

```bash
node --test --test-concurrency=1 tests/agt002-evidence-coverage-ui.test.mjs tests/agt002-legal-findings-ui.test.mjs
```

Expected: FAIL on the old accordion and technical blocks.

- [ ] **Step 3: Implement compact coverage**

Replace the accordion renderer with:

```tsx
function EvidenceCoverageStrip({ coverage }: { coverage: TenderEvidenceCoverage }) {
  const used = coverage.selected_chunks?.length || 0;
  const requirements = coverage.coverage_manifest?.by_requirement || [];
  const covered = requirements.filter(item => item.status === 'covered').length;
  const total = requirements.length;
  return <div className="tender-evidence-coverage-strip" aria-label="Cobertura de evidencia">
    <span><strong>{used}</strong> referencias utilizadas</span>
    <span><strong>{covered} de {total}</strong> requisitos con evidencia</span>
  </div>;
}
```

Retain any material-omission warning only when it changes a human decision, but do not expose omitted counts/reasons or raw document coordinates.

Remove the summary technical `<details>` from `src/main.tsx`, the technical analysis accordion, raw citation accordion, duplicate AGT-002/producer messages, and the “Cómo funciona” accordion. Keep one concise human-authority sentence.

- [ ] **Step 4: Replace obsolete CSS**

Remove `.tender-evidence-coverage` accordion rules and add a responsive strip using existing border, muted background, spacing, and typography tokens. At mobile width, wrap the two metrics without horizontal overflow.

- [ ] **Step 5: Run focused tests and build**

```bash
node --test --test-concurrency=1 tests/agt002-evidence-coverage-ui.test.mjs tests/agt002-legal-findings-ui.test.mjs tests/tender-opportunity-exit-ui.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/tenders/components/TenderAnalysisSection.tsx src/styles.css tests/agt002-evidence-coverage-ui.test.mjs tests/agt002-legal-findings-ui.test.mjs
git commit -m "refactor: simplify tender analysis UI"
```

---

### Task 5: Full regression, independent review, and authorized rollout

**Files:**
- Modify only files required by verified review findings.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: mechanically verified branch ready for migration/deploy gate and one guided authenticated validation.

- [ ] **Step 1: Run focused lifecycle suite sequentially**

```bash
node --test --test-concurrency=1 \
  tests/tender-opportunity-exit-migration.test.mjs \
  tests/tender-opportunity-exit-pglite.integration.test.mjs \
  tests/tender-opportunity-exit-rpc-contract.test.mjs \
  tests/tender-opportunity-exit-api.test.mjs \
  tests/tender-opportunity-exit-ui.test.mjs \
  tests/tender-tracking-pglite.integration.test.mjs \
  tests/tender-opportunities-listing-pglite.integration.test.mjs \
  tests/agt002-evidence-coverage-ui.test.mjs \
  tests/agt002-legal-findings-ui.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run full regression sequentially**

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run build, backend parity, and diff checks**

```bash
npm run build
npm run check:backend-parity
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
```

Expected: build and parity PASS; no whitespace errors; only intended files changed.

- [ ] **Step 4: Request one independent technical review**

Use Claude Code Sonnet read-only against `git diff origin/main...HEAD`, asking specifically for transaction safety, authorization, idempotency, stale-token behavior, reconversion, UI copy, and hidden technical data. Fix only concrete findings and rerun Steps 1–3 once.

- [ ] **Step 5: Commit verified review fixes if any**

```bash
git add supabase/migrations/058_tender_opportunity_exit_destinations.sql supabase/rollbacks/058_tender_opportunity_exit_destinations_rollback.sql tender-tracking-rpc.js server/index.js 'api/[...path].js' src/main.tsx src/tenders/components/TenderAnalysisSection.tsx src/styles.css tests/tender-opportunity-exit-*.test.mjs tests/agt002-evidence-coverage-ui.test.mjs tests/agt002-legal-findings-ui.test.mjs
git commit -m "fix: address tender exit review findings"
```

Skip this commit when no changes are needed.

- [ ] **Step 6: Stop at migration/deploy gate**

Report the exact test counts, build result, parity result, migration path, and diff summary. Ask for authorization before applying migration 058, pushing, opening/merging a PR, or deploying.

- [ ] **Step 7: After authorization, apply and verify rollout**

Apply migration 058 through the established project migration mechanism, push the branch, open/merge the PR, deploy production, and verify deployment status/assets/API authentication mechanically. Do not trigger Vig-IA or modify GO/NO GO.

- [ ] **Step 8: Perform one guided authenticated validation with Juan**

Validate one step/capture at a time:

1. open AEROCIVIL opportunity detail and confirm both buttons;
2. use the user-chosen safe test action only after Juan confirms scope;
3. verify the opportunity disappears from Oportunidades;
4. verify it appears only in Radar or Seguimiento according to the selected action;
5. verify the simplified SA-24-2026 analysis presentation without starting a new analysis.

- [ ] **Step 9: Final commit/status evidence**

```bash
git status --short
git log -5 --oneline
git diff --check origin/main...HEAD
```

Expected: clean working tree and traceable commits.
