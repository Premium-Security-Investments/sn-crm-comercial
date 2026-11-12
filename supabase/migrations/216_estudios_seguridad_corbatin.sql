-- Estudios de Seguridad Física: corbatín y datos de cada control, y dueño del riesgo (NTC-IEC/ISO 31010:2020, B.4.2 y
-- B.10.2; Juan, 2026-11-12). Cada riesgo guarda:
--   control_details   por cada renglón de "Control existente" o "Control propuesto": cuándo actúa (antes o después del
--                     evento), frente a qué causa, si se verificó en el recorrido, de qué depende, qué lo puede hacer
--                     fallar y qué lo sostiene. Lo valida el servidor (verticales/estudios-seguridad/corbatin.js).
--   risk_owner        el cargo del cliente que responde por el riesgo. Opcional: si no se sabe, no frena nada.
begin;

alter table public.psi_security_study_risks
  add column if not exists control_details jsonb not null default '[]'::jsonb
    check (jsonb_typeof(control_details) = 'array' and jsonb_array_length(control_details) <= 40),
  add column if not exists risk_owner text check (risk_owner is null or length(risk_owner) <= 200);

commit;
