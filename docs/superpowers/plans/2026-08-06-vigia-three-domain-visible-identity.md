# Three-Domain Vig‑IA Visible Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the three SIIO functional agents consistently as Vig‑IA Gerencial, Vig‑IA Licitaciones, and Vig‑IA Comercial while preserving AGT-001/002/003 as technical identities and keeping Agente IT outside SIIO.

**Architecture:** Add one UI-only identity map and consume it from the SIIO catalog and React surfaces. Keep persisted producers, database values, authorization, workbench contracts, and historical records unchanged; normalize any persisted bare display name only at the presentation adapter. Treat Agente Comercial PSI as a router, not as a fourth SIIO agent.

**Tech Stack:** React 19, TypeScript, Vite, Node.js static contract tests, esbuild catalog validation.

## Global Constraints

- SIIO has exactly three functional agents: `AGT-001`, `AGT-002`, and `AGT-003`.
- Their mandatory visible names are `Vig-IA Gerencial`, `Vig-IA Licitaciones`, and `Vig-IA Comercial`.
- Bare `Vig-IA` is forbidden in user-facing copy; only the three domain-qualified forms are allowed.
- `AGT-*` remains available in contracts, persistence, logs, events, audit payloads, and historical documentation, but not as a primary UI heading.
- Agente IT remains the master/template agent of Plataforma de Agentes and is not added to `SIIO_AGENT_CATALOG`.
- Agente Comercial PSI remains a router across domains and is not counted as an additional canonical agent.
- Radar → Oportunidad remains a human action before Vig‑IA Licitaciones analyzes a case.
- GO/NO-GO, approval, signature, sending, and submission remain human decisions/actions.
- Vig‑IA Comercial stays read-only and cannot modify opportunities, owners, or communications.
- No database migration, producer rename, historical rewrite, external send, push, deploy, scheduler activation, or production data change.
- Do not modify `CURRENT.md`.
- Run Node checks sequentially because the host is memory constrained.

---

## File Structure

**Create**

- `src/vigia/agentIdentity.ts` — canonical UI-only labels for the three SIIO agents and the cross-domain router.
- `tests/vigia-visible-identity-static.test.mjs` — static guard against bare or crossed visible identities.

**Modify**

- `src/siioAgents.ts` — consume visible labels and correct purpose/channel/authority copy without changing IDs.
- `src/siio/SiioAgentsView.tsx` — render human labels instead of technical IDs/status/front codes.
- `tests/siio-agent-catalog-static.test.mjs` — lock the three IDs, names, order, and Agente IT boundary.
- `scripts/check_siio_agent_catalog.mjs` — runtime-check the same canonical catalog contract.
- `tests/siio-manager-navigation-static.test.mjs` — lock the presentation behavior of the Agents view.
- `src/tenders/components/TenderDossierVigiaWorkbench.tsx` — qualify the Workbench and normalize persisted author labels at render time.
- `tests/agt002-workbench-ui.test.mjs` — lock the Licitaciones display name and ensure AGT-002 is not exposed.
- `src/vigia/VigiaCommercial.tsx` — qualify commercial UI copy.
- `src/vigia/VigiaOpportunityCopilot.tsx` — qualify commercial copilot/status copy.
- `tests/vigia-ui-static.test.mjs` — lock the commercial display name and prohibit AGT-003 exposure.
- `src/main.tsx` — qualify tender/commercial messages and rename the cross-domain report router to Agente Comercial PSI.
- `docs/superpowers/specs/2026-08-06-vigia-domain-qualified-visible-identity-design.md` — only if implementation evidence reveals a factual mismatch; otherwise leave unchanged.

**Explicitly unchanged**

- `agt002-workbench-contract.js` — persisted/internal visible-name compatibility remains unchanged; presentation qualification occurs in the adapter.
- Database migrations and seeded historical rows.
- Producer IDs, `analysis_engine`, `agent_id`, audit fields, permissions, and scheduler configuration.

---

### Task 1: Canonical UI Identity Map and Catalog Contract

**Files:**
- Create: `src/vigia/agentIdentity.ts`
- Create: `tests/vigia-visible-identity-static.test.mjs`
- Modify: `src/siioAgents.ts:1-73`
- Modify: `tests/siio-agent-catalog-static.test.mjs:4-17`
- Modify: `scripts/check_siio_agent_catalog.mjs:13-33`

**Interfaces:**
- Produces: `VIGIA_VISIBLE_NAMES` with keys `manager`, `tenders`, and `commercial`.
- Produces: `PSI_AGENT_ROUTER_NAME` with value `Agente Comercial PSI`.
- Consumes: no application API or persisted data.

- [ ] **Step 1: Write the failing identity contract test**

Create `tests/vigia-visible-identity-static.test.mjs` with:

```js
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

console.log('Vig-IA visible identity contract OK');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node tests/vigia-visible-identity-static.test.mjs
```

Expected: FAIL on the missing `manager` label because `src/vigia/agentIdentity.ts` does not exist.

- [ ] **Step 3: Add the minimal UI identity map**

Create `src/vigia/agentIdentity.ts` with:

```ts
export const VIGIA_VISIBLE_NAMES = Object.freeze({
  manager: 'Vig-IA Gerencial',
  tenders: 'Vig-IA Licitaciones',
  commercial: 'Vig-IA Comercial',
} as const);

export const PSI_AGENT_ROUTER_NAME = 'Agente Comercial PSI' as const;
```

- [ ] **Step 4: Correct the catalog without changing technical IDs**

At the top of `src/siioAgents.ts`, import the map:

```ts
import { VIGIA_VISIBLE_NAMES } from './vigia/agentIdentity';
```

Use these exact visible names:

```ts
id: 'AGT-001',
name: VIGIA_VISIBLE_NAMES.manager,
```

```ts
id: 'AGT-002',
name: VIGIA_VISIBLE_NAMES.tenders,
```

```ts
id: 'AGT-003',
name: VIGIA_VISIBLE_NAMES.commercial,
```

Replace the AGT-002 semantic fields with:

```ts
purpose: 'Analizar documentos, organizar evidencia, identificar brechas y preparar insumos de una oportunidad pública convertida manualmente desde el Radar.',
permitted_actions: ['Analizar documentos', 'Organizar requisitos y brechas', 'Preparar insumos y matriz para decisión humana GO/NO GO', 'Generar borradores y checklist sujetos a revisión humana'],
forbidden_actions: ['Convertir procesos del Radar en oportunidades', 'Analizar indiscriminadamente el Radar', 'Decidir, aprobar o registrar GO/NO GO', 'Presentar ofertas', 'Descartar procesos sin confirmación humana', 'Firmar documentos'],
channel: 'Oportunidades / Mesa Vig-IA Licitaciones',
```

Do not alter `status`, `owner_role`, `authorized_fronts`, `authorized_sources`, `human_review_required`, `can_write_production`, or the three IDs.

- [ ] **Step 5: Strengthen static and runtime catalog assertions**

Add after the three ID assertions in `tests/siio-agent-catalog-static.test.mjs`:

```js
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.manager/);
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.tenders/);
assert.match(catalog, /name: VIGIA_VISIBLE_NAMES\.commercial/);
assert.match(catalog, /convertida manualmente desde el Radar/);
assert.match(catalog, /decisión humana GO\/NO GO/);
assert.doesNotMatch(catalog, /Priorizar procesos públicos|Preparar matriz GO\/NO GO'/);
assert.doesNotMatch(catalog, /Agente IT/);
```

Add after catalog length/order checks in `scripts/check_siio_agent_catalog.mjs`:

```js
assert.deepEqual(
  SIIO_AGENT_CATALOG.map(agent => agent.name),
  ['Vig-IA Gerencial', 'Vig-IA Licitaciones', 'Vig-IA Comercial'],
);
assert.equal(SIIO_AGENT_CATALOG.some(agent => /Agente IT/i.test(agent.name)), false);
const tenders = SIIO_AGENT_CATALOG.find(agent => agent.id === 'AGT-002');
assert.match(tenders.purpose, /convertida manualmente desde el Radar/);
assert.ok(tenders.permitted_actions.some(action => /decisión humana GO\/NO GO/.test(action)));
assert.ok(tenders.forbidden_actions.some(action => /Convertir procesos del Radar/.test(action)));
```

- [ ] **Step 6: Run focused checks and verify GREEN**

Run sequentially:

```bash
node tests/vigia-visible-identity-static.test.mjs
node tests/siio-agent-catalog-static.test.mjs
npm run check:siio-agents
```

Expected: all three commands exit `0` and print their `OK` messages.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/vigia/agentIdentity.ts src/siioAgents.ts tests/vigia-visible-identity-static.test.mjs tests/siio-agent-catalog-static.test.mjs scripts/check_siio_agent_catalog.mjs
git commit -m "fix(siio): define domain-qualified agent identities"
```

---

### Task 2: Human-Readable SIIO Agent Catalog

**Files:**
- Modify: `src/siio/SiioAgentsView.tsx:1-57`
- Modify: `tests/siio-manager-navigation-static.test.mjs:31-49`

**Interfaces:**
- Consumes: `SIIO_AGENT_CATALOG` and `SiioAgentStatus`.
- Produces: visible status/front labels inside the read-only Agents view.
- Preserves: filters continue to use raw `status` and `owner_role` values.

- [ ] **Step 1: Write failing presentation assertions**

Add to `tests/siio-manager-navigation-static.test.mjs` after `assert.match(agents, /SIIO_AGENT_CATALOG/)`:

```js
assert.match(agents, /const STATUS_LABELS/);
assert.match(agents, /piloto: 'Piloto controlado'/);
assert.match(agents, /operativo_parcial: 'Operación parcial'/);
assert.match(agents, /const FRONT_LABELS/);
assert.match(agents, /F1: 'Comercial'/);
assert.match(agents, /F2: 'Finanzas'/);
assert.doesNotMatch(agents, />\{agent\.id\}</);
assert.match(agents, /Agente funcional de SIIO/);
assert.match(agents, /STATUS_LABELS\[agent\.status\]/);
assert.match(agents, /agentStatusLabel\(status\)/);
assert.match(agents, /agent\.authorized_fronts\.map\(front => FRONT_LABELS\[front\]/);
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node tests/siio-manager-navigation-static.test.mjs
```

Expected: FAIL because raw `agent.id`, raw status, and raw front codes are still rendered.

- [ ] **Step 3: Add presentation-only labels**

Change the catalog import and add maps in `src/siio/SiioAgentsView.tsx`:

```ts
import { SIIO_AGENT_CATALOG } from '../siioAgents';
import type { SiioAgentStatus } from '../siioAgents';

const STATUS_LABELS: Record<SiioAgentStatus, string> = {
  piloto: 'Piloto controlado',
  operativo_parcial: 'Operación parcial',
  diseño: 'En diseño',
};

const FRONT_LABELS: Record<string, string> = {
  F1: 'Comercial',
  F2: 'Finanzas',
  F3B: 'Nómina agregada',
  F4: 'Fuentes e inteligencia',
  F5: 'Reglas y recomendaciones',
};

const agentStatusLabel = (status: string) => STATUS_LABELS[status as SiioAgentStatus] ?? status;
```

Render filter options with human text but preserve raw values:

```tsx
{statuses.map(status => <option key={status} value={status}>{agentStatusLabel(status)}</option>)}
```

Replace the card header and technical fields with:

```tsx
<header>
  <div><span className="eyebrow">Agente funcional de SIIO</span><h3>{agent.name}</h3></div>
  <Badge tone={agent.status === 'piloto' ? 'amber' : agent.status === 'operativo_parcial' ? 'green' : 'purple'}>
    {STATUS_LABELS[agent.status]}
  </Badge>
</header>
```

```tsx
<div><strong>Estado</strong><span>{STATUS_LABELS[agent.status]}</span></div>
<div><strong>Frentes autorizados</strong><span>{agent.authorized_fronts.map(front => FRONT_LABELS[front] ?? front).join(', ')}</span></div>
```

Do not add buttons, API calls, permission changes, or execution controls.

- [ ] **Step 4: Run catalog UI checks and verify GREEN**

```bash
node tests/siio-manager-navigation-static.test.mjs
node tests/siio-agent-catalog-static.test.mjs
npm run check:siio-agents
```

Expected: all commands exit `0`; the Agents view still exposes exactly two filters and remains read-only.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/siio/SiioAgentsView.tsx tests/siio-manager-navigation-static.test.mjs
git commit -m "fix(siio): present governed agents with human labels"
```

---

### Task 3: Vig‑IA Licitaciones Presentation Boundary

**Files:**
- Modify: `src/tenders/components/TenderDossierVigiaWorkbench.tsx:7-29`
- Modify: `tests/agt002-workbench-ui.test.mjs:64-73`
- Modify: `src/main.tsx` only at user-facing tender analysis/tracking strings found by the identity guard
- Test: `tests/vigia-visible-identity-static.test.mjs`

**Interfaces:**
- Consumes: `VIGIA_VISIBLE_NAMES.tenders`.
- Produces: `AgentWorkbenchConfig.visibleAgentName = 'Vig-IA Licitaciones'`.
- Preserves: persisted `message.visible_agent_name`, `AGT-002`, capability ID, endpoints, and workbench contract.

- [ ] **Step 1: Make the Workbench test fail on the required qualified name**

Replace the current adapter name assertion in `tests/agt002-workbench-ui.test.mjs` and add the presentation normalization assertion:

```js
assert.match(adapter, /visibleAgentName:\s*VIGIA_VISIBLE_NAMES\.tenders,/);
assert.match(adapter, /visibleAuthorName:\s*VIGIA_DOSSIER_CONFIG\.visibleAgentName,/);
assert.doesNotMatch(adapter, /visibleAuthorName:\s*message\.visible_agent_name/);
assert.doesNotMatch(adapter, /visibleAgentName:\s*['"]Vig-IA['"],/);
```

Extend `tests/vigia-visible-identity-static.test.mjs`:

```js
const tenderWorkbench = readFileSync(new URL('../src/tenders/components/TenderDossierVigiaWorkbench.tsx', import.meta.url), 'utf8');
assert.match(tenderWorkbench, /VIGIA_VISIBLE_NAMES\.tenders/);
assert.doesNotMatch(tenderWorkbench, /['"]Vig-IA['"]/);
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node tests/agt002-workbench-ui.test.mjs
node tests/vigia-visible-identity-static.test.mjs
```

Expected: both fail because the adapter still uses bare `Vig-IA` and persisted author labels directly.

- [ ] **Step 3: Qualify the Workbench without changing persistence**

Import the identity map:

```ts
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
```

Update the config:

```ts
const VIGIA_DOSSIER_CONFIG = Object.freeze({
  visibleAgentName: VIGIA_VISIBLE_NAMES.tenders,
  subtitle: 'Copiloto para análisis de licitaciones',
  contextLabel: 'Expediente activo',
  capabilities: ['message', 'attach', 'draft', 'review', 'learning'],
  humanReviewRequired: true,
} as const);
```

Normalize only the rendered author label:

```ts
messages: data.messages.map(message => ({
  id: message.id,
  authorKind: message.author_kind,
  visibleAuthorName: message.author_kind === 'agent'
    ? VIGIA_DOSSIER_CONFIG.visibleAgentName
    : message.visible_agent_name,
  content: message.content,
  createdAt: message.created_at,
})),
```

This intentionally leaves `agt002-workbench-contract.js` and stored rows unchanged.

- [ ] **Step 4: Qualify tender-facing strings in `src/main.tsx`**

Import `VIGIA_VISIBLE_NAMES` once near the other application imports. Replace user-visible tender analysis/status/actor strings so each uses `VIGIA_VISIBLE_NAMES.tenders`, for example:

```ts
setAnalysisStatus({ message: `Analizando con ${VIGIA_VISIBLE_NAMES.tenders}; la revisión humana sigue siendo obligatoria…`, tone: 'status' });
```

```ts
message: data.analysis_engine?.fallback
  ? `${VIGIA_VISIBLE_NAMES.tenders} no estuvo disponible; se aplicó fallback seguro por reglas.`
  : `${VIGIA_VISIBLE_NAMES.tenders} completó el análisis. La recomendación requiere revisión humana.`,
```

```ts
const actorLabel = (event: TenderTrackingEvent) => event.actor_kind === 'system'
  ? 'Sistema'
  : profiles.find(profile => profile.id === event.created_by)?.full_name
    || (event.actor_kind === 'agent' ? VIGIA_VISIBLE_NAMES.tenders : 'Usuario registrado');
```

Replace tender-facing labels such as “Auditoría técnica de Vig-IA” with “Auditoría técnica de Vig-IA Licitaciones”. Do not rename `agent_id`, producer values, capabilities, endpoints, or events.

- [ ] **Step 5: Run Licitaciones checks and verify GREEN**

```bash
node tests/agt002-workbench-ui.test.mjs
node tests/vigia-visible-identity-static.test.mjs
node tests/agt002-workbench-contract.test.mjs
```

Expected: all commands exit `0`; the contract test proves persisted/internal compatibility remains intact.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/tenders/components/TenderDossierVigiaWorkbench.tsx src/main.tsx tests/agt002-workbench-ui.test.mjs tests/vigia-visible-identity-static.test.mjs
git commit -m "fix(licitaciones): qualify Vig-IA presentation"
```

---

### Task 4: Vig‑IA Comercial Presentation Boundary

**Files:**
- Modify: `src/vigia/VigiaCommercial.tsx:158-206`
- Modify: `src/vigia/VigiaOpportunityCopilot.tsx:64-81`
- Modify: `tests/vigia-ui-static.test.mjs:10-37`
- Modify: `tests/vigia-visible-identity-static.test.mjs`
- Modify: `src/main.tsx` at commercial-only messages and invalid-link copy

**Interfaces:**
- Consumes: `VIGIA_VISIBLE_NAMES.commercial`.
- Produces: domain-qualified commercial headings, statuses, summaries, and errors.
- Preserves: read-only priority logic, feedback behavior, routes, filters, scores, and CRM records.

- [ ] **Step 1: Write failing commercial copy assertions**

Update the marker list in `tests/vigia-ui-static.test.mjs`:

```js
const markers = [
  'function VigiaCommercial({ canOpenDashboard, canOpenOpportunity }',
  "api<VigiaPayload>('/api/vigia/priorities')",
  'Prioridades Comerciales',
  'Prioridades explicables del CRM',
  'CRM-F1',
  'Requiere validación humana; no ejecuta acciones.',
  'Ver en Dashboard',
  'Ver oportunidad',
  'Marcar revisada',
  'Útil',
  'No útil',
  'vigia-priority-card',
  'vigia-score',
  'vigia-source-status',
];
```

Add:

```js
assert.ok(component.includes('VIGIA_VISIBLE_NAMES.commercial'));
assert.match(component, /Impulsado por \{VIGIA_VISIBLE_NAMES\.commercial\}/);
assert.doesNotMatch(component, /Vig-IA(?! Comercial)/);
assert.doesNotMatch(component, /AGT-003/);
```

Extend `tests/vigia-visible-identity-static.test.mjs`:

```js
const commercial = readFileSync(new URL('../src/vigia/VigiaCommercial.tsx', import.meta.url), 'utf8');
const opportunityCopilot = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
assert.match(commercial, /VIGIA_VISIBLE_NAMES\.commercial/);
assert.match(opportunityCopilot, /VIGIA_VISIBLE_NAMES\.commercial/);
assert.doesNotMatch(`${commercial}\n${opportunityCopilot}`, /Vig-IA(?! Comercial)/);
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node tests/vigia-ui-static.test.mjs
node tests/vigia-visible-identity-static.test.mjs
```

Expected: FAIL because the component does not yet consume `VIGIA_VISIBLE_NAMES.commercial` and still contains bare commercial labels.

- [ ] **Step 3: Qualify `VigiaCommercial.tsx`**

Import the map:

```ts
import { VIGIA_VISIBLE_NAMES } from './agentIdentity';
```

Use the constant for visible copy:

```tsx
<span className="eyebrow">Impulsado por {VIGIA_VISIBLE_NAMES.commercial}</span>
```

```tsx
<div className="vigia-source-status">
  <small>Motor de priorización</small>
  <strong>{VIGIA_VISIBLE_NAMES.commercial}</strong>
  <span>Fuente de datos: {payload?.source.id || 'CRM-F1'}</span>
  <span>Corte: {displayDate(payload?.source.as_of || null)}</span>
  <span>Política: {payload?.policy.version || 'gate0-v1.0'} · Solo lectura</span>
</div>
```

Replace “Sin movimiento según Vig-IA” with:

```tsx
<span>Sin movimiento según {VIGIA_VISIBLE_NAMES.commercial}</span>
```

Replace “la misma lectura de Vig-IA” with “la misma lectura de Vig-IA Comercial”. Do not change the score or data-processing logic.

- [ ] **Step 4: Qualify `VigiaOpportunityCopilot.tsx`**

Import `VIGIA_VISIBLE_NAMES` and use it in the four visible locations:

```tsx
<span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial} · copiloto comercial</span>
```

```tsx
{state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
```

```tsx
<summary><strong>Resumen de {VIGIA_VISIBLE_NAMES.commercial}</strong><span>{brief.summary}</span></summary>
```

Keep the human-review warning and local-only draft behavior unchanged.

- [ ] **Step 5: Qualify commercial-only `src/main.tsx` strings**

Use `VIGIA_VISIBLE_NAMES.commercial` for invalid commercial dashboard links and commercial search summaries. For example:

```tsx
{initialVigiaFilters.invalid && <div className="error">Enlace de {VIGIA_VISIBLE_NAMES.commercial} inválido o manipulado. Se aplicó un alcance vacío.</div>}
```

Do not apply the commercial label to Radar, tender analysis, or cross-domain router copy.

- [ ] **Step 6: Run commercial checks and verify GREEN**

```bash
node tests/vigia-ui-static.test.mjs
node tests/vigia-visible-identity-static.test.mjs
```

Expected: both commands exit `0`; `AGT-003` remains absent from commercial UI and all business logic is unchanged.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/vigia/VigiaCommercial.tsx src/vigia/VigiaOpportunityCopilot.tsx src/main.tsx tests/vigia-ui-static.test.mjs tests/vigia-visible-identity-static.test.mjs
git commit -m "fix(comercial): qualify Vig-IA presentation"
```

---

### Task 5: Router Identity, Global Guard, Regression, and Visual QA

**Files:**
- Modify: `src/main.tsx:2279-2517`
- Modify: `tests/vigia-visible-identity-static.test.mjs`
- Modify: current authoritative documentation only if a live reference still states a conflicting visible name

**Interfaces:**
- Consumes: `PSI_AGENT_ROUTER_NAME`, `VIGIA_VISIBLE_NAMES.tenders`, and `VIGIA_VISIBLE_NAMES.commercial`.
- Produces: an explicitly named cross-domain router that delegates by query domain.
- Preserves: report interpretation, filtering, sorting, permissions, and navigation.

- [ ] **Step 1: Add failing router and global-copy assertions**

Append to `tests/vigia-visible-identity-static.test.mjs`:

```js
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const userFacingSources = [
  catalog,
  tenderWorkbench,
  commercial,
  opportunityCopilot,
  main,
].join('\n');

assert.match(main, /PSI_AGENT_ROUTER_NAME/);
assert.match(main, /VIGIA_VISIBLE_NAMES\.tenders/);
assert.match(main, /VIGIA_VISIBLE_NAMES\.commercial/);
assert.doesNotMatch(userFacingSources, /Vig-IA(?! (?:Gerencial|Licitaciones|Comercial))/);
assert.doesNotMatch(main, />AGT-00[123]</);
```

If the broad guard identifies a technical literal inside `main.tsx`, keep the technical identifier but move it out of visible JSX/message copy and narrow the assertion to rendered strings only. Do not delete audit identifiers.

- [ ] **Step 2: Run the global guard and verify RED**

```bash
node tests/vigia-visible-identity-static.test.mjs
```

Expected: FAIL on current cross-domain “Vig-IA” labels in `CentinelAssistant`.

- [ ] **Step 3: Rename the cross-domain report surface to the router identity**

Import and use `PSI_AGENT_ROUTER_NAME`. Replace the router hero/result copy with:

```tsx
<section className="centinel-topline">
  <h2>{PSI_AGENT_ROUTER_NAME} — reportes gerenciales asistidos</h2>
  <p>Módulo en evolución: organiza reportes seguros del CRM y dirige cada consulta al dominio correspondiente.</p>
</section>
```

```tsx
<div>
  <span className="eyebrow">{PSI_AGENT_ROUTER_NAME}</span>
  <h2>Selecciona un reporte gerencial</h2>
  <p>Usa los accesos rápidos para revisar pipeline, alertas, metas y licitaciones con una lectura ejecutiva. El router trabaja en modo solo lectura.</p>
</div>
```

```tsx
<span className="eyebrow">Resultado de {PSI_AGENT_ROUTER_NAME}</span>
```

Use `VIGIA_VISIBLE_NAMES.tenders` in tender loading/unavailable messages and `VIGIA_VISIBLE_NAMES.commercial` in commercial search summaries. The router does not become a fourth catalog entry.

- [ ] **Step 4: Prove the global identity guard is GREEN**

```bash
node tests/vigia-visible-identity-static.test.mjs
```

Expected: exit `0` and `Vig-IA visible identity contract OK`.

- [ ] **Step 5: Run the complete sequential regression gate**

Run each command separately and stop at the first failure:

```bash
node tests/siio-agent-catalog-static.test.mjs
node scripts/check_siio_agent_catalog.mjs
node tests/siio-manager-navigation-static.test.mjs
node tests/agt002-workbench-ui.test.mjs
node tests/agt002-workbench-contract.test.mjs
node tests/vigia-ui-static.test.mjs
node tests/vigia-visible-identity-static.test.mjs
npm run check:siio-integration
npm run check:backend-parity
npm run build
git diff --check
```

Expected: every command exits `0`; build completes with no TypeScript or Vite error; `git diff --check` prints nothing.

- [ ] **Step 6: Perform one independent review of the whole implementation**

Review the complete diff once against these exact questions:

1. Are all three visible names domain-qualified?
2. Do AGT-001/002/003 remain unchanged in technical contracts and order?
3. Is Agente IT absent from `SIIO_AGENT_CATALOG`?
4. Is Agente Comercial PSI clearly a router rather than a canonical agent?
5. Does Licitaciones still require a human-created Oportunidad before analysis?
6. Is GO/NO-GO still human-only?
7. Is Comercial still read-only?
8. Are persisted workbench names normalized only for rendering?
9. Did `CURRENT.md` remain untouched by this implementation?

Resolve only Critical, Important, or regression findings before the final gate.

- [ ] **Step 7: Run local visual QA at desktop and mobile widths**

Start the local app with the project’s existing safe local environment:

```bash
npm run dev
```

Verify authenticated local/preview surfaces without production mutation:

- SIIO → Agentes: three cards read **Vig-IA Gerencial**, **Vig-IA Licitaciones**, **Vig-IA Comercial**; no AGT ID is a heading; status/front labels are human-readable.
- SIIO Gerencial: AGT-001-facing identity reads **Vig-IA Gerencial**.
- Oportunidades → Mesa: header, agent messages, footer, errors, and fallback copy read **Vig-IA Licitaciones**.
- Prioridades Comerciales and opportunity copilot: all labels read **Vig-IA Comercial**.
- Cross-domain report router: reads **Agente Comercial PSI** and never appears in the SIIO agent catalog.
- Mobile width ≤760 px: names do not clip and cards/workbench remain usable.
- No screen offers automatic GO/NO-GO, send, signature, submission, owner change, or production write.

Record screenshots and the tested route/role in a local verification note. Do not deploy.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/main.tsx tests/vigia-visible-identity-static.test.mjs docs/verification
git commit -m "fix(siio): separate router and agent identities"
```

- [ ] **Step 9: Stop at the human gate**

Report:

- commits created;
- exact tests/build commands and results;
- visual QA evidence;
- remaining risks;
- confirmation that no push/deploy/migration occurred.

Wait for Juan’s explicit authorization before push, integration, preview deployment, production deployment, scheduler change, or data operation.
