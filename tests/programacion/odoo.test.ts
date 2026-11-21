// Conector de Avancys (Odoo) contra un servidor de prueba que imita la conexión estándar de Odoo.
// Los datos de prueba copian la forma medida en Avancys el 2026-10-29: el empleado no tiene ciudad
// (está en su contrato) y el NIT del cliente vive en ref_num.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { autenticar, contar, diasDesdeCiclo, leerLugares, leerModalidades, leerPuestos, leerTodo, mapearRegistros, pasaFiltro, tramoDeHorario, type ConfigEntidad } from '../../src/programacion/integracion/odoo.ts';

const EMPLEADOS = Array.from({ length: 1203 }, (_, i) => ({
  id: i + 1, identification_id: String(1000000 + i), name: `GUARDA ${i + 1}`, job_id: [3, 'Vigilante'],
  cellphone: i % 2 ? '300 111 2233' : false, active: i % 10 !== 0, first_contract_date: '2025-02-01',
}));
// 1.000 en Risaralda, 200 en Antioquia y 3 sin contrato vigente (contrato cerrado).
const CONTRATOS = EMPLEADOS.slice(0, 1200).map((e, i) => ({
  id: i + 1, employee_id: [e.id, e.name],
  work_city_id: i < 1000 ? [1, 'Pereira'] : [2, 'Medellin'],
  zone_id: i < 1000 ? [1, 'RISARALDA'] : [2, 'ANTIOQUIA'],
  state: 'open',
})).concat(EMPLEADOS.slice(1200).map((e, i) => ({
  id: 1201 + i, employee_id: [e.id, e.name], work_city_id: [1, 'Pereira'], zone_id: [1, 'RISARALDA'], state: 'close',
})));
const CLIENTES = [
  { id: 1, name: 'CAMARA DE COMERCIO', ref_num: '891.408.256-4', active: true, city_id: [1, 'Pereira'], state_id: [1, 'Risaralda (CO)'] },
  { id: 2, name: 'CLIENTE DE CALI', ref_num: '900000001', active: true, city_id: [9, 'Cali'], state_id: [9, 'Valle Del Cauca (CO)'] },
  { id: 3, name: 'CLIENTE SIN CIUDAD', ref_num: '900000002', active: false, city_id: false, state_id: false },
];
// Catálogo de patrones, con la forma medida en Avancys: el horario se llama "06:00-18:00" y el
// descanso "_". La modalidad 2 tiene sus días desordenados a propósito.
const HORARIOS = [
  { id: 1, name: '06:00-18:00' }, { id: 2, name: '18:00-06:00' }, { id: 3, name: '_' }, { id: 4, name: '5:30-17:30' },
];
const MODALIDADES = [
  { id: 10, name: '4X2 24 HORAS 06', desfase: 2, numero_personal: 3 },
  { id: 11, name: '12 HORAS LUN-VIE', desfase: 0, numero_personal: 1 },
  { id: 12, name: 'SIN SECUENCIA', desfase: 0, numero_personal: 1 },
];
const SECUENCIAS = [
  { id: 1, modalidad_id: [10, ''], horario_id: [1, ''], sequence: 1 },
  { id: 2, modalidad_id: [10, ''], horario_id: [1, ''], sequence: 2 },
  { id: 3, modalidad_id: [10, ''], horario_id: [2, ''], sequence: 3 },
  { id: 4, modalidad_id: [10, ''], horario_id: [2, ''], sequence: 4 },
  { id: 5, modalidad_id: [10, ''], horario_id: [3, ''], sequence: 5 },
  { id: 6, modalidad_id: [10, ''], horario_id: [3, ''], sequence: 6 },
  { id: 9, modalidad_id: [11, ''], horario_id: [3, ''], sequence: 3 },
  { id: 7, modalidad_id: [11, ''], horario_id: [4, ''], sequence: 1 },
  { id: 8, modalidad_id: [11, ''], horario_id: [4, ''], sequence: 2 },
];
// Puestos: el 1 con ciudad y cliente; el 2 con dos órdenes que dicen ciudades distintas (queda sin
// municipio); el 3 sin orden de servicio.
const PUESTOS = [
  { id: 1, code: 'EFIGAS MANIZALES', name: 'EFIGAS MANIZALES - CALDAS - MANIZALES - VIGILANCIA...', direccion: 'CRA 23', cliente_contract_id: [7, ''], analytic_account_id: [70, ''] },
  { id: 2, code: 'PUESTO DISCUTIDO', name: 'x', direccion: false, cliente_contract_id: [7, ''], analytic_account_id: [71, ''] },
  { id: 3, code: false, name: 'SOLO NOMBRE LARGO', direccion: false, cliente_contract_id: false, analytic_account_id: false },
];
const ORDENES = [
  { id: 1, puesto_id: [1, ''], city_id: [9, 'Manizales'], state: 'active' },
  { id: 2, puesto_id: [1, ''], city_id: [9, 'Manizales'], state: 'active' },
  { id: 3, puesto_id: [2, ''], city_id: [9, 'Manizales'], state: 'active' },
  { id: 4, puesto_id: [2, ''], city_id: [8, 'Pereira'], state: 'active' },
];
const CONTRATOS_P = [{ id: 7, partner_id: [1, ''] }];
const CUENTAS = [{ id: 70, code: '573-1' }, { id: 71, code: '574-2' }];
const DATOS: Record<string, Record<string, unknown>[]> = {
  'hr.employee': EMPLEADOS, 'hr.contract': CONTRATOS, 'res.partner': CLIENTES,
  'hr.roster.modalidad': MODALIDADES, 'hr.roster.sequence': SECUENCIAS, 'hr.roster.horario': HORARIOS,
  'hr.roster.puesto': PUESTOS, 'project.service.order.line': ORDENES, 'project.project': CONTRATOS_P,
  'account.analytic.account': CUENTAS,
};

function servidor() {
  const llamadas: string[] = [];
  const s = createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      const { params, id } = JSON.parse(cuerpo);
      llamadas.push(`${params.service}.${params.method}`);
      let result: unknown = null;
      if (params.service === 'common' && params.method === 'authenticate') result = params.args[2] === 'clave-correcta' ? 7 : false;
      else {
        const filas = DATOS[params.args[3] as string] ?? [];
        if (params.args[4] === 'search_count') result = filas.length;
        else if (params.args[4] === 'search_read') {
          const { limit, offset, fields } = params.args[6];
          result = filas.slice(offset, offset + limit).map((e) => ({ id: e.id, ...Object.fromEntries((fields as string[]).map((f) => [f, e[f]])) }));
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    });
  });
  return new Promise<{ url: string; cerrar: () => void; llamadas: string[] }>((ok) => s.listen(0, () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close(), llamadas })));
}

const CFG_EMPLEADOS: ConfigEntidad = {
  modelo: 'hr.employee', dominio: [],
  campos: { documento: 'identification_id', nombre: 'name', cargo: 'job_id', telefono: 'cellphone', activo: 'active', fecha_ingreso: 'first_contract_date' },
  lugar: { desde: 'hr.contract', campos: { registro: 'employee_id', ciudad: 'work_city_id', grupo: 'zone_id', estado: 'state' }, estadoVigente: 'open' },
};
const CFG_CLIENTES: ConfigEntidad = {
  modelo: 'res.partner', dominio: [['customer_rank', '>', 0]],
  campos: { nit: 'ref_num', razon_social: 'name', activo: 'active' },
  lugar: { desde: 'propio', campos: { ciudad: 'city_id', grupo: 'state_id' } },
};
const CONEXION = (url: string) => ({ url, db: 'avancys', usuario: 'integracion', clave: 'clave-correcta' });

test('empleados: la ciudad viene del contrato vigente y el filtro es por zona', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    assert.equal(uid, 7);
    assert.equal(await contar(c, uid, CFG_EMPLEADOS), 1203);
    const regs = await leerTodo(c, uid, CFG_EMPLEADOS, 500);
    assert.equal(regs.length, 1203);
    const lugares = await leerLugares(c, uid, CFG_EMPLEADOS.lugar!, 500);
    assert.equal(lugares.size, 1200);          // los 3 de contrato cerrado quedan sin lugar
    assert.deepEqual(lugares.get(1), { ciudad: 'Pereira', grupo: 'RISARALDA' });
    assert.deepEqual(lugares.get(1001), { ciudad: 'Medellin', grupo: 'ANTIOQUIA' });

    const { filas, descartadosPorCiudad, sinLugar } = mapearRegistros(regs, CFG_EMPLEADOS, 'empleados', { grupos: ['RISARALDA'] }, lugares);
    assert.equal(filas.length, 1000);
    assert.equal(descartadosPorCiudad, 203);   // 200 de Antioquia + 3 sin contrato vigente
    assert.equal(sinLugar, 3);
    assert.deepEqual(filas[1], { documento: '1000001', nombre: 'GUARDA 2', cargo: 'Vigilante', fecha_ingreso: '2025-02-01', fecha_retiro: null, estado: 'activo', telefono: '300 111 2233' });
    assert.equal(filas[0].estado, 'retirado');
    assert.equal(filas[0].telefono, null);
  } finally { srv.cerrar(); }
});

test('empleados: el filtro por municipio también sirve, y sin filtro pasa todo', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    const regs = await leerTodo(c, uid, CFG_EMPLEADOS, 500);
    const lugares = await leerLugares(c, uid, CFG_EMPLEADOS.lugar!, 500);
    assert.equal(mapearRegistros(regs, CFG_EMPLEADOS, 'empleados', { ciudades: ['pereira'] }, lugares).filas.length, 1000);
    assert.equal(mapearRegistros(regs, CFG_EMPLEADOS, 'empleados', undefined, lugares).filas.length, 1203);
    assert.equal(mapearRegistros(regs, CFG_EMPLEADOS, 'empleados', { ciudades: [], grupos: [] }, lugares).filas.length, 1203);
    // el filtro por municipio descarta Medellín y los que no tienen contrato vigente
    assert.equal(mapearRegistros(regs, CFG_EMPLEADOS, 'empleados', { ciudades: ['Medellin'] }, lugares).filas.length, 200);
  } finally { srv.cerrar(); }
});

test('un contrato cerrado no da lugar: el empleado queda para revisar, no retirado', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    const lugares = await leerLugares(c, uid, {
      desde: 'hr.contract',
      campos: { registro: 'employee_id', ciudad: 'work_city_id', grupo: 'zone_id', estado: 'state' },
      estadoVigente: 'open',
    }, 500);
    assert.equal(lugares.get(1201), undefined);  // su único contrato está cerrado
    assert.deepEqual(lugares.get(1), { ciudad: 'Pereira', grupo: 'RISARALDA' });
    assert.equal(lugares.size, 1200);
  } finally { srv.cerrar(); }
});

test('clientes: el NIT sale de ref_num y el lugar del propio registro', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    const regs = await leerTodo(c, uid, CFG_CLIENTES, 500);
    assert.equal(regs.length, 3);
    assert.ok(Object.keys(regs[0]).includes('city_id'), 'leerTodo debe pedir los campos del lugar propio');
    const { filas, descartadosPorCiudad, sinLugar } = mapearRegistros(regs, CFG_CLIENTES, 'clientes', { grupos: ['Risaralda (CO)'] });
    assert.equal(filas.length, 1);
    assert.deepEqual(filas[0], { nit: '891.408.256-4', razon_social: 'CAMARA DE COMERCIO', activo: true });
    assert.equal(descartadosPorCiudad, 2);
    assert.equal(sinLugar, 1);
  } finally { srv.cerrar(); }
});

test('pasaFiltro: compara sin tildes ni mayúsculas y un filtro vacío deja pasar', () => {
  assert.equal(pasaFiltro({ ciudad: 'Quindío', grupo: 'RISARALDA' }, { ciudades: ['quindio'] }), true);
  assert.equal(pasaFiltro({ ciudad: 'Pereira', grupo: 'RISARALDA' }, { grupos: ['risaralda'] }), true);
  assert.equal(pasaFiltro({ ciudad: 'Cali', grupo: 'VALLE DEL CAUCA' }, { grupos: ['RISARALDA'] }), false);
  assert.equal(pasaFiltro(null, { grupos: ['RISARALDA'] }), false);
  assert.equal(pasaFiltro(null, undefined), true);
  assert.equal(pasaFiltro(null, { ciudades: [], grupos: [] }), true);
});

test('clave incorrecta: mensaje claro', async () => {
  const srv = await servidor();
  try {
    await assert.rejects(autenticar({ url: srv.url, db: 'avancys', usuario: 'x', clave: 'mala' }), /no válidos/);
  } finally { srv.cerrar(); }
});

const CFG_PATRONES = { modelo: 'hr.roster.modalidad', secuencias: 'hr.roster.sequence', horarios: 'hr.roster.horario' };

test('patrones: arma el ciclo en orden, traduce el horario y descarta la modalidad sin secuencia', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    const p = await leerModalidades(c, uid, CFG_PATRONES);
    assert.equal(p.length, 2, 'la modalidad sin secuencia no entra');
    const m = p.find((x) => x.avancys_id === 10)!;
    assert.deepEqual(m.ciclo, ['0600-1800', '0600-1800', '1800-0600', '1800-0600', '_', '_']);
    assert.equal(m.grupos, 3);
    assert.equal(m.desfase, 2);
    assert.deepEqual(m.dias[0], { tramos: [{ inicio: '06:00', fin: '18:00' }] });
    assert.deepEqual(m.dias[4], { tramos: [] });
    // la 11 viene con las secuencias desordenadas: 3 va de último
    const n = p.find((x) => x.avancys_id === 11)!;
    assert.deepEqual(n.ciclo, ['0530-1730', '0530-1730', '_']);
  } finally { srv.cerrar(); }
});

test('tramoDeHorario: entiende las formas de Avancys y descarta lo que no es un rango', () => {
  assert.equal(tramoDeHorario('06:00-18:00'), '0600-1800');
  assert.equal(tramoDeHorario('5:30-17:30'), '0530-1730');
  assert.equal(tramoDeHorario('_'), null);
  assert.equal(tramoDeHorario(''), null);
  assert.equal(tramoDeHorario(false), null);
  assert.equal(tramoDeHorario('DESCANSO'), null);
});

test('diasDesdeCiclo: el "_" es un día sin tramos', () => {
  assert.deepEqual(diasDesdeCiclo(['0600-1800', '_']), [{ tramos: [{ inicio: '06:00', fin: '18:00' }] }, { tramos: [] }]);
});

const CFG_PUESTOS = { modelo: 'hr.roster.puesto', ordenes: 'project.service.order.line',
  contratos: 'project.project', terceros: 'res.partner', cuentas: 'account.analytic.account' };

test('puestos: el municipio sale de la orden de servicio, y dos ciudades distintas dejan el puesto sin municipio', async () => {
  const srv = await servidor();
  try {
    const c = CONEXION(srv.url);
    const uid = await autenticar(c);
    const p = await leerPuestos(c, uid, CFG_PUESTOS);
    assert.equal(p.length, 3);
    const uno = p.find((x) => x.avancys_id === 1)!;
    assert.equal(uno.nombre, 'EFIGAS MANIZALES', 'usa el code, no la descripción larga');
    assert.equal(uno.municipio, 'Manizales');
    assert.equal(uno.centro_costo, '573-1');
    assert.equal(uno.nit_cliente, '891.408.256-4');   // por el contrato 7 -> tercero 1
    assert.equal(uno.direccion, 'CRA 23');
    // dos órdenes con ciudades distintas: no se escoge una
    assert.equal(p.find((x) => x.avancys_id === 2)!.municipio, null);
    // sin orden de servicio: sin municipio, y sin code usa el nombre largo
    const tres = p.find((x) => x.avancys_id === 3)!;
    assert.equal(tres.municipio, null);
    assert.equal(tres.nombre, 'SOLO NOMBRE LARGO');
    assert.equal(tres.nit_cliente, null);
  } finally { srv.cerrar(); }
});
