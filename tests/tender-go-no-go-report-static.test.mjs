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

assert(!src.includes('Dictamen GO / NO GO SN'), 'UI no debe confundir una recomendación asistida con un dictamen humano.');
for (const label of ['Recomendación preliminar', 'Fortalezas', 'Debilidades y bloqueadores', 'Dudas abiertas', 'Información no verificada', 'Siguiente acción', 'Cómo funciona']) {
  assert(src.includes(label), `UI debe presentar ${label}.`);
}
assert(src.includes('No autoriza GO / NO GO'), 'UI debe explicar que el brief no reemplaza la decisión humana.');

console.log('tender GO/NO GO report static checks passed');
