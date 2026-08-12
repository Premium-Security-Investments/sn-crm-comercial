# AGT-002 — Registro contractual exhaustivo · Rama Judicial Manizales SA-24-2026

Fecha: 2026-08-12 · Rama: `feat/agt002-v3-foundations` · Estado: **borrador para revisión humana**
(`human_approval_required: true`). No GO/NO-GO, no firma/envío, no despliegue.

## 1. Objetivo y frontera

Construir un registro **auditable, regenerable y reutilizable** de los requisitos del pliego
vigente de SA-24-2026, cubriendo el **pliego completo** (no sólo los 4 requisitos del extractor
cerrado `tender-requirement-extraction.js`). El registro **cataloga** lo que el pliego exige;
**no decide** cumplimiento, habilitación, puntaje ni conveniencia. Esas son compuertas humanas
(§1 de `CURRENT.md`).

El expediente adjudicado **Rama Judicial Pereira SA-MC-02-2026** se usó como **patrón positivo**
de taxonomía y flujo (catálogo de documentos, matriz requisito→evidencia, escalera probatoria,
ledger de evidencia con vocabulario controlado). **No** se usó como prueba de cumplimiento de
Manizales ni se trasladó aplicabilidad: los valores, IDs y hechos de Pereira son específicos de
ese caso y no se copiaron.

## 2. Entregables

| Artefacto | Ruta | Rol |
|---|---|---|
| Taxonomía congelada + guarda PII | `agt002-contractual-registry-taxonomy.js` | Vocabulario cerrado, validadores, `scrubOpenPii`/`assertNoOpenPii` |
| Constructor del registro | `agt002-contractual-registry.js` | Procedencia/vigencia, seccionador, enumerador, umbrales cerrados, ensamblado |
| Generador offline | `scripts/agt002-manizales-registry-generate.mjs` | Lee la exportación local; escribe artefacto + cobertura |
| Artefacto real (regenerable) | `docs/governance/registro/manizales-sa-24-2026.registry.json` | Registro del pliego real |
| Cobertura/gaps (auto) | `docs/governance/registro/2026-08-12-manizales-registro-contractual-cobertura.md` | Tablas de cobertura, abstenciones y gaps |
| Tests | `tests/agt002-contractual-registry-taxonomy.test.mjs`, `tests/agt002-contractual-registry.test.mjs`, `tests/agt002-manizales-registry-generate-static.test.mjs` | TDD |

El generador es **offline y read-only**: lee sólo `/tmp/agt002-rama-originals/` (manifest +
extraction-manifest + `<id>.full.txt`). **No** toca Supabase, red, Vercel, SharePoint ni
secretos (verificado por el test estático).

## 3. Distinciones que el registro mantiene separadas

- **Pliego vigente vs. no vigente.** Procedencia determinista por tipo + nombre: `pliego_definitivo`
  (vigente) vs. `pliego_proyecto` (superseded) vs. `respuesta_observaciones` (histórico) vs.
  estudios/anexos (soporte). La oferta económica **Ajustado** es la vigente; la previa, superseded.
  Si no hay exactamente un pliego definitivo, **falla en cerrado**: no resuelve vigente y abre un gap.
- **Fase:** `habilitante` (Cap. II) / `puntuable` (Cap. III) / `evaluacion` (Cap. IV) /
  `ejecucion_tecnica` (Cap. V) / `postadjudicacion` (Cap. VI) / `generalidad` (Cap. I). Se deriva del
  **entero inicial del numeral**, robusto frente a rótulos romanos mal escaneados (el pliego reetiqueta
  "CAPITULO IV" lo que es el VI).
- **Las 4 dimensiones, por separado:** `presencia` (observado en el pliego), `vigencia` (cláusula del
  definitivo), `aplicabilidad` (**abstención** — depende de la modalidad del proponente), `cumplimiento`
  (**siempre `no_evaluado`** — frontera con la compuerta humana).
- **Requisito contractual vs. evidencia empresarial:** `evidencia_empresarial: not_assessed` en todo
  ítem. El registro no evalúa lo que la empresa aporta ni asume que Pereira lo tenía.
- **Presentado vs. aceptado/adjudicado:** escalera probatoria `requisito_pliego` / `observado`; nunca
  `cumplimiento probado` ni `puntaje otorgado` ni `hecho de adjudicación`.

## 4. Cobertura obtenida (pliego real)

67 secciones numeradas registradas del pliego definitivo; 7 habilitantes (Cap. II) con la sección
2.1 enumerando su lista de documentos como sub-ítems; umbrales cuantitativos extraídos por reglas
cerradas para capacidad financiera (los 4 indicadores), organizacional y experiencia (SMMLV). El
registro es **superset** del extractor cerrado: marca qué secciones tocan uno de los 4 requisitos
gobernados (`governed_requirement_ids`). Cifras exactas en el documento de cobertura auto-generado.

Señal auditada relevante (HR-003): la póliza de **RCE** aparece como **requisito habilitante**
(Cap. II) y como **amparo de garantía postadjudicación** (Cap. VI, 400 SMMLV) — exigencias
distintas; el registro las marca como `contradiccion` en el ledger y **no** resuelve su relación
(interpretación humana).

## 5. Gaps y abstenciones (residuales)

- **Categoría no determinada:** secciones cuyo título no mapea a una categoría cerrada quedan
  `no_determinada` con abstención (nunca se fuerza una etiqueta). Requieren clasificación humana.
- **Umbral no extraído:** habilitantes/garantías sin señal cuantitativa cerrada abstienen en el eje
  `umbral`; el valor/condición debe verificarse en el pliego.
- **Aplicabilidad:** abstención en **todos** los ítems (persona natural/jurídica/consorcio/UT,
  régimen diferencial MiPyme/mujeres/discapacidad).
- **Profundidad de parseo:** el seccionador reconoce la estructura numerada; texto no numerado,
  tablas OCR y anexos no se atomizan en requisitos individuales (se registran como soporte).
- **No se afirma** ausencia de adendas más allá de los 17 documentos exportados.

## 6. Qué NO hace (frontera de no automatización)

No decide cumplimiento/habilitación/puntaje/GO-NO-GO; no interpreta jurídicamente el pliego ni
resuelve sus contradicciones; no valida suficiencia de licencias/pólizas/experiencia; no evalúa
evidencia empresarial; no firma ni presenta; no escribe en producción, Supabase, Vercel ni
SharePoint. Toda salida es borrador con `human_approval_required: true`.

## 7. Regenerar

```bash
node scripts/agt002-manizales-registry-generate.mjs   # usa /tmp/agt002-rama-originals por defecto
node --test --test-concurrency=1 \
  tests/agt002-contractual-registry-taxonomy.test.mjs \
  tests/agt002-contractual-registry.test.mjs \
  tests/agt002-manizales-registry-generate-static.test.mjs
```
