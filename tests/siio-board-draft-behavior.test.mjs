import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { createBoardDraftGovernance, focusTrapTargetIndex } = await loadModule('../src/siio/boardDraftPolicy.ts');
const { SIIO_AGENT_CATALOG } = await loadModule('../src/siioAgents.ts');
const board = readFileSync(new URL('../src/siio/SiioBoardDraftAction.tsx', import.meta.url), 'utf8');

const governance = createBoardDraftGovernance(SIIO_AGENT_CATALOG, {
  sources: [
    { id: 'SRC-011', name: 'Finanzas' },
    { id: 'SRC-012', name: 'Nómina' },
    { id: 'SRC-999', name: 'Hoja no autorizada' },
  ],
  recommendations: [
    { id: 'eligible', title: 'Validar cifras', sourceIds: ['SRC-011'] },
    { id: 'mixed', title: 'Cruza fuentes', sourceIds: ['SRC-011', 'SRC-999'] },
    { id: 'missing', title: 'Sin respaldo', sourceIds: [] },
  ],
  trackingItems: [
    { id: 'tracked', title: 'Bloqueo con respaldo', sourceIds: ['SRC-012'] },
    { id: 'untracked', title: 'Decisión sin fuente', sourceIds: [] },
    { id: 'foreign', title: 'Riesgo de hoja externa', sourceIds: ['SRC-999'] },
  ],
});

assert.equal(governance.agent.id, 'AGT-001', 'Board governance must be derived from the catalog owner');
assert.deepEqual(governance.authorizedSourceIds, ['SRC-011', 'SRC-012', 'SRC-013']);
assert.deepEqual(governance.eligibleSources.map(source => source.id), ['SRC-011', 'SRC-012']);
assert.deepEqual(governance.excludedSources.map(source => source.id), ['SRC-999']);
assert.deepEqual(governance.eligibleRecommendations.map(item => item.id), ['eligible']);
assert.deepEqual(governance.excludedRecommendations.map(item => item.id).sort(), ['missing', 'mixed']);
assert.deepEqual(governance.eligibleTrackingItems.map(item => item.id), ['tracked']);
assert.deepEqual(governance.excludedTrackingItems.map(item => item.id).sort(), ['foreign', 'untracked']);
assert.match(governance.excludedRecommendations.find(item => item.id === 'mixed').exclusionReason, /SRC-999/);
assert.match(governance.excludedRecommendations.find(item => item.id === 'missing').exclusionReason, /Sin fuente vinculada/);

assert.equal(focusTrapTargetIndex(2, 0, true), 1, 'Shift+Tab from the initially focused Close button must wrap to the last control');
assert.equal(focusTrapTargetIndex(2, 1, false), 0, 'Tab from the last control must wrap to Close');
assert.equal(focusTrapTargetIndex(2, 0, false), null, 'Tab from the initial Close button must proceed inside the dialog');
assert.equal(focusTrapTargetIndex(2, 1, true), null, 'Shift+Tab from the last control must proceed inside the dialog');

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(board, /createPortal\([\s\S]*?document\.body\)/, 'The Board must be portalled outside #root so print can isolate it exactly');
assert.match(styles, /@media print\{[\s\S]*?body>\*\{display:none!important\}[\s\S]*?#root\{display:none!important\}/, 'Print must hide all non-Board application content inside #root');
assert.match(styles, /@media print\{[\s\S]*?body>\.siio-board-backdrop\{[^}]*display:block!important/, 'Print must retain only the portal Board backdrop outside #root');
assert.match(styles, /@media print\{[\s\S]*?body>\.siio-board-backdrop \.siio-board-dialog\{[^}]*display:block/, 'Print must retain the Board dialog');

console.log('SIIO Board draft behavior contract OK');
