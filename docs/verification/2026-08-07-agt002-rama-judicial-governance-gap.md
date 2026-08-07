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
