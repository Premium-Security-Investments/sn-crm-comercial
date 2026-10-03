// AGT-002 governed document workset — TenderAnalysisSection wiring contract.
// Pins how TenderAnalysisSection.tsx mounts the governed builder (documents/busy/canRun plus the
// two parent-owned callbacks) and that the legacy direct-analyze path is gone from this component.
// main.tsx wiring is owned by tests/agt002-governed-document-workset-main-integration.test.mjs.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const analysisSection = read('src/tenders/components/TenderAnalysisSection.tsx');

// --- TenderAnalysisSection imports and mounts TenderGovernedDocumentWorkset --------------------
assert.match(analysisSection, /import \{ TenderGovernedDocumentWorkset \} from '\.\/TenderGovernedDocumentWorkset'/);
const mountIndex = analysisSection.indexOf('<TenderGovernedDocumentWorkset');
assert.notEqual(mountIndex, -1, 'TenderAnalysisSection debe montar TenderGovernedDocumentWorkset');
const mountCall = analysisSection.slice(mountIndex, analysisSection.indexOf('/>', mountIndex) + 2);
assert.match(mountCall, /documents=\{documents\}/);
assert.match(mountCall, /busy=\{busy\}/);
assert.match(mountCall, /canRun=\{canRunPreview && processingPresentation\.primaryAction !== 'disabled'\}/);
assert.match(mountCall, /onFreeze=\{onFreezeGovernedWorkset\}/);
assert.match(mountCall, /onUploadFiles=\{onUploadGovernedFiles\}/);

// --- props are typed with the closed member/file types ------------------------------------------
assert.match(
  analysisSection,
  /onFreezeGovernedWorkset:\s*\(members: Agt002GovernedWorksetMemberInput\[\]\) => void \| Promise<void>/,
  'la prop de congelamiento debe estar tipada con el tipo cerrado de miembro',
);
assert.match(
  analysisSection,
  /onUploadGovernedFiles:\s*\(files: File\[\]\) => void \| Promise<void>/,
  'la prop de carga debe estar tipada con File[]',
);

// --- no legacy direct-analyze wiring remains in this component ----------------------------------
assert.doesNotMatch(analysisSection, /onAnalyzePreview/, 'el componente no debe referenciar el onAnalyzePreview legado');
assert.doesNotMatch(analysisSection, /tender-analysis-primary-cta/, 'la CTA directa de análisis legada no debe existir en este componente');

console.log('AGT-002 governed document workset TenderAnalysisSection wiring contract passed');
