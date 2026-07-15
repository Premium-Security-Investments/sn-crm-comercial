import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profiles = readFileSync(new URL('../src/tenders/TenderProfilesView.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/012_company_procurement_profile.sql', import.meta.url), 'utf8');

for (const marker of [
  'loadCompanyProfile', '/api/tender-company-profile', '/api/tender-company-profile-upload-url',
  '/api/tender-company-profile-process-upload', 'uploadToSignedUrl', '50 * 1024 * 1024',
  '50MB', 'Cargar RUP', 'Información empresa', 'Guardar información de empresa', 'Nombre legal',
  'NIT', 'RUP / códigos UNSPSC', 'Servicios autorizados', 'Licencia SuperVigilancia',
  'Capacidad financiera', 'Experiencia habilitante', 'Información útil para cruzar contra pliegos',
]) assert.ok(profiles.includes(marker), `TenderProfilesView missing marker: ${marker}`);
assert.doesNotMatch(main, /TenderCompanyProfilePanel/, 'La ficha corporativa debe vivir únicamente en la vista independiente.');
for (const forbidden of ['const procurementLegalFramework', 'Marco normativo Colombia para analizar requisitos habilitantes', 'Ley 80 de 1993']) assert.ok(!main.includes(forbidden));

for (const marker of ["app.get('/api/tender-company-profile'", "app.put('/api/tender-company-profile'", "app.post('/api/tender-company-profile-upload'", "app.post('/api/tender-company-profile-upload-url'", "app.post('/api/tender-company-profile-process-upload'", 'download(storagePath)', 'RUP_MAX_BYTES', 'updateBucket(tenderDocumentBucket', 'parseRupCompanyProfile', 'extractTextFromTenderFile', 'rup_import_notes', 'Texto extraído del RUP', 'source_document_name', 'psi_company_procurement_profile', 'saveTenderCompanyProfile', "mode: 'company_profile'", 'canViewTenders(currentProfile)']) assert.ok(server.includes(marker), `server/index.js missing marker: ${marker}`);
for (const marker of ['create table if not exists public.psi_company_procurement_profile', 'legal_name text', 'rup_unspsc_codes text', 'useful_company_info text', 'enable row level security']) assert.ok(migration.includes(marker), `migration missing marker: ${marker}`);

console.log('tender company profile editable isolation passed');
