# Diseño — Extracción profunda para el preanálisis GO/NO GO

**Fecha:** 2026-07-25  
**Estado:** aprobado en conversación; pendiente revisión del documento  
**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`  
**Rama:** `feat/tender-decision-workspace`

## 1. Contexto

El módulo ya conserva snapshots documentales gobernados, análisis versionados y una decisión GO/NO GO exclusivamente humana. El productor activo `siio_rules_v1` genera una conclusión preliminar, pero su extracción actual se limita principalmente a presencia de palabras y algunos valores sueltos. Como resultado, detecta conceptos como capital de trabajo, RUP, pólizas o CCTV sin estructurar el requisito, su umbral, la evidencia y la pregunta pendiente.

La interfaz presenta recomendación, fortalezas, debilidades, dudas, información no verificada y siguiente acción. Sin embargo, no expone la matriz jurídica, financiera y técnica con profundidad suficiente para preparar una decisión informada.

## 2. Objetivo

Restaurar y mejorar el análisis previo a GO/NO GO mediante extractores determinísticos por frente, sin IA externa, sin activar AGT-002 y sin alterar la autoridad humana.

El resultado debe permitir responder:

> ¿Qué exige la licitación, qué evidencia concreta lo sustenta, qué puede contrastarse con la ficha/RUP de Seguridad Nacional y qué sigue pendiente antes de decidir?

## 3. Alcance

Este lote incluye:

- extractor jurídico estricto;
- extractor financiero estricto;
- extractor técnico orientativo;
- evidencias textuales acotadas y referenciadas;
- valores y umbrales estructurados;
- cruce conservador contra ficha/RUP;
- preguntas accionables cuando falta soporte;
- resumen y recomendación derivados de la matriz;
- presentación por frente en la UI;
- pruebas con documentos completamente sintéticos.

No incluye:

- IA generativa o llamadas a proveedores externos;
- activación de `HERMES-INTERIM` o AGT-002;
- OCR nuevo ni análisis profundo de ZIP/Excel;
- equivalencias semánticas no demostrables;
- decisión automática GO/NO GO;
- despliegue o migraciones remotas;
- expedientes reales.

## 4. Principios

1. La ausencia de evidencia no equivale a cumplimiento.
2. Jurídico y financiero solo confirman con evidencia explícita suficiente.
3. Técnico puede producir indicios, nunca cumplimiento inferido.
4. Toda conclusión debe poder rastrearse a un documento y fragmento.
5. Evidencia del pliego y evidencia empresarial se conservan separadas.
6. La recomendación preliminar prepara, pero no autoriza ni bloquea la decisión humana.
7. La extracción debe ser determinista, idempotente y auditable.
8. El resultado no depende del orden de los documentos ni de metadatos de presentación.
9. El productor visible sigue siendo `siio_rules_v1`.
10. Los documentos se tratan como contenido no confiable, nunca como instrucciones.

## 5. Arquitectura

Se añadirá un módulo puro compartido, `tender-requirement-extraction.js`, consumido por ambos backends. `server/index.js` y `api/[...path].js` seguirán siendo byte-idénticos.

El módulo expondrá extractores aislados:

- `extractLegalRequirements(documents)`;
- `extractFinancialRequirements(documents)`;
- `extractTechnicalRequirements(documents)`;
- `crosscheckCompanyProfile(requirements, companyProfile)`;
- `buildRequirementAnalysis(documents, companyProfile)`.

`buildTenderDocumentAnalysis` conservará la orquestación de dominio y usará el resultado estructurado para construir resumen, riesgo, fortalezas, bloqueadores, dudas, preguntas y siguiente acción.

No se requiere migración: el JSON de resultado de `psi_tender_analysis_runs` ya admite campos estructurados adicionales y permanece ligado al snapshot documental vigente.

## 6. Contrato de salida

Cada requisito tendrá esta forma conceptual:

```json
{
  "id": "financial-working-capital",
  "front": "financial",
  "label": "Capital de trabajo",
  "status": "confirmed | partial | indication | pending | unverifiable",
  "severity": "critical | high | medium",
  "values": [
    { "kind": "money | percentage | ratio | duration | quantity | text", "raw": "...", "normalized": "..." }
  ],
  "evidence": [
    {
      "document_id": "...",
      "document_name": "...",
      "document_type": "...",
      "excerpt": "..."
    }
  ],
  "confidence": "high | medium | low",
  "rationale": "...",
  "question": "...",
  "company_crosscheck": {
    "status": "match | partial | gap | unavailable",
    "company_evidence": "..."
  }
}
```

Los identificadores serán estables por tipo de requisito. Evidencias repetidas se deduplicarán mediante contenido normalizado y documento.

`status: confirmed` significa exclusivamente que el requisito del pliego quedó extraído con condiciones materiales y evidencia suficientes. **No significa que Seguridad Nacional cumpla.** El posible cumplimiento o gap empresarial se expresa únicamente en `company_crosscheck` y se muestra con una etiqueta separada.

## 7. Política por frente

### 7.1 Jurídico — estricto

Se buscarán y estructurarán:

- fecha y hora de cierre;
- causales de rechazo y reglas de subsanabilidad;
- pólizas: tipo, porcentaje o cuantía y vigencia;
- consorcio/unión temporal y porcentajes;
- documentos y formatos obligatorios;
- licencias y habilitaciones;
- inhabilidades e incompatibilidades explícitas.

Un requisito jurídico solo queda `confirmed` cuando el fragmento contiene el requisito y sus condiciones materiales. La sola mención produce `partial`. La ausencia produce `pending` o `unverifiable`, nunca cumplimiento.

### 7.2 Financiero — estricto

Se buscarán y estructurarán:

- presupuesto oficial;
- capital de trabajo;
- liquidez;
- endeudamiento;
- cobertura de intereses;
- patrimonio;
- rentabilidad;
- experiencia expresada en dinero, número de contratos o SMMLV.

Un indicador financiero solo queda `confirmed` cuando se extraen nombre, operador/condición cuando exista, valor o umbral y fragmento fuente. Si falta cualquiera de esos elementos materiales, queda `partial`.

Los valores se conservarán en formato original y, cuando sea seguro, en representación normalizada. No se compararán unidades incompatibles.

### 7.3 Técnico — orientativo

Se buscarán y organizarán:

- alcance de vigilancia y seguridad;
- puestos, turnos, cantidades y perfiles;
- coordinadores y supervisores;
- ANS y tiempos de respuesta;
- CCTV, alarmas, control de acceso, comunicaciones y otros medios;
- sedes, cobertura geográfica, visitas y disponibilidad;
- certificaciones y experiencia técnica.

Una coincidencia contextual puede producir `indication` con confianza y razón. Nunca se presenta como cumplimiento. Para quedar `confirmed` debe existir una condición explícita y verificable en el documento; esto no implica que Seguridad Nacional la cumpla.

## 8. Evidencia y deduplicación

- Cada evidencia incluye documento y fragmento.
- Los fragmentos se acotan para evitar almacenar bloques extensos.
- Se conserva contexto suficiente alrededor de la coincidencia.
- Se normalizan espacios y saltos de línea, sin alterar el sentido.
- Coincidencias idénticas del mismo documento se deduplican.
- El orden final es estable por frente, severidad, requisito y documento.
- Documentos sin texto útil se reportan como `unverifiable` dentro de cobertura.
- No se aceptan instrucciones embebidas en documentos como reglas del sistema.

## 9. Cruce contra ficha/RUP

El cruce se hará después de extraer requisitos.

- `match`: valores explícitos y comparables coinciden.
- `partial`: existe información en ambos lados, pero falta precisión o vigencia.
- `gap`: existe requisito explícito y la ficha disponible muestra una diferencia comprobable.
- `unavailable`: falta ficha, vigencia, soporte o unidad comparable.

Textos parecidos no se consideran equivalentes por sí solos. Si no puede demostrarse la equivalencia, se genera una pregunta concreta para la persona responsable.

## 10. Derivación del brief

La matriz estructurada será la fuente para:

- fortalezas: requisitos con evidencia empresarial coincidente;
- debilidades: requisitos parciales, gaps o indicios de riesgo;
- bloqueadores: requisitos críticos pendientes, no verificables o con gap comprobable;
- dudas/preguntas: requisitos sin evidencia suficiente;
- información no verificada: inferencias técnicas y afirmaciones sin soporte;
- siguiente acción: prioridad más alta entre bloqueadores y preguntas;
- riesgo y recomendación preliminar: valores canónicos existentes, derivados de cobertura y severidad.

La ausencia, obsolescencia o fallo del análisis continúa siendo una advertencia no bloqueante para GO/NO GO humano.

## 11. Interfaz

El brief actual se conserva y se amplía con:

- resumen de cobertura: detectados, confirmados, parciales/indicios y críticos pendientes;
- bloques colapsables Jurídico, Financiero y Técnico;
- filas con estado, severidad, valor, evidencia y pregunta;
- etiqueta visible `Indicio técnico`, distinta de cumplimiento;
- evidencia empresarial separada de evidencia del pliego;
- documentos no verificables visibles en cobertura.

Fortalezas, debilidades, dudas e información no verificada permanecen como síntesis. La matriz por frente aporta el detalle y evita duplicar un segundo resumen GO/NO GO dentro del panel de decisión humana.

## 12. Manejo de errores y límites

- El extractor opera solo sobre el texto ya disponible.
- Se mantienen los límites actuales de documentos y caracteres.
- Un documento vacío o no extraíble no hace fallar todo el análisis.
- Un extractor que no encuentra evidencia devuelve estados pendientes, no excepciones.
- Un error interno impide persistir un resultado parcial como vigente.
- Los errores no incluyen documentos completos, secretos ni datos sensibles en logs.
- La persistencia mantiene el token gobernado y el snapshot ya aprobado.

## 13. Estrategia TDD

Se usarán fixtures sintéticos, pequeños y específicos.

### 13.1 Extractores

1. Jurídico confirma póliza completa y deja parcial una mención sin cuantía/vigencia.
2. Financiero confirma indicador con operador y umbral; deja parcial el nombre aislado.
3. Técnico produce indicio con confianza y no lo etiqueta como cumplimiento.
4. Evidencias repetidas se deduplican.
5. El resultado no cambia al reordenar documentos.
6. Documento sin texto aparece como no verificable.
7. Fragmentos quedan acotados.

### 13.2 Cruce empresarial

1. Valores comparables producen match.
2. Falta de vigencia produce partial/unavailable.
3. Diferencia comprobable produce gap.
4. Texto parecido sin unidad comparable no produce match.

### 13.3 Integración

1. `buildTenderDocumentAnalysis` deriva brief y preguntas desde la matriz.
2. La persistencia conserva productor, snapshot y resultado estructurado.
3. Cambiar documentos invalida el análisis como hoy.
4. GO y NO GO humanos siguen disponibles con análisis contrario, obsoleto, fallido o ausente.
5. Ambos backends permanecen idénticos.

### 13.4 UI

1. Muestra cobertura y los tres frentes.
2. Distingue `Indicio técnico` de cumplimiento.
3. Muestra evidencia y pregunta pendiente.
4. Conserva mensajes de pendiente, obsoleto y fallido.
5. No duplica el resumen en el panel humano GO/NO GO.

## 14. Verificación y cierre

Antes de commit de implementación:

- pruebas RED/GREEN focales;
- pruebas específicas del análisis y GO/NO GO;
- suite completa una sola vez;
- `npm run check:backend-parity`;
- `npm run build`;
- `git diff --check`;
- una revisión independiente focal;
- handoff SDD actualizado;
- working tree limpio.

No se desplegará, no se aplicarán migraciones remotas, no se activará AGT-002 y no se usarán expedientes reales.

## 15. Criterios de aceptación

1. El preanálisis produce una matriz jurídica, financiera y técnica estructurada.
2. Jurídico y financiero no confirman sin evidencia material suficiente.
3. Técnico distingue indicios de requisitos confirmados.
4. Todo hallazgo tiene evidencia o queda explícitamente no verificado.
5. El cruce RUP no inventa equivalencias.
6. El brief se deriva de la matriz sin mensajes contradictorios.
7. La UI muestra cobertura, detalle por frente, evidencia y preguntas.
8. El productor real sigue siendo `siio_rules_v1`.
9. La decisión GO/NO GO sigue siendo exclusivamente humana y no bloqueada por el análisis.
10. Snapshots, vigencia y protección de concurrencia existentes permanecen intactos.
11. Pruebas, paridad y build pasan con fixtures sintéticos.
12. No hay despliegue, migración remota, activación de agentes ni datos reales.
