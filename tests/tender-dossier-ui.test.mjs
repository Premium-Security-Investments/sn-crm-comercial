import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/tenders/components/TenderDossierWorkspacePanel.tsx');
const checklist = read('src/tenders/components/TenderDossierChecklist.tsx');
const artifacts = read('src/tenders/components/TenderDossierArtifacts.tsx');
const main = read('src/main.tsx');
const all = `${panel}\n${checklist}\n${artifacts}`;

assert.doesNotMatch(all, /chat|conversaci[oó]n|AGT-002/i, 'Lote 2 no expone chat ni nombre interno del agente');
assert.doesNotMatch(all, /window\.prompt/, 'las decisiones y evidencias deben usar controles inline auditables');

assert.match(panel, /loadTenderDossierWorkspace/);
assert.match(panel, /seedTenderDossier/);
assert.match(panel, /Listo para presentar|Faltan requisitos/);
assert.match(panel, /pending_required_items/);
assert.match(panel, /active_blockers/);
assert.match(panel, /unapproved_artifacts/);

assert.match(checklist, /appendTenderDossierItemAction/);
assert.match(checklist, /marked_not_applicable/);
assert.match(checklist, /assignee_id/);
assert.match(checklist, /target_date/);
assert.match(checklist, /evidence_attached/);
assert.match(checklist, /Justificaci[oó]n/);
assert.match(checklist, /profiles\.filter/);

assert.match(artifacts, /addTenderDossierArtifactVersion/);
assert.match(artifacts, /recordTenderDossierArtifactReview/);
assert.match(artifacts, /aprobado/);
assert.match(artifacts, /rechazado/);
assert.match(artifacts, /Comentario de revisi[oó]n/);

assert.match(all, /className="(?:panel|card|badge|timeline|tracking-row|document-analysis)/);
assert.match(main, /TenderDossierWorkspacePanel/);
assert.match(main, /profiles=\{data\.profiles\}/);
assert.match(main, /tender_offer_status/);

console.log('tender dossier UI static checks passed');
