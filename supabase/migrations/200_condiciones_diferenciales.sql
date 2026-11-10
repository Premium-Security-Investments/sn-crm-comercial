-- 200 — Mejora 10 (Juan, 2026-11-10): las condiciones diferenciales de la empresa en la ficha.
--
-- En Terminal se supo a un día del cierre que «empresa de mujeres» bajaba la garantía del 12 % al 10 %. Tres condiciones,
-- cada una con su estado, su detalle, su soporte y la fecha de la certificación, para que Vig-IA avise en cada pliego:
--   * empresa_mujeres: art. 2.2.1.2.4.2.14 del Decreto 1082 de 2015 (Decreto 1860 de 2021): al menos 50 % de los cargos
--     directivos ejercidos por mujeres con un año o más de vinculación.
--   * tamano_empresarial: Gran Empresa (no aplican beneficios Mipyme).
--   * discapacidad_nomina: personas con discapacidad en la nómina (factor de desempate, art. 35 de la Ley 2069 de 2020).
-- Los datos los ponen Juan o Katherine; Vig-IA sólo lee y avisa.
begin;

create table if not exists public.psi_company_differential_conditions (
  code text primary key check (code in ('empresa_mujeres', 'tamano_empresarial', 'discapacidad_nomina')),
  status text not null default 'por_confirmar' check (status in ('cumple', 'no_cumple', 'por_confirmar')),
  value text check (value is null or char_length(value) <= 100),
  detail text check (detail is null or char_length(detail) <= 1000),
  evidence text check (evidence is null or char_length(evidence) <= 500),
  certified_on date,
  updated_by uuid references public.psi_sales_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.psi_company_differential_conditions enable row level security;
revoke all on table public.psi_company_differential_conditions from public, anon, authenticated, service_role;
grant select, insert, update on table public.psi_company_differential_conditions to service_role;

-- Lo que consta al 2026-11-10 (handoffs de Terminal del 3-nov): no pisa lo que una persona ya haya escrito.
insert into public.psi_company_differential_conditions (code, status, value, detail, evidence, certified_on) values
  ('empresa_mujeres', 'cumple', null,
   '9 de 16 cargos directivos (56,25 %) ejercidos por mujeres, las nueve con un año o más de vinculación (recalculado al 4-nov-2026).',
   'CERTIFICACION_EMPRENDIMIENTO_DE_MUJERES.pdf (hecha para SA-MC-02-2026 de la Rama Judicial). Para cada pliego se firma una nueva con la fecha de cierre.',
   '2026-06-22'),
  ('tamano_empresarial', 'cumple', 'gran_empresa',
   'Gran Empresa: activo total $23.026.819.474 al 31-dic-2025. No aplican los beneficios ni el desempate para Mipymes.',
   'Ficha de la empresa (perfil de contratación verificado).', null),
  ('discapacidad_nomina', 'por_confirmar', null,
   'En la oferta adjudicada de la Rama Judicial Pereira 2026 se presentó un certificado de personas con discapacidad vinculadas. Falta confirmar cuántas hay hoy y qué porcentaje de la nómina son.',
   'CERTIFICADO PERSONAS DISCAPACITADAS VINCULADAS.pdf (04_Casos_Historicos_Adjudicados/Rama Judicial Pereira - 2026).', null)
on conflict (code) do nothing;

commit;
