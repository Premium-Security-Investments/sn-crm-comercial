// AGT-003 — la nota de una decisión dice el nombre de la etapa y del motivo, no su código (Juan, 2026-10-23).
// El defecto venía del botón "Decidir" de la ficha; el chat lo hizo visible al mover la etapa con una frase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('migración 152: el texto usa nombres, y ninguna regla de la decisión se toca', () => {
  const sql = readFileSync(new URL('../supabase/migrations/152_crm_decision_con_nombre_de_etapa.sql', import.meta.url), 'utf8');

  // El texto nuevo: nombre de la etapa y del motivo.
  assert.match(sql, /when 'advance' then 'Avanza a ' \|\| v_target_name \|\| ': ' \|\| v_notes/);
  assert.match(sql, /when 'discard' then 'Descartada \(' \|\| v_reason_name \|\| '\): ' \|\| v_notes/);
  assert.match(sql, /else 'Perdida \(' \|\| v_reason_name \|\| '\): ' \|\| v_notes/);
  // Y el viejo ya no está en ninguna parte de la función.
  assert.doesNotMatch(sql, /'Avanza a ' \|\| p_stage_code/);
  assert.doesNotMatch(sql, /\|\| p_loss_reason_code \|\| '\)/);

  // Las reglas de la decisión siguen palabra por palabra: orden de etapas, ventana de la próxima gestión, cierre,
  // licitaciones, congelamiento y la auditoría. Si una de estas desaparece, la migración cambió más de lo que dice.
  for (const regla of [
    /Escoja una etapa más avanzada que la actual\./,
    /La próxima gestión debe quedar entre hoy y los próximos 90 días\./,
    /La oportunidad ya está cerrada\./,
    /Las licitaciones públicas se deciden en Licitaciones\./,
    /Se puede congelar 30, 60 o 90 días\./,
    /Escriba en una frase qué pasó o por qué decide esto\./,
    /Escoja el motivo\./,
    /insert into public\.psi_sales_opportunity_audit_logs/,
    /for update;/,
  ]) assert.match(sql, regla, String(regla));

  // El congelamiento conserva su fecha formateada: no era parte del defecto.
  assert.match(sql, /'Congelada hasta ' \|\| to_char\(v_frozen_until, 'DD\/MM\/YYYY'\)/);

  // Las notas viejas: se reemplaza sólo el arranque del sistema y se conserva la frase del comercial.
  assert.match(sql, /set notes = 'Avanza a ' \|\| s\.name \|\| substring\(i\.notes from length\('Avanza a ' \|\| s\.code\) \+ 1\)/);
  assert.equal((sql.match(/^update public\.psi_sales_interactions i$/gm) || []).length, 3, 'una corrección por cada texto: avance, descarte y pérdida');
  assert.doesNotMatch(sql, /delete from|drop /i, 'la 152 no borra nada');

  const rollback = readFileSync(new URL('../supabase/rollbacks/152_crm_decision_con_nombre_de_etapa_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /when 'advance' then 'Avanza a ' \|\| p_stage_code \|\| ': ' \|\| v_notes/, 'el rollback devuelve el texto con código');
  assert.doesNotMatch(rollback, /v_target_name|v_reason_name/, 'y se lleva las variables que introdujo la 152');
  assert.match(rollback, /revertirlas sería ensuciar a propósito/, 'dice qué no revierte y por qué');
});
