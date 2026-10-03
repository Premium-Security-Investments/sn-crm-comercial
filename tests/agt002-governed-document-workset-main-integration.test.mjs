// AGT-002 governed document workset — main.tsx transport integration.
// Pins the governed freeze endpoint, its closed request body, response-driven job polling, and
// the TenderAnalysisSection wiring, while proving the legacy direct-analyze path is gone.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');

// --- closed types are imported from ./tenders/types --------------------------------------------
assert.match(main, /import type \{[^}]*\bAgt002GovernedDocumentWorksetFreezeResponse\b[^}]*\} from '\.\/tenders\/types'/s);
assert.match(main, /import type \{[^}]*\bAgt002GovernedWorksetMemberInput\b[^}]*\} from '\.\/tenders\/types'/s);
assert.match(types, /export type Agt002GovernedWorksetMemberInput = \{/);
assert.match(types, /export type Agt002GovernedDocumentWorksetFreezeResponse = \{/);

// --- shared upload helper --------------------------------------------------------------------
const uploadStart = main.indexOf('const uploadTenderDocumentFiles = async');
assert.notEqual(uploadStart, -1, 'main.tsx debe definir uploadTenderDocumentFiles(selected: File[])');
assert.match(main.slice(uploadStart, uploadStart + 120), /uploadTenderDocumentFiles = async \(selected: File\[\]\) => \{/);
const uploadEnd = main.indexOf('\n  };', uploadStart);
const uploadBlock = main.slice(uploadStart, uploadEnd);
assert.match(uploadBlock, /selected\.slice\(0, 8\)/, 'debe preservar el máximo de 8 documentos');
assert.match(uploadBlock, /content_base64:\s*await fileToBase64\(file\)/, 'debe preservar la codificación base64');
assert.match(uploadBlock, /document_type:\s*inferTenderDocumentType\(file\.name\)/, 'debe preservar la inferencia del tipo documental');
assert.match(uploadBlock, /\/api\/tender-documents-upload/);
assert.match(uploadBlock, /setPayload\(data\)/, 'debe aplicar la lectura devuelta (payload/readback)');
assert.match(uploadBlock, /onNavigationStateChanged\?\.\(/, 'debe reportar estado/navegación');
assert.match(uploadBlock, /finally \{ setBusy\(false\); \}/);

const addFilesStart = main.indexOf('const addFiles = (event: React.ChangeEvent<HTMLInputElement>)');
assert.notEqual(addFilesStart, -1, 'el manejador del input existente debe delegar en uploadTenderDocumentFiles');
const addFilesEnd = main.indexOf('\n  };', addFilesStart);
const addFilesBlock = main.slice(addFilesStart, addFilesEnd);
assert.match(addFilesBlock, /void uploadTenderDocumentFiles\(selected\)/);
assert.doesNotMatch(addFilesBlock, /setSelection|selection\[/i, 'no debe existir auto-selección de documentos');

// --- governed freeze + analyze function ---------------------------------------------------------
assert.doesNotMatch(main, /\bfunction analyzeDocumentsWithAgt002\b|\bconst analyzeDocumentsWithAgt002\b/, 'la función legada analyzeDocumentsWithAgt002 debe haber sido removida');
assert.doesNotMatch(main, /analyzeDocumentsWithAgt002\(/, 'no debe quedar ninguna llamada directa a la función legada');

const freezeStart = main.indexOf('const freezeAndAnalyzeGovernedWorkset = async');
assert.notEqual(freezeStart, -1, 'main.tsx debe definir freezeAndAnalyzeGovernedWorkset(members)');
assert.match(main.slice(freezeStart, freezeStart + 160), /freezeAndAnalyzeGovernedWorkset = async \(members: Agt002GovernedWorksetMemberInput\[\]\) => \{/);
const freezeEnd = main.indexOf('\n  };', freezeStart);
const freezeBlock = main.slice(freezeStart, freezeEnd);

// exact endpoint and closed request body
assert.match(freezeBlock, /api<Agt002GovernedDocumentWorksetFreezeResponse>\(\s*'\/api\/tender-agt002-governed-document-worksets'/s);
assert.match(
  freezeBlock,
  /JSON\.stringify\(\{\s*opportunity_id:\s*opportunity\.id,\s*documents:\s*members\s*\}\)/s,
  'debe enviar exactamente { opportunity_id: opportunity.id, documents: members }',
);
assert.doesNotMatch(freezeBlock, /tender_id\s*:/, 'el cliente nunca debe enviar tender_id');
assert.doesNotMatch(freezeBlock, /content_hash|selection_hash\s*:|extraction_id|extracted_text/i, 'el cliente nunca debe enviar hashes ni identidades/texto de extracción');
assert.doesNotMatch(freezeBlock, /snapshot_id\s*:|context_version_id\s*:/, 'el cliente nunca debe enviar ids de snapshot/contexto');
assert.doesNotMatch(freezeBlock, /tender-documents-analyze-agent-preview/, 'no debe invocar el endpoint legado');

// confirms active opportunity before applying the response
assert.match(freezeBlock, /activeOpportunityRef\.current !== requestedOpportunityId/);

// reports created/existing and member_count, preserving human-review language
assert.match(freezeBlock, /data\.status === 'created'/);
assert.match(freezeBlock, /data\.member_count/);
assert.match(freezeBlock, /revisión humana sigue siendo obligatoria/);

// reuses busy/active-job guard and existing job polling on the response's reanalysis_job_id
assert.match(freezeBlock, /if \(activeReanalysisJobId\) return;/);
assert.match(freezeBlock, /setBusy\(true\);/);
assert.match(freezeBlock, /await pollAgt002Reanalysis\(data\.reanalysis_job_id, requestedOpportunityId\)/);

// errors set analysisStatus error; finally busy false
assert.match(freezeBlock, /catch \(err\) \{\s*setAnalysisStatus\(\{ message: err instanceof Error \? err\.message : String\(err\), tone: 'error' \}\);/s);
assert.match(freezeBlock, /finally \{ setBusy\(false\); \}/);

// never re-derives TenderDocumentsPayload from this POST's response
assert.doesNotMatch(freezeBlock, /setPayload\(data\)/, 'la respuesta del freeze gobernado no es un TenderDocumentsPayload y no debe alimentar setPayload');

// --- TenderAnalysisSection wiring: new governed props only, legacy prop gone -------------------
const sectionCallIndex = main.indexOf('<TenderAnalysisSection');
assert.notEqual(sectionCallIndex, -1);
const sectionCall = main.slice(sectionCallIndex, main.indexOf('/>', sectionCallIndex) + 2);
assert.match(sectionCall, /onFreezeGovernedWorkset=\{members => void freezeAndAnalyzeGovernedWorkset\(members\)\}/);
assert.match(sectionCall, /onUploadGovernedFiles=\{files => uploadTenderDocumentFiles\(files\)\}/);
assert.doesNotMatch(sectionCall, /onAnalyzePreview=/);

console.log('AGT-002 governed document workset main.tsx transport integration contract passed');
