import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { agt002DocumentRequestIntent, agt002ResolveRequestedDocument } from '../verticales/licitaciones/agt002-mesa-document-intent.js';

// F16, parte B (auditoría del piloto Fiscalía; Juan, 2026-11-04): «Nuestros documentos» en la pantalla por decidir.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const componentUrl = new URL('../src/tenders/workspace/TenderOwnDocuments.tsx', import.meta.url);

test('la sección existe y no ofrece aprobar antes del GO', () => {
  assert.ok(existsSync(componentUrl), 'falta TenderOwnDocuments.tsx');
  const component = read('../src/tenders/workspace/TenderOwnDocuments.tsx');
  assert.match(component, /<small>Nuestros documentos<\/small>/);
  assert.match(component, /canApprove=\{false\}/, 'aprobar sigue siendo del expediente, después del GO');
  assert.match(component, /loadTenderDossierWorkspace\(request, opportunityId\)/);
  assert.match(component, /createTenderDossierArtifact\(request, \{ opportunity_id: opportunityId/);
});

test('«+ Observaciones al pliego» usa la misma clave con que la Mesa crea el documento', () => {
  const component = read('../src/tenders/workspace/TenderOwnDocuments.tsx');
  const clave = /artifact_key: '([a-z_]+)'/.exec(component)?.[1];
  const mesa = agt002ResolveRequestedDocument(agt002DocumentRequestIntent('Redacta las observaciones al pliego'), []);
  assert.equal(clave, mesa.key);
  assert.equal(mesa.title, 'Observaciones al pliego');
  assert.match(component, /\+ Observaciones al pliego/);
});

test('la vista por decidir la muestra y se refresca cuando la Mesa termina', () => {
  const workspace = read('../src/tenders/workspace/TenderWorkspace.tsx');
  assert.match(workspace, /export function TenderDecideView\(\{ report, decisionPanel, reanalysis, channel, documents, clarify \}/);
  assert.match(workspace, /\{channel\}\s*\n\s*\{\/\* F16[^*]*\*\/\}\s*\n\s*\{documents\}/);
  const main = read('../src/main.tsx');
  assert.match(main, /<TenderVigiaChannel key=\{`tender-channel-\$\{o\.id\}`\} opportunityId=\{o\.id\} request=\{api\} onJobsCompleted=\{bumpTenderOwnDocuments\} \/>/);
  assert.match(main, /documents=\{!readOnly \? <TenderOwnDocuments key=\{`tender-own-documents-\$\{o\.id\}`\} opportunityId=\{o\.id\} request=\{api\} refreshKey=\{tenderOwnDocumentsVersion\} \/> : null\}/);
});
