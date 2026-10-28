import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AvancysLecturaError,
  MAX_PUESTOS_LISTADOS,
  configuracionDeAvancys,
  crearLectorAvancys,
  normalizarIdentificacion,
} from '../avancys-odoo-lectura.js';
import {
  ESTADOS,
  FORMAS,
  FRESCURAS,
  resolverClienteDelPuesto,
  resolverParaLector,
  resolverPuestosDelCliente,
  sostieneAfirmacion,
} from '../catalogo-fuentes.js';

const ENTORNO = Object.freeze({
  AVANCYS_ODOO_URL: 'https://avancys.ejemplo.test',
  AVANCYS_ODOO_DATABASE: 'seguridadnacional',
  AVANCYS_ODOO_USERNAME: 'integracion.siio',
  AVANCYS_ODOO_API_KEY: 'clave-de-mentira',
  AVANCYS_ODOO_COMPANY_ID: '1',
});

// Odoo de mentira: contesta `authenticate` y `search_read` sobre las tablas que se le dan, y
// aplica los dominios que el lector arma. Guarda cada llamada para poder afirmar sobre el modelo,
// el método y los campos que se pidieron: la lista blanca es la mitad del valor de este archivo.
function odooDeMentira(tablas, { errorDeOdoo = null, estado = 200 } = {}) {
  const llamadas = [];
  const cumple = (fila, [campo, operador, valor]) => {
    const actual = fila[campo];
    const id = Array.isArray(actual) ? actual[0] : actual;
    if (operador === '=') return id === valor || (valor === false && (id === false || id === undefined || id === null));
    if (operador === 'in') return valor.includes(id);
    throw new Error(`operador no soportado en la prueba: ${operador}`);
  };
  const fetchImpl = async (url, opciones) => {
    const cuerpo = JSON.parse(opciones.body);
    const { service, method, args } = cuerpo.params;
    llamadas.push({ url, service, method, args });
    if (estado !== 200) return { ok: false, status: estado, text: async () => '' };
    // Un error de Odoo viaja con HTTP 200 y cuerpo `{error}`.
    if (errorDeOdoo) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, error: { message: errorDeOdoo } }) };
    }
    let result;
    if (service === 'common' && method === 'authenticate') result = 230;
    else {
      const [, , , modelo, metodo, posicional, nombrado] = args;
      assert.equal(metodo, 'search_read', 'el lector solo debe usar search_read');
      const dominio = posicional[0] || [];
      const filas = (tablas[modelo] || []).filter(fila => dominio.every(hoja => cumple(fila, hoja)));
      result = filas.slice(0, nombrado.limit).map(fila => {
        const recorte = {};
        for (const campo of nombrado.fields) if (campo in fila) recorte[campo] = fila[campo];
        recorte.id = fila.id;
        return recorte;
      });
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result }) };
  };
  return { fetchImpl, llamadas };
}

const CIDE = { id: 31765, name: 'CORPORACION INTERNACIONAL PARA EL DESARROLLO EDUCATIVO CIDE', ref_num: '860053914', ref_type_id: [11, 'Número de Identificación Tributaria'], verification_code: 4, is_company: true, write_date: '2026-09-17 02:48:02' };
const OTRO = { id: 31708, name: 'JERONIMO MARTINS COLOMBIA S.A.S', ref_num: '900480569', ref_type_id: [11, 'Número de Identificación Tributaria'], verification_code: 1, is_company: true, write_date: '2026-08-04 13:48:21' };

function baseCoherente() {
  return {
    'hr.roster.puesto': [{ id: 12839, code: 'CIDE RIONEGRO', name: 'CIDE RIONEGRO BOGOTA', analytic_account_id: [30503, 'cuenta'], cliente_contract_id: [11535, 'contrato'], write_date: '2026-09-17 02:48:02' }],
    'project.project': [{ id: 11535, name: 'CIDE RIONEGRO', partner_id: [CIDE.id, CIDE.name], date_start: '2026-01-01', date: '2026-12-31', write_date: '2026-09-01 10:00:00' }],
    'account.analytic.account': [{ id: 30503, code: '573', partner_id: [CIDE.id, CIDE.name], write_date: '2026-09-02 10:00:00' }],
    'res.partner': [CIDE, OTRO],
  };
}

test('sin credenciales en el entorno no hay lector, y eso no es una excepción', () => {
  assert.equal(configuracionDeAvancys({}), null);
  assert.equal(crearLectorAvancys({ entorno: {} }), null);
});

test('la URL de Avancys tiene que ser https y sin credenciales embutidas', () => {
  for (const url of ['http://avancys.ejemplo.test', 'https://usuario:clave@avancys.ejemplo.test', 'https://avancys.ejemplo.test/?db=x']) {
    assert.throws(() => crearLectorAvancys({ entorno: { ...ENTORNO, AVANCYS_ODOO_URL: url } }), AvancysLecturaError);
  }
});

test('el NIT se busca sin el dígito de verificación, porque en Avancys vive aparte', () => {
  assert.equal(normalizarIdentificacion('860053914-4'), '860053914');
  assert.equal(normalizarIdentificacion(' 900.480.569 '), '900480569');
  assert.equal(normalizarIdentificacion('860053914'), '860053914');
  assert.equal(normalizarIdentificacion(''), null);
  assert.equal(normalizarIdentificacion(null), null);
});

test('del puesto al cliente por las dos rutas, y dice que coinciden', async () => {
  const { fetchImpl, llamadas } = odooDeMentira(baseCoherente());
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.clienteDelPuesto({ codigo: 'CIDE RIONEGRO' });

  assert.equal(leido.encontrado, true);
  assert.equal(leido.total, 1);
  assert.equal(leido.puestos[0].cliente.nombre, CIDE.name);
  assert.equal(leido.puestos[0].cliente.identificacion.numero, '860053914');
  assert.equal(leido.puestos[0].cliente.identificacion.digito_de_verificacion, '4');
  assert.equal(leido.puestos[0].centro_de_costo, '573');
  assert.equal(leido.puestos[0].contrato.vence, '2026-12-31');
  assert.equal(leido.puestos[0].rutas.coinciden, true);
  // La fecha de corte es la del dato leído, no la de la pregunta.
  assert.equal(leido.as_of, '2026-09-17T02:48:02Z');
  // Nunca se piden personas: hr.employee y hr.contract no están en la lista blanca.
  const modelos = llamadas.filter(l => l.service === 'object').map(l => l.args[3]);
  assert.deepEqual([...new Set(modelos)].sort(), ['account.analytic.account', 'hr.roster.puesto', 'project.project', 'res.partner']);
});

test('cuando el contrato y la cuenta analítica no coinciden, la respuesta no escoge', async () => {
  const tablas = baseCoherente();
  tablas['account.analytic.account'][0].partner_id = [OTRO.id, OTRO.name];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.clienteDelPuesto({ codigo: 'CIDE RIONEGRO' });

  assert.equal(leido.puestos[0].rutas.coinciden, false);
  assert.equal(leido.puestos[0].rutas.por_contrato.nombre, CIDE.name);
  assert.equal(leido.puestos[0].rutas.por_cuenta_analitica.nombre, OTRO.name);
});

test('un código repetido devuelve los dos puestos, no el primero', async () => {
  const tablas = baseCoherente();
  tablas['hr.roster.puesto'].push({ id: 99999, code: 'CIDE RIONEGRO', name: 'OTRO PUESTO CON EL MISMO CODIGO', analytic_account_id: [30503, 'cuenta'], cliente_contract_id: [11535, 'contrato'], write_date: '2026-10-01 00:00:00' });
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.clienteDelPuesto({ codigo: 'CIDE RIONEGRO' });
  assert.equal(leido.total, 2);
});

test('del cliente a sus puestos: el total es exacto y la lista viene recortada', async () => {
  const tablas = baseCoherente();
  tablas['hr.roster.puesto'] = Array.from({ length: 60 }, (_, i) => ({
    id: 1000 + i, code: `P-${i}`, name: `PUESTO ${i}`,
    analytic_account_id: [30503, 'cuenta'], cliente_contract_id: [11535, 'contrato'],
    write_date: '2026-09-17 02:48:02',
  }));
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.puestosDelCliente({ identificacion: '860053914-4' });

  assert.equal(leido.encontrado, true);
  assert.equal(leido.cliente.identificacion.numero, '860053914');
  assert.equal(leido.total_contratos, 1);
  assert.equal(leido.total_puestos, 60, 'el total tiene que ser el real, no el recortado');
  assert.equal(leido.puestos_listados, MAX_PUESTOS_LISTADOS);
  assert.equal(leido.contratos[0].total_puestos, 60);
  assert.equal(leido.contratos[0].puestos.length, MAX_PUESTOS_LISTADOS);
});

test('un NIT que no está en Avancys se declara no encontrado, no vacío', async () => {
  const { fetchImpl } = odooDeMentira(baseCoherente());
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.puestosDelCliente({ identificacion: '999999999' });
  assert.equal(leido.encontrado, false);
  assert.equal(leido.as_of, null);
});

test('un error de Odoo llega con HTTP 200: se trata como fallo, no como respuesta vacía', async () => {
  const { fetchImpl } = odooDeMentira(baseCoherente(), { errorDeOdoo: 'You are not allowed to access' });
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  await assert.rejects(() => lector.clienteDelPuesto({ codigo: 'CIDE RIONEGRO' }), error => {
    assert.ok(error instanceof AvancysLecturaError);
    assert.equal(error.codigo, 'AVANCYS_RPC_FALLO');
    return true;
  });
});

test('un 403 de Avancys se distingue de cualquier otro fallo HTTP', async () => {
  const { fetchImpl } = odooDeMentira(baseCoherente(), { estado: 403 });
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  await assert.rejects(() => lector.clienteDelPuesto({ codigo: 'X' }), error => {
    assert.equal(error.codigo, 'AVANCYS_ACCESO_DENEGADO');
    return true;
  });
});

// ---- El catálogo ----

const AVANCYS_DE_MENTIRA = Object.freeze({
  clienteDelPuesto: async () => ({
    encontrado: true, codigo: 'CIDE RIONEGRO', total: 1, as_of: '2026-09-17T02:48:02Z',
    puestos: [{ puesto_id: 12839, codigo: 'CIDE RIONEGRO', nombre: 'CIDE RIONEGRO BOGOTA', centro_de_costo: '573', contrato: { nombre: 'CIDE RIONEGRO', inicia: '2026-01-01', vence: '2026-12-31' }, cliente: { nombre: CIDE.name, identificacion: { tipo: 'NIT', numero: '860053914', digito_de_verificacion: '4' }, es_empresa: true }, rutas: { coinciden: true } }],
  }),
  puestosDelCliente: async () => ({
    encontrado: true, identificacion: '860053914', as_of: '2026-09-17T02:48:02Z',
    cliente: { nombre: CIDE.name, identificacion: { tipo: 'NIT', numero: '860053914', digito_de_verificacion: '4' }, es_empresa: true },
    total_contratos: 1, total_puestos: 3, puestos_listados: 3, contratos: [],
  }),
});

test('la llave resuelta dice de cuándo es, de dónde salió y en qué forma viene', async () => {
  const resuelto = await resolverClienteDelPuesto(null, { avancys: AVANCYS_DE_MENTIRA, puestoCodigo: 'CIDE RIONEGRO' });
  assert.equal(resuelto.estado, ESTADOS.VIGENTE);
  assert.equal(resuelto.frescura, FRESCURAS.VIVA);
  assert.equal(resuelto.forma, FORMAS.TIPADO);
  assert.equal(resuelto.requiere_interpretacion, false);
  assert.equal(resuelto.as_of, '2026-09-17T02:48:02Z');
  assert.equal(resuelto.procedencia.fuente, 'avancys.hr_roster_puesto');
  assert.ok(resuelto.procedencia.modelos.includes('hr.roster.puesto'));
});

test('un puesto con las dos rutas en desacuerdo se sirve en disputa, no vigente', async () => {
  const avancys = {
    clienteDelPuesto: async () => ({
      encontrado: true, codigo: 'X', total: 2, as_of: '2026-10-01T00:00:00Z',
      puestos: [
        { cliente: { nombre: 'A' }, rutas: { coinciden: true } },
        { cliente: { nombre: 'B' }, rutas: { coinciden: false } },
      ],
    }),
  };
  const resuelto = await resolverClienteDelPuesto(null, { avancys, puestoCodigo: 'X' });
  // El peor estado del lote manda: no se promedia la certeza.
  assert.equal(resuelto.estado, ESTADOS.EN_DISPUTA);
  assert.equal(sostieneAfirmacion(resuelto), false);
});

test('Avancys caído no rompe la respuesta: la degrada y escribe la razón', async () => {
  const avancys = {
    clienteDelPuesto: async () => { throw new AvancysLecturaError('AVANCYS_TIEMPO_AGOTADO'); },
    puestosDelCliente: async () => { throw new AvancysLecturaError('AVANCYS_ACCESO_DENEGADO'); },
  };
  const puesto = await resolverClienteDelPuesto(null, { avancys, puestoCodigo: 'X' });
  assert.equal(puesto.estado, ESTADOS.NO_VERIFICADO);
  assert.match(puesto.procedencia.nota, /AVANCYS_TIEMPO_AGOTADO/);

  const cliente = await resolverPuestosDelCliente(null, { avancys, clienteIdentificacion: '860053914' });
  assert.equal(cliente.estado, ESTADOS.NO_VERIFICADO);
  assert.match(cliente.procedencia.nota, /AVANCYS_ACCESO_DENEGADO/);
});

test('sin Avancys configurado, o sin la pregunta, se declara en vez de devolver vacío', async () => {
  const sinLector = await resolverClienteDelPuesto(null, { avancys: null, puestoCodigo: 'X' });
  assert.equal(sinLector.estado, ESTADOS.NO_VERIFICADO);
  assert.match(sinLector.procedencia.nota, /no está configurado/);

  const sinCodigo = await resolverClienteDelPuesto(null, { avancys: AVANCYS_DE_MENTIRA, puestoCodigo: null });
  assert.match(sinCodigo.procedencia.nota, /sin código de puesto/);

  const sinNit = await resolverPuestosDelCliente(null, { avancys: AVANCYS_DE_MENTIRA, clienteIdentificacion: '' });
  assert.match(sinNit.procedencia.nota, /sin identificación/);
});

test('un NIT ausente en Avancys no se lee como "no es cliente nuestro"', async () => {
  const avancys = { puestosDelCliente: async () => ({ encontrado: false, identificacion: '999', as_of: null }) };
  const resuelto = await resolverPuestosDelCliente(null, { avancys, clienteIdentificacion: '999' });
  assert.equal(resuelto.estado, ESTADOS.NO_VERIFICADO);
  assert.match(resuelto.procedencia.nota, /tiene esa identificación/);
});

test('la llave es del copiloto comercial; a la Mesa de licitaciones el catálogo le calla', async () => {
  const pedidos = ['operacion.cliente_del_puesto', 'operacion.puestos_del_cliente'];
  const copiloto = await resolverParaLector(null, {
    lector: 'agt003.copiloto', nombres: pedidos, puestoCodigo: 'CIDE RIONEGRO',
    clienteIdentificacion: '860053914-4', avancys: AVANCYS_DE_MENTIRA, entorno: {},
  });
  assert.deepEqual(copiloto.map(entrada => entrada.nombre), pedidos);

  const mesa = await resolverParaLector(null, {
    lector: 'agt002.mesa', nombres: pedidos, puestoCodigo: 'CIDE RIONEGRO',
    avancys: AVANCYS_DE_MENTIRA, entorno: {},
  });
  assert.deepEqual(mesa, []);
});

test('mientras nadie responda por la llave, se sirve no_verificado aunque la fuente esté verificada', async () => {
  const resueltos = await resolverParaLector(null, {
    lector: 'agt003.copiloto', nombres: ['operacion.cliente_del_puesto'],
    puestoCodigo: 'CIDE RIONEGRO', avancys: AVANCYS_DE_MENTIRA, entorno: {},
  });
  assert.equal(resueltos.length, 1);
  assert.equal(resueltos[0].responsable, null);
  // El resolvedor la dio por vigente; la composición la degrada por no tener dueño humano.
  assert.equal(resueltos[0].estado, ESTADOS.NO_VERIFICADO);
  assert.equal(sostieneAfirmacion(resueltos[0]), false);
});

test('si nadie pide datos de Avancys, no se abre sesión contra Odoo', async () => {
  let intentos = 0;
  const entorno = { ...ENTORNO };
  const fetchImpl = async () => { intentos += 1; throw new Error('no debió llamarse'); };
  // `avancys` sin pasar: el catálogo decide si crea el lector mirando lo que se pidió.
  await resolverParaLector(null, { lector: 'agt003.copiloto', nombres: ['dato.inexistente'], entorno, fetchImpl });
  assert.equal(intentos, 0);
});
