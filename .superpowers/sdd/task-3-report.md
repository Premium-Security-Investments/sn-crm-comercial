# Task 3 — Panel administrativo y navegación por módulos

## Estado

**Completado.** Task 3 implementado en la rama `feat/siio-access-control-foundation`, sin push, deploy ni operación remota de Supabase.

## Alcance entregado

- Navegación declarativa por capacidades explícitas en `src/navPermissions.ts`.
  - Se añadió `moduleActionForPage(page)`.
  - Cada entrada navegable se asocia a un único código del catálogo compartido.
  - `canAccessRoute` y `getVisibleNavGroups` comparten el mismo mapeo y exigen perfil activo, compatibilidad de rol y permiso explícito.
  - Las rutas `detail`, `new` y `edit` requieren `modulo_oportunidades`.
  - Los grupos sin ítems visibles se omiten.
- `Nav` ahora consume exclusivamente `getVisibleNavGroups(currentProfile)` para renderizar grupos, etiquetas y hrefs, sin guards de rol duplicados en el componente.
- `UsersAdmin` consume `MODULE_PERMISSIONS`, `MODULE_PERMISSION_CODES`, `eligibleModulePermissions` e `isModulePermissionEligible` del catálogo compartido.
  - Los perfiles nuevos continúan iniciando con `permissions: []`.
  - La sección **“Módulos y pestañas”** muestra sólo módulos presentes en el catálogo y elegibles para el rol seleccionado.
  - Cambiar de rol elimina cada módulo incompatible y no autoasigna ninguno.
  - Editar carga `user.permissions` sin transformar los módulos persistidos.
  - Se añadió un resumen previo con módulos seleccionados y áreas asignadas.
  - Se conservaron alcance por áreas/subáreas, invitaciones, edición, cancelación y recuperación de acceso existentes.

## Archivos modificados o creados

- `src/navPermissions.ts`
- `src/main.tsx`
- `scripts/check_nav_permissions.mjs`
- `tests/user-module-admin-static.test.mjs` (nuevo)
- `tests/user-admin-edit-reset-static.test.mjs`

## RED → GREEN

### RED de navegación

1. Se reemplazó la matriz histórica de `scripts/check_nav_permissions.mjs` por perfiles con `id`, `active` y permisos explícitos.
2. Ejecución inicial: `npm run check:nav-permissions`.
3. Falló como se esperaba porque `moduleActionForPage` no existía:
   - `AssertionError: moduleActionForPage must be exported`

### GREEN de navegación

Después del mapeo declarativo y el filtrado por capacidad:

- `npm run check:nav-permissions` → OK.
- Cubiertos: admin sin módulos, admin sólo Usuarios, comercial sólo Oportunidades, Alertas+Metas, gerencia sin SIIO, rutas de oportunidad directas, correo histórico sin licitaciones, perfil inactivo y grupos vacíos.

### RED del formulario administrativo

1. Se creó `tests/user-module-admin-static.test.mjs`.
2. Ejecución inicial: `node tests/user-module-admin-static.test.mjs`.
3. Falló como se esperaba porque `main.tsx` no consumía el catálogo compartido:
   - `AssertionError: UsersAdmin debe consumir el catálogo compartido de módulos.`

### GREEN del formulario administrativo

Tras integrar el catálogo, filtros de compatibilidad, resumen y sección de módulos:

- `node tests/user-module-admin-static.test.mjs` → OK.
- `node tests/user-admin-edit-reset-static.test.mjs` → OK.

## Verificación final

Ejecutado con éxito después de la última corrección:

```text
node tests/module-access.test.mjs
node tests/user-module-admin-static.test.mjs
node tests/user-admin-edit-reset-static.test.mjs
npm run check:nav-permissions
npm run build
git diff --check
```

Resultados:

- Catálogo compartido: OK.
- Contrato estático de módulos: OK.
- Regresión de edición/reset: OK.
- Matriz de navegación: OK.
- Build TypeScript/Vite: OK.
- `git diff --check`: OK.
- Vite informó únicamente el warning preexistente/no bloqueante de chunk mayor a 500 kB.

## Commit

`497ed9e feat(access): let admins choose visible user modules`

## Auto-revisión

- Confirmado que `Nav` renderiza `getVisibleNavGroups(currentProfile)` y ya no contiene condiciones `isManagementRole`, `canViewTenders`, `canManageGoals` o `canManageUsers` dentro de su JSX.
- Confirmado que las URLs directas de detalle, creación y edición quedan asociadas a `modulo_oportunidades` en el mismo mapeo que la navegación.
- Confirmado que no hay autorización por `microsoft_email` ni templates/auto-selección de módulos en el panel.
- Confirmado que el techo por rol se consulta desde `isModulePermissionEligible`, no se replica como una lista de roles en el formulario.
- La revisión fue estática y por pruebas/build; no se hizo prueba visual autenticada ni operación contra Supabase por las restricciones del task.

## Preocupaciones / trabajo diferido

- Task 3 sólo protege la navegación del cliente y el enrutamiento de la SPA. Las guardas de endpoint y la minimización de `bootstrap` pertenecen explícitamente a Task 4 y no fueron implementadas aquí.
- `SiioDashboard` conserva sus controles internos históricos por rol; el acceso inicial a la ruta queda filtrado por la capacidad explícita en `RouterView`. La conversión de defensas backend/UI adicionales se mantiene fuera del alcance de esta tarea.

## Review fix

### RED → GREEN de hallazgos de revisión

- Se añadió `tests/task-3-review-regressions-static.test.mjs` y se ejecutó primero sobre `497ed9e`.
- **RED:** falló con 16 contratos incumplidos: acción `Nueva oportunidad` sin guard, hashes `detail`/`edit`/`consultant` incompletos sin ruta inválida, catálogo de acceso sin estados ni bloqueo de submit, y `moduleCode` duplicado en navegación.
- **GREEN:** el test de regresión pasa tras:
  - ocultar `Nueva oportunidad` sin `canAccessRoute(currentProfile, 'new')`;
  - modelar `invalid` explícitamente para hashes incompletos y desconocidos, y renderizar una vista de URL inválida antes de cualquier autorización o módulo;
  - distinguir catálogo `loading`/`ready`/`error`, mostrar el estado en Módulos y pestañas, deshabilitar Guardar y rechazar submit fuera de `ready`;
  - eliminar `moduleCode` de los items y mantener una única tabla `moduleActionByPage` para la capacidad por página.

### Commit

- `0ead755 fix(access): close task 3 review gaps`

### Verificación y auto-revisión

- `node tests/task-3-review-regressions-static.test.mjs` → OK.
- `node tests/user-module-admin-static.test.mjs` → OK.
- `node tests/user-admin-edit-reset-static.test.mjs` → OK.
- `npm run check:nav-permissions` → OK.
- `npm run build` → OK (solo warning no bloqueante de chunk >500 kB).
- `git diff --check` → OK.
- No se modificaron backend, bootstrap, deploy ni Supabase: los guards de API siguen diferidos a Task 4.
