# AGT-002 integral v3 — expediente Rama Judicial (`54190e51-15fb-46af-b0aa-8f13461a3110`): gobernanza gobernada, no inferida

**Fecha:** 2026-08-07
**Rama:** `feat/agt002-v3-foundations`
**Alcance:** preparar el expediente gobernado (`categoryOverrides` + `evidenceClassLinkByRequirementId`, migración `064`) para la oportunidad Rama Judicial `54190e51-15fb-46af-b0aa-8f13461a3110` antes de cualquier caso real con el flag `AGT002_INTEGRAL_CONTRACT_V3`.

## 1. Qué se intentó

Con el wiring real de servidor ya cerrado (`loadAgt002IntegralV3GovernanceIfEnabled` en `server/index.js`/`api/[...path].js`, ver `tests/agt002-integral-v3-server-wiring.test.mjs`), el siguiente paso del gate (`CURRENT.md` §2.1, "Gate siguiente" #1) es curar filas reales en `psi_agt002_integral_governance_overrides` (migración `064`) para la oportunidad Rama Judicial, de modo que:

- todo `requirement_id` cuyo `front` sea `legal` reciba un `category_override` honesto en vez de fallar cerrado en `agt002-integral-category-manifest.js`;
- todo `requirement_id` que deba dejar de abstenerse en sus cinco ejes reciba un `evidence_class_link` hacia una de las 17 clases reales de `psi_agt002_company_evidence_registry`.

## 2. Por qué no se curó ninguna fila

Ninguna fila fue insertada. La razón es estructural, no una omisión:

1. **No hay conexión a una base de datos real en este worktree.** `.env.local` sólo define `VERCEL_OIDC_TOKEN`; no existen `NEXT_PUBLIC_SUPABASE_URL` ni `SUPABASE_SERVICE_ROLE_KEY` apuntando a ningún proyecto Supabase, ni local ni productivo. `server/index.js` exige ambas variables al arrancar (`process.exit(1)` si faltan) — no hay manera de ejecutar una consulta real, ni siquiera de sólo lectura, desde esta sesión.
2. **El conjunto real de `requirement_id` no existe localmente.** `requirement_id` se genera por extracción de pliego (`agt002-deep-analysis-matrix.js`) contra los documentos reales de la oportunidad — no es un identificador estable ni predecible fuera de ese proceso. La única aparición de `54190e51-15fb-46af-b0aa-8f13461a3110` en el repositorio es como UUID fijo en un fixture de prueba (`tests/agt002-fixed-snapshot-reanalysis.test.mjs`) y como referencia de comentario en la migración `061` ("productive case") — ninguna de las dos fuentes contiene el pliego real ni una lista de requisitos reales.
3. **No hay texto de pliego, cláusula ni corpus jurídico real accesible en esta sesión** contra el cual redactar un `rationale`/`source_reference` trazable y honesto para ninguna fila.

Cualquier fila insertada en estas condiciones sería, por construcción, una adivinanza: exactamente la fabricación por keyword/presencia/intuición que esta tarea prohíbe explícitamente y que `agt002-integral-governance-overrides.js` está diseñado para rechazar (`rationale`/`source_reference`/`curated_by` son obligatorios y no pueden ser texto vacío o inventado). Se optó, como exige la instrucción, por dejar el expediente **vacío y documentado**, no por simularlo.

## 3. Estado exacto del expediente al corte

```text
opportunity_id = 54190e51-15fb-46af-b0aa-8f13461a3110
psi_agt002_integral_governance_overrides (migración 064): 0 filas curadas (para esta oportunidad y para cualquier otra — la migración no siembra datos)
category_override curados:        0
evidence_class_link curados:      0
```

Consecuencia directa, ya probada mecánicamente por el validador (no una suposición):

- Cualquier `requirement_id` con `front: 'legal'` en el manifiesto real de esta oportunidad hará que `agt002-integral-category-manifest.js` **falle cerrado** (lanza, no adivina) al construir el envelope v3, hasta que exista una fila `category_override` real.
- Todo `requirement_id` de tipo `tender_requirement` de esta oportunidad **abstendrá sus cinco ejes** al estado seguro `{presence:"unknown", review:"not_reviewed", validity:"unknown", applicability:"unknown", compliance:"unknown"}` (`agt002-evidence-state-manifest.js`), porque no existe ningún `evidence_class_link` curado que los saque de ahí.

Esto es exactamente el comportamiento fail-closed diseñado, no un defecto pendiente de "rellenar rápido".

## 4. Qué se necesitaría para cerrar este gate honestamente

1. Acceso real (fuera de esta sesión) a las credenciales Supabase del ambiente objetivo, sólo para lectura del pliego/`requirement_manifest` ya extraído de un run existente de la oportunidad (o del pliego original), nunca para escritura productiva.
2. Un humano con el pliego real a la vista que revise, para cada `requirement_id` con `front: legal` (o cualquier reclasificación real), a qué categoría (`discard|habilitating|technical|financial_execution`) corresponde honestamente, citando la cláusula exacta como `source_reference`.
3. El mismo humano, para cada requisito habilitante que deba salir de la abstención, enlazándolo a una de las 17 clases reales (`agt002-company-evidence-classes.js`) con un `source_reference` trazable a la evidencia empresarial real, no a una inferencia por nombre de documento.
4. Insertar esas filas vía migración/curación revisada (nunca RPC en runtime — `psi_agt002_integral_governance_overrides` no otorga `INSERT`/`UPDATE`/`DELETE` a ningún rol, ver migración `064`), tal como se hizo con el corpus de 17 clases en la migración `061`.

Hasta que 1–4 ocurran fuera de esta sesión, el expediente Rama Judicial permanece, correctamente, sin curar. `docs/runbooks/agt002-integral-v3-canary.md` §"Preconditions" refleja este mismo estado.

## 5. Alcance de esta sesión

- No se realizó ninguna escritura de producción, migración remota, llamada a modelo real, canary, push, PR, merge ni deploy.
- No se imprimió ni registró ningún secreto (se verificaron únicamente los nombres de las variables de entorno presentes, nunca sus valores).
- El único cambio persistido para este expediente es este documento; `psi_agt002_integral_governance_overrides` permanece sin filas locales o remotas para esta oportunidad.

## 6. Actualización 2026-08-07 (sesión posterior): credenciales reales localizadas fuera de este worktree

Una sesión posterior, por instrucción explícita del operador, usó credenciales Supabase de **solo lectura** reales presentes en `/root/psi-comercial/plataforma-ventas/app/.env.local` (otro worktree del mismo repositorio; nunca impresas ni registradas) para ejecutar únicamente `select`/`eq`/`order` contra la base real. Esto resuelve los gates 1-3 descritos arriba (acceso a BD, `requirement_id` reales, texto de pliego trazable) para el pliego definitivo y dos anexos con chunks vigentes. El resultado — extracción determinística real, manifiesto de procedencia, propuestas y abstenciones de `category_override`/`evidence_class_link`, y una desviación real y verificada por ID entre el snapshot canónico y `psi_tender_document_chunks` — está documentado en `docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md` y `docs/governance/drafts/agt002-rama-judicial-54190e51-15fb-46af-b0aa-8f13461a3110.v1.json`, ambos marcados `DRAFT` / `HUMAN_APPROVAL_REQUIRED`. El gate 4 (inserción de filas curadas reales en `psi_agt002_integral_governance_overrides`) permanece abierto: sigue sin otorgarse ningún privilegio de escritura a ningún rol en la migración `064`, y esta sesión tampoco lo ejerció.

## 7. Actualización 2026-08-08: extracción ampliada a 17/17 documentos + correcciones P2 (borrador versión 2)

Una revisión independiente (Claude Opus 4.8) de la versión 1 del borrador emitió **APPROVE** para presentar el borrador a aprobación humana (sin P0), con un P1 explícito bloqueante solo de *canary* (no de la presentación del borrador): la extracción solo cubría 3 de los 17 documentos vigentes de la oportunidad, porque dependía de `psi_tender_document_chunks` como única fuente de texto, y esa tabla nunca se volvió a poblar tras las adendas que reemplazaron 14 de los 17 documentos. También señaló tres P2: semántica ambigua de `snapshot_id` frente a la evidencia real, alcance frágil (no recursivo) del test de aislamiento runtime, y una regex asimétrica/imprecisa como única defensa final anti-fuga de texto.

Esta sesión, continuando con las mismas credenciales de solo lectura ya localizadas (§6, sin imprimir ni registrar valores; exclusivamente `select`), cerró el P1 y los tres P2, siguiendo TDD estricto RED→GREEN para cada cambio de comportamiento:

- **Cobertura 17/17 (cierra P1).** `scripts/agt002-rama-judicial-governance-draft-generate.mjs` ya no lee `psi_tender_document_chunks` como fuente de texto. Lee `extracted_text` directamente de las 17 filas vigentes de `psi_tender_document_versions` y reconstruye chunks **localmente**, en memoria, con el mismo contrato puro y determinístico que usa producción (`buildAgt002DocumentChunks`, `agt002-document-chunks.js`) — nunca una reimplementación privada. Esa reconstrucción se reconcilió por igualdad exacta de `chunk_id`/`content_hash`/`chunk_hash` (nunca por conteo) contra los chunks reales que sí existen hoy en la base: 479/479 coincidencias, cero discrepancias. El extractor cerrado (`tender-requirement-extraction.js`) sigue reconociendo exactamente los mismos 3 `requirement_id` — no se inventó ninguno nuevo y no se usó ningún modelo/LLM para clasificar; lo que cambió es la cantidad y calidad de evidencia disponible para esos 3 requisitos (48 citas legales frente a 16, 33 técnicas frente a 9, 4 financieras frente a 1), releída íntegramente para reevaluar honestamente las propuestas/abstenciones existentes (todas se confirmaron; ninguna cambió de conclusión). El borrador declara explícitamente, en un `data_gap` dedicado, que este alcance de 3 `requirement_id` es el alcance actual del extractor cerrado, no cobertura semántica total del pliego real.
- **`evidence_chunk_snapshot_ids` (cierra P2-1).** Nuevo campo cerrado y obligatorio en `agt002-governance-draft-proposal.js` que declara, sin ambigüedad, el conjunto real de snapshots del que proviene cada porción de la evidencia citada (el snapshot real observado en la base para los chunks ya persistidos; el snapshot canónico contra el que se reconstruyó localmente para el resto) — nunca implícito solo en el `snapshot_id` canónico único.
- **Defensa anti-fuga recursiva (cierra P2-4, y corrige un falso positivo real).** La regex final sobre `JSON.stringify(value)` se reemplazó por un escaneo recursivo por clave (`findAgt002GovernanceDraftForbiddenTextKeyPaths`) que corre sobre **todo** el objeto, incluido `requirement_manifest`, antes que cualquier otra validación. Se demostró con un test RED→GREEN que la regex anterior producía un falso positivo real (rechazaba un borrador válido cuya `rationale` legítimamente mencionaba la palabra "text_content" como prosa); el escaneo por clave no tiene ese defecto.
- **Test de aislamiento runtime recursivo (cierra P2-3).** `tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs` se reescribió para recorrer recursivamente todo el repositorio (163 archivos `.js`/`.mjs`/`.ts`/`.tsx`) en vez de solo los `.js` de la raíz y los dos entrypoints nombrados. Se verificó mecánicamente (inyectando una importación real en un subdirectorio nuevo, luego eliminándola) que la versión anterior del test no la detectaba y que la nueva sí — RED→GREEN observado con un caso real, no hipotético. Ambos tests de gobernanza se agregaron explícitamente a `npm run test:agt002-runtime` en `package.json`.

Detalle completo, con las 27/33 citas técnicas falsas positivas clasificadas una por una (Cámara de Comercio, "monitoreo" de indicadores, Superintendencia de Vigilancia) frente a las 6/33 señales reales pero no cuantificables, en `docs/governance/2026-08-07-agt002-rama-judicial-governance-draft.md` §4.3 y §0.

El gate 4 (inserción de filas curadas reales en `psi_agt002_integral_governance_overrides`) permanece abierto: esta sesión, igual que las anteriores, no ejerció ningún privilegio de escritura sobre ningún rol ni tabla — todas las llamadas a Supabase en `scripts/agt002-rama-judicial-governance-draft-generate.mjs` son `select`/`eq`/`order`/`range`/`maybeSingle`. No se realizó ninguna escritura remota, migración, RPC con efecto, canary, modelo productivo, push, PR, merge ni deploy.
