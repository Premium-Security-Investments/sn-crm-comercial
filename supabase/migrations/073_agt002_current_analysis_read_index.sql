-- Índice del camino de lectura del análisis vigente (getCurrentTenderAnalysis).
--
-- Estrictamente aditiva e idempotente: NO crea, altera ni elimina tablas, columnas,
-- triggers, políticas, permisos ni funciones, y no toca ninguna fila. Sólo añade un
-- índice a public.psi_tender_analysis_runs con `create index if not exists`, de modo
-- que aplicarla dos veces es igual que aplicarla una.
--
-- Hecho observado: `getCurrentTenderAnalysis` resuelve el run vigente con la pareja de
-- igualdades (opportunity_id, snapshot_id) más `order by created_at desc, id desc limit 1`.
-- Ningún índice existente tiene esa pareja en su clave:
--
--   * 025 psi_tender_analysis_runs_opportunity_created_idx (opportunity_id, created_at desc, id desc)
--   * 025 psi_tender_analysis_runs_snapshot_created_idx    (snapshot_id, created_at desc, id desc)
--   * 050 psi_tender_analysis_runs_canonical_current_idx   (opportunity_id, created_at desc, id desc)
--                                                          where canonical and status = 'completed'
--   * 063 psi_tender_analysis_runs_one_canonical_current_idx (opportunity_id)
--                                                          where canonical and status = 'completed'
--
-- Con cualquiera de ellos el planificador sólo puede usar UNA de las dos igualdades como
-- rango del índice y debe recheck-ear la otra fila por fila contra el heap. Cada recheck es
-- una lectura aleatoria de página: con caché caliente cuesta ~0,1 s (lo observado en una
-- corrida tibia) y con caché fría, o con varias lecturas concurrentes de la misma
-- oportunidad, el mismo statement agota `statement_timeout` y Supabase lo cancela con
-- `canceling statement due to statement timeout`. El costo crece linealmente con la
-- cantidad de runs acumulados por oportunidad (re-análisis 068, respuestas humanas 038),
-- así que el defecto empeora con el uso.
--
-- Este índice hace que la lectura sea un rango exacto sobre (opportunity_id, snapshot_id)
-- con el ORDER BY ya satisfecho por la propia clave: LIMIT 1 toca una entrada de índice y
-- una fila del heap, con costo independiente de cuántos runs tenga la oportunidad.
--
-- No se sube `statement_timeout` y no se relaja ningún gate: la consulta devuelve
-- exactamente las mismas filas que antes, sólo que por un camino acotado.
--
-- La rama canónica de la misma lectura ya queda cubierta por 050/063 desde que la capa JS
-- declara también `status = 'completed'` (restricción que 050's
-- psi_tender_analysis_runs_canonical_agt002_check ya garantizaba, pero que el planificador
-- no podía deducir); por eso aquí no se añade ningún índice parcial adicional.
begin;

create index if not exists psi_tender_analysis_runs_opportunity_snapshot_current_idx
  on public.psi_tender_analysis_runs (opportunity_id, snapshot_id, created_at desc, id desc);

commit;
