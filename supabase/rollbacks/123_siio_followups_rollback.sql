-- Rollback of 123_siio_followups.sql. Drops the follow-up register (data is lost; export first).
drop table if exists public.siio_followups;
