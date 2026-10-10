#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSiioFinancialWorkbook } from '../siio-financial-workbook.js';

const filePath = process.argv[2];
if (!filePath) throw new Error('Uso: node scripts/check_siio_financial_import.mjs <PYG.xlsm> [periodo] [fecha-corte]');
const periodMonth = process.argv[3] || '2026-04-01';
const cutoffDate = process.argv[4] || '2026-04-30';
const result = parseSiioFinancialWorkbook(readFileSync(filePath), {
  fileName: path.basename(filePath), periodMonth, cutoffDate, importType: 'cierre_mensual',
});
assert.equal(result.status, 'listo_revision', 'el libro debe superar los controles automáticos y quedar pendiente de validación humana');
assert.equal(result.metrics.length, 9, 'debe extraer los nueve indicadores ejecutivos');
assert.ok(result.balance_lines.length > 0, 'debe extraer líneas del balance de prueba');
assert.ok(result.validations.filter(item => item.severity === 'bloqueante').every(item => item.ok), 'toda validación bloqueante debe aprobarse');
console.log(JSON.stringify({
  file_sha256: result.file_sha256,
  period_month: result.period_month,
  cutoff_date: result.cutoff_date,
  status: result.status,
  summary: result.summary,
  financial_totals: Object.fromEntries(result.metrics.filter(item => ['INGRESOS', 'COSTOS', 'GASTOS', 'UTILIDAD OPERACIONAL', 'UTILIDAD NETA'].includes(item.concept)).map(item => [item.concept, item.value_current])),
  validations: result.validations.map(({ rule, severity, ok, obtained }) => ({ rule, severity, ok, obtained })),
}, null, 2));
