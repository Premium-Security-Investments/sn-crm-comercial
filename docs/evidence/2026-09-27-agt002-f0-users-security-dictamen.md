# AGT-002 F0 — Migration 095 (`public.usuarios` security) — Independent Review Dictamen

- Date: 2026-09-27
- Scope: `supabase/migrations/095_agt002_f0_users_security.sql`
- Status: repo-only; no `supabase db push`, no `psql` against prod/staging, no production access performed as part of this review or its remediation.

## 1. Evidence provenance

This dictamen documents a **live, read-only, pre-095** catalog capture, performed and verified by the parent/operator (not by this session), against the production project:

- Project ref: `tyfzjqzcpgwcjnxozaaf`
- Captured at: `2026-09-27T20:07:55.902172+00:00`
- External artifact: `/root/.hermes/artifacts/AGT002-095-PREFLIGHT-001/pre-095-live-catalog.json`
- Artifact SHA-256: `9ec80a4ed53fd1dc9b2a73fe21c6d9627fed7afa3c0028b4b8a56268644bf3c8`
- Read scope: catalog/metadata only. No business-row contents were read. Row counts captured were `usuarios=6` and `ia_usage=0`.

Nothing below extrapolates beyond these captured facts. Anything not explicitly captured (e.g. contents of `usuarios` rows) is out of scope for this dictamen.

## 2. Live pre-095 facts

### `public.usuarios`

- Owner: `postgres`
- `relrowsecurity = false`
- `relforcerowsecurity = false`
- `relacl`: `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
  - i.e. `anon` and `authenticated` hold full `arwdDxtm` (all) table privileges directly on `usuarios`, with RLS disabled — the exposure migration 095 closes.
- 5 policies exist on `usuarios` and are preserved untouched by 095 (RLS was simply never turned on to enforce them).
- Column `activo`: exists, `boolean`, nullable, `default true`.
  - `registrar_uso_ia`'s `v_activo is not true` check fails closed for both `false` and `NULL` — an account with `activo` unset (`NULL`) is treated as inactive, not permissive-by-default.
- Role capabilities: `service_role` and `postgres` have `BYPASSRLS`; `anon` and `authenticated` do not.

### `public.registrar_uso_ia`

- Owner: `postgres`
- `SECURITY DEFINER`
- `search_path = pg_catalog, public`
- Live definition MD5: `e4a458b6cacbddb05da83967d1a92c43`
- Grants: `authenticated` and `service_role` hold `EXECUTE`; `PUBLIC` and `anon` are denied.

### `public.ia_usage`

- `UNIQUE (usuario_id, fecha)`
- `FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE`

### `auth.users` trigger `on_auth_user_created`

- Calls `public.handle_new_user`.
- Function owner: `postgres`, `SECURITY DEFINER`.
- Live body MD5: `dabeef182d1b0c172f7747fc5c0b974d`.
- The live body writes to **`public.profiles`**, not `public.usuarios`.
- Consequence: enabling RLS on `public.usuarios` in migration 095 **does not** block the signup trigger, because the trigger never touches `usuarios`.
- `public.usuarios` itself has **no table triggers**.

## 3. Rollback fidelity

A rollback of migration 095 must restore the system to the exact pre-095 state captured above:

- Restore `relrowsecurity = false` (disable RLS) on `public.usuarios`.
- Restore the exact grant-all ACL for `anon`, `authenticated`, and `service_role` on `public.usuarios` (i.e. re-grant `ALL` table privileges to `anon` and `authenticated`, matching the captured `relacl`).
- Restore the exact pre-095 `registrar_uso_ia` function body (MD5 `e4a458b6cacbddb05da83967d1a92c43`) and its exact pre-095 ACL (`EXECUTE` to `authenticated` and `service_role`, denied to `PUBLIC`/`anon`).

No other object (policies, `ia_usage` constraints, `handle_new_user`, DANE/SIIO/AGT-003 objects) is touched by 095 or its rollback.

## 4. Forward-change rationale

- **`GRANT ALL ... TO service_role` on `usuarios` is a preservation, not an expansion.** `service_role` already held full `arwdDxtm` table privileges pre-095 (see captured `relacl` above). Migration 095 intentionally re-asserts that exact pre-095 ACL for `service_role` so that unenumerated, internal `service_role`-driven management paths (e.g. Supabase platform/service internals, admin tooling) that already relied on full table access continue to work unchanged. It does not grant `service_role` anything it did not already have live.
- **All direct `anon`/`authenticated` table privileges on `usuarios` are removed**, and RLS is enabled (not forced) — closing the live exposure where both roles held full `ALL` table privileges with RLS disabled.
- **`registrar_uso_ia` execution becomes `service_role`-only.** Pre-095, `authenticated` held `EXECUTE`; migration 095 revokes `EXECUTE`/`ALL` from `public`, `anon`, and `authenticated`, and grants `EXECUTE` only to `service_role`. Any client-facing invocation of this RPC must now go through a `service_role`-mediated path (e.g. an edge function), not a direct `authenticated` client call.

## 5. Static-guard remediation (this review)

`scripts/agt002-check-grants-static.mjs`'s `guardedUpsertPattern` previously accepted any `consultas_count < <anything>` clause ahead of `RETURNING`, which would also match a hardcoded, effectively-unbounded constant (e.g. `consultas_count < 999999999`) instead of the intended per-role `v_limite` guard. The pattern is tightened to require the literal guard `consultas_count < v_limite` (optionally alias-prefixed, e.g. `u.consultas_count < v_limite`). A regression mutation asserting that a hardcoded large constant is rejected has been added to `tests/agt002-f0e-grants-static.test.mjs`.
