-- Rollback de 131: borra las recomendaciones de IA de la Torre (no toca siio_followups).
drop table if exists public.siio_ai_recommendations;
drop table if exists public.siio_ai_recommendation_runs;
