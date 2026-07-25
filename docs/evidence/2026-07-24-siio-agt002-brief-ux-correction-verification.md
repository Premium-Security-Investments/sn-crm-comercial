# Evidencia — Corrección UX del brief documental y decisión GO/NO GO

**Fecha:** 2026-07-24
**Rama:** `feat/tender-decision-assistant`
**Base previa:** `01e5141d9becfb2fdbce67404b337cf2de60f768`
**Ámbito:** cierre local de la brecha visual/semántica del PR #28; sin push, merge, deployment, migración remota, datos reales, costo ni activación de Hermes/AGT-002.

## Resultado implementado

- Se conserva un único brief documental con Recomendación preliminar, Fortalezas, Debilidades y bloqueadores, Dudas abiertas, Información no verificada y Siguiente acción.
- Las señales conocidas se presentan como conclusiones preliminares y pendientes de validación; las conclusiones no catalogadas permanecen intactas.
- El encaje comercial legado agrupa las señales en una conclusión preliminar, sin listas `Objeto/documentos mencionan ...`.
- `next_action` visible usa `actualizar la conclusión preliminar`, no `regenerar dictamen`.
- La experiencia visible usa `Registrar GO` / `GO registrado`; los permisos y la autorización backend no cambiaron.
- El panel humano conserva recomendación mínima, decisión, advertencias no bloqueantes, acciones e historial; no repite el resumen completo ni la lista de riesgos del brief.
- `Dudas abiertas` sigue siendo la única sección visual de preguntas accionables.
- Matriz, checklist y detalle operativo permanecen fuera del cierre ejecutivo.

## TDD y verificación

La primera ejecución focal quedó verde, pero la primera suite completa detectó un import faltante de `useMemo`; se corrigió. Una ejecución posterior detectó una expectativa contractual antigua `GO autorizado`; se actualizó a `GO registrado`.

La revisión independiente posterior encontró dos brechas bloqueantes y se corrigieron con TDD:

1. Las descargas ESU/SECOP validaban la URL al persistir, después de abrir la conexión. Ahora `safe-official-fetch.js` exige HTTPS, allowlist de host/ruta, DNS exclusivamente público, conexión fijada a la dirección validada, revalidación de redirects, dirección remota pública, timeout y límite de bytes.
2. La vigencia documental dependía de `created_at` y las cargas manuales podían dejar un puntero stale. La migración 027 añade un puntero explícito, refresh tokenizado, semántica A→B→A y triggers transaccionales que invalidan el puntero ante mutaciones legacy o tipadas, incluso para callers service-role que omitan el wrapper.

Después del último blocker se ejecutó una verificación completa fresca:

```text
TEST_SUITE_PASS=125/125
TSC_PASS
BUILD_PASS
BACKEND_PARITY_PASS
DIFF_CHECK_PASS
PGLITE_DIRECT_MUTATION_GATE_PASS
```

El build mantiene el warning conocido de Vite por chunks mayores a 500 kB; no bloquea y está fuera del alcance de este paquete.

## QA responsive

- Shell/login fresco: desktop 1440×900 y móvil 390×844, sin recortes ni overflow visible.
- Las vistas protegidas conservan la evidencia autenticada previa del lote.
- No se pudo repetir navegación autenticada fresca porque el navegador aislado no conserva sesión ni existe `storageState`; este límite permanece explícito y requiere decisión humana antes de deployment.

## Límites verificados

- La autorización GO/NO GO sigue siendo humana y exige ACL; ningún productor autoriza o bloquea la decisión.
- Una persona autorizada puede registrar GO/NO GO sin análisis, incluso durante refresh.
- Sólo un run `completed` del snapshot autoritativo vigente puede quedar anclado.
- No se modificaron contratos `AGT-002/v1` ni se activó AGT-002/HERMES-INTERIM.
- No hubo push, merge, deployment ni migración remota.
- No se usaron datos reales, servicios de IA ni costos.

## Gate siguiente

Esperar `APPROVE` de la re-revisión independiente y la decisión humana sobre el alcance del QA protegido. Sólo después corresponde crear el commit local y evaluar aplicación remota de 026/027, deployment y smoke productivo mediante un gate separado.
