import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('buildTenderGoNoGoVerdict'), 'Backend debe construir un dictamen GO/NO GO SN separado del análisis básico.');
  assert(file.includes('commercial_fit'), 'Dictamen debe incluir encaje comercial.');
  assert(file.includes('company_profile_crosscheck'), 'Dictamen debe cruzar contra ficha/RUP SN.');
  assert(file.includes('habilitating_requirements'), 'Dictamen debe separar requisitos habilitantes.');
  assert(file.includes('executive_semaphore'), 'Dictamen debe incluir semáforo ejecutivo.');
  assert(file.includes('committee_summary'), 'Dictamen debe generar resumen para comité.');
  assert(file.includes('decision: finalDecision'), 'Dictamen debe persistir decisión final sugerida.');
  assert(file.includes('GO / NO GO SN'), 'Reporte debe estar identificado como GO / NO GO SN.');
  assert(file.includes('getTenderCompanyProfile(database)'), 'Análisis debe consultar ficha/RUP SN para cruzar requisitos.');
  assert(file.includes('buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile)'), 'Análisis debe recibir ficha/RUP en importación/manual.');
}

assert(src.includes('Dictamen GO / NO GO SN'), 'UI debe presentar el reporte como Dictamen GO / NO GO SN.');
assert(src.includes('Semáforo ejecutivo'), 'UI debe mostrar semáforo ejecutivo.');
assert(src.includes('Encaje comercial'), 'UI debe mostrar encaje comercial.');
assert(src.includes('Cruce ficha/RUP SN'), 'UI debe mostrar cruce contra ficha/RUP.');
assert(src.includes('Requisitos habilitantes'), 'UI debe mostrar requisitos habilitantes.');
assert(src.includes('Resumen para comité'), 'UI debe mostrar resumen para comité.');
assert(src.includes('Siguiente acción recomendada'), 'UI debe mostrar próxima acción recomendada.');

console.log('tender GO/NO GO report static checks passed');
