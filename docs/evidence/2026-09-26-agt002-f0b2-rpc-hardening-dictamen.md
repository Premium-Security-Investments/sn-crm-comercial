# AGT-002 F0-B2 — RPC hardening dictamen (094, unapplied)

**Date:** 2026-09-26  
**origin/main base:** `60a0795e61385028a5a9cd27fca845643aca4651`  
**Live catalog SHA-256:** `8e816427015342ebac35f89326bf3be9dea9cdaa6e92eb7d5048a278fc6cdfa1`  
**Applied:** false

Incident language: sin evidencia de explotación y sin capacidad suficiente para descartarla retrospectivamente.

## Thirteen live exposures after 092

| Routine | Dictamen | 094 action |
|---|---|---|
| `psi_admin_acquire_profile_lock(uuid)` | P0 backend-only | REVOKE anon; KEEP service_role |
| `psi_admin_release_profile_lock(uuid,uuid)` | P0 backend-only | REVOKE anon; KEEP service_role |
| `psi_admin_bind_profile_auth(uuid,text,uuid)` | P0 backend-only | REVOKE anon; KEEP service_role |
| `psi_admin_persist_profile_access(...)` | P0 backend-only | REVOKE anon; KEEP service_role |
| `psi_assert_tender_dossier_go(uuid)` | P0 internal DEFINER | REVOKE public/anon/authenticated |
| `psi_assert_tender_dossier_actor(uuid,boolean)` | internal DEFINER | REVOKE public/anon/authenticated |
| `psi_profile_has_tender_permission(uuid,boolean)` | backend SQL | REVOKE anon; KEEP service_role |
| `psi_record_tender_analysis_run(...)` | backend | REVOKE anon; KEEP service_role |
| `psi_sales_current_profile_id()` | RLS session | REVOKE public/anon; KEEP authenticated |
| `psi_sales_current_profile_role()` | RLS session | REVOKE public/anon; KEEP authenticated |
| `handle_new_user()` | trigger, no repo refs | SET search_path; REVOKE public/anon/authenticated |
| `get_my_profile()` | KEEP_WITH_SESSION_AUTH | SET search_path; REVOKE public/anon; KEEP authenticated |
| `registrar_uso_ia(...)` | unused in repo | SET search_path; REVOKE public/anon; KEEP authenticated |

Zero of the 13 remain without dictamen. 094 does not replace function bodies and does not touch 092/093.
