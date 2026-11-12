# Instrucciones para agentes en este repositorio

## Tests y memoria

El servidor donde trabajan los agentes tiene la RAM compartida con otros agentes y servicios en producción. Cada test
con PGlite (`tests/*-pglite.test.mjs`) levanta una base en memoria y usa más de 1 GB.

1. Nunca corras la suite completa (`pnpm test`, `pnpm run test:resto`) salvo que te lo pidan explícitamente. La corre
   CI en el PR (`resto_suite`, `agt002_suite`, `f0_suite`).
2. Corre por lotes de máximo 2 archivos de test, y espera a que termine cada lote. `node --test a b c …` corre los
   archivos en paralelo: pasa como máximo 2, o usa `--test-concurrency=1`.
3. Antes de cada lote, revisa `free -h`. Si hay menos de 2 GB disponibles, espera.
4. Si un test muere por memoria (exit 137 u OOM), córrelo solo, no en paralelo.
5. Para validar un cambio, corre primero los tests que lo tocan (por ejemplo, `tests/estudios-seguridad-*` para
   `verticales/estudios-seguridad/`).
