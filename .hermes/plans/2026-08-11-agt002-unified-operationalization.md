# AGT-002 único — plan de operacionalización end-to-end

**Objetivo:** dejar un solo AGT-002 / Vig-IA Licitaciones operativo y útil, usando Rama Judicial Manizales como piloto desde intake hasta pre-GO completo y, sólo después de un GO humano, probar post-GO sin firma, envío ni presentación automática.

**Autonomía:** Juan autorizó ejecutar este plan sin microaprobaciones. Se mantienen gates humanos indelegables: validación contractual consolidada, decisión GO/NO-GO y cualquier firma/envío/presentación.

## Criterios globales

- Una sola línea de producto y una sola persistencia canónica.
- Producción `origin/main@bbef30a` es la base; la evolución integral se integra, no se duplica.
- Toda conclusión por requisito necesita cita verificable o abstención explícita.
- Presencia, revisión, vigencia, aplicabilidad y cumplimiento son ejes independientes.
- El agente propone; el humano valida y decide.
- Toda migración es aditiva, con preflight, conteos y rollback.
- Un commit pequeño por bloque; TDD RED→GREEN; revisión independiente por bloque.

## Hallazgos P0 que gobiernan el plan

- Producción conserva 451.204 caracteres de 757.115 extraídos localmente: pérdida mínima de 305.911 (40,40%).
- `extractTextFromTenderFile` corta PDF/DOCX/TXT a 90.000 caracteres.
- Los XLSX no tienen extracción estructurada; conservan sólo marcadores de 108–125 caracteres.
- El input directo del agente cubre máximo 12/17 documentos y 36.000/757.115 caracteres (4,75%).
- La recuperación actual busca evidencia para requisitos ya conocidos; no sirve como descubrimiento exhaustivo.
- El extractor gobernado actual sólo produce cuatro requirement_id.
- El eje compliance permanece siempre `unknown`.

---

## Fase 0 — integración canónica

### Tarea 0.1 — rebase seguro

- Base de respaldo: `backup/agt002-v3-pre-rebase-20260811@2a3e398`.
- Rebasar `feat/agt002-v3-foundations` sobre `origin/main@bbef30a`.
- Resolver `CURRENT.md`, `src/main.tsx`, `tests/agt002-preview-surface.test.mjs` conservando producción y vista integral.

### Gate 0

- `node --test tests/agt002-*.test.mjs`
- `npm run check:backend-parity`
- `npm run build`
- `git diff --check origin/main...HEAD`
- `server/index.js` y `api/[...path].js` byte-idénticos.

---

## Fase 1 — extracción documental completa y versionada

### Tarea 1.1 — contrato puro de extracción

**Crear:**
- `tender-document-text-extraction.js`
- `tests/tender-document-text-extraction.test.mjs`

**Cambiar:**
- `server/index.js`
- `api/[...path].js`
- `package.json` sólo si se requiere un parser XLSX mantenido.

**RED:**
- PDF de más de 90.000 caracteres no se trunca.
- DOCX/TXT no se truncan silenciosamente.
- XLSX devuelve hojas, celdas, valores y fórmulas de forma determinista.
- archivo ilegible produce gap tipado, nunca texto de éxito ficticio.
- salida incluye `extractor_version`, parser, char_count y text_hash.

### Tarea 1.2 — persistencia inmutable de extracciones

**Crear migración:** `065_tender_document_extraction_integrity.sql`.

Tabla append-only propuesta: `psi_tender_document_extractions`:
- `document_version_id`, `extractor_version`, `status`;
- `extracted_text`, `text_hash`, `char_count`, parser/metadata;
- unicidad idempotente por versión + extractor;
- RLS/ACL read-only para runtime; escritura sólo por RPC gobernada/service worker;
- trigger de inmutabilidad.

No mutar ni sobrescribir las versiones documentales históricas.

### Tarea 1.3 — adaptador de lectura canónica

- El flujo integral usa la última extracción exitosa y anclada a `document_version_id`.
- El legado puede leer `psi_tender_document_versions.extracted_text` hasta completar backfill.
- La UI no descarga textos completos innecesariamente.

### Tarea 1.4 — backfill idempotente de Rama

- Script dry-run primero; verifica 17 hashes originales.
- Reprocesa 15 PDF + 2 XLSX desde Storage.
- Persiste 17 extracciones y chunks completos sólo tras preflight.
- Reconstruye snapshot/estado de análisis sin cambiar el contenido de los archivos.

### Gate 1

- 17/17 archivos con extracción tipada.
- 757.115 caracteres mínimos reproducibles para el snapshot actual, salvo diferencias justificadas por parser/versionado.
- Cero truncamiento silencioso.
- XLSX con hojas/celdas/fórmulas.
- Todos los chunks conservan documento, versión, página/hoja, locus y hash.

---

## Fase 2 — registro exhaustivo del pliego

### Tarea 2.1 — persistencia del registro

**Crear migración:** `066_agt002_tender_requirement_register.sql`.

Registro append-only/versionado por oportunidad y snapshot:
- `requirement_id`, categoría, frente, etapa;
- participación/habilitante, evaluación/puntuable, ejecución/post-award, informativo;
- condición, umbral, vigencia, fecha/hito, severidad;
- citas estructuradas a chunks;
- `proposal_status`, `human_validation_status`;
- supersesión y procedencia por pliego/adenda.

### Tarea 2.2 — descubrimiento map/reduce sobre todos los chunks

**Crear módulos y pruebas:**
- `agt002-requirement-discovery-contract.js`
- `agt002-requirement-discovery-map.js`
- `agt002-requirement-discovery-reduce.js`
- `agt002-requirement-register.js`
- pruebas unitarias, adversariales y PGlite.

Proceso:
1. Map: cada lote de chunks propone sólo requisitos citados.
2. Reduce: deduplica sin perder condiciones ni fuentes.
3. Precedencia: adenda > pliego definitivo > proyecto/estudios.
4. Abstención: chunk ilegible/no cubierto queda como gap explícito.
5. Validación: toda propuesta requiere cita existente y hash coincidente.

Los cuatro extractores deterministas actuales se conservan como controles confiables, no como universo total.

### Tarea 2.3 — registro piloto Rama Judicial

- Ejecutar discovery sobre 100% de chunks de los 17 documentos.
- Revisión técnica independiente de falsos positivos/omisiones.
- Producir un único paquete consolidado para validación humana, no microdecisiones.

### Gate 2

- Cada documento/chunk tiene estado procesado o gap.
- Cada requisito tiene una o más citas verificables.
- Ningún requisito se declara cumplido por mera presencia.
- Pliego definitivo y respuestas/adendas tienen precedencia explícita.
- Registro completo aprobado en una validación humana consolidada.

---

## Fase 3 — evidencia empresarial y cumplimiento gobernado

### Tarea 3.1 — determinaciones separadas

**Crear migración:** `067_agt002_requirement_determinations.sql`.

Para cada requisito:
- presencia;
- revisión;
- vigencia;
- aplicabilidad;
- cumplimiento propuesto;
- cumplimiento validado;
- evidencia empresarial y fuente;
- actor, fecha, rationale y supersesión.

Sin determinación validada, `compliance=unknown`.

### Tarea 3.2 — ampliar mapas y evidencia de Rama

- Mantener decisiones HR-001..HR-004 ya registradas.
- Proponer enlaces para el registro completo.
- Si no hay evidencia, abstención/gap + acción requerida.
- Nunca convertir similitud textual en cumplimiento.

### Gate 3

- Cobertura uno-a-uno de requisitos con conclusión propuesta o abstención.
- Conclusiones materiales sólo con determinación validada y evidencia.
- Preguntas, bloqueadores, responsable, acción y hito derivados por requisito.

---

## Fase 4 — brief pre-GO completo de Rama

- Ejecutar AGT-002 integral sobre el snapshot reprocesado.
- Persistir run canónico único, schema `3.x`.
- Renderizar resumen ejecutivo, matriz completa, fortalezas, brechas, preguntas y próximos pasos.
- Validación visual autenticada en producción.

### Gate 4

- Sin omisiones silenciosas.
- Cada afirmación abre su evidencia.
- GO/NO-GO sigue disponible sólo a persona autorizada.
- AGT-002 no decide ni presenta.

---

## Fase 5 — release operativo

- Revisión independiente de diff y seguridad.
- Push/PR/merge según flujo del repositorio.
- Aplicar migraciones 063–067 en orden con preflight y rollback.
- Deploy Vercel y verificar commit/READY/HTTP.
- Canary único de Rama; apagar workers automáticos al terminar hasta aceptar resultados.
- Activar contrato integral sólo después de canary verde.

### Gate 5

- Suite AGT-002, PGlite, backend parity, build y smoke productivo verdes.
- Run canónico v3 visible y trazable.
- Sin duplicación de jobs ni dos líneas de AGT-002.

---

## Fase 6 — post-GO condicionado

Sólo tras decisión GO humana:

1. crear/sembrar dossier;
2. verificar checklist y responsables;
3. adjuntar evidencias;
4. crear/versionar artefactos;
5. revisar y aprobar versiones;
6. probar gate `lista_para_presentar`;
7. detener antes de `presentada` salvo instrucción humana expresa.

No existe ni se añadirá firma, envío SECOP o presentación automática.

---

## Definición final de DONE

- Un único AGT-002 productivo.
- Rama Judicial reproducible end-to-end.
- Extracción completa y versionada de PDF/XLSX.
- Registro del pliego completo con citas o gaps.
- Evidencia/compliance gobernados.
- Brief pre-GO útil y auditado.
- GO/NO-GO humano.
- Post-GO probado hasta listo para presentar, sin presentar.
- Observabilidad, runbook, rollback y limpieza de ramas/worktrees completados.
