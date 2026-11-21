import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferirServicios } from '../../src/programacion/motor/inferir-servicios.ts';

const turnos = (dias: string[], ini: string, fin: string, puesto = 1) =>
  dias.map((d) => {
    const fd = fin <= ini ? new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) : d;
    return { puesto_id: puesto, inicio: `${d}T${ini}`, fin: `${fd}T${fin}` };
  });
const semana = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const dosSemanas = [...semana, '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];

test('un puesto 24 h con día y noche queda como un servicio de 24 h todos los días', () => {
  const t = [...turnos(dosSemanas, '06:00', '18:00'), ...turnos(dosSemanas, '18:00', '06:00')];
  const s = inferirServicios(t, '2026-10-26', '2026-11-08');
  assert.deepEqual(s, [{ puesto_id: 1, dias: [1, 2, 3, 4, 5, 6, 7], hora_inicio: '06:00', hora_fin: '06:00', guardas: 1 }]);
});

test('lunes a viernes de 07:00 a 17:00', () => {
  const lv = dosSemanas.filter((d) => ![6, 0].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
  const s = inferirServicios(turnos(lv, '07:00', '17:00'), '2026-10-26', '2026-11-08');
  assert.deepEqual(s, [{ puesto_id: 1, dias: [1, 2, 3, 4, 5], hora_inicio: '07:00', hora_fin: '17:00', guardas: 1 }]);
});

test('una ausencia aislada no cambia lo contratado (se usa el valor más frecuente)', () => {
  const t = [...turnos(dosSemanas, '06:00', '18:00'), ...turnos(dosSemanas, '18:00', '06:00')].filter((x) => x.inicio !== '2026-10-28T18:00');
  const s = inferirServicios(t, '2026-10-26', '2026-11-08');
  assert.equal(s.length, 1);
  assert.equal(s[0].hora_inicio, '06:00');
});

test('refuerzo: 2 guardas de 07:00 a 19:00 y 1 el resto', () => {
  const t = [...turnos(dosSemanas, '06:00', '18:00'), ...turnos(dosSemanas, '18:00', '06:00'), ...turnos(dosSemanas, '07:00', '19:00')];
  const s = inferirServicios(t, '2026-10-26', '2026-11-08');
  const dos = s.find((x) => x.guardas === 2);
  assert.ok(dos);
  assert.equal(dos!.hora_inicio, '07:00');
  assert.equal(dos!.hora_fin, '19:00'); // 18–19: guarda de noche + refuerzo
});

test('los puestos que agrupan muchas sedes no reciben propuesta de contrato', async () => {
  const { clasificarPropuestas } = await import('../../src/programacion/motor/inferir-servicios.ts');
  const r = clasificarPropuestas([
    { puesto_id: 1, dias: [1, 2, 3, 4, 5, 6, 7], hora_inicio: '06:00', hora_fin: '06:00', guardas: 1 },
    { puesto_id: 2, dias: [1, 2, 3, 4, 5], hora_inicio: '07:00', hora_fin: '19:00', guardas: 25 },
  ]);
  assert.deepEqual(r.confiables.map((x) => x.puesto_id), [1]);
  assert.deepEqual(r.agrupados, [{ puesto_id: 2, maxGuardas: 25, servicios: 1 }]);
});
