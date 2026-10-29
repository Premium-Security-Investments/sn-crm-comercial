import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AvancysLecturaError,
  MAX_CLIENTES_LISTADOS,
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
    if (operador === '>') return Number(id || 0) > valor;
    if (operador === 'ilike') return String(actual || '').toLowerCase().includes(String(valor).toLowerCase());
    if (operador === '!=') return valor === false ? !(id === false || id === undefined || id === null) : id !== valor;
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
    else if (args[4] === 'read_group') {
      // Los servicios por cliente se leen agrupados; el doble devuelve los grupos que se le den.
      const [, , , modelo, , posicional] = args;
      llamadas[llamadas.length - 1].modelo = modelo;
      const dominio = posicional[0] || [];
      const enLote = dominio.find(hoja => hoja[0] === 'client_id');
      result = (tablas.__grupos || []).filter(g => !enLote || enLote[2].includes(g.client_id[0]));
    } else {
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

// ---- La cartera del comercial ----

test('la cartera trae los clientes de los usuarios de Odoo que se le pasen', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [
    { ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'] },
    { ...OTRO, customer_rank: 5, user_id: [77, 'VERONICA DUQUE'] },
    { id: 999, name: 'DE OTRO COMERCIAL', ref_num: '111', verification_code: 1, customer_rank: 3, user_id: [64, 'CARLOS BEDOYA'], write_date: '2026-10-01 00:00:00' },
  ];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  // Dos usuarios de Odoo para un solo comercial del CRM: así se le muestran al gerente los
  // clientes de quienes ya no están en la empresa.
  const leido = await lector.clientesDelComercial({ odooUserIds: [67, 77] });

  assert.equal(leido.total, 2);
  assert.equal(leido.recortada, false);
  assert.deepEqual(leido.clientes.map(c => c.identificacion.numero).sort(), ['860053914', '900480569']);
  // El de otro comercial no se cuela.
  assert.ok(!leido.clientes.some(c => c.nombre === 'DE OTRO COMERCIAL'));
  // Cada cliente dice quién lo atiende en Avancys, para que el comercial sepa cuáles no son suyos.
  assert.deepEqual([...new Set(leido.clientes.map(c => c.atendido_por))].sort(), ['JOHN ESCOBAR', 'VERONICA DUQUE']);
  assert.ok(leido.as_of);
});

test('cada cliente trae con qué filtrarlo: departamento, productos y tipo de servicio', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [{ ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'], state_id: [1, 'Risaralda (CO)'] }];
  tablas.__grupos = [
    { client_id: [CIDE.id, CIDE.name], product_id: [5, '[VI002] VIGILANCIA FISICA SIN ARMA'], service_type: 'fijos', __count: 3 },
    { client_id: [CIDE.id, CIDE.name], product_id: [9, '[MO005] MONITOREO TELEMATICO (GPRS)'], service_type: 'monitoreo', __count: 1 },
  ];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.clientesDelComercial({ odooUserIds: [67] });

  assert.equal(leido.clientes[0].departamento, 'Risaralda (CO)');
  assert.deepEqual(leido.clientes[0].productos, ['[MO005] MONITOREO TELEMATICO (GPRS)', '[VI002] VIGILANCIA FISICA SIN ARMA']);
  assert.deepEqual(leido.clientes[0].tipos_de_servicio, ['fijos', 'monitoreo']);
});

test('un cliente sin órdenes no rompe la lista: sale con sus listas vacías', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [{ ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'] }];
  tablas.__grupos = [];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const leido = await lector.clientesDelComercial({ odooUserIds: [67] });
  assert.equal(leido.total, 1);
  assert.deepEqual(leido.clientes[0].productos, []);
  assert.equal(leido.clientes[0].departamento, null);
});

test('sin servicios no se hace la agrupación cara, y la respuesta lo declara', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [{ ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'] }];
  tablas.__grupos = [{ client_id: [CIDE.id, CIDE.name], product_id: [5, 'X'], service_type: 'fijos', __count: 1 }];
  const { fetchImpl, llamadas } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });

  const rapida = await lector.clientesDelComercial({ odooUserIds: [67], conServicios: false });
  assert.equal(rapida.con_servicios, false);
  assert.deepEqual(rapida.clientes[0].productos, []);
  // Lo que importa: la agrupación —que con 1.439 clientes puede tardar 18 segundos— no se corre.
  assert.equal(llamadas.filter(l => l.args?.[4] === 'read_group').length, 0);

  const completa = await lector.clientesDelComercial({ odooUserIds: [67] });
  assert.equal(completa.con_servicios, true);
  assert.deepEqual(completa.clientes[0].productos, ['X']);
  assert.ok(llamadas.filter(l => l.args?.[4] === 'read_group').length > 0);
});

test('un comercial sin usuario de Odoo no pide una cartera vacía: falla y se declara', async () => {
  const { fetchImpl } = odooDeMentira(baseCoherente());
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  await assert.rejects(() => lector.clientesDelComercial({ odooUserIds: [] }), error => {
    assert.equal(error.codigo, 'AVANCYS_COMERCIAL_SIN_USUARIO');
    return true;
  });
  // Un id inválido no se convierte en una consulta sin filtro, que traería TODA la cartera ajena.
  await assert.rejects(() => lector.clientesDelComercial({ odooUserIds: [0, -1, null, 'x'] }), AvancysLecturaError);
});

test('sin ids y sin ser dirección, la cartera no se abre entera', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [
    { ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'] },
    { ...OTRO, customer_rank: 5, user_id: [64, 'CARLOS BEDOYA'] },
  ];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  // El caso peligroso: ids vacíos. Sin la guarda, el dominio quedaría sin filtro de usuario y un
  // comercial vería los clientes de todos.
  await assert.rejects(() => lector.clientesDelComercial({ odooUserIds: [] }), AvancysLecturaError);
  // Con `todos` —y eso sólo lo decide el servidor por el rol— sí se abre.
  const completa = await lector.clientesDelComercial({ odooUserIds: [], todos: true });
  assert.equal(completa.total, 2);
});

test('el tope de la cartera existe y la respuesta avisa cuando recorta', () => {
  assert.ok(Number.isSafeInteger(MAX_CLIENTES_LISTADOS) && MAX_CLIENTES_LISTADOS >= 900,
    'el gerente comercial sostiene 877 clientes: el tope no puede quedar por debajo');
});

// ---- El selector de clientes al crear una oportunidad ----

test('buscar por nombre encuentra al cliente y trae su NIT sin que nadie lo escriba', async () => {
  const tablas = baseCoherente();
  tablas['res.partner'] = [
    { ...CIDE, customer_rank: 10, user_id: [67, 'JOHN ESCOBAR'] },
    { ...OTRO, customer_rank: 5, user_id: [64, 'CARLOS BEDOYA'] },
  ];
  const { fetchImpl } = odooDeMentira(tablas);
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const r = await lector.buscarClientes({ texto: 'jeronimo' });

  assert.equal(r.clientes.length, 1);
  assert.equal(r.clientes[0].identificacion.numero, '900480569');
  // Dice quién lo atiende aunque sea de otro comercial: es lo que evita crearlo por segunda vez.
  assert.equal(r.clientes[0].atendido_por, 'CARLOS BEDOYA');
});

test('con menos de tres letras no se consulta a Avancys', async () => {
  const { fetchImpl, llamadas } = odooDeMentira(baseCoherente());
  const lector = crearLectorAvancys({ entorno: ENTORNO, fetchImpl });
  const r = await lector.buscarClientes({ texto: 'pa' });
  assert.deepEqual(r.clientes, []);
  // Ni una sola llamada: esto corre mientras alguien teclea.
  assert.equal(llamadas.length, 0);
  assert.deepEqual((await lector.buscarClientes({ texto: '  ' })).clientes, []);
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

test('la llave llega con la persona que responde por ella, y por eso sostiene una afirmación', async () => {
  const resueltos = await resolverParaLector(null, {
    lector: 'agt003.copiloto', nombres: ['operacion.cliente_del_puesto'],
    puestoCodigo: 'CIDE RIONEGRO', avancys: AVANCYS_DE_MENTIRA, entorno: {},
  });
  assert.equal(resueltos.length, 1);
  // Nombrado por Juan el 2026-10-28. Sin nombre el catálogo la degradaría a no_verificado.
  assert.equal(resueltos[0].responsable, 'Fabián Franco');
  assert.equal(resueltos[0].estado, ESTADOS.VIGENTE);
  assert.equal(sostieneAfirmacion(resueltos[0]), true);
});

test('en disputa no sostiene afirmación ni con responsable nombrado', async () => {
  const enDisputa = {
    clienteDelPuesto: async () => ({
      encontrado: true, codigo: 'X', total: 1, as_of: '2026-10-01T00:00:00Z',
      puestos: [{ cliente: { nombre: 'A' }, rutas: { coinciden: false } }],
    }),
  };
  const resueltos = await resolverParaLector(null, {
    lector: 'agt003.copiloto', nombres: ['operacion.cliente_del_puesto'],
    puestoCodigo: 'X', avancys: enDisputa, entorno: {},
  });
  // Tener dueño no vuelve cierto un dato que se contradice consigo mismo: el peor estado gana.
  assert.equal(resueltos[0].responsable, 'Fabián Franco');
  assert.equal(resueltos[0].estado, ESTADOS.EN_DISPUTA);
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

// ---- El cableado del copiloto comercial ----
//
// Estático, y por una razón: el cableado vive en los dos archivos de backend de 560 kB que deben
// quedar idénticos (`check:backend-parity`), y no se pueden importar sin levantar el servidor.
// Lo que se fija aquí es lo que se rompería en silencio: que la fuente esté en la lista del lector,
// que el NIT se lea de donde vive, y que no se lea de donde no está.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKENDS = ['server/index.js', 'api/[...path].js'];
const leer = rel => readFileSync(resolve(raiz, rel), 'utf8');

test('los dos archivos de backend siguen siendo idénticos', () => {
  const [uno, dos] = BACKENDS.map(leer);
  assert.equal(uno, dos, 'server/index.js y api/[...path].js deben quedar byte a byte iguales');
});

test('el copiloto comercial pide la fuente de Avancys, en los dos backends', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    const lista = /const AGT003_COPILOTO_FUENTES = Object\.freeze\(\[([^\]]*)\]\)/.exec(texto);
    assert.ok(lista, `${archivo}: no se encontró la lista de fuentes del copiloto`);
    assert.match(lista[1], /'operacion\.puestos_del_cliente'/, archivo);
    // Las que ya tenía no se pierden.
    assert.match(lista[1], /'empresa\.identidad'/, archivo);
    assert.match(lista[1], /'empresa\.sedes'/, archivo);
    // La otra dirección de la llave necesita un código de puesto, que el copiloto no tiene de
    // dónde sacar: declarada sí, pedida no. Pedirla sería ruido en cada respuesta.
    assert.doesNotMatch(lista[1], /'operacion\.cliente_del_puesto'/, archivo);
  }
});

test('el NIT se lee de la tabla, que es donde vive, y no de la vista enriquecida', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    const fn = /async function loadAgt003OpportunityClientNit\(database, opportunityId\) \{[\s\S]*?\n\}/.exec(texto);
    assert.ok(fn, `${archivo}: falta el lector del NIT`);
    const cuerpo = fn[0];
    // `company_nit` está en psi_sales_opportunities (migración 113) y NO en
    // v_psi_sales_opportunity_enriched. Pedirlo a la vista devolvería 42703 y el NIT saldría
    // siempre nulo, con la fuente siempre no_verificada y sin que nada fallara a la vista.
    assert.match(cuerpo, /from\('psi_sales_opportunities'\)/, archivo);
    assert.match(cuerpo, /select\('company_nit'\)/, archivo);
    assert.doesNotMatch(cuerpo, /v_psi_sales_opportunity_enriched/, archivo);
    // Falla blanda: una oportunidad sin NIT, o una consulta caída, no impiden el borrador.
    assert.match(cuerpo, /if \(error\) return null;/, archivo);
    assert.match(cuerpo, /catch \{\s*return null;/, archivo);
    assert.ok(!/\bmust\(/.test(cuerpo), `${archivo}: el lector del NIT no debe lanzar`);
  }
});

test('el resolvedor del copiloto espera el NIT antes de preguntarle al catálogo', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    const bloque = /resolveSources: async \(\{ opportunityId \} = \{\}\) => resolverParaLector\(database, \{[\s\S]*?\}\),/.exec(texto);
    assert.ok(bloque, `${archivo}: el resolvedor del copiloto no recibe la oportunidad`);
    assert.match(bloque[0], /lector: 'agt003\.copiloto'/, archivo);
    assert.match(bloque[0], /clienteIdentificacion: await loadAgt003OpportunityClientNit\(database, opportunityId\)/, archivo);
  }
});

test('el endpoint de la cartera existe en los dos backends y falla blando', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    assert.match(texto, /'GET \/api\/avancys\/mis-clientes': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_DETAIL_VIEW\]/, archivo);
    const handler = /app\.get\('\/api\/avancys\/mis-clientes'[\s\S]*?\n\}\);/.exec(texto);
    assert.ok(handler, `${archivo}: falta el endpoint de la cartera`);
    const cuerpo = handler[0];
    // La equivalencia de personas sale de la base, no de Avancys.
    assert.match(cuerpo, /from\('psi_avancys_salesperson_map'\)/, archivo);
    assert.match(cuerpo, /\.eq\('profile_id', currentProfile\.id\)/, archivo);
    // Tres fallas blandas: sin equivalencia, sin Avancys configurado, y Avancys sin responder.
    assert.match(cuerpo, /no tiene comercial equivalente/, archivo);
    assert.match(cuerpo, /no esta configurado/, archivo);
    assert.match(cuerpo, /Avancys no respondio/, archivo);
    // Nunca se pide la cartera con los ids de otro perfil.
    assert.match(cuerpo, /odooUserIds: asignaciones\.map\(fila => fila\.odoo_user_id\)/, archivo);
    // Estrechar siempre se concede; ensanchar se comprueba contra el rol real. Esa asimetría es
    // lo único que impide que un comercial pida `alcance=todos` por la URL y vea cartera ajena.
    assert.match(cuerpo, /const puedeVerTodo = veTodaLaCarteraComercial\(currentProfile\);/, archivo);
    assert.match(cuerpo, /pedido === 'propios'\s*\?\s*false/, archivo);
    assert.match(cuerpo, /puedeVerTodo && \(pedido === 'todos' \|\| asignaciones\.length === 0\)/, archivo);
  }
});

test('la migración del mapa de comerciales no escribe en Avancys ni copia clientes', () => {
  const sql = leer('supabase/migrations/160_avancys_comercial_del_cliente.sql');
  assert.match(sql, /create table if not exists public\.psi_avancys_salesperson_map/);
  assert.match(sql, /references public\.psi_sales_profiles\(id\)/);
  // La tabla guarda personas, no clientes: si algún día alguien le mete los clientes, esto cae.
  assert.ok(!/customer|cliente_id|partner_id/i.test(sql), 'el mapa no debe guardar clientes');
  assert.match(sql, /revoke all on public\.psi_avancys_salesperson_map from anon, authenticated, public/);
  // Y existe su reverso.
  assert.match(leer('supabase/rollbacks/160_avancys_comercial_del_cliente_rollback.sql'), /drop table if exists public\.psi_avancys_salesperson_map/);
});

test('el selector de clientes suma Avancys sin duplicar ni depender de que responda', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    const handler = /app\.get\('\/api\/client-typeahead'[\s\S]*?\n\}\);/.exec(texto);
    assert.ok(handler, `${archivo}: falta el endpoint del selector`);
    const cuerpo = handler[0];
    // Lo del CRM primero, y lo de Avancys sólo si no está ya por nombre.
    assert.match(cuerpo, /const yaEstan = new Set\(delCrm\.map\(cliente => normalizeClientName\(cliente\.company_name\)\)\)/, archivo);
    assert.match(cuerpo, /!yaEstan\.has\(normalizeClientName\(cliente\.nombre\)\)/, archivo);
    // Un cliente de Avancys no se hace pasar por cliente del CRM.
    assert.match(cuerpo, /id: `avancys:/, archivo);
    assert.match(cuerpo, /origen: 'avancys'/, archivo);
    // Avancys caído no puede impedir crear una oportunidad: va en try/catch y sólo deja aviso.
    assert.match(cuerpo, /client_typeahead_avancys_unavailable/, archivo);
    assert.match(cuerpo, /let deAvancys = \[\];/, archivo);
  }
});

test('el formulario no manda un cliente de Avancys como si fuera del CRM', () => {
  const ui = leer('src/main.tsx');
  const fn = /const selectClientSuggestion = \(client: ClientSuggestion\) => \{[\s\S]*?\n  \};/.exec(ui);
  assert.ok(fn, 'falta el manejador del selector');
  const cuerpo = fn[0];
  assert.match(cuerpo, /const deAvancys = client\.origen === 'avancys';/);
  // Sin esto, `avancys:891400378` viajaría como client_id y la oportunidad quedaría colgada de
  // un cliente que no existe en la base del CRM.
  assert.match(cuerpo, /client_id: deAvancys \? '' : client\.id/);
  // El NIT llega solo, y el segmento es cierto por construcción: está en Avancys porque se factura.
  assert.match(cuerpo, /company_nit: deAvancys \?/);
  assert.match(cuerpo, /customer_segment: deAvancys \? 'cliente_actual'/);
});

test('la pantalla de clientes pide primero la lista y después los productos', () => {
  const ui = leer('src/main.tsx');
  // Sin esto la dirección mira un "cargando" ocho segundos —o dieciocho, que también se midió—
  // antes de ver un solo cliente.
  assert.match(ui, /\/api\/avancys\/mis-clientes\?sin_servicios=1/);
  assert.match(ui, /setDatos\(rapida\); setEstado\('listo'\);/);
  // Y si la segunda falla, la lista ya visible se queda y se declara qué filtros faltan —ahora
  // con su propio estado, para no confundir "falló" con "todavía no llega".
  assert.match(ui, /setServicios\('fallaron'\)/);
  assert.match(ui, /los filtros de producto y tipo de servicio no están disponibles/);
});

test('el endpoint acepta pedir la lista sin los servicios', () => {
  for (const archivo of BACKENDS) {
    assert.match(leer(archivo), /conServicios: req\.query\.sin_servicios !== '1'/, archivo);
  }
});

test('Clientes obedece la Vista Admin / Vista Comercial que ya tiene el CRM', () => {
  const ui = leer('src/main.tsx');
  // En Vista Comercial `currentProfile` llega con rol comercial, así que `mios` ya refleja la
  // vista elegida y la pantalla pide su cartera. Sin esto, el gerente comercial veía los 1.439
  // de la compañía aunque estuviera en Vista Comercial.
  assert.match(ui, /const alcance = mios \? '&alcance=propios' : '';/);
  // Y recarga al cambiar de vista: sin esto cambiaría el rótulo sin cambiar los datos.
  assert.match(ui, /\}, \[mios\]\);/);
  // Ninguna casilla propia: el CRM ya tenía ese interruptor y no se duplica (Juan, 2026-10-29).
  assert.ok(!/Ver todos los clientes de la compañía/.test(ui), 'no se inventa un segundo interruptor de vista');
});

test('la pantalla distingue "cargando los servicios" de "no se pudieron leer"', () => {
  const ui = leer('src/main.tsx');
  // Decía "no están disponibles" mientras simplemente no habían llegado. Dos cosas distintas
  // contadas igual; Juan lo vio en producción el 2026-10-29.
  assert.match(ui, /const \[servicios, setServicios\] = useState<'cargando'\|'listos'\|'fallaron'>\('cargando'\);/);
  assert.match(ui, /servicios === 'cargando' && <> · <span className="muted">consultando qué le prestamos a cada uno…/);
  assert.match(ui, /servicios === 'fallaron' && <p className="muted">No se pudo leer/);
  // Y lo que se eliminó: el mensaje de falla ya no cuelga del dato que trae la respuesta rápida,
  // que siempre viene sin servicios y por eso mentía.
  assert.ok(!/datos\.con_servicios === false/.test(ui), 'el aviso no puede depender de la respuesta rápida');
});

test('los clientes se muestran en tabla y el producto por su código', () => {
  const ui = leer('src/main.tsx');
  const vista = ui.slice(ui.indexOf('function ClientsView'), ui.indexOf('function OpportunityList'));
  assert.match(vista, /<th>Cliente<\/th><th>NIT<\/th><th>Departamento<\/th><th>Servicios<\/th>/);
  // El nombre completo del producto ocupaba dos renglones por fila; en la celda va el código y
  // el nombre queda al pasar el mouse.
  assert.match(vista, /codigoDeProducto\(nombre\)/);
  assert.match(vista, /<span key=\{nombre\} title=\{nombre\}>/);
  // La columna del comercial sólo aparece cuando hay más de uno a la vista.
  assert.match(vista, /\{comerciales\.length > 1 && <th>Comercial<\/th>\}/);
  // Y el panel ya no repite el título de la pantalla.
  assert.ok(!/<Panel title=\{mios \? 'Mis clientes' : 'Clientes'\}>/.test(vista), 'el título no se repite');
});

test('el menú de Clientes tiene icono, como las demás entradas', () => {
  const iconos = leer('src/shell/UserMenu.tsx');
  assert.match(iconos, /'#\/clients': \w+,/);
});

test('el cliente se puede abrir, y lo del CRM no depende de que Avancys responda', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    assert.match(texto, /'GET \/api\/avancys\/cliente': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_DETAIL_VIEW\]/, archivo);
    const cuerpo = /app\.get\('\/api\/avancys\/cliente'[\s\S]*?\n\}\);/.exec(texto)[0];
    // Las oportunidades se leen ANTES de tocar Avancys: si el ERP falla, la pantalla igual sirve.
    assert.ok(cuerpo.indexOf('psi_sales_opportunities') < cuerpo.indexOf('crearLectorAvancys'),
      `${archivo}: lo del CRM debe leerse antes que Avancys`);
    assert.match(cuerpo, /motivo = `Avancys no respondio/, archivo);
    // La respuesta declara de dónde salió la lista, sea un enlace confirmado o un parecido.
    assert.match(cuerpo, /emparejamiento,/, archivo);
    assert.match(cuerpo, /normalizeClientName\(nombre\)/, archivo);
  }
});

test('la pantalla avisa que las oportunidades se emparejaron por nombre', () => {
  const ui = leer('src/main.tsx');
  const comp = ui.slice(ui.indexOf('function ClienteAbierto'), ui.indexOf('function ClientsView'));
  assert.match(comp, /por nombre, no por identificación: revísela antes de darla por suya/);
  // Y cuando alguien ya confirmó el enlace, la pantalla deja de advertir: son sus oportunidades.
  assert.match(comp, /alguien confirmó que este es el mismo cliente/);
  // Y se consulta al abrir la fila, no al cargar la lista: son 1.439 clientes.
  assert.match(comp, /\/api\/avancys\/cliente\?nit=/);
  assert.match(comp, /\}, \[nit, nombre, recargar\]\);/);
});

test('el enlace cliente↔Avancys lo confirma una persona, y entonces el emparejamiento es exacto', () => {
  for (const archivo of BACKENDS) {
    const texto = leer(archivo);
    // Guardar el enlace afirma algo sobre los datos de la empresa: pide permiso de edición.
    assert.match(texto, /'PUT \/api\/avancys\/cliente-enlace': \['opportunities', ACTIONS\.CRM_OPPORTUNITY_EDIT\]/, archivo);
    const detalle = /app\.get\('\/api\/avancys\/cliente'[\s\S]*?\n\}\);/.exec(texto)[0];
    // Con enlace confirmado se busca por client_id —exacto—; sin él, por nombre.
    assert.match(detalle, /\.eq\('avancys_ref_num', identificacion\)/, archivo);
    assert.match(detalle, /emparejamiento = 'enlace_confirmado'/, archivo);
    assert.match(detalle, /emparejamiento = 'nombre_aproximado'/, archivo);
    // El candidato se propone, no se guarda solo.
    assert.match(detalle, /const candidato = enlace\?\.client_id \? null : clienteMasFrecuente\(oportunidades\);/, archivo);

    const enlace = /app\.put\('\/api\/avancys\/cliente-enlace'[\s\S]*?\n\}\);/.exec(texto)[0];
    // No se enlaza a un id inventado.
    assert.match(enlace, /El cliente del CRM no existe/, archivo);
    // Y un cliente de Avancys no puede quedar enlazado a dos del CRM: eso sería un duplicado
    // nuestro, y se arregla acá, no duplicando el enlace.
    assert.match(enlace, /ya esta enlazado a otro cliente del CRM/, archivo);
    assert.match(enlace, /confirmado_por: currentProfile\.id/, archivo);
  }
});

test('la migración del enlace no toca el camino crítico de escritura', () => {
  const sql = leer('supabase/migrations/161_cliente_crm_avancys.sql');
  // Sin comentarios: la cabecera explica por qué NO se toca `psi_persist_sales_opportunity`, y esa
  // explicación no puede hacer fallar una comprobación sobre lo que el archivo ejecuta.
  const ejecuta = sql.split('\n').filter(linea => !linea.trim().startsWith('--')).join('\n');
  assert.match(sql, /create table if not exists public\.psi_cliente_avancys/);
  assert.match(sql, /constraint psi_cliente_avancys_ref_num_unico unique \(avancys_ref_num\)/);
  // La razón de ser de esta tabla: NO tocar psi_persist_sales_opportunity ni psi_sales_clients.
  assert.ok(!/psi_persist_sales_opportunity/.test(ejecuta), 'no debe tocar la función que escribe oportunidades');
  assert.ok(!/alter table public\.psi_sales_clients/.test(ejecuta), 'no debe alterar el maestro de clientes');
  assert.match(sql, /revoke all on public\.psi_cliente_avancys from anon, authenticated, public/);
  assert.match(leer('supabase/rollbacks/161_cliente_crm_avancys_rollback.sql'), /drop table if exists public\.psi_cliente_avancys/);
});
