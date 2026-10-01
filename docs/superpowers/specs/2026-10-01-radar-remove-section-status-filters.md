# Especificación — Radar de Licitaciones: retirar filtros "Sección" y "Estado interno"

**Fecha:** 2026-10-01
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial` (worktree `/workspace`)
**Naturaleza:** diseño y especificación técnica. Este documento no implementa código, no modifica datos ni configuración, no ejecuta migraciones y no despliega producción.
**Plan asociado:** `docs/superpowers/plans/2026-10-01-radar-remove-section-status-filters.md`
**Estado:** aprobado por el usuario/product owner (AGT-002): los dos controles visibles "Sección" y "Estado interno" no aportan valor y deben retirarse del panel de Filtros del Radar.

> **Convención de evidencia:** **[EXISTE]** significa verificado leyendo el código de este árbol de trabajo; **[PROPUESTO]** significa diseño aún no implementado.

## 1. Propósito

El panel "Filtros del Radar" (`TenderRadarView`) expone hoy ocho `<select>`: Fuente, Región SN, Cierre, Valor, Encaje, Sección, Estado interno y Orden. El usuario determinó que "Sección" y "Estado interno" no aportan valor como filtros manuales y deben desaparecer de la interfaz.

El cambio es puramente de **presentación y estado de filtro en el componente React**. No borra ni transforma el dato subyacente `tender.section` / `tender.internal_status`, no cambia las insignias de estado (`statusLabel`), no cambia las acciones de tarjeta (pasar a seguimiento, convertir, abrir expediente/oportunidad), no cambia la política de encaje, el conjunto de candidatos del Radar, el backend, la base de datos, Discord ni ningún temporizador o script de despliegue.

Además, el cambio debe impedir que una búsqueda guardada (perfil) aplique silenciosamente un valor antiguo de `section_filter` / `internal_status_filter` al cargarse: hoy `applyProfile` sincroniza esos dos campos del perfil contra el estado de filtro; al remover la UI y la reactividad de esos dos filtros, aplicar cualquier perfil (antiguo o nuevo) deja de alterar la sección o el estado interno visibles.

## 2. Estado actual verificado

**[EXISTE]** `src/tenders/TenderRadarView.tsx:51-52` declara el estado de los dos filtros a retirar:
```tsx
const [section, setSection] = useState<TenderSection | 'todas'>('todas');
const [internalStatus, setInternalStatus] = useState<TenderInternalStatus | 'todas'>('todas');
```

**[EXISTE]** `applyProfile` (`:71-76`) sincroniza ambos campos desde el perfil guardado:
```tsx
setSection(profile.section_filter || 'todas'); setInternalStatus(profile.internal_status_filter || 'todas'); setPage(1);
```
Esto es exactamente la "aplicación silenciosa de valores antiguos" que el usuario pidió evitar: un perfil guardado hace meses con `section_filter: 'prioridad_baja'` reescribe el filtro visible sin que el usuario lo pida explícitamente.

**[EXISTE]** Los efectos de paginación y de filtrado (`:82`, `:115`) incluyen `section` e `internalStatus` en sus dependencias y en el objeto pasado a `filterRadarTenders`.

**[EXISTE]** El panel (`:131`) renderiza, entre Encaje y Orden, los dos controles a retirar:
```tsx
<label className="tender-filter tender-filter-section">Sección<select value={section} onChange={event => setSection(event.target.value as TenderSection | 'todas')}>...</select></label>
<label className="tender-filter tender-filter-status">Estado interno<select value={internalStatus} onChange={event => setInternalStatus(event.target.value as TenderInternalStatus | 'todas')}>...</select></label>
```

**[EXISTE]** El banner "Mostrando procesos convertidos..." (`:129`) depende de `internalStatus === 'convertida_oportunidad'`, es decir, del valor del filtro que se retira — no de un dato de la tarjeta. Es un banner de "vista filtrada", no una insignia de estado de tarjeta.

**[EXISTE]** `src/styles.css:374-375` define el ancho de escritorio de los ocho controles secundarios, incluyendo las dos clases a retirar, con Orden en `span 4`:
```css
.tender-filter-source,.tender-filter-region,.tender-filter-deadline,.tender-filter-value,.tender-filter-score,.tender-filter-section,.tender-filter-status{grid-column:span 2}
.tender-filter-order{grid-column:span 4}
```
Las reglas de tablet (`:383-385`) y móvil (`:389-393`) usan la clase genérica `.tender-filter` y la excepción genérica `.tender-filter-order`; ninguna regla de tablet/móvil menciona `tender-filter-section` ni `tender-filter-status` por nombre propio hoy.

**[EXISTE]** `TenderSavedSearches.tsx:11-12` arma el payload de un perfil nuevo leyendo `filters.section` y `filters.internalStatus` del objeto `filters` que le pasa `TenderRadarView`. No se modifica este archivo: al dejar de ofrecer la UI y la reactividad de esos dos filtros en `TenderRadarView`, `filters.section`/`filters.internalStatus` seguirán siendo valores válidos del tipo (`'todas'` fijo), y los perfiles nuevos seguirán guardando `section_filter: 'todas'` / `internal_status_filter: 'todas'` sin error de tipos ni cambio de esquema.

**[EXISTE]** `filterRadarTenders` y el tipo `RadarFilters` en `src/tenders/radarUtils.ts:132-152` exigen `section` e `internalStatus` como campos obligatorios del filtro. No se modifica este archivo: `TenderRadarView` seguirá invocándolo con ambos campos fijos en `'todas'`, preservando la firma y el comportamiento de filtrado/orden/candidatos del Radar sin cambios.

## 3. Cambio propuesto [PROPUESTO] (fuera de alcance de esta sesión de RED; documentado para la fase GREEN)

En `src/tenders/TenderRadarView.tsx`:
- Reemplazar los dos `useState` de `section`/`internalStatus` por dos constantes locales fijas en `'todas'` (mismo nombre de variable, para no tocar `filterRadarTenders`, el objeto `filters` ni las dependencias de los `useEffect` existentes más de lo necesario).
- Eliminar `setSection(...)`/`setInternalStatus(...)` de `applyProfile`.
- Eliminar las dos etiquetas `<label className="tender-filter tender-filter-section">...` y `<label className="tender-filter tender-filter-status">...` del panel.
- Dejar sin cambios el resto del panel, `filterRadarTenders`, `sortTenderCards`, las insignias de tarjeta (`statusLabel`), las acciones de tarjeta y el flujo de conversión/seguimiento.
- El banner "Mostrando procesos convertidos..." deja de ser alcanzable desde la UI (la condición que lo activa ya no tiene control manual); se documenta como efecto colateral aceptado, no se reescribe su texto ni su lógica en esta sesión.

En `src/styles.css`:
- Retirar `.tender-filter-section` y `.tender-filter-status` de la lista de selectores en `span 2` (línea 374).
- Ampliar `.tender-filter-order` de `span 4` a `span 8` en escritorio (línea 375) para que la segunda fila (Valor, Encaje, Orden) siga ocupando las 12 columnas sin hueco visual, en vez de dejar 4 columnas vacías.
- No tocar las reglas de tablet ni móvil: ya son genéricas (`.tender-filter`, `.tender-filter-order`) y siguen siendo correctas con seis controles.

## 4. No-alcance

- No se modifica `tender.section` ni `tender.internal_status` como datos: siguen en `PublicTender`, se siguen usando en `tender-${tender.section}` (clase de tarjeta) y en `statusLabel(tender)` (insignia "Nueva"/"En seguimiento"/"Descartada"/"Convertida en oportunidad").
- No se modifican las acciones de tarjeta (pasar a seguimiento, convertir en oportunidad, abrir expediente/oportunidad) ni `enterTracking`/`convert`.
- No se modifica `filterRadarTenders`, `sortTenderCards`, `tenderFitBadgeLabel`, `tenderFitReasonDetails` ni ninguna otra función de `src/tenders/radarUtils.ts`.
- No se modifica la política de encaje (`tender-fit-policy`), el conjunto de candidatos del Radar, el backend, la base de datos, el esquema de `tender_search_profiles`, Discord ni ningún script de despliegue o temporizador.
- No se modifica `TenderSavedSearches.tsx`: sigue leyendo `filters.section`/`filters.internalStatus` sin cambios; el efecto de este diseño sobre ese archivo es indirecto (los valores que lee pasan a ser siempre `'todas'`).
- No se añaden, quitan ni reordenan las opciones de los seis `<select>` restantes.
- No se cambia el texto de ninguna etiqueta ni opción de los controles que permanecen.

## 5. Verificación exigida (resumen; detalle en el plan)

- `tests/tender-filter-compact-layout.test.mjs` reescrito en esta sesión para expresar el estado deseado (RED contra el código actual).
- `node --test tests/*.test.mjs` completo antes de cualquier commit de la fase GREEN.
- `npm run build` para confirmar que TypeScript no reporta tipos ni importaciones huérfanas tras retirar `section`/`internalStatus` como estado reactivo.
- Revisión manual en escritorio y móvil: seis controles visibles, sin Sección ni Estado interno, sin hueco visual en la segunda fila, perfiles guardados aplicables sin alterar Sección/Estado interno, insignias y acciones de tarjeta sin cambios.
