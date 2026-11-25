-- AGT-003 — Cotización mixta: dos oportunidades, y plazo de instalación por cotización (Juan, 2026-11-25).
--
-- Juan: "se deben hacer dos oportunidades diferentes o que el sistema las divida para poder tener seguimiento de
-- seguridad física y de proyectos independiente". La cotización y su propuesta siguen siendo una; al pasar los
-- valores, la vigilancia va a la oportunidad de seguridad física y la tecnología a una de tipo «proyecto» del mismo
-- cliente (la que ya exista o una que el sistema crea). `paired_opportunity_id` guarda la segunda, para que la próxima
-- vez se actualice la misma y para que la ficha de esa oportunidad vea la cotización.
--
-- Juan, mismo día: el plazo de entrega e instalación de tecnología "depende del proyecto". `tech_delivery_terms` lo
-- escribe el comercial en cada cotización; vacío, la propuesta dice que se acuerda con el cronograma del proyecto.
--
-- El código tolera que esta migración no haya corrido (lee sin las columnas nuevas y no divide).
begin;

alter table public.psi_quotes
  add column if not exists paired_opportunity_id uuid references public.psi_sales_opportunities(id) on delete set null,
  add column if not exists tech_delivery_terms text check (tech_delivery_terms is null or length(tech_delivery_terms) <= 300);

create index if not exists psi_quotes_paired_opportunity_idx on public.psi_quotes (paired_opportunity_id);

commit;
