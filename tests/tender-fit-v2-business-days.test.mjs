// Contrato RED (TDD) del helper puro de días hábiles de Colombia, requerido por el
// eje D (Tiempo) de tender-fit-v2. Vive en un módulo propio (`tender-fit-v2-business-days.js`)
// para poder probarse de forma aislada, sin reloj ni aleatoriedad: misma entrada,
// misma salida siempre.
//
// Semántica de `countColombiaBusinessDays(evaluationDateIso, closingDateIso)`:
// cuenta los días hábiles colombianos (lunes a viernes, excluyendo los festivos de
// `COLOMBIA_HOLIDAYS_2026`) estrictamente DESPUÉS de `evaluationDateIso` y
// ESTRICTAMENTE ANTES de `closingDateIso` (es decir, la ventana
// [evaluationDateIso+1, closingDateIso-1], ambos extremos inclusive). Ambas fechas
// son strings de fecha de calendario `YYYY-MM-DD` (ya resueltas a la zona horaria de
// Bogotá por el llamador; el helper mismo es agnóstico de zona horaria/reloj).
// Si la ventana es vacía o inválida (closingDateIso <= evaluationDateIso), devuelve 0.
//
// Este módulo NO EXISTE TODAVÍA (fase RED): se espera ERR_MODULE_NOT_FOUND hasta que
// la implementación productiva lo cree.
import assert from 'node:assert/strict';
import { countColombiaBusinessDays, isColombiaBusinessDay } from '../tender-fit-v2-business-days.js';
import { COLOMBIA_HOLIDAYS_2026 } from '../tender-fit-v2-parameters.js';

// ---------------------------------------------------------------------------
// 1. isColombiaBusinessDay: fin de semana y festivo son no-hábiles; entre semana es hábil
// ---------------------------------------------------------------------------
assert.equal(isColombiaBusinessDay('2026-01-05'), true, 'lunes 2026-01-05 es hábil');
assert.equal(isColombiaBusinessDay('2026-01-10'), false, 'sábado 2026-01-10 no es hábil');
assert.equal(isColombiaBusinessDay('2026-01-11'), false, 'domingo 2026-01-11 no es hábil');
assert.equal(isColombiaBusinessDay('2026-01-01'), false, 'festivo fijo (Año Nuevo) no es hábil aunque sea jueves');
assert.equal(isColombiaBusinessDay('2026-07-20'), false, 'festivo fijo (Independencia, lunes) no es hábil');
assert.equal(isColombiaBusinessDay('2026-07-13'), false, 'Chiquinquirá trasladado al lunes 13 no es hábil');
assert.equal(isColombiaBusinessDay('2026-01-06'), true, 'la fecha original de Reyes (martes, no festivo real porque se trasladó) sí es hábil');
assert.equal(isColombiaBusinessDay('2026-01-12'), false, 'festivo trasladado de Reyes (lunes 12) no es hábil');

// ---------------------------------------------------------------------------
// 2. Ventana simple sin festivos: solo excluye fines de semana
// ---------------------------------------------------------------------------
// Ventana [2026-01-02 .. 2026-01-09]: vie,sáb,dom,lun,mar,mié,jue,vie -> hábiles: 2,5,6,7,8,9 = 6
assert.equal(countColombiaBusinessDays('2026-01-01', '2026-01-10'), 6);

// ---------------------------------------------------------------------------
// 3. Ventana que atraviesa un festivo colombiano real (Independencia, 2026-07-20,
//    que cae en lunes): el festivo debe excluirse además de los fines de semana.
// ---------------------------------------------------------------------------
// Ventana [2026-07-17 .. 2026-07-23]: vie(17,hábil),sáb,dom,lun(20,FESTIVO),mar(21),mié(22),jue(23)
// Hábiles: 17,21,22,23 = 4 (NO 5: el festivo del 20 resta un día hábil que de otro modo contaría)
assert.equal(
  countColombiaBusinessDays('2026-07-16', '2026-07-24'),
  4,
  'la ventana que atraviesa el festivo del 20 de julio de 2026 debe excluirlo, dando 4 y no 5',
);
assert.ok(COLOMBIA_HOLIDAYS_2026.includes('2026-07-20'), 'fijación: 2026-07-20 debe estar en la lista de festivos usada por el helper');

// Ventana que cruza Chiquinquirá trasladado (13 de julio): el lunes también se excluye.
// [2026-07-10 .. 2026-07-16]: vie(10),sáb,dom,lun(13,FESTIVO),mar(14),mié(15),jue(16) -> 4 hábiles.
assert.equal(
  countColombiaBusinessDays('2026-07-09', '2026-07-17'),
  4,
  'la ventana que atraviesa Chiquinquirá trasladado debe excluir el 13 de julio',
);

// Ventana realmente libre de festivos: lunes a viernes completos de febrero.
assert.equal(
  countColombiaBusinessDays('2026-02-01', '2026-02-07'),
  5,
  'una semana laboral completa sin festivos debe dar 5 días hábiles',
);

// ---------------------------------------------------------------------------
// 4. Ventana vacía o invertida: 0
// ---------------------------------------------------------------------------
assert.equal(countColombiaBusinessDays('2026-01-04', '2026-01-04'), 0, 'misma fecha, ventana vacía');
assert.equal(countColombiaBusinessDays('2026-01-10', '2026-01-04'), 0, 'cierre anterior a evaluación, ventana invertida');
assert.equal(countColombiaBusinessDays('2026-01-04', '2026-01-05'), 0, 'un solo día de diferencia no deja ningún día dentro de la ventana exclusiva');

// ---------------------------------------------------------------------------
// 5. Determinismo
// ---------------------------------------------------------------------------
assert.equal(countColombiaBusinessDays('2026-01-01', '2026-02-05'), countColombiaBusinessDays('2026-01-01', '2026-02-05'));

console.log('tender-fit-v2-business-days: OK');
