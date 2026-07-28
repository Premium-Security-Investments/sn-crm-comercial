import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const helper = readFileSync(new URL('../src/tenders/tenderDecisionBrief.ts', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');

assert.match(helper, /export function tenderAnalysisProducerDisclosure/, 'Debe existir una divulgación explícita del productor');
assert.match(helper, /Determinístico por reglas SIIO/, 'Debe identificar sin ambigüedad el análisis determinístico');
assert.match(helper, /Vig-IA con revisión humana obligatoria/, 'Debe identificar públicamente a Vig-IA sin atribuirle decisión');
assert.doesNotMatch(helper, /Análisis AGT-002|Agente AGT-002/, 'El identificador técnico no debe aparecer en el humanizador público.');
assert.match(section, /tenderAnalysisProducerDisclosure\(analysis\.producer\)/, 'La sección debe mostrar la divulgación real del productor');
assert.match(section, /Fallback seguro aplicado/, 'Debe advertir el fallback');
assert.match(section, /preanálisis determinístico por reglas/, 'El fallback debe explicar que no fue producido por el agente');
assert.doesNotMatch(section, /AGT-002 (decidió|autorizó|aprobó)/i, 'La UI no puede atribuir decisión o autorización al agente');

console.log('tender analysis producer disclosure contract passed');
