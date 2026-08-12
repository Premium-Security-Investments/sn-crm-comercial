// Generador OFFLINE y read-only del REGISTRO CONTRACTUAL EXHAUSTIVO de Rama Judicial
// Manizales SA-24-2026.
//
// No accede a Supabase, red, Vercel, SharePoint ni secretos: lee EXCLUSIVAMENTE la
// exportación local de los 17 documentos oficiales (manifest.json + extraction-manifest.json
// + los <id>.full.txt) y escribe un artefacto regenerable + un documento de cobertura/gaps.
// Reproducible: mismo insumo ⇒ mismo registro (salvo `generated_at`).
//
// Uso:
//   node scripts/agt002-manizales-registry-generate.mjs [inputDir]
// inputDir por defecto: /tmp/agt002-rama-originals

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContractualRegistry } from '../agt002-contractual-registry.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INPUT_DIR = '/tmp/agt002-rama-originals';
const OUTPUT_JSON = resolve(PROJECT_ROOT, 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const OUTPUT_COVERAGE = resolve(PROJECT_ROOT, 'docs/governance/registro/2026-08-12-manizales-registro-contractual-cobertura.md');

function loadDocuments(inputDir) {
  const manifest = JSON.parse(readFileSync(resolve(inputDir, 'manifest.json'), 'utf8'));
  let extractionById = new Map();
  try {
    const extraction = JSON.parse(readFileSync(resolve(inputDir, 'extraction-manifest.json'), 'utf8'));
    extractionById = new Map((extraction.documents || []).map(d => [d.id, d]));
  } catch {
    extractionById = new Map();
  }
  const documents = manifest.documents.map(doc => {
    const extraction = extractionById.get(doc.id);
    let content = '';
    if (extraction?.full_text_path) {
      try { content = readFileSync(extraction.full_text_path, 'utf8'); } catch { content = ''; }
    }
    return { document_id: doc.id, name: doc.name, document_type: doc.document_type, content };
  });
  return { opportunityId: manifest.opportunity_id, documents };
}

function coverageMarkdown(registry) {
  const c = registry.coverage;
  const fase = Object.entries(c.por_fase).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  const cat = Object.entries(c.por_categoria).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  const prov = registry.provenance
    .map(d => `| ${d.provenance_kind} | ${d.vigencia} | ${d.is_vigente_pliego ? 'sí' : ''} | ${d.name} |`)
    .join('\n');
  const gaps = registry.data_gaps.length
    ? registry.data_gaps.map(g => `- **${g.gap_id}**: ${g.description}`).join('\n')
    : '- (sin gaps de datos)';
  const abstArr = registry.abstentions.reduce((acc, a) => { acc[a.axis] = (acc[a.axis] || 0) + 1; return acc; }, {});
  const abst = Object.entries(abstArr).sort().map(([k, v]) => `- **${k}**: ${v}`).join('\n');
  const habilitantes = registry.items
    .filter(i => i.fase === 'habilitante')
    .map(i => `| ${i.numeral} | ${i.categoria} | ${i.umbral.detectado ? 'sí' : '—'} | ${i.sub_items.length || ''} | ${i.titulo} |`)
    .join('\n');
  return `# Registro contractual exhaustivo — Rama Judicial Manizales SA-24-2026

> Artefacto: \`docs/governance/registro/manizales-sa-24-2026.registry.json\` (regenerable con
> \`node scripts/agt002-manizales-registry-generate.mjs\`). Estado: **${registry.status}**,
> \`human_approval_required: ${registry.human_approval_required}\`. Generado: ${registry.generated_at}.

Este registro cataloga los requisitos del **pliego vigente (definitivo)** distinguiéndolos del
proyecto de pliego y de la respuesta a observaciones. **No decide cumplimiento, habilitación,
puntaje ni GO/NO-GO**: esas son compuertas humanas. Pereira SA-MC-02-2026 se usó sólo como
patrón de taxonomía y flujo, nunca como prueba de cumplimiento de Manizales.

## Procedencia y vigencia documental

| Procedencia | Vigencia | Pliego vigente | Documento |
|---|---|---|---|
${prov}

Pliego vigente resuelto: **${registry.vigente_pliego.resolved ? registry.vigente_pliego.name : 'NO RESUELTO'}**.

## Cobertura del pliego vigente

Métricas separadas y honestas (secciones y subítems son unidades de distinto nivel y **no se
suman**: un subítem es un componente de su sección, no un requisito jurídico independiente):

- **Secciones registradas** (unidad atomizada del registro): **${c.secciones_registradas}**
- **Subítems detectados** (componentes enumerados dentro de secciones): **${c.subitems_detectados}** en ${c.secciones_con_subitems} secciones
- Con señal de umbral extraída por reglas cerradas: **${c.con_umbral}**
- Categoría no determinada (abstención): **${c.categoria_no_determinada}**
- Tocan uno de los 4 requisitos del extractor cerrado: **${c.tocan_requisito_gobernado}**

> Definiciones — sección registrada: ${registry.coverage.metrica_definiciones.seccion_registrada}
> Subítem detectado: ${registry.coverage.metrica_definiciones.subitem_detectado}
> Atomización: ${registry.coverage.metrica_definiciones.atomizacion}

### Por fase

| Fase | Secciones |
|---|---|
${fase}

### Por categoría

| Categoría | Secciones |
|---|---|
${cat}

## Requisitos habilitantes (Capítulo II)

| Numeral | Categoría | Umbral | Sub-ítems | Título |
|---|---|---|---|---|
${habilitantes}

## Abstenciones (por eje)

${abst}

## Gaps de datos

${gaps}

## Límites probatorios (frontera de no automatización)

${registry.probative_limits.map(l => `- ${l}`).join('\n')}
`;
}

function main() {
  const inputDir = process.argv[2] || DEFAULT_INPUT_DIR;
  const { opportunityId, documents } = loadDocuments(inputDir);
  const registry = buildContractualRegistry({
    documents,
    opportunityId,
    generatedAt: new Date().toISOString(),
  });
  // Guarda dura: ningún PII sin redactar entra al artefacto abierto.
  assertNoOpenPii(registry);

  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(OUTPUT_COVERAGE, coverageMarkdown(registry));
  console.log(`Registro escrito en ${OUTPUT_JSON}`);
  console.log(`Cobertura escrita en ${OUTPUT_COVERAGE}`);
  console.log(`Secciones: ${registry.coverage.total_items} | con umbral: ${registry.coverage.con_umbral} | abstenciones: ${registry.abstentions.length} | gaps: ${registry.data_gaps.length}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
