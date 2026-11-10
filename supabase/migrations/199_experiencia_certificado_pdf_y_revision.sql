-- 199 — Mejora 9, segunda parte (Juan, 2026-11-10): el PDF del certificado en cada experiencia y la revisión de Vig-IA.
--
-- Se sube el PDF en la fila del contrato. Si trae texto, Vig-IA lo revisa al subirlo; si es escaneado (los dos que hay lo
-- son), el trabajo del servidor que ya hace OCR cada 2 minutos (agt002-auto-initial) lo lee y guarda el texto, y la
-- revisión corre después. Vig-IA sólo SUGIERE completo o incompleto: el estado lo pone una persona.
begin;

alter table public.psi_company_experience
  add column if not exists certificate_storage_path text check (certificate_storage_path is null or char_length(certificate_storage_path) <= 500),
  add column if not exists certificate_file_name text check (certificate_file_name is null or char_length(certificate_file_name) <= 300),
  add column if not exists certificate_uploaded_at timestamptz,
  -- El texto leído del PDF (pdf) o del escaneo (ocr); «sin_texto» si el OCR tampoco sacó nada. Nulo: falta leerlo.
  add column if not exists certificate_text text check (certificate_text is null or char_length(certificate_text) <= 200000),
  add column if not exists certificate_text_source text check (certificate_text_source is null or certificate_text_source in ('pdf', 'ocr', 'sin_texto')),
  add column if not exists certificate_review jsonb,
  add column if not exists certificate_reviewed_at timestamptz;

-- Lo que el OCR del servidor tiene pendiente: certificados subidos que todavía no tienen texto.
create index if not exists psi_company_experience_certificate_pending_text
  on public.psi_company_experience (certificate_uploaded_at)
  where certificate_storage_path is not null and certificate_text_source is null;

commit;
