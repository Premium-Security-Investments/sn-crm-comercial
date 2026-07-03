import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/012_company_procurement_profile.sql', import.meta.url), 'utf8');

const mainMarkers = [
  'TenderCompanyProfilePanel',
  "api<TenderCompanyProfile>('/api/tender-company-profile')",
  "api<TenderCompanyProfile>('/api/tender-company-profile', { method: 'PUT'",
  "api<TenderCompanyProfile>('/api/tender-company-profile-upload'",
  'Cargar RUP actualizado',
  'Abrir / editar ficha de empresa',
  '<details className="company-profile-details"',
  'Información real de la empresa',
  'Guardar información de empresa',
  'Nombre legal',
  'NIT',
  'RUP / códigos UNSPSC',
  'Servicios autorizados',
  'Licencia SuperVigilancia',
  'Capacidad financiera',
  'Experiencia habilitante',
  'Información útil para cruzar contra pliegos',
];
for (const marker of mainMarkers) assert.ok(main.includes(marker), `main.tsx missing marker: ${marker}`);

assert.ok(!main.includes('const procurementLegalFramework'), 'No debe quedar sección de cultura general legal estática.');
assert.ok(!main.includes('Marco normativo Colombia para analizar requisitos habilitantes'), 'No debe quedar marco normativo decorativo.');
assert.ok(!main.includes('Ley 80 de 1993'), 'No debe listar leyes como contenido principal de la sección.');

const serverMarkers = [
  "app.get('/api/tender-company-profile'",
  "app.put('/api/tender-company-profile'",
  "app.post('/api/tender-company-profile-upload'",
  'parseRupCompanyProfile',
  'extractTextFromTenderFile',
  'rup_import_notes',
  'Texto extraído del RUP',
  'source_document_name',
  'psi_company_procurement_profile',
  'saveTenderCompanyProfile',
  "mode: 'company_profile'",
  'canViewTenders(currentProfile)',
];
for (const marker of serverMarkers) assert.ok(server.includes(marker), `server/index.js missing marker: ${marker}`);

const migrationMarkers = [
  'create table if not exists public.psi_company_procurement_profile',
  'legal_name text',
  'rup_unspsc_codes text',
  'useful_company_info text',
  'enable row level security',
];
for (const marker of migrationMarkers) assert.ok(migration.includes(marker), `migration missing marker: ${marker}`);

console.log('tender company profile editable static ok');
