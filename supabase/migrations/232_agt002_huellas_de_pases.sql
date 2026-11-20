-- Los pases de OCR de licitaciones (cada 2 minutos) descargaban el texto completo de todos los documentos de todas las
-- licitaciones activas sólo para concluir «no hay nada que hacer». Medido el 2026-11-20 en pg_stat_statements: las dos
-- lecturas de texto más pesadas del CRM (unos 105 minutos de base acumulados) y 12 de 12 pases en «idle» en media hora.
-- Aquí se guarda la huella barata (conteos y última fecha) del último pase que no encontró candidatos: si no cambió, el
-- pase siguiente se salta, y una vez por hora corre completo igual. Sólo el servidor lee y escribe.

create table if not exists public.psi_agt002_pase_huellas (
  pase text primary key check (char_length(pase) between 1 and 60),
  huella text not null,
  completo_en timestamptz not null default now()
);

alter table public.psi_agt002_pase_huellas enable row level security;
revoke all on table public.psi_agt002_pase_huellas from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.psi_agt002_pase_huellas to service_role;
