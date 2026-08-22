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
const identity = read('src/vigia/agentIdentity.ts');

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
assert.match(types, /workbenchTitle:\s*string;/, 'el título visible de la mesa debe venir de config, no del shell');
assert.match(types, /export type AgentWorkbenchMessage\s*=\s*\{/);
assert.match(types, /export type AgentWorkbenchJob\s*=\s*\{/);
// I4: el estado del trabajo debe ser representable y cerrado, no una inferencia del shell.
// `obsolete` es terminal y NO reintentable: existe precisamente para no ofrecer un reintento
// que la base rechazaría y que, por el trabajo congelado, nunca podría prosperar.
assert.match(types, /export type AgentWorkbenchJobStatus\s*=\s*'queued'\s*\|\s*'in_progress'\s*\|\s*'completed'\s*\|\s*'failed'\s*\|\s*'obsolete';/);
assert.match(types, /status:\s*AgentWorkbenchJobStatus;/, 'el trabajo debe llevar su estado');
// I3: la propuesta de aprendizaje debe poder declarar su decisión y alcance aprobado.
assert.match(types, /decision:\s*AgentWorkbenchLearningDecision\s*\|\s*null;/);
assert.match(types, /approvedScope:\s*string\s*\|\s*null;/);
assert.match(types, /export type AgentWorkbenchActiveLearningPolicy\s*=\s*\{/);
assert.match(types, /activeLearningPolicies:\s*readonly AgentWorkbenchActiveLearningPolicy\[\];/);
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

// --- naming visible: el shell sólo compone, el adapter aporta las cadenas ---
assert.match(shell, /<h3>\{config\.workbenchTitle\}<\/h3>/, 'el h3 debe renderizar config.workbenchTitle');
assert.doesNotMatch(shell, /Mesa de trabajo/, 'el h3 genérico anterior debe desaparecer');
assert.match(
  shell,
  /<span className="agent-workbench-eyebrow">\{config\.visibleAgentName\} · \{config\.subtitle\}<\/span>/,
  'el eyebrow debe ser exactamente "{visibleAgentName} · {subtitle}"',
);

const visibleTenderName = identity.match(/tenders:\s*'([^']+)'/)?.[1];
const visibleSubtitle = adapter.match(/subtitle:\s*'([^']+)'/)?.[1];
const visibleTitle = adapter.match(/workbenchTitle:\s*'([^']+)'/)?.[1];
assert.equal(visibleTitle, 'Mesa de ayuda', 'el título visible de la mesa debe ser exactamente "Mesa de ayuda"');
assert.equal(
  `${visibleTenderName} · ${visibleSubtitle}`,
  'Vig-IA Licitaciones · Preparación de oferta',
  'el eyebrow visible debe ser exactamente "Vig-IA Licitaciones · Preparación de oferta"',
);
assert.doesNotMatch(adapter, /Copiloto para análisis de licitaciones/, 'el subtítulo anterior debe desaparecer');

// --- I4: reintentar es exclusivo del fallo terminal ---
assert.match(shell, /\{job\.status === 'failed' &&[\s\S]{0,240}?Reintentar<\/button>\}/,
  'el botón Reintentar debe renderizarse sólo cuando el trabajo está en fallo terminal');
assert.doesNotMatch(shell, /\{workspace\.jobs\.map\(job => <li[^>]*>\s*<span>\{job\.summary\}<\/span>\s*<button/,
  'el trabajo no debe ofrecer reintentar de forma incondicional');
assert.match(shell, /JOB_STATUS_LABELS\[job\.status\]/, 'el estado del trabajo debe ser visible para la encargada');
for (const status of ['queued', 'in_progress', 'completed', 'failed', 'obsolete']) {
  assert.match(shell, new RegExp(`${status}:\\s*'`), `el shell debe etiquetar el estado ${status}`);
}
// Un trabajo obsoleto es visible y terminal, pero jamás ofrece reintentar: en su lugar dice
// qué sí recupera el trabajo, porque el trabajo congelado no puede volverse a intentar.
assert.match(shell, /\{job\.status === 'obsolete' &&[\s\S]{0,320}?vuelva a pedirlo/,
  'el trabajo obsoleto debe explicar la recuperación real en vez de ofrecer reintento');
assert.doesNotMatch(shell, /job\.status === 'obsolete'[\s\S]{0,200}?onRetryJob/,
  'un trabajo obsoleto nunca puede cablear el reintento');

// --- I3: la revisión decidida deja de ofrecer botones y muestra su resultado ---
assert.match(shell, /proposal\.decided\s*\n?\s*\?/, 'una propuesta decidida debe ramificar hacia su estado, no hacia los controles');
assert.match(shell, /LEARNING_DECISION_LABELS\[proposal\.decision\]/, 'la decisión humana debe mostrarse');
assert.match(shell, /proposal\.decision === 'approved' && proposal\.approvedScope/, 'la aprobación debe mostrar su alcance aprobado');
assert.match(shell, /workspace\.activeLearningPolicies/, 'las políticas de aprendizaje activas deben renderizarse');
assert.match(shell, /Políticas de aprendizaje activas/);

// --- una fuente sólo se ofrece como enlace cuando su referencia es navegable ---
assert.match(shell, /function isNavigable\(sourceRef: string\)\s*\{\s*return \/\^https\?:\\\/\\\/\/i\.test\(sourceRef\);/,
  'sólo http/https deben considerarse navegables');
assert.match(shell, /isNavigable\(link\.sourceRef\)\s*\n?\s*\?\s*<a href=\{link\.sourceRef\}/,
  'la referencia interna de expediente no debe fingir un destino navegable');

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
assert.match(adapter, /visibleAgentName:\s*VIGIA_VISIBLE_NAMES\.tenders,/);
assert.match(adapter, /subtitle:\s*'Preparación de oferta',/);
assert.match(adapter, /workbenchTitle:\s*'Mesa de ayuda',/);
// El título deja de repetir la identidad del agente: ésa ya la dice el eyebrow, que sigue
// siendo "Vig-IA Licitaciones · Preparación de oferta" y se verifica arriba.
assert.doesNotMatch(adapter, /workbenchTitle:\s*'Mesa Vig-IA Licitaciones',/, 'el título anterior debe desaparecer');
assert.match(adapter, /visibleAuthorName:\s*message\.author_kind\s*===\s*'agent'[\s\S]*?VIGIA_DOSSIER_CONFIG\.visibleAgentName/);
assert.doesNotMatch(adapter, /visibleAuthorName:\s*message\.visible_agent_name,/);
assert.doesNotMatch(adapter, /visibleAgentName:\s*['"]Vig-IA['"],/);
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

// --- el bloqueo del primer mensaje desaparece: hilo y referencia vienen del servidor ---
assert.doesNotMatch(adapter, /if\s*\(!threadId\s*\|\|\s*!lastJob\)/, 'el primer mensaje no puede exigir un trabajo previo');
assert.doesNotMatch(adapter, /Aún no hay una versión de referencia para enviar mensajes/, 'el mensaje del bloqueo debe desaparecer');
assert.match(adapter, /thread_id:\s*data\.thread_id,/, 'el hilo debe ser el que devolvió el GET del servidor');
assert.match(adapter, /context_links:\s*data\.reference\.context_links,/, 'los vínculos deben ser los seguros del servidor, nunca inventados');
assert.match(
  adapter,
  /snapshot_id:\s*data\.reference\.snapshot_id,/,
  'el mensaje debe congelarse siempre sobre el snapshot canónico servido',
);
assert.doesNotMatch(adapter, /lastJob/, 'el snapshot del último trabajo no puede seguir siendo la semilla del mensaje');
assert.doesNotMatch(adapter, /context_links:\s*\[\],/, 'el adaptador no debe enviar mensajes sin contexto');

// --- I3/I4: el adaptador traslada estado y decisión sin ablandarlos ---
assert.match(adapter, /status:\s*job\.status,/, 'el estado del trabajo debe venir del servidor');
assert.match(adapter, /decided:\s*proposal\.review_status\s*!==\s*'pendiente',/, 'lo decidido lo dice el RPC, no el cliente');
assert.match(adapter, /approvedScope:\s*proposal\.approved_scope,/);
assert.match(adapter, /activeLearningPolicies:\s*data\.active_learning_policies\.map/);
assert.doesNotMatch(adapter, /decided:\s*false,/, 'no debe volver la afirmación de que nada está decidido');

// --- tender types: contrato de la Mesa alineado con lo que el servidor entrega ---
assert.match(tenderTypes, /export type TenderDossierWorkbenchJobStatus\s*=\s*'queued'\s*\|\s*'in_progress'\s*\|\s*'completed'\s*\|\s*'failed'\s*\|\s*'obsolete';/);
// El último evento observado viaja con el trabajo y es cerrado: es lo que el servidor mapea.
assert.match(tenderTypes, /export type TenderDossierWorkbenchJobEventType\s*=\s*'queued'\s*\|\s*'claimed'\s*\|\s*'released'\s*\|\s*'completed'\s*\|\s*'failed'\s*\|\s*'stale';/);
assert.match(tenderTypes, /latest_event_type:\s*TenderDossierWorkbenchJobEventType\s*\|\s*null;/);
assert.match(tenderTypes, /export type TenderDossierWorkbenchReference\s*=\s*\{/);
const workbenchTypeMatch = tenderTypes.match(/export type TenderDossierWorkbench\s*=\s*\{[^}]*\};/s);
assert.ok(workbenchTypeMatch, 'debe existir TenderDossierWorkbench');
assert.match(workbenchTypeMatch[0], /thread_id:\s*string;/, 'un GET habilitado siempre trae hilo');
assert.match(workbenchTypeMatch[0], /reference:\s*TenderDossierWorkbenchReference;/);
assert.match(workbenchTypeMatch[0], /active_learning_policies:\s*TenderDossierWorkbenchActiveLearningPolicy\[\];/);
assert.match(tenderTypes, /review_status:\s*TenderDossierWorkbenchLearningReviewStatus;/);
assert.match(tenderTypes, /approved_scope:\s*TenderDossierWorkbenchLearningScope\s*\|\s*null;/);

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
