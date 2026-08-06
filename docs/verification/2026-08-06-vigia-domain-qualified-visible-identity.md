# Verificación local — identidad visible Vig‑IA por dominio

**Fecha:** 2026-08-06  
**Worktree:** `/root/worktrees/siio-vigia-phase1-gpt`  
**Rama:** `fix/agt002-canonical-current`  
**Rango de implementación:** `003eaec..0ab19e4`  
**Alcance:** local, sin push, deploy, migraciones ni datos reales

## Resultado ejecutivo

La implementación local aplica las tres identidades visibles aprobadas:

- `AGT-001` → **Vig‑IA Gerencial**
- `AGT-002` → **Vig‑IA Licitaciones**
- `AGT-003` → **Vig‑IA Comercial**

El **Agente Comercial PSI** se presenta como router de interfaz, no como cuarto agente funcional de SIIO. El **Agente IT** no fue añadido al catálogo ni recibió un ID inventado.

## Preservación contractual

- Los IDs internos `AGT-001`, `AGT-002` y `AGT-003` permanecen sin cambios.
- No se modificaron migraciones, tablas, datos, perfiles de producción ni permisos.
- `agt002-workbench-contract.js` no fue modificado.
- El nombre persistido de mensajes AGT‑002 no se reescribe; la capa de presentación normaliza el autor visible a **Vig‑IA Licitaciones**.
- La revisión humana continúa obligatoria y `can_write_production` sigue en `false` para los tres agentes.

## Evidencia TDD

Cada bloque se ejecutó RED → GREEN:

1. Contrato común de identidad y catálogo canónico.
2. Presentación humana del catálogo SIIO.
3. Workbench y copy de Vig‑IA Licitaciones.
4. Prioridades y copiloto de Vig‑IA Comercial.
5. Separación del router y guard global contra `Vig‑IA` aislado.
6. Corrección posterior a revisión: brief, estados de procesamiento, análisis documental y panel GO/NO‑GO de Licitaciones; ampliación del guard a esas cuatro superficies.

Pruebas focales ejecutadas en secuencia:

```text
node tests/vigia-visible-identity-static.test.mjs
node tests/vigia-ui-static.test.mjs
node tests/agt002-workbench-ui.test.mjs
node tests/agt002-workbench-contract.test.mjs
node tests/siio-agent-catalog-static.test.mjs
node tests/siio-manager-navigation-static.test.mjs
npm run check:siio-agents
npm run check:siio-integration
npx tsc --noEmit
npm run build
git diff --check
```

Resultado final: **todas pasaron**.

Además se ejecutaron secuencialmente **19 regresiones de Licitaciones** que cubren brief, procesamiento durable, evidencia, preguntas, hallazgos jurídicos, timeline, preview, reportes, workspace guiado, lenguaje, navegación, productor y GO/NO‑GO. La corrida limpia completa terminó con `19 tender identity regressions passed`.

## Build

`npm run build` terminó con código `0`:

- TypeScript: correcto.
- Vite: 120 módulos transformados.
- `dist/index.html`: generado.
- Bundle principal: generado.
- `postbuild`: `katherine_company_permission=skipped_non_production`.

Vite mantiene un warning no bloqueante por un chunk minificado mayor de 500 kB. No fue introducido ni resuelto dentro de este cambio de identidad.

## QA de runtime y visual

1. El build inicial sin variables locales respondió HTTP 200, pero React no montó porque faltaban:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
2. Se recompiló exclusivamente `dist` con URL local inexistente y clave ficticia, sin credenciales reales.
3. El runtime montó correctamente la pantalla **Ingreso al CRM Comercial**, sin errores JavaScript visibles.
4. Las superficies autenticadas modificadas no se inspeccionaron visualmente porque hacerlo exige una sesión autorizada. No se simularon credenciales, perfiles ni datos de producción.

**Gate visual restante:** Juan debe validar en un entorno autorizado las pantallas Agentes, expediente de Licitaciones, Prioridades Comerciales, copiloto comercial y Agente Comercial PSI antes de cualquier despliegue.

## Revisión independiente

La primera revisión independiente del rango `003eaec..b9cdf57` concluyó **NO LISTO** con un hallazgo `Important`: cuatro superficies visibles de Licitaciones aún mostraban `Vig‑IA` aislado y el guard no las inspeccionaba. No reportó hallazgos `Critical` y confirmó preservación de IDs, contratos, permisos, productores, base de datos y gates humanos.

El commit correctivo `0ab19e4`:

- reemplaza esos usos visibles por **Vig‑IA Licitaciones** mediante el mapa central;
- incorpora los cuatro archivos al guard de identidad;
- actualiza las pruebas históricas que exigían el nombre aislado;
- conserva intacta la lógica de análisis, procesamiento, permisos y decisión humana.

La revisión independiente GPT de seguimiento del rango `003eaec..0ab19e4` concluyó **LISTO**:

- `Critical`: ninguno.
- `Important`: ninguno.
- `Minor`: warning no bloqueante de Vite por chunk mayor de 500 kB; alias interno legado `vig-ia` en una ruta de `main.tsx`, no renderizado como identidad visible.
- Hallazgo previo: resuelto en las cuatro superficies de Licitaciones.
- Guard de identidad: cubre catálogo, router, Workbench, Comercial, copiloto y las cuatro superficies corregidas.
- Invariantes: IDs, catálogo de tres agentes, productor, permisos, contratos, DB y gates humanos preservados.
- Checks adicionales de la revisión: contratos y permisos, autoridad humana, integraciones PGlite, navegación y backend parity aprobados.

## Estado de entrega

- Implementación local: completada y aprobada por revisión independiente GPT.
- Pruebas y build: aprobados.
- QA visual autenticado: pendiente de gate humano.
- Push: no realizado.
- Deploy: no realizado.
- Scheduler E6: no modificado.
