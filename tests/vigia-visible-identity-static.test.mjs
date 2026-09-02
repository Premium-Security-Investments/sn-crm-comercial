import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const identityUrl = new URL('../src/vigia/agentIdentity.ts', import.meta.url);
const identity = existsSync(identityUrl) ? readFileSync(identityUrl, 'utf8') : '';
const catalog = readFileSync(new URL('../src/siioAgents.ts', import.meta.url), 'utf8');

for (const [key, label] of [
  ['manager', 'Vig-IA Gerencial'],
  ['tenders', 'Vig-IA Licitaciones'],
  ['commercial', 'Vig-IA Comercial'],
]) {
  assert.match(identity, new RegExp(`${key}: '${label}'`), `${key} must have its domain-qualified label`);
}
assert.match(identity, /PSI_AGENT_ROUTER_NAME = 'Agente Comercial PSI'/);
assert.match(catalog, /id: 'AGT-001'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.manager/);
assert.match(catalog, /id: 'AGT-002'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.tenders/);
assert.match(catalog, /id: 'AGT-003'[\s\S]*?name: VIGIA_VISIBLE_NAMES\.commercial/);
assert.doesNotMatch(catalog, /AGT-004|Agente IT/);

const tenderWorkbench = readFileSync(new URL('../src/tenders/components/TenderDossierVigiaWorkbench.tsx', import.meta.url), 'utf8');
assert.match(tenderWorkbench, /VIGIA_VISIBLE_NAMES\.tenders/);
assert.doesNotMatch(tenderWorkbench, /['"]Vig-IA['"]/);

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const approvedCommercialCopilotEmptyCopy = 'Vig-IA no encontró acciones adicionales fuera de las alertas comerciales.';
const approvedCommercialCopilotInferencesCopy = 'Inferencias de Vig-IA · por confirmar';
assert.match(main, /VIGIA_VISIBLE_NAMES\.tenders/);
for (const legacyTenderLabel of [
  'Radar de Vig-IA',
  'Documentos Vig-IA',
  'Seguimiento de Vig-IA',
  'Dossier Vig-IA',
  'Enviar al dossier Vig-IA',
]) {
  assert.doesNotMatch(main, new RegExp(legacyTenderLabel));
}

for (const path of [
  '../src/vigia/VigiaCommercial.tsx',
  '../src/vigia/VigiaOpportunityCopilot.tsx',
]) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /VIGIA_VISIBLE_NAMES\.commercial/);
  const identitySurface = path.endsWith('VigiaOpportunityCopilot.tsx')
    ? source.replace(approvedCommercialCopilotEmptyCopy, '').replace(approvedCommercialCopilotInferencesCopy, '')
    : source;
  assert.doesNotMatch(identitySurface, /Vig-IA(?! Comercial)/);
}

assert.match(main, /PSI_AGENT_ROUTER_NAME/);
for (const [label, source] of [
  ['main', main],
  ['catalog', catalog],
  ['tender workbench', tenderWorkbench],
  ['agent catalog view', readFileSync(new URL('../src/siio/SiioAgentsView.tsx', import.meta.url), 'utf8')],
  ['commercial priorities', readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8')],
  ['commercial copilot', readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8')],
  ['tender decision brief', readFileSync(new URL('../src/tenders/tenderDecisionBrief.ts', import.meta.url), 'utf8')],
  ['tender decision brief v3', readFileSync(new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url), 'utf8')],
  ['tender processing status', readFileSync(new URL('../src/tenders/processingStatus.ts', import.meta.url), 'utf8')],
  ['tender decision panel', readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8')],
  ['tender analysis section', readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8')],
]) {
  const identitySurface = label === 'commercial copilot'
    ? source.replace(approvedCommercialCopilotEmptyCopy, '').replace(approvedCommercialCopilotInferencesCopy, '')
    : source;
  assert.doesNotMatch(identitySurface, /Vig-IA(?! (?:Gerencial|Licitaciones|Comercial))/, `${label} contains a bare Vig-IA label outside the approved empty-preflight copy`);
  assert.doesNotMatch(source, /VIG-IA/, `${label} contains the obsolete uppercase label`);
}

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(
  styles,
  /\.vigia-opportunity-copilot \.eyebrow\{[^}]*text-transform:none[^}]*\}/,
  'vigia-opportunity-copilot .eyebrow must override text-transform to none so the identity renders exactly "Vig-IA Comercial"',
);

console.log('Vig-IA visible identity contract OK');
