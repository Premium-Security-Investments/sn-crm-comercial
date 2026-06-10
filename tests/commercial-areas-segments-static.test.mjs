import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync('src/main.tsx', 'utf8');
const api = readFileSync('api/[...path].js', 'utf8');
const server = readFileSync('server/index.js', 'utf8');
const migration = readFileSync('supabase/migrations/006_commercial_areas_customer_segments.sql', 'utf8');

for (const code of [src, api, server, migration]) {
  assert(code.includes('commercial_area'), 'Debe existir campo commercial_area para áreas comerciales.');
  assert(code.includes('customer_segment'), 'Debe existir campo customer_segment para Cliente Nuevo / Cliente Actual.');
  assert(code.includes('can_edit_customer_segment'), 'Debe existir permiso can_edit_customer_segment para comerciales.');
}

assert(!src.includes('Reglas comerciales por área'), 'Dashboard gerencial no debe mostrar reglas comerciales por área.');
assert(!src.includes('Seguridad Física · Cliente Nuevo vs Cliente Actual'), 'La regla de Seguridad Física no debe ocupar espacio en el dashboard.');
assert(!src.includes('Tecnología · Metas Carlos Bedoya'), 'La meta individual de tecnología no debe ocupar espacio en el dashboard.');
assert(src.includes('Cliente Nuevo') && src.includes('Cliente Actual'), 'UI debe etiquetar Cliente Nuevo / Cliente Actual.');

assert(api.includes('canEditCustomerSegment') && server.includes('canEditCustomerSegment'), 'Backend debe tener función de permiso para editar segmento.');
assert(api.includes('logCustomerSegmentChange') && server.includes('logCustomerSegmentChange'), 'Backend debe registrar auditoría de cambios de segmento.');
assert(api.includes('psi_sales_opportunity_audit_logs') && server.includes('psi_sales_opportunity_audit_logs'), 'Backend debe insertar logs de auditoría de oportunidad.');
assert(api.includes('validateCustomerSegment') && server.includes('validateCustomerSegment'), 'Backend debe validar segmento de cliente.');

assert(migration.includes('psi_sales_opportunity_audit_logs'), 'Migración debe crear tabla de auditoría.');
assert(migration.includes("'seguridad_fisica'"), 'Migración debe soportar área Seguridad Física.');
assert(migration.includes("'tecnologia'"), 'Migración debe soportar área Tecnología.');
assert(migration.includes("'licitacion_publica'"), 'Migración debe soportar área Licitación Pública.');
assert(migration.includes('Carlos Bedoya') && migration.includes('analista2@seguridadnacional.co'), 'Migración debe crear/configurar Carlos Bedoya.');

console.log('commercial areas and customer segment static tests passed');
