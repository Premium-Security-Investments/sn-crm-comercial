# Plan de implementación — AGT-002 resultados para decisión

**Fecha:** 2026-08-30
**Diseño:** `docs/superpowers/specs/2026-08-30-agt002-decision-results-redesign-design.md`
**Rama:** `fix/agt002-decision-results-redesign-20260830`

## Alcance y disciplina

Implementación exclusivamente visual y de selectores puros. Está prohibido ejecutar/reintentar/refrescar AGT-002 o Vig-IA, cambiar datos, persistencia, modelos o prompts. El cierre autorizado es fix → PR → CI → merge → deploy → QA autenticado read-only; no incluye una decisión GO/NO-GO.

## Tarea 1 — documentar contrato y fijar RED

**Archivos**
- Crear diseño y este plan.
- Modificar `tests/agt002-decision-axis-surface-ui.test.mjs`.
- Modificar `tests/agt002-decision-axis-surface-integration.test.mjs`.
- Modificar `tests/tender-executive-projection.test.mjs`.
- Modificar `tests/tender-integral-analysis-presentation.test.mjs`.
- Modificar `tests/tender-go-no-go-ui.test.mjs`.

**Pasos**
1. Añadir fixture V3 pausado de seis unidades abiertas, distribuido en las cinco categorías cerradas, con textos sintéticos únicos por campo.
2. Exigir seis tarjetas, conteo `6 pendientes accionables`, grupos humanos y ausencia de chips vacíos, cifras de cobertura y strings técnicos.
3. Exigir que cada campo visible corresponda verbatim al campo V3 permitido y que los fallbacks sean explícitos.
4. Reemplazar la expectativa antigua que codifica cinco ejes vacíos/cobertura numérica.
5. Exigir precedencia del conteo ejecutivo y fallback V3.
6. Exigir que `main.tsx` no monte `TenderIntegralAnalysisV3View` ni `Ver respaldo técnico del análisis`.
7. Ejecutar el conjunto focal y conservar la salida RED con causas esperadas de contrato aún no implementado.

**Comando RED**

```bash
node --test \
  tests/agt002-decision-axis-surface-ui.test.mjs \
  tests/agt002-decision-axis-surface-integration.test.mjs \
  tests/tender-executive-projection.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs \
  tests/tender-go-no-go-ui.test.mjs
```

## Tarea 2 — selectores puros y conteo

**Archivos**
- Modificar `src/tenders/tenderIntegralAnalysisPresentation.ts`.
- Modificar `src/tenders/tenderDecisionGate.ts`.

**Pasos**
1. Sustituir las etiquetas de categoría por el diccionario humano aprobado.
2. Exportar selector de unidades abiertas basado sólo en `closure.status`.
3. Exportar grupos operativos en orden cerrado, omitiendo grupos vacíos y preservando fallback desconocido.
4. Mantener textos verbatim, referencias traducidas y fallbacks en la vista, no mediante heurísticas.
5. Corregir `tenderExecutiveOpenIssueCount`: review → critical positivo → unidades abiertas → cero.
6. Ejecutar pruebas de presentación/conteo hasta GREEN.

## Tarea 3 — proyección operativa en la superficie única

**Archivos**
- Modificar `src/tenders/components/TenderDecisionAxisSurface.tsx`.
- Modificar `src/tenders/components/TenderDecisionExperience.tsx` sólo si la integración requiere una frontera explícita.
- Modificar `src/tenders/components/tender-decision-axis-surface.css`.

**Pasos**
1. Detectar modo V3 sólo si los cinco ejes están vacíos/no evaluados y existen unidades abiertas.
2. Crear componentes presentacionales `OperationalPendingCard` y `OperationalPendingProjection` dentro de la superficie.
3. Renderizar `Lectura documental incompleta`, conteo dinámico y grupos humanos en lugar de rail/body vacíos.
4. Renderizar únicamente título, conclusión, razones faltantes, impacto, acciones y referencias humanas.
5. No renderizar trazabilidad, IDs, enums ni cobertura interna.
6. Mantener ejes actuales sin cambios cuando haya cualquier hallazgo real.
7. Priorizar CTA de resolución de pendientes sin bloquear ni automatizar el panel humano.
8. Añadir CSS responsive, overflow wrapping y contraste de eyebrows/labels.
9. Ejecutar pruebas UI hasta GREEN.

## Tarea 4 — eliminar duplicación técnica

**Archivos**
- Modificar `src/main.tsx`.
- Ajustar `src/tenders/components/TenderIntegralAnalysisV3View.tsx` para que no exponga trazabilidad cruda si todavía tiene consumidores legítimos fuera del montaje eliminado.
- Modificar `src/tenders/components/TenderAnalysisSection.tsx` sólo si las pruebas detectan lectura duplicada.

**Pasos**
1. Retirar import y montaje duplicado de `TenderIntegralAnalysisV3View` en `main.tsx`.
2. Conservar controles de corrida existentes sin invocarlos en QA.
3. Retirar de la vista V3 accesible acordeones de IDs/enums/trazas; conservar helpers internos si otros contratos los requieren.
4. Confirmar por búsqueda estática y SSR que no existen strings prohibidos en HTML operativo.
5. Ejecutar integración y GO/NO-GO UI hasta GREEN.

## Tarea 5 — harness visual determinista

**Archivos**
- Modificar `scripts/agt002-decision-axis-visual-qa.mjs`.
- Generar `docs/verification/screenshots/agt002-decision-axis-*.{html,png}`.
- Generar reporte `docs/verification/screenshots/agt002-decision-axis-qa.txt`.

**Pasos**
1. Reemplazar escenario pausado antiguo por fixture genérico de seis unidades abiertas; ningún literal Pereira.
2. Conservar escenarios con hallazgos reales y post-GO para regresión.
3. Capturar proyección V3 desktop 1440 px y mobile 390 px.
4. Verificar conteos, secciones de tarjeta, grupos, ausencia de chips vacíos, cobertura interna y strings técnicos.
5. Medir en Chromium `scrollWidth <= clientWidth` para desktop/móvil.
6. Verificar estilos computados de eyebrows/labels y ratio WCAG >= 4.5:1.
7. Ejecutar harness y revisar visualmente PNG.

## Tarea 6 — verificación fresca y revisión

**Comandos**

```bash
node --test tests/agt002-decision-axis-surface-*.test.mjs \
  tests/tender-executive-projection.test.mjs \
  tests/tender-integral-analysis-presentation.test.mjs \
  tests/agt002-integral-analysis-v3.test.mjs \
  tests/tender-go-no-go-ui.test.mjs
node scripts/agt002-decision-axis-visual-qa.mjs
npm run test:agt002-runtime
npm run build
git diff --check
```

**Revisión obligatoria**
1. Revisar diff completo contra `origin/main`.
2. Buscar IDs/enums/trazas/cifras prohibidas y duplicación.
3. Revisar accesibilidad, responsive, autoridad humana y ausencia de I/O nuevo.
4. Corregir todo hallazgo Critical/Important.
5. Reejecutar suite afectada y build después de la última corrección.

## Tarea 7 — PR, CI y merge

1. Crear commits claros y atómicos sin artefactos temporales.
2. Push de la rama.
3. Abrir PR contra `main` con contrato, evidencia RED/GREEN, capturas y confirmación de cero corridas.
4. Esperar todos los checks requeridos; investigar y corregir fallas reales.
5. Con CI verde y revisión completa, mergear según la política del repositorio.
6. Registrar URL de PR, SHA de merge y resultados de checks.

## Tarea 8 — deploy y QA productivo autenticado

1. Verificar mecanismo vigente (Vercel ligado a `main`) y credenciales disponibles; no confundir publicación con deploy.
2. Desplegar el merge por el mecanismo vigente o confirmar el deploy automático asociado al SHA.
3. Confirmar deployment `Ready`, target production, alias y SHA desplegado.
4. Abrir producción con sesión autenticada existente y navegar a Pereira sin pulsar controles de actualizar/reanalizar.
5. Capturar desktop y mobile.
6. Comprobar:
   - seis pendientes y conteo humano;
   - ausencia de cinco chips vacíos;
   - categorías/tarjetas/campos/acciones;
   - ausencia de trazabilidad/IDs/enums/cobertura interna;
   - contraste y cero overflow;
   - control GO/NO-GO humano intacto y no accionado;
   - ninguna solicitud de nueva corrida/reintento/refresh.
7. Si no hay credenciales/sesión o un servicio externo bloquea el proceso, no inventar éxito: entregar PR/merge/deploy verificables y describir bloqueo exacto.

## Evidencia final requerida

- Estado e impacto breve.
- PR y SHA de merge.
- Checks CI con estado.
- Deployment ID/SHA/URL.
- Comandos y conteos de pruebas.
- Rutas/URLs de capturas locales y productivas.
- Matriz QA criterio por criterio.
- Confirmación explícita de que AGT-002/Vig-IA no se ejecutó, reintentó ni refrescó.
- Limitaciones reales.
