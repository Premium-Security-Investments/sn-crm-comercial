import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const types = read('src/agents/workbench/types.ts');
const shell = read('src/agents/workbench/AgentWorkbenchShell.tsx');
const shellCss = read('src/agents/workbench/agent-workbench.css');
const adapter = read('src/tenders/components/TenderDossierVigiaWorkbench.tsx');
const panel = read('src/tenders/components/TenderDossierWorkspacePanel.tsx');
const tenderTypes = read('src/tenders/types.ts');
const tenderApi = read('src/tenders/api.ts');

// --- shell must be agent-neutral: no AGT-002 anywhere, no bypasses ---
for (const [label, source] of [['types.ts', types], ['AgentWorkbenchShell.tsx', shell], ['agent-workbench.css', shellCss]]) {
  assert.doesNotMatch(source, /AGT-002/i, `${label} no debe mencionar AGT-002`);
}
assert.doesNotMatch(shell, /localStorage|sessionStorage|location\.search|URLSearchParams/, 'el shell no debe usar bypasses de flag');
assert.doesNotMatch(shell, /visibleAgentName\s*===\s*['"]/, 'el shell no debe inferir autoridad por nombre del agente');
assert.doesNotMatch(shell, /config\.visibleAgentName\s*===/, 'el shell no debe inferir autoridad por nombre del agente');

// --- types.ts: capabilities and config cerrados ---
assert.match(types, /export type AgentWorkbenchCapability\s*=\s*'message'\s*\|\s*'attach'\s*\|\s*'draft'\s*\|\s*'review'\s*\|\s*'learning';/);
assert.match(types, /export type AgentWorkbenchConfig\s*=\s*\{/);
assert.match(types, /visibleAgentName:\s*string;/);
assert.match(types, /subtitle:\s*string;/);
assert.match(types, /contextLabel:\s*string;/);
assert.match(types, /capabilities:\s*readonly AgentWorkbenchCapability\[\];/);
assert.match(types, /humanReviewRequired:\s*true;/);
assert.match(types, /export type AgentWorkbenchMessage\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchJob\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchRequiredAction\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchArtifact\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchLearningProposal\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchWorkspace\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchHandlers\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchShellProps\s*=\s*\{/);

// --- shell: capabilities gate every panel/control, no implicit authority ---
assert.match(shell, /config\.capabilities\.includes\(/, 'los controles deben depender de config.capabilities explícitas');

// humanReviewRequired must be an operative, fail-closed runtime guarantee, not just a type-level decoration:
// the shell must actually check it and refuse to render when it is not exactly true.
assert.match(
  shell,
  /if\s*\(\s*config\.humanReviewRequired\s*!==\s*true\s*\)\s*(?:return\s+null|throw)/,
  'el shell debe fallar cerrado en runtime si humanReviewRequired no es exactamente true',
);
// and it must be visible: the mandatory footer copy is the human-facing surface of that guarantee.
assert.match(shell, /humanReviewRequired/);

// --- required panels ---
for (const label of [/[Ff]rentes/, /[Hh]ilo/, /[Cc]ontexto|[Ff]uentes/, /[Aa]cciones requeridas/, /[Aa]rtefactos|[Rr]evisi[oó]n/]) {
  assert.match(shell, label, `falta panel requerido que coincida con ${label}`);
}

// --- exact footer copy, parameterized by config.visibleAgentName (shell stays neutral) ---
assert.match(
  shell,
  /Control humano obligatorio: \{config\.visibleAgentName\} prepara borradores y señala faltantes\. La encargada debe revisar y aprobar cada versión antes de integrarla al paquete final\./,
  'el footer debe usar exactamente el copy obligatorio, parametrizado por config.visibleAgentName',
);

// --- adapter: exact VIGIA config from the plan, no AGT-002 visible copy ---
assert.doesNotMatch(adapter, /AGT-002/i, 'el adapter no debe exponer AGT-002 en copy visible');
assert.match(adapter, /visibleAgentName:\s*'Vig-IA',/);
assert.match(adapter, /subtitle:\s*'Copiloto de Licitaciones',/);
assert.match(adapter, /contextLabel:\s*'Expediente activo',/);
assert.match(adapter, /capabilities:\s*\['message',\s*'attach',\s*'draft',\s*'review',\s*'learning'\],/);
assert.match(adapter, /humanReviewRequired:\s*true,/);
assert.match(adapter, /\}\s*as const\)/);
assert.match(adapter, /import\s*\{\s*AgentWorkbenchShell\s*\}\s*from\s*'..\/..\/agents\/workbench\/AgentWorkbenchShell';/);
assert.doesNotMatch(adapter, /localStorage|sessionStorage|location\.search|URLSearchParams/, 'el adapter no debe usar bypasses de flag');

// --- adapter wires the four Task 4 routes ---
assert.match(adapter, /loadTenderDossierWorkbench/);
assert.match(adapter, /postTenderDossierWorkbenchMessage/);
assert.match(adapter, /retryTenderDossierWorkbenchJob/);
assert.match(adapter, /reviewTenderDossierWorkbenchLearning/);
assert.doesNotMatch(adapter, /setInterval|setTimeout/, 'el adapter no debe hacer polling');
assert.doesNotMatch(adapter, /onReviewArtifact:\s*\(\)\s*=>\s*\{\}/, 'no debe exponer controles conectados a handlers vacíos');
assert.match(
  adapter,
  /onReviewLearning:\s*\(proposalId,\s*decision,\s*scope\)/,
  'la revisión de aprendizaje debe conservar el alcance propuesto',
);
assert.match(adapter, /scope:\s*decision\s*===\s*'approved'\s*\?\s*scope\s*:\s*null/);

// --- tender types: workbench_enabled cerrado en el workspace ---
const workspaceTypeMatch = tenderTypes.match(/export type TenderDossierWorkspace\s*=\s*\{[^}]*\};/s);
assert.ok(workspaceTypeMatch, 'debe existir TenderDossierWorkspace');
assert.match(workspaceTypeMatch[0], /workbench_enabled:\s*boolean;/);

// --- tender api: loaders/mutators tipados para las cuatro rutas ---
assert.match(tenderApi, /export async function loadTenderDossierWorkbench/);
assert.match(tenderApi, /\/api\/tender-dossier-workbench\?id=/);
assert.match(tenderApi, /export async function postTenderDossierWorkbenchMessage/);
assert.match(tenderApi, /\/api\/tender-dossier-workbench\/messages/);
assert.match(tenderApi, /export async function retryTenderDossierWorkbenchJob/);
assert.match(tenderApi, /\/api\/tender-dossier-workbench\/jobs\/retry/);
assert.match(tenderApi, /export async function reviewTenderDossierWorkbenchLearning/);
assert.match(tenderApi, /\/api\/tender-dossier-workbench\/learning\/review/);

// --- workspace panel: mounts adapter only under the closed gate, no bypass ---
assert.match(panel, /import\s*\{\s*TenderDossierVigiaWorkbench\s*\}\s*from\s*'.\/TenderDossierVigiaWorkbench';/);
assert.match(panel, /\{workspace\.workbench_enabled\s*&&\s*<TenderDossierVigiaWorkbench/);
assert.doesNotMatch(panel, /localStorage|sessionStorage|location\.search|URLSearchParams/, 'el panel no debe usar bypasses de flag');

// --- responsive containment: controls and content must remain usable on mobile ---
assert.match(shellCss, /\.agent-workbench\{[^}]*min-width:0;[^}]*max-width:100%;/s, 'el shell debe contener su ancho');
assert.match(shellCss, /\.agent-workbench-jobs li>span\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere;?\}/s, 'los errores de job deben poder envolver texto');
assert.match(shellCss, /\.agent-workbench-artifacts>ul[^}]*list-style:none/s, 'artefactos no deben mostrar bullets residuales');
assert.match(shellCss, /@media\(max-width:640px\)[\s\S]*\.agent-workbench-composer\{grid-template-columns:minmax\(0,1fr\)\}/, 'el composer debe apilarse en móvil');
assert.match(shellCss, /@media\(max-width:640px\)[\s\S]*\.agent-workbench-jobs li\{[^}]*flex-direction:column;?\}/, 'el reintento debe apilarse en móvil');
assert.match(shellCss, /@media\(max-width:640px\)[\s\S]*\.agent-workbench-review-actions\{[^}]*flex-direction:column;?\}/, 'las decisiones deben apilarse en móvil');

console.log('agt002 workbench UI static checks passed');
