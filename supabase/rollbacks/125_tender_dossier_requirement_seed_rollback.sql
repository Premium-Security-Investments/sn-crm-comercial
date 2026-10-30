-- Rollback de 125: retira la función. Los ítems ya sembrados quedan (tablas append-only).
drop function if exists public.psi_seed_tender_dossier_requirements(uuid, uuid, jsonb);
