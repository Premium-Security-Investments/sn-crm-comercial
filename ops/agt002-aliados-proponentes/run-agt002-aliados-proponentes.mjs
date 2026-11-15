#!/usr/bin/env node
// Aliados al día con los procesos (Juan, 2026-11-15; migración 223): paso semanal de la cadena del Radar. Registra los
// que ofertaron y los que observaron. Corre los lunes (hora de Colombia); `--forzar` lo corre cualquier día. Una línea
// JSON en stdout, sin llaves ni URL.
import { createClient } from '@supabase/supabase-js';
import { registerSecopProponents } from '../../verticales/licitaciones/aliados-proponentes-secop.js';
import { registerResponseObservers } from '../../verticales/licitaciones/aliados-observantes.js';

const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bogotaDay = new Date(Date.now() - 5 * 3600e3).getUTCDay();

if (!process.argv.includes('--forzar') && bogotaDay !== 1) {
  console.log(JSON.stringify({ status: 'skipped', reason: 'solo_lunes' }));
} else if (!supabaseUrl || !serviceRoleKey) {
  console.log(JSON.stringify({ status: 'unavailable', code: 'AGT002_ALIADOS_PROPONENTES_CONFIG_INVALID' }));
  process.exitCode = 1;
} else {
  try {
    const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const log = event => console.error(JSON.stringify(event));
    // Los que ofertaron (SECOP) y los que observaron (respuestas de la entidad leídas por Vig-IA).
    const proponentes = await registerSecopProponents(database, { log });
    const observantes = await registerResponseObservers(database, { log });
    console.log(JSON.stringify({ status: 'success', proponentes, observantes }));
  } catch (error) {
    console.log(JSON.stringify({ status: 'unavailable', code: 'AGT002_ALIADOS_PROPONENTES_FAILED', message: String(error?.message || '').slice(0, 200) }));
    process.exitCode = 1;
  }
}
