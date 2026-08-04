import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const analysis = readFileSync(analysisPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');

// --- Types: the closed Task33 contract (legal_evidence/legal_findings) must be typed. ---
assert.match(types, /legal_findings\?:/, 'TenderDocumentAnalysis debe tipar legal_findings.');
assert.match(types, /legal_evidence\?:/, 'TenderDocumentAnalysis debe tipar legal_evidence.');
assert.match(types, /'tender_requirement'/, 'El tipo de clasificación jurídica debe incluir tender_requirement.');
assert.match(types, /'legal_obligation'/, 'El tipo de clasificación jurídica debe incluir legal_obligation.');
assert.match(types, /'company_evidence'/, 'El tipo de clasificación jurídica debe incluir company_evidence.');
assert.match(types, /'inference'/, 'El tipo de clasificación jurídica debe incluir inference.');
assert.match(types, /'human_legal_review'/, 'El tipo de clasificación jurídica debe incluir human_legal_review.');
assert.match(types, /official_url/, 'El tipo de cita jurídica debe incluir official_url.');
assert.match(types, /article_or_section/, 'El tipo de cita jurídica debe incluir article_or_section.');
assert.match(types, /corpus_version/, 'El tipo de cita jurídica debe incluir corpus_version.');
assert.match(types, /verified_at/, 'El tipo de cita jurídica debe incluir verified_at.');
assert.match(types, /citation_allowlist/, 'El tipo de evidencia jurídica debe incluir citation_allowlist.');
assert.match(types, /abstention_state/, 'El tipo de evidencia jurídica debe incluir abstention_state.');

// --- Component: a dedicated panel/component must exist, reading the real closed fields. ---
assert.match(analysis, /function\s+\w*Legal\w*\s*\(/, 'Debe existir un componente dedicado a hallazgos jurídicos.');
assert.match(analysis, /analysis\??\.legal_findings/, 'El componente debe leer analysis.legal_findings.');
assert.match(analysis, /analysis\??\.legal_evidence/, 'El componente debe leer analysis.legal_evidence.');

// Five distinct classes must be labeled/rendered distinctly (not just enumerated in a type).
for (const classification of ['tender_requirement', 'legal_obligation', 'company_evidence', 'inference', 'human_legal_review']) {
  assert.match(analysis, new RegExp(classification), `El panel debe distinguir la clase ${classification}.`);
}
// Distinct semantic grouping, not a single flat undifferentiated list.
assert.match(analysis, /tender-legal-findings-\$\{|tender-legal-findings-group/, 'Cada clase debe tener un contenedor/estilo distinto, no una lista plana indiferenciada.');

// Source verification and legal interpretation must be presented as two independent states.
assert.match(analysis, /Fuente oficial comprobada/, 'Una fuente verificada debe mostrar la etiqueta clara "Fuente oficial comprobada".');
assert.match(analysis, /Fuente pendiente de comprobación/, 'Una fuente incierta debe mostrar su estado técnico sin confundirlo con revisión jurídica.');
assert.match(analysis, /Interpretación pendiente de revisión humana/, 'La aplicabilidad e interpretación deben indicar revisión humana por separado.');
assert.match(analysis, /Hallazgo pendiente de validación jurídica/, 'Los hallazgos human_legal_review deben tener un título comprensible y no duplicar el mensaje técnico.');
assert.match(analysis, /citation\.official_url|\.official_url/, 'El panel debe enlazar official_url de la cita.');
assert.match(analysis, /article_or_section/, 'El panel debe mostrar el artículo/sección de la norma.');
assert.match(analysis, /corpus_version/, 'El panel debe mostrar la versión del corpus.');
assert.match(analysis, /verified_at/, 'El panel debe mostrar la fecha de verificación.');
assert.match(analysis, /target=["']_blank["']/, 'El enlace oficial debe abrir en pestaña nueva segura.');
assert.match(analysis, /rel=["']noopener noreferrer["']/, 'El enlace oficial debe incluir rel=noopener noreferrer.');

assert.match(analysis, /Fuente comprobada el/, 'La fecha de una fuente verificada debe explicar qué se comprobó.');
assert.match(analysis, /Fuente consultada el/, 'La fecha de una fuente pendiente debe presentarse como consulta, no aprobación jurídica.');
assert.doesNotMatch(
  analysis,
  /human_legal_review[^;]*Fuente oficial comprobada|Fuente oficial comprobada[^;]*human_legal_review/s,
  'human_legal_review nunca debe llevar la etiqueta de fuente verificada.',
);

// Never infer a source from free text, and never render a non-allowlisted/non-HTTPS link as official:
// the component must carry its own closed host allowlist + https check before treating a citation as official.
assert.match(analysis, /funcionpublica\.gov\.co/, 'El panel debe validar contra el host oficial de Función Pública.');
assert.match(analysis, /suin-juriscol\.gov\.co/, 'El panel debe validar contra el host oficial de SUIN-Juriscol.');
assert.match(analysis, /colombiacompra\.gov\.co/, 'El panel debe validar contra el host oficial de Colombia Compra Eficiente.');
assert.match(analysis, /supervigilancia\.gov\.co/, 'El panel debe validar contra el host oficial de Supervigilancia.');
assert.match(analysis, /https:/, 'El panel debe exigir HTTPS antes de tratar un enlace como oficial.');

// Fail-safe visual: a validator must gate rendering so legacy/corrupt data never crashes or
// renders as if it were verified.
assert.match(analysis, /function\s+isValidLegal\w*/, 'Debe existir un validador defensivo para datos jurídicos legacy/corruptos.');

// Preserve human authority: the panel must keep visible that Vig-IA organizes evidence only,
// and must never introduce legal decision/authorization/signature/GO-NO-GO buttons or language.
assert.match(analysis, /No autoriza GO\s*\/\s*NO GO|no autoriza GO\/NO-GO/i, 'El panel debe reiterar que no autoriza GO/NO GO.');
assert.doesNotMatch(analysis, /<button[^>]*legal/i, 'El panel de hallazgos jurídicos no debe incluir botones/acciones.');
assert.doesNotMatch(analysis, /Aprobar|Autorizar|Firmar|Enviar\s+a\s+firma/i, 'El panel no debe introducir lenguaje de autoridad jurídica definitiva.');

console.log('agt002 legal findings UI checks passed');
