# AGT-002 M1 — Contratos de confiabilidad del radar (`agt002-m1-radar-reliability-contract`)

**Fase:** RED (TDD). Este corte crea **únicamente** este plan y la suite de tests que falla
por diseño (el módulo evaluado todavía no existe). No hay implementación, no hay schemas, no
hay catálogo de razones como artefacto independiente, no hay fixtures en disco. Todo eso es
alcance de la FASE GREEN, descrita al final como referencia para el siguiente corte, pero no se
toca en este.

**Retomado tras:** habilitación temporal de ACL local para UID 10001, restringida a los dos
directorios padre autorizados de este corte (el padre de `docs/superpowers/plans/` y el padre de
`tests/`). Ninguna otra ruta del repo se lee ni se escribe en esta fase.

## 0. Qué NO es este corte

- No hay `agt002-m1-radar-reliability-contract.js` ni ningún otro archivo de implementación.
- No hay `contracts/agt002-radar-reliability/v1/**` en disco (ni schemas, ni manifest, ni
  fixtures). Las rutas de esa carpeta que aparecen abajo son **especificación para la FASE
  GREEN**, no artefactos creados ahora.
- No hay integración con runtime, SQL, scheduler, worker, UI ni ningún servicio existente
  (`server/index.js`, `api/`, `src/`, `supabase/migrations/`, ningún `agt002-radar-*` productivo).
  El evaluador objetivo es y será una **función pura** sobre un objeto en memoria: nunca abre un
  archivo, nunca hace una consulta, nunca resuelve un locator a bytes reales. A diferencia de
  `agt002-phase01-executable-controls.js` (que sí resuelve evidencia durable vía
  `context.resolve_durable_evidence`), este evaluador trata cada `locator` como una cadena
  opaca que sólo se valida por forma (prefijo de esquema), nunca se lee.
- No se modifica `package.json` ni ninguna dependencia.
- No hay commit, push ni PR.

## 1. Objetivo del contrato

`agt002-m1-radar-reliability-contract.js` (FASE GREEN) exportará un evaluador puro que decide si
un "bundle de confiabilidad" de una corrida del radar (una fila u objeto que resume una corrida
de escaneo + persistencia + proyección UI) puede **promoverse** — es decir, marcarse como
confiable para consumo — o no. El contrato cubre exactamente los mismos tres veredictos que
`agt002-phase01-executable-controls.js` (`AGT002_PHASE01_VERDICTS`), por consistencia con el
resto del repo:

```
VALID       — el bundle demuestra, con evidencia propia, que es confiable y promovible.
INVALID     — el bundle prueba positivamente una violación (dato conocido, no ausencia de dato).
UNVERIFIED  — no hay evidencia suficiente para afirmar ni negar confiabilidad (fail-closed).
```

`INVALID` y `UNVERIFIED` bloquean la promoción por igual: la distinción existe para que quien
consuma el veredicto sepa si hay algo que corregir (`INVALID`) o algo que todavía falta observar
(`UNVERIFIED`), pero ningún llamador puede promover en ninguno de los dos casos.

## 2. Forma del bundle de entrada (especificación, FASE GREEN)

Forma cerrada (`additionalProperties: false` en cada nivel, igual que
`agt002-phase01-executable-controls.js` y `agt002-radar-preanalysis-contract.js`):

```
{
  schema_version: 'agt002-m1-radar-reliability-bundle/1.0.0',
  run_id: string,                          // p. ej. 'synthetic-run-0001' en fixtures
  scan: {
    status: 'completed' | 'failed' | 'running' | 'pending',
    started_at_utc: string,                // RFC 3339 UTC estricto
    completed_at_utc: string,
    pagination: {
      pages_fetched: number,
      total_pages_declared: number,
      exhaustive: boolean,                 // true sólo si se recorrieron todas las páginas
      claims_absence: boolean,             // true si el bundle afirma "no hay más ítems"
    },
    source_snapshot_hash: string,          // sha256 hex de lo observado en la fuente
    item_count: number,
  },
  persistence: {
    persisted_count: number,
    persisted_snapshot_hash: string,       // sha256 hex de lo efectivamente persistido
    persisted_at_utc: string,
  },
  ui_projection: {
    rendered_count: number,
    rendered_snapshot_hash: string,        // sha256 hex de lo efectivamente proyectado a UI
    rendered_at_utc: string,
  },
  evidence: [
    {
      evidence_id: string,
      kind: string,
      locator: string,                     // esquema 'fixture://...' en tests; nunca resuelto
      captured_at_utc: string,
      content_sha256: string,
    },
    ...
  ],
  freshness: {
    now_utc: string,
    data_as_of_utc: string,
    max_staleness_calendar_days: number,
  },
}
```

Sólo `status` en `{'completed','failed'}` es **terminal**. `'running'` y `'pending'` son
no-terminales: un bundle no-terminal nunca es evaluable como confiable (ni `VALID` ni `INVALID`
sobre su contenido — es `UNVERIFIED`, porque la corrida todavía puede cambiar).

## 3. Términos de evaluación (especificación, FASE GREEN)

Igual que `validateAgt002Phase01Gate`, el evaluador combina **términos** independientes y agrega
el veredicto final con la misma regla que `aggregateAgt002Phase01Verdict`: cualquier término
`INVALID` domina; si no hay `INVALID` pero hay algún `UNVERIFIED`, el resultado es `UNVERIFIED`;
sólo si todos los términos son `VALID` el resultado es `VALID`.

1. **`schema`** — forma cerrada exacta en cada nivel (bundle, `scan`, `pagination`,
   `persistence`, `ui_projection`, cada elemento de `evidence`, `freshness`). Bundle ausente/nulo
   → `UNVERIFIED` (`bundle.absent`). Clave extra en cualquier nivel → `INVALID`
   (`schema.additional_property`). Clave requerida faltante → `INVALID`
   (`schema.missing_required`). Tipo o enum incorrecto → `INVALID` (`schema.type_mismatch` /
   `schema.enum_mismatch`).
2. **`terminal_state`** — `scan.status` fuera de `{'completed','failed'}` → `UNVERIFIED`
   (`scan.status.not_terminal`).
3. **`temporal_integrity`** — cada campo `*_at_utc` del bundle (incluyendo
   `freshness.now_utc` y `freshness.data_as_of_utc`) se parsea como RFC 3339 UTC con
   validación de calendario real (rechaza 30 de febrero, hora 24:00, etc. — mismo criterio que
   `parseAgt002Phase01Rfc3339Utc`). Cualquier timestamp imposible → `INVALID`
   (`temporal.timestamp_invalid`).
4. **`coverage`** — cobertura exhaustiva de paginación:
   - `pagination.exhaustive === true` → cobertura `VALID` (haya o no `claims_absence`): una
     corrida exhaustiva puede afirmar ausencia legítimamente.
   - `pagination.exhaustive === false` y `claims_absence === true` → `INVALID`
     (`coverage.first_page_claims_absence`): **la primera página (o cualquier página parcial)
     nunca prueba ausencia.**
   - `pagination.exhaustive === false` y `claims_absence === false` → `UNVERIFIED`
     (`coverage.partial`): cobertura incompleta y honesta sobre su propio límite, pero
     insuficiente para promover.
   - `pages_fetched` fuera de `[1, total_pages_declared]` → `INVALID`
     (`coverage.inconsistent_pagination`).
5. **`freshness`** — sólo se evalúa si `temporal_integrity` es `VALID` (sin timestamps válidos
   no hay frescura que medir). Se compara la **fecha de calendario UTC** (año-mes-día, no la
   duración en milisegundos) de `now_utc` contra `data_as_of_utc`; si la diferencia en días de
   calendario excede `max_staleness_calendar_days` → `INVALID` (`freshness.stale`). Dos
   instantes en el mismo día calendario UTC cuentan como 0 días de diferencia aunque disten casi
   24 horas; dos instantes en días calendario consecutivos cuentan como 1 día aunque disten
   segundos (p. ej. 23:59:59 y 00:00:01 del día siguiente).
6. **`evidence`** — `evidence` vacío → `UNVERIFIED` (`evidence.absent`): la ausencia de
   evidencia nunca se trata como prueba de que todo está bien (fail-closed). Con evidencia
   presente: `evidence_id` duplicado → `INVALID` (`evidence.duplicate_id`); `locator` que no
   empieza por uno de los esquemas permitidos (`fixture://`, `repo://`, `evidence://`) →
   `INVALID` (`evidence.locator_scheme_invalid`).
7. **`traceability`** — encadenamiento fuente → persistencia → UI:
   - `scan.source_snapshot_hash !== persistence.persisted_snapshot_hash` → `INVALID`
     (`traceability.source_persistence_mismatch`).
   - `persistence.persisted_snapshot_hash !== ui_projection.rendered_snapshot_hash` → `INVALID`
     (`traceability.persistence_ui_mismatch`).
   - Los dos mismatches son independientes: un bundle puede tener uno sin el otro.

## 4. Catálogo cerrado de razones (especificación, FASE GREEN)

`AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG` (constante congelada exportada por el módulo,
igual que `AGT002_PHASE01_REASON_CATALOG` en `agt002-phase01-executable-controls.js` — sin
archivo JSON separado):

```
schema.missing_required
schema.additional_property
schema.type_mismatch
schema.enum_mismatch
bundle.absent
scan.status.not_terminal
temporal.timestamp_invalid
coverage.first_page_claims_absence
coverage.partial
coverage.inconsistent_pagination
freshness.stale
evidence.absent
evidence.duplicate_id
evidence.locator_scheme_invalid
traceability.source_persistence_mismatch
traceability.persistence_ui_mismatch
```

**Invariante de cierre:** ninguna razón emitida por `validateAgt002M1RadarReliabilityBundle`
(ni por ningún término interno) puede estar fuera de este catálogo, para ningún bundle de
entrada. Esto se verifica en la suite de tests como una aserción transversal sobre todos los
casos, no como un caso aislado (ver §6.14).

## 5. Promoción atómica (especificación, FASE GREEN)

`resolveAgt002M1RadarReliabilityPromotion(bundle, context)` — todo o nada:

- Ejecuta `validateAgt002M1RadarReliabilityBundle` una sola vez.
- Si el veredicto es `VALID` → `{ promoted: true, verdict: 'VALID', reasons: [] }`.
- Si el veredicto es `INVALID` o `UNVERIFIED` → `{ promoted: false, verdict, reasons }`, **sin
  ninguna forma de promoción parcial**: no existe un concepto de "promover los términos que sí
  pasaron". El resultado no expone ni `promoted_terms` ni ningún campo que sugiera que una parte
  del bundle quedó promovida mientras otra no. La forma de retorno es cerrada:
  `{ promoted, verdict, reasons }`, nada más.
- No muta el `bundle` recibido (debe poder invocarse sobre un objeto congelado con
  `Object.freeze`).

## 6. Plan de tests (`tests/agt002-m1-radar-reliability-contract.test.mjs`, ya creado en este corte)

Estilo: aserciones planas a nivel de módulo (mismo estilo que
`tests/agt002-radar-preanalysis-contract.test.mjs`), datos 100% sintéticos en memoria —
identificadores con prefijo `synthetic-` y locators de evidencia con esquema `fixture://`. Cero
lectura de disco, cero red, cero SQL.

1. **Happy path promovible** — bundle válido completo (terminal, exhaustivo, fresco, con
   evidencia, cadena de hashes coherente) → `verdict === 'VALID'`, `promotable === true`,
   `reasons` vacío; `resolveAgt002M1RadarReliabilityPromotion` → `promoted === true`.
2. **No-terminal** — `scan.status: 'running'` → `verdict === 'UNVERIFIED'`, incluye
   `scan.status.not_terminal`.
3. **Partial** — `pagination.exhaustive: false, claims_absence: false` → `verdict ===
   'UNVERIFIED'`, incluye `coverage.partial`.
4. **Stale** — `data_as_of_utc` tres días de calendario UTC antes de `now_utc` con
   `max_staleness_calendar_days: 1` → `verdict === 'INVALID'`, incluye `freshness.stale`.
5. **Evidencia vacía** — `evidence: []` → `verdict === 'UNVERIFIED'`, incluye
   `evidence.absent`.
6. **Promoción inválida sobre partial/stale/sin evidencia** — para cada uno de los tres bundles
   de 3/4/5, `resolveAgt002M1RadarReliabilityPromotion` → `promoted === false` y `reasons`
   coincide con las del veredicto de `validate`.
7. **Bundle mixto / no atómico** — bundle por lo demás válido (terminal, exhaustivo, fresco, con
   evidencia) pero con `traceability` rota (mismatch fuente→persistencia) → `verdict ===
   'INVALID'` con **únicamente** razones de `traceability.*` (los demás términos deben seguir
   siendo `VALID`, confirmando que el fallo es puntual); `resolveAgt002M1RadarReliabilityPromotion`
   → `promoted === false` y la forma del resultado es exactamente `{ promoted, verdict,
   reasons }` (sin ningún campo de promoción parcial).
8. **Mismatch fuente→persistencia** — `persistence.persisted_snapshot_hash` distinto de
   `scan.source_snapshot_hash`, pero `ui_projection.rendered_snapshot_hash` igual al de
   persistencia → sólo `traceability.source_persistence_mismatch` (no
   `traceability.persistence_ui_mismatch`).
9. **Mismatch persistencia→UI** — `ui_projection.rendered_snapshot_hash` distinto de
   `persistence.persisted_snapshot_hash`, con `persistence.persisted_snapshot_hash` igual a
   `scan.source_snapshot_hash` → sólo `traceability.persistence_ui_mismatch`.
10. **Primera página reclama ausencia** — `pagination.exhaustive: false, claims_absence: true,
    pages_fetched: 1, total_pages_declared: 5` → `verdict === 'INVALID'`, incluye
    `coverage.first_page_claims_absence`.
11. **Ausencia exhaustiva válida** — `pagination.exhaustive: true, claims_absence: true,
    pages_fetched: total_pages_declared`, conteos e hashes coherentes en cero ítems → `verdict
    === 'VALID'` (contraste directo con el caso 10: sólo la exhaustividad, no la sola
    afirmación, habilita la ausencia).
12. **Timestamp imposible** — `scan.completed_at_utc: '2026-02-30T10:00:00Z'` (30 de febrero no
    existe) → `verdict === 'INVALID'`, incluye `temporal.timestamp_invalid`.
13. **Campo extra** — clave adicional no declarada en el nivel superior del bundle (y,
    aparte, en un elemento de `evidence`) → `verdict === 'INVALID'`, incluye
    `schema.additional_property` en ambos casos.
14. **Razón emitida fuera del catálogo** — aserción transversal: se acumulan todas las
    `reasons` devueltas por los 13 casos anteriores y se verifica que cada código está incluido
    en `AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG` (`catalog.includes(reason)` para cada
    `reason` observado). Esto convierte el catálogo en una superficie cerrada verificable por
    construcción, no por inspección manual.

## 7. Criterios de verificación de esta FASE RED

- `node --test tests/agt002-m1-radar-reliability-contract.test.mjs` falla con
  `ERR_MODULE_NOT_FOUND` (o equivalente) al intentar importar
  `../agt002-m1-radar-reliability-contract.js`, porque ese archivo no existe todavía. Este
  fallo **es el resultado esperado y correcto** de la FASE RED.
- No existe `agt002-m1-radar-reliability-contract.js` en la raíz del repo.
- No existe `contracts/agt002-radar-reliability/` en disco.
- `package.json`, `server/index.js`, `src/`, `api/`, `supabase/migrations/` y cualquier
  servicio/scheduler/worker existente permanecen sin modificar.
- Los únicos dos archivos tocados por este corte son este plan y el archivo de test indicado en
  §6.

## 8. FASE GREEN (fuera de alcance de este corte — sólo referencia para el siguiente)

1. Crear `agt002-m1-radar-reliability-contract.js` implementando exactamente §2–§5 hasta que la
   suite de §6 pase sin modificar los tests.
2. Crear `contracts/agt002-radar-reliability/v1/` con `manifest.json` y los JSON Schema
   equivalentes a la forma de §2, más `fixtures/valid-*.json` / `fixtures/invalid-*.json` /
   `fixtures/unverified-*.json` (convención `agt002-phase01`) para congelar casos de regresión
   fuera del test en memoria.
3. Sólo después de GREEN, y como corte aparte, evaluar integración real (fuente de datos del
   radar, persistencia, UI) — explícitamente fuera de alcance de FASE RED y de FASE GREEN tal
   como se describen aquí.
