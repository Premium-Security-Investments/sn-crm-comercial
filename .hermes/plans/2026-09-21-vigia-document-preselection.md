# AGT-002 — preselección de documentos "Sugerido por Vig-IA" (diseño aprobado)

**Estado:** diseño aprobado por el usuario, implementación completa y verificada localmente
(las cuatro piezas de producción descritas abajo existen y sus pruebas pasan). El despliegue a
producción sigue pendiente.

**Construye sobre:** `.hermes/plans/2026-09-17-agt002-governed-document-worksets.md` (Fase 4),
`src/tenders/governedWorksetSelection.ts`, `agt002-governed-document-worksets.js`,
`src/tenders/components/TenderGovernedDocumentWorkset.tsx`.

## Qué resuelve

El paquete gobernado (Fase 4) ya exige selección humana explícita, 1..12 documentos, motivo de
inclusión y confirmación de congelamiento. Pero hoy Licitaciones arranca de una lista plana sin
ninguna ayuda: debe abrir y leer cada documento vigente para decidir cuáles corresponden al
paquete. Este corte agrega una **sugerencia** — nunca una decisión — calculada por el servidor
("Vig-IA") a partir de señales conservadoras, dejando a Licitaciones exactamente el mismo control
total que ya tiene hoy.

## Invariantes duras (no negociables)

1. **La sugerencia es sólo eso: una sugerencia.** El servidor calcula `analysis_suggestion` por
   documento (`recommended`, `confidence`, `reason_code`, `reason`, `policy_version`), pero nunca
   decide por Licitaciones. La preselección resultante es un punto de partida editable, no un
   resultado final.
2. **Nunca es exclusión.** Ningún documento vigente con `extraction_status === 'ok'` deja de ser
   seleccionable manualmente, sin importar lo que diga `analysis_suggestion.recommended`. Un
   documento no recomendado sigue apareciendo en la lista completa de candidatos
   (`currentAgt002GovernedWorksetDocuments`) y puede marcarse a mano.
3. **Señales conservadoras y explicables.** La sugerencia usa únicamente: `document_type`, el
   nombre de archivo (`name`) y señales del texto extraído (`extracted_text`) — encabezados
   fuertes reconocibles (p. ej. "requisitos habilitantes", "especificaciones técnicas"). Nunca hay
   una regla universal de nombre de archivo: el nombre de archivo **por sí solo, sin ninguna otra
   señal, nunca alcanza `high`** — a lo sumo puede sostener `medium`. Combinado con `document_type`
   (ambos apuntando al mismo tipo documental) o con señales de texto extraído, el nombre de archivo
   sí puede contribuir a que la confianza combinada llegue a `high`. No hay heurística de
   aprendizaje, ni modelo externo, ni llamada a un proveedor de IA: es una función pura,
   determinista y auditable.
4. **Licitaciones puede agregar o quitar libremente.** La preselección puebla el borrador de
   selección (los mismos `Agt002GovernedWorksetDraftEntry` que ya administra el componente), pero
   cada entrada sigue siendo un checkbox editable: agregar un documento no sugerido o quitar uno
   sugerido es una operación de primera clase, sin fricción adicional ni confirmación especial.
5. **Se aplica una única vez por paquete cargado.** Al cargar el conjunto de documentos vigentes
   de una oportunidad, la preselección se calcula y se aplica exactamente una vez. Nunca se vuelve
   a aplicar automáticamente sobre la misma carga — ni al editar una entrada, ni al tipear un
   motivo, ni al desmarcar un documento y volver a mirarlo.
6. **Nunca se auto-agrega un documento subido después.** Un archivo cargado mientras la sección ya
   está montada (mismo flujo que hoy: "se lista como candidato, pero nunca se agrega
   automáticamente a la selección congelada") jamás entra a la selección por la sola preselección
   de Vig-IA. La preselección corre una vez sobre el paquete inicial cargado, no sobre cada cambio
   de la lista de candidatos.
7. **Congelar sigue exigiendo confirmación humana explícita.** `AGT002_GOVERNED_WORKSET_FREEZE_CONFIRMATION_COPY`,
   el checkbox de confirmación y el botón "Congelar paquete y ejecutar AGT-002" no cambian de
   comportamiento: aceptar una preselección no exime de marcar la confirmación de congelamiento.
8. **La preselección se reinicia por oportunidad (`selectionScopeKey`).** `TenderGovernedDocumentWorkset`
   guarda con qué `selectionScopeKey` se aplicó la preselección por última vez (vía `useRef`, nunca
   un booleano plano). Si el componente se reutiliza para una oportunidad distinta —
   `selectionScopeKey` cambia—, el guard de "una única vez" (invariante 5) se reinicia y la
   preselección puede volver a aplicarse una vez para el nuevo paquete; dentro de la misma
   oportunidad, sigue aplicándose exactamente una vez sin importar cuántas veces cambie la lista de
   candidatos.
9. **Fuera de alcance de este corte y de este diseño, sin excepción:**
   - Ningún GO/NO-GO, ninguna recomendación de decisión ni cambio a `recommendation`/`go_no_go`.
   - Ningún envío de correo, ninguna integración con SECOP, ningún flujo de aprobación externo.
   - Ninguna ejecución de producción del piloto DANE ni de ningún otro piloto real.
   - Ninguna regla universal de nombre de archivo (ver invariante 3).
   - El límite de 12 documentos (`AGT002_GOVERNED_WORKSET_MAX_MEMBERS`) no cambia.

## Forma pública segura (contrato exacto)

`suggestAgt002DocumentRelevance(document)` devuelve exactamente estas cinco claves, sin
extras ni variantes:

```
{
  recommended: boolean,
  confidence: 'high' | 'medium' | 'low',
  reason_code: string,
  reason: string,
  policy_version: 'agt002-document-relevance-v1',
}
```

- `reason` es lenguaje humano, corto, en español, y **nunca** cita ni reproduce el contenido de
  `extracted_text` — únicamente describe qué tipo de señal se encontró (p. ej. "el tipo documental
  y el nombre de archivo coinciden con el pliego vigente"), nunca el texto del documento.
- Cuando `recommended === false`, `reason` es neutral: nunca dice que el documento es
  "irrelevante" — explica que no se detectaron señales suficientes y que Licitaciones puede
  incluirlo manualmente si lo considera pertinente.
- `policy_version` es constante y versiona la política de señales, para poder cambiarla después
  sin ambigüedad sobre qué versión produjo cada sugerencia histórica.

## Piezas de este corte (implementadas y verificadas localmente)

1. **`agt002-document-relevance-suggestion.js`**: función pura
   `suggestAgt002DocumentRelevance(document)` sobre `{ document_type, name, extracted_text }`.
   Verificado por: `tests/agt002-document-relevance-suggestion.test.mjs`.
2. **`buildAgt002RecommendedWorksetSelection`** (en `src/tenders/governedWorksetSelection.ts`):
   toma los documentos vigentes ya anotados con `analysis_suggestion` (calculado por el servidor)
   y construye la lista de miembros preseleccionados: sólo `recommended === true` y elegibles por
   extracción (`extraction_status === 'ok'`), ordenados por confianza (`high` antes que `medium`,
   preservando el orden de entrada entre empates), acotados a
   `AGT002_GOVERNED_WORKSET_MAX_MEMBERS` (12, sin cambios), con `source_classification: 'official'`
   y un `inclusion_reason` que siempre empieza con `"Preseleccionado por Vig-IA:"` seguido del
   `reason` seguro ya producido por la función anterior. Verificado por (extensión):
   `tests/tender-governed-workset-selection.test.mjs`.
3. **`TenderGovernedDocumentWorkset.tsx`**: al montar con un paquete de documentos cargado, aplica
   la preselección exactamente una vez por `selectionScopeKey` (guard con `useRef` + `useEffect`,
   ver invariante 8), muestra la etiqueta "Sugerido por Vig-IA" junto a cada documento recomendado
   y un texto que aclara que Licitaciones puede agregar o quitar cualquier documento libremente.
   Sigue renderizando la lista completa de candidatos vigentes sin filtrar por recomendación, y
   conserva sin cambios la confirmación de congelamiento y el botón de la corrida. Verificado por
   (regresión de integración de fuente): `tests/agt002-document-preselection-component.test.mjs`.
4. **Cableado del backend**: `server/index.js` y `api/[...path].js` importan
   `suggestAgt002DocumentRelevance` desde `../agt002-document-relevance-suggestion.js` y anotan
   cada documento vigente con `analysis_suggestion` (pasándole el documento completo del lado
   servidor, antes de proyectarlo) dentro de `getTenderDocumentRecords`, justo antes de la llamada
   existente a `publicTenderDocumentProjection`. `tender-document-extraction-persistence.js` gana
   `analysis_suggestion` en su lista blanca de campos públicos, sin tocar la exclusión de
   `extracted_text`. Verificado por (regresión de integración de fuente y de runtime de la
   proyección): `tests/agt002-document-relevance-api-integration.test.mjs`, con una extensión
   mínima del mismo invariante de seguridad en `tests/security/tender-api-projection.test.mjs`.

## Explícitamente fuera de alcance de este corte

- Cualquier endpoint HTTP nuevo. Este corte **extiende** la respuesta existente de documentos
  vigentes de la licitación (la que ya construye `getTenderDocumentRecords` y sirve
  `publicTenderDocumentProjection` por documento) agregando el objeto seguro `analysis_suggestion`
  a cada documento público — no crea ninguna ruta nueva, pero sí cambia el payload de esa
  respuesta existente. La lista blanca de `tender-document-extraction-persistence.js` gana
  exactamente esa clave nueva; `extracted_text` sigue, sin excepción, fuera de la lista blanca.
- Cualquier flag de configuración nueva.
- El despliegue a producción: la implementación está completa y verificada localmente, pero
  todavía no se ha desplegado al piloto DANE ni a ningún otro entorno de producción.
- Cualquier cambio al contrato 1..12 de `agt002GovernedWorksetSelectionErrors` /
  `buildAgt002GovernedWorksetMembers`.
