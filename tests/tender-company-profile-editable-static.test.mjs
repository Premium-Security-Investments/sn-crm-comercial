import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const configuration = readFileSync(new URL('../src/tenders/TenderConfigurationView.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../src/tenders/tenderConfigurationActions.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/012_company_procurement_profile.sql', import.meta.url), 'utf8');
const custodyMigration = readFileSync(new URL('../supabase/migrations/029_agt002_charter_authority.sql', import.meta.url), 'utf8');

for (const marker of [
  'loadCompanyProfile', 'createTenderConfigurationActions', 'Actualizar RUP', 'Información empresa',
  'Guardar cambios', 'Nombre legal', 'NIT', 'RUP / códigos UNSPSC',
  'Servicios autorizados', 'Licencia SuperVigilancia', 'Capacidad financiera',
  'Experiencia habilitante', 'Información útil para cruzar contra pliegos',
]) assert.ok(configuration.includes(marker), `TenderConfigurationView missing marker: ${marker}`);
for (const marker of [
  '/api/tender-company-profile', '/api/tender-company-profile-upload-url',
  '/api/tender-company-profile-process-upload', 'uploadToSignedUrl', '50 * 1024 * 1024', '50MB',
]) assert.ok(actions.includes(marker), `tenderConfigurationActions missing marker: ${marker}`);
assert.doesNotMatch(main, /TenderCompanyProfilePanel/, 'La ficha corporativa debe vivir únicamente en la vista independiente.');
for (const forbidden of ['const procurementLegalFramework', 'Marco normativo Colombia para analizar requisitos habilitantes', 'Ley 80 de 1993']) assert.ok(!main.includes(forbidden));

for (const marker of ["app.get('/api/tender-company-profile'", "app.put('/api/tender-company-profile'", "app.post('/api/tender-company-profile-upload'", "app.post('/api/tender-company-profile-upload-url'", "app.post('/api/tender-company-profile-process-upload'", 'download(storagePath)', 'RUP_MAX_BYTES', 'updateBucket(tenderDocumentBucket', 'parseRupCompanyProfile', 'extractTextFromTenderFile', 'rup_import_notes', 'Texto extraído del RUP', 'source_document_name', 'psi_company_procurement_profile', 'saveTenderCompanyProfile', "database.rpc('psi_upsert_company_procurement_profile'", 'ACTIONS.LICITACIONES_CONFIGURE']) assert.ok(server.includes(marker), `server/index.js missing marker: ${marker}`);
for (const marker of ['create table if not exists public.psi_company_procurement_profile', 'legal_name text', 'rup_unspsc_codes text', 'useful_company_info text', 'enable row level security']) assert.ok(migration.includes(marker), `migration missing marker: ${marker}`);
for (const marker of ['create or replace function public.psi_upsert_company_procurement_profile', 'psi_profile_has_tender_custody(p_actor_id)', 'security definer']) assert.ok(custodyMigration.includes(marker), `custody migration missing marker: ${marker}`);

console.log('tender company profile editable isolation passed');
