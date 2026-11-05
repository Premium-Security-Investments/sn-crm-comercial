import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Juan, 2026-11-05, después de probar el botón con la carta de Supersalud: «creo que el botón debería estar frente a
// cada documento». El botón general subía de una vez todo borrador con Word, también los que nadie había revisado.
const source = readFileSync(new URL('../src/tenders/components/TenderDossierArtifacts.tsx', import.meta.url), 'utf8');

test('ya no hay un botón general que suba todo', () => {
  assert.doesNotMatch(source, /Subir a SharePoint \(\$\{toUpload\.length\}\)/);
  assert.doesNotMatch(source, /for \(const artifact of toUpload\)/);
});

test('cada documento con Word tiene su «Subir a SharePoint», y sube sólo su versión vigente', () => {
  assert.match(source, /\{files\.archivo && !files\.sharepointUrl && \(!copy \|\| copy\.status === 'fallido'\) && <button[^>]*onClick=\{\(\) => void uploadToSharepoint\(artifact\)\}>/);
  assert.match(source, /requestTenderDraftSharepointCopy\(request, \{ opportunity_id: opportunityId, version_id: artifact\.current_version\.id \}\)/);
});
