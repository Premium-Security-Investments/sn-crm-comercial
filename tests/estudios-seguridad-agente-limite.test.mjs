// Estudios de Seguridad Física: el límite de tiempo de la nota de campo con Vig-IA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIELD_NOTE_TIMEOUT_MS } from '../verticales/estudios-seguridad/agente.js';

test('la nota de campo espera 110 s: una visita completa tardó hasta 65 s en la prueba del 17-nov', () => {
  assert.equal(FIELD_NOTE_TIMEOUT_MS, 110_000);
});

test('el límite cabe en el puente, en Vercel y en la reserva de la corrida', () => {
  // El puente AGT-003 rechaza (no recorta) un timeout mayor que su techo de 120 s.
  assert.ok(FIELD_NOTE_TIMEOUT_MS + 2_000 <= 120_000);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(FIELD_NOTE_TIMEOUT_MS / 1000 < vercel.functions['api/[...path].js'].maxDuration);
  // Una corrida 'running' de más de 2 minutos deja de bloquear al analista (migración 181).
  const claim = readFileSync(new URL('../supabase/migrations/181_estudios_seguridad_agente.sql', import.meta.url), 'utf8');
  assert.match(claim, /status = 'running' and created_at > now\(\) - interval '2 minutes'/);
  assert.ok(FIELD_NOTE_TIMEOUT_MS < 120_000);
});
