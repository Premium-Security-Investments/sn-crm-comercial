# Prioridades Comerciales Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar las dos experiencias activas Alertas Comerciales y Vig-IA Comercial por una única pestaña Prioridades Comerciales dentro de Comercial, respaldada por el motor canónico AGT-003.

**Architecture:** La ruta compatible `#/alerts` renderizará `VigiaCommercial` evolucionado como bandeja consolidada. Los filtros operativos se derivarán exclusivamente de `signals`, `level` y `evidence` entregados por `/api/vigia/priorities`; no se mantendrá el cálculo paralelo de `CommercialAlerts`. El acceso de transición aceptará cualquiera de los permisos existentes `modulo_alertas_comerciales` o `modulo_vig_ia`, conservando los controles de rol, área, propietario y CTA.

**Tech Stack:** React 19, TypeScript, Vite, Express/Vercel Functions, Node test contracts, Supabase, Vercel.

## Global Constraints

- La pestaña visible se llama exactamente **Prioridades Comerciales**.
- Vive en el grupo **Comercial**, no en **Gerencia**.
- `AGT-003` y `gate0-v1.0` siguen siendo el motor y política canónicos.
- No crear migraciones ni escrituras productivas.
- No mezclar Licitaciones.
- Compatibilidad con `#/alerts`, `#/vig-ia` y `#/centinel` sin mantener vistas duplicadas.
- Autorización y alcance se resuelven antes de leer oportunidades.
- Los permisos existentes de Alertas o Vig-IA conservan acceso durante la transición.
- El endpoint continúa siendo solo `GET`, read-only y con allowlist.
- Producción se despliega únicamente después de tests, build, audit, Preview y smoke autenticado.

---

### Task 1: Contratos de navegación y experiencia única

**Files:**
- Modify: `tests/navigation-dashboard-default-static.test.mjs`
- Replace: `tests/commercial-alerts-static.test.mjs`
- Modify: `tests/vigia-ui-static.test.mjs`
- Modify: `src/navPermissions.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `getVisibleNavGroups(profile)`, `canAccessRoute(profile, page)`, `Route.page`.
- Produces: una única entrada `#/alerts` con etiqueta `Prioridades Comerciales`; aliases `#/vig-ia` y `#/centinel` resueltos a `alerts`.

- [ ] **Step 1: Escribir contratos que fallen**

Actualizar las pruebas para exigir:

```js
assert.ok(nav.includes("{ href: '#/alerts', label: 'Prioridades Comerciales', page: 'alerts' }"));
assert.ok(!nav.includes("label: 'Vig-IA', page: 'centinel'"));
assert.ok(main.includes("if (page === 'centinel' || page === 'vig-ia') return { page: 'alerts' };"));
assert.ok(main.includes("if (route.page === 'alerts') return 'Prioridades Comerciales';"));
assert.ok(main.includes("if (route.page === 'alerts') return <VigiaCommercial"));
```

El nuevo contrato `commercial-alerts-static.test.mjs` debe prohibir `function CommercialAlerts` y exigir en `VigiaCommercial.tsx` los marcadores `Prioridades Comerciales`, `Filtros de gestión`, `Pipeline en riesgo`, `Sin próxima acción`, `Vencidas`, `Gestión vigente`, `Registrar seguimiento` y `Marcar revisada`.

- [ ] **Step 2: Ejecutar las pruebas y confirmar RED**

Run:

```bash
node tests/navigation-dashboard-default-static.test.mjs
node tests/commercial-alerts-static.test.mjs
node tests/vigia-ui-static.test.mjs
```

Expected: FAIL porque la navegación todavía muestra Alertas y Vig-IA separadas y `CommercialAlerts` sigue activo.

- [ ] **Step 3: Aplicar el cambio mínimo de navegación**

En `src/navPermissions.ts`:

```ts
{ href: '#/alerts', label: 'Prioridades Comerciales', page: 'alerts' }
```

Eliminar la entrada visible `#/vig-ia` del grupo Gerencia. En `src/main.tsx`, resolver `centinel` y `vig-ia` a `alerts`, cambiar el título de página y renderizar `VigiaCommercial` en `route.page === 'alerts'`. Eliminar el branch activo que renderiza Vig-IA por separado.

- [ ] **Step 4: Ejecutar contratos focalizados**

Run: los tres comandos del Step 2.
Expected: los contratos de navegación pasan; los marcadores de UI pendientes pueden permanecer RED hasta Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/navPermissions.ts src/main.tsx tests/navigation-dashboard-default-static.test.mjs tests/commercial-alerts-static.test.mjs tests/vigia-ui-static.test.mjs
git commit -m "feat: unify commercial priorities navigation"
```

### Task 2: Acceso transicional gobernado para Prioridades

**Files:**
- Modify: `server/index.js`
- Modify: `api/[...path].js`
- Modify: `src/navPermissions.ts`
- Modify: `tests/backend-module-guards.test.mjs`
- Modify: `tests/vigia-api-scope.integration.test.mjs`
- Modify: `tests/backend-parity.test.mjs`

**Interfaces:**
- Consumes: `can(profile, ACTIONS.MODULE_ALERTS_VIEW)`, `can(profile, ACTIONS.MODULE_VIGIA_VIEW)`.
- Produces: `requirePrioritiesAction(profile): true`, acceso a Prioridades cuando cualquiera de los dos módulos heredados es válido.

- [ ] **Step 1: Escribir pruebas RED del acceso de transición**

Añadir escenarios:

```js
const alertsOnly = profile('gerencia', ['modulo_alertas_comerciales']);
assert.equal(requirePrioritiesAction(alertsOnly), true);
assert.equal(requirePrioritiesAction(vigiaOnly), true);
assert.throws(() => requirePrioritiesAction(dashboardOnly), error => error?.status === 403);
```

En integración HTTP, probar `200` y lectura acotada para un perfil con Alertas sin Vig-IA, conservar `403` para perfil sin ambos y `403` para director sin área.

- [ ] **Step 2: Ejecutar y confirmar RED**

Run:

```bash
node tests/backend-module-guards.test.mjs
node tests/vigia-api-scope.integration.test.mjs
node tests/backend-parity.test.mjs
```

Expected: FAIL porque `requirePrioritiesAction` no existe y el endpoint exige solo Vig-IA.

- [ ] **Step 3: Implementar helper fail-closed en ambos backends**

Implementar la misma función en `server/index.js` y `api/[...path].js`:

```js
export function requirePrioritiesAction(profile) {
  if (can(profile, ACTIONS.MODULE_ALERTS_VIEW) || can(profile, ACTIONS.MODULE_VIGIA_VIEW)) return true;
  return requireAction(profile, ACTIONS.MODULE_VIGIA_VIEW, {});
}
```

Reemplazar `requireModuleAction(currentProfile, 'vigia')` por `requirePrioritiesAction(currentProfile)` únicamente en `GET /api/vigia/priorities`. Mantener la resolución de scope antes de `loadScopedVigiaOpportunities` y conservar `app.all(...405)`.

En `src/navPermissions.ts`, hacer que `alerts` sea visible/accesible si el perfil tiene cualquiera de los permisos elegibles, sin relajar otras rutas.

- [ ] **Step 4: Ejecutar GREEN y paridad**

Run: los tres comandos del Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/index.js 'api/[...path].js' src/navPermissions.ts tests/backend-module-guards.test.mjs tests/vigia-api-scope.integration.test.mjs tests/backend-parity.test.mjs
git commit -m "feat: preserve governed priorities access"
```

### Task 3: Bandeja consolidada basada en AGT-003

**Files:**
- Modify: `src/vigia/VigiaCommercial.tsx`
- Modify: `src/styles.css`
- Modify: `src/main.tsx`
- Modify: `tests/commercial-alerts-static.test.mjs`
- Modify: `tests/vigia-ui-static.test.mjs`
- Create: `tests/prioridades-commercial-filter-contract.test.mjs`
- Create: `src/vigia/priority-filters.js`
- Create: `src/vigia/priority-filters.d.ts`

**Interfaces:**
- Consumes: `VigiaPayload.priorities`, `VigiaPriority.signals`, `VigiaPriority.evidence`, CTA booleans.
- Produces: `filterCommercialPriorities(rows, filters)` y `summarizeCommercialPriorities(rows)`; una UI única de resumen, filtros y tarjetas explicables.

- [ ] **Step 1: Escribir contrato dinámico RED para filtros**

El test debe cubrir filas con `missing_next_action`, `next_action_overdue`, `close_soon`, nivel alto y gestión vigente. Debe exigir:

```js
assert.deepEqual(filterCommercialPriorities(rows, { category: 'missing' }).map(r => r.id), ['missing']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'overdue' }).map(r => r.id), ['overdue']);
assert.deepEqual(filterCommercialPriorities(rows, { category: 'managed' }).map(r => r.id), ['managed']);
assert.equal(summarizeCommercialPriorities(rows).risk, 2);
```

Los filtros combinados deben aplicar búsqueda, owner, regional, stage, service, level y exclusión local de revisadas mediante intersección, nunca unión.

- [ ] **Step 2: Ejecutar y confirmar RED**

Run:

```bash
node tests/prioridades-commercial-filter-contract.test.mjs
node tests/commercial-alerts-static.test.mjs
node tests/vigia-ui-static.test.mjs
```

Expected: FAIL porque `priority-filters.js` y la UI consolidada no existen.

- [ ] **Step 3: Implementar filtros puros**

Crear funciones puras:

```js
export function priorityHasSignal(row, code) {
  return Array.isArray(row?.signals) && row.signals.some(signal => signal.code === code);
}
export function priorityCategory(row, category) {
  if (!category) return true;
  if (category === 'risk') return row.level === 'alto';
  if (category === 'missing') return priorityHasSignal(row, 'missing_next_action');
  if (category === 'overdue') return priorityHasSignal(row, 'next_action_overdue');
  if (category === 'closing') return priorityHasSignal(row, 'close_soon') || priorityHasSignal(row, 'close_overdue');
  if (category === 'managed') return Boolean(row?.evidence?.next_action_at) && !priorityHasSignal(row, 'next_action_overdue');
  return false;
}
```

`filterCommercialPriorities` debe aplicar todos los filtros y `summarizeCommercialPriorities` contar las categorías con la misma definición.

- [ ] **Step 4: Evolucionar `VigiaCommercial`**

Cambiar el encabezado a **Prioridades Comerciales** y conservar `Impulsado por Vig-IA · AGT-003`. Añadir:

- tarjetas rápidas: Pipeline en riesgo, Sin próxima acción, Vencidas, Gestión vigente;
- filtros: búsqueda, comercial, región, etapa, producto, nivel;
- resumen de resultados;
- límite de 20 tarjetas después de filtrar;
- ocultar localmente revisadas;
- botones gobernados `Ver en Dashboard`, `Ver oportunidad` y `Registrar seguimiento`;
- score, señales, evidencia, recomendación, fuente, corte y política;
- aviso read-only y revisión humana.

Eliminar `CommercialAlerts` y `ALERT_INBOX_LIMIT` de `src/main.tsx` para retirar el motor paralelo del frontend.

- [ ] **Step 5: Ejecutar GREEN de UI y filtros**

Run: los tres comandos del Step 2.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/vigia/VigiaCommercial.tsx src/vigia/priority-filters.js src/vigia/priority-filters.d.ts src/main.tsx src/styles.css tests/prioridades-commercial-filter-contract.test.mjs tests/commercial-alerts-static.test.mjs tests/vigia-ui-static.test.mjs
git commit -m "feat: consolidate commercial priorities experience"
```

### Task 4: Verificación, Preview, PR y Producción

**Files:**
- Modify: `docs/qa/vigia-commercial-gate0-verification.md`
- Modify: `docs/superpowers/specs/2026-07-22-prioridades-comerciales-consolidation-design.md`

**Interfaces:**
- Consumes: rama implementada y todos los contratos anteriores.
- Produces: PR revisable, Preview validado, despliegue productivo trazable y evidencia QA.

- [ ] **Step 1: Ejecutar batería completa**

```bash
for f in tests/*.test.mjs; do node "$f"; done
npm run check:siio-integration
npm run build
npm audit --audit-level=low
git diff --check
```

Expected: todos los tests PASS, build exitoso, `found 0 vulnerabilities`, diff limpio.

- [ ] **Step 2: Revisión independiente**

Revisar seguridad, alcance, duplicación, paridad backend, compatibilidad de rutas y UX. Corregir cualquier bloqueador y repetir Step 1.

- [ ] **Step 3: Publicar rama y PR**

```bash
git push -u origin feat/prioridades-comerciales-tab
gh pr create --base main --head feat/prioridades-comerciales-tab --title "feat: consolidate Prioridades Comerciales" --body-file /tmp/prioridades-pr-body.md
```

Expected: PR abierto y mergeable.

- [ ] **Step 4: Desplegar Preview y ejecutar smoke por roles**

```bash
vercel --yes
```

Validar en Preview: usuario con Alertas, usuario con Vig-IA, usuario sin ambos, director sin área, `401`, `403`, `405`, scope por propietario, cero campos sensibles y cero escrituras.

- [ ] **Step 5: Integrar y desplegar Producción**

```bash
gh pr merge <PR> --merge
git switch main
git pull --ff-only origin main
vercel --prod --yes
```

Expected: deployment Production `Ready` y alias canónico actualizado.

- [ ] **Step 6: Smoke productivo y evidencia**

Repetir los casos de Preview contra `https://seguridad-nacional-crm.vercel.app`, verificar navegación en vivo, registrar deployment ID y rollback, actualizar evidencia QA, eliminar credenciales/fixtures temporales y confirmar árbol limpio.

- [ ] **Step 7: Commit documental de cierre**

```bash
git add docs/qa/vigia-commercial-gate0-verification.md docs/superpowers/specs/2026-07-22-prioridades-comerciales-consolidation-design.md
git commit -m "docs: record Prioridades Comerciales production verification"
git push origin main
```
