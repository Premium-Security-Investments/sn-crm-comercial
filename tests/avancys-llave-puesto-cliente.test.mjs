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
