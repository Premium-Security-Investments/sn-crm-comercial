// Lectura de Avancys (Odoo 14 Community) para el catálogo de fuentes. Avancys es, por decisión de
// Juan del 2026-10-23, la fuente de clientes, contratos y puestos. Esto es lo único que SIIO usa
// para preguntarle.
//
// Dos reglas de forma, y las dos son de seguridad, no de estilo:
//
//   1. Solo lectura, y la lista de lo legible vive AQUÍ. No hay un `ejecutar(modelo, metodo)` que
//      quien llame pueda apuntar a donde quiera: hay consultas con nombre —`clienteDelPuesto`,
//      `puestosDelCliente`— que arman su propio dominio. El usuario de Odoo también es de solo
//      lectura, así que son dos cierres independientes, no uno repetido.
//   2. Nunca se leen personas. `hr.employee` y `hr.contract` no están en la lista aunque el
//      usuario los pueda ver: el reconocimiento del 2026-10-27 se hizo sin tocar los datos de
//      3.113 empleados y esa frontera no se mueve por conveniencia.
//
// Medido contra producción el 2026-10-28: 3.646 puestos, los 3.646 con contrato, 3.636 con cuenta
// analítica, 1.355 clientes con al menos un puesto.

const CAMPOS = Object.freeze({
  puesto: Object.freeze(['id', 'code', 'name', 'analytic_account_id', 'cliente_contract_id', 'write_date']),
  contrato: Object.freeze(['id', 'name', 'partner_id', 'date_start', 'date', 'write_date']),
  cuenta: Object.freeze(['id', 'code', 'partner_id', 'write_date']),
  orden: Object.freeze(['id', 'client_id', 'product_id', 'service_type']),
  cliente: Object.freeze(['id', 'name', 'ref_num', 'ref_type_id', 'verification_code', 'is_company', 'user_id', 'state_id', 'write_date']),
});

const MODELO = Object.freeze({
  orden: 'project.service.order.line.invoice',
  puesto: 'hr.roster.puesto',
  contrato: 'project.project',
  cuenta: 'account.analytic.account',
  cliente: 'res.partner',
});

// Un cliente grande tiene 1.002 puestos (Jerónimo Martins, medido el 2026-10-28). La respuesta
// viaja al modelo por `minimizarFuentes`, que recorta a 6 kB: se entrega el total completo y una
// porción nombrada de los puestos, nunca la lista entera recortada a la mitad de un nombre.
export const MAX_PUESTOS_LISTADOS = 25;
// Tope de la lista. El gerente comercial sostiene 877 clientes y la dirección ve los 1.439, así
// que esto no es un número decorativo.
export const MAX_CLIENTES_LISTADOS = 2000;
const MAX_FILAS = 2000;
// Clientes por lote al agrupar sus servicios. Ver `serviciosPorCliente`.
const LOTE_AGRUPACION = 200;
const MAX_BYTES = 8388608;
const TIMEOUT_MS = 20000;

export class AvancysLecturaError extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'AvancysLecturaError';
    this.codigo = codigo;
  }
}

const falla = codigo => { throw new AvancysLecturaError(codigo); };

function urlDeOdoo(valor) {
  let url;
  try { url = new URL(valor); } catch { falla('AVANCYS_URL_INVALIDA'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) falla('AVANCYS_URL_INVALIDA');
  return url.origin;
}

/**
 * Lee la configuración del entorno. Devuelve `null` —no lanza— cuando Avancys no está
 * configurado, porque un despliegue sin credenciales de Odoo es un estado válido: el catálogo
 * responde `no_verificado` y lo declara, en vez de caerse o de devolver vacío en silencio.
 */
export function configuracionDeAvancys(entorno = process.env) {
  const url = entorno.AVANCYS_ODOO_URL;
  const database = entorno.AVANCYS_ODOO_DATABASE;
  const username = entorno.AVANCYS_ODOO_USERNAME;
  const clave = entorno.AVANCYS_ODOO_API_KEY;
  if (!url || !database || !username || !clave) return null;
  const companyId = Number(entorno.AVANCYS_ODOO_COMPANY_ID);
  return Object.freeze({
    origen: urlDeOdoo(url),
    database: String(database),
    username: String(username),
    clave: String(clave),
    companyId: Number.isSafeInteger(companyId) && companyId > 0 ? companyId : null,
  });
}

// Normaliza una identificación para buscarla en `ref_num`, que es donde vive el NIT en este Odoo
// —no en `vat` ni en `ref`, que están vacíos en 1.438 de 1.439 clientes—. El dígito de
// verificación vive aparte, en `verification_code`, así que "860053914-4" se busca como
// "860053914". No se adivina más allá de eso: si no aparece, se declara no encontrado.
export function normalizarIdentificacion(valor) {
  const texto = String(valor ?? '').trim();
  if (texto === '') return null;
  const sinDigitoDeVerificacion = texto.split(/[-–/]/)[0];
  const digitos = sinDigitoDeVerificacion.replace(/\D/g, '');
  return digitos === '' ? null : digitos;
}

function unoAMuchos(valor) {
  return Array.isArray(valor) && Number.isSafeInteger(valor[0]) ? valor[0] : null;
}

function texto(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function identificacionDe(cliente) {
  if (!cliente) return null;
  const numero = texto(cliente.ref_num);
  if (!numero) return null;
  const dv = Number.isSafeInteger(cliente.verification_code) ? String(cliente.verification_code) : null;
  return Object.freeze({
    tipo: Array.isArray(cliente.ref_type_id) ? texto(cliente.ref_type_id[1]) : null,
    numero,
    digito_de_verificacion: dv,
  });
}

function clientePublico(cliente) {
  if (!cliente) return null;
  return Object.freeze({
    nombre: texto(cliente.name),
    identificacion: identificacionDe(cliente),
    es_empresa: cliente.is_company === true,
  });
}

// La fecha de corte de una respuesta es el `write_date` más reciente de lo que se leyó: la
// respuesta dice de cuándo es, no cuándo se preguntó.
function corteDe(filas) {
  const fechas = filas.flat().map(fila => fila?.write_date).filter(Boolean).sort();
  return fechas.length ? String(fechas[fechas.length - 1]).replace(' ', 'T') + 'Z' : null;
}

/**
 * Crea el lector. Devuelve `null` si Avancys no está configurado en este entorno.
 *
 * `fetchImpl` se inyecta para las pruebas; en producción es el `fetch` del runtime.
 */
export function crearLectorAvancys({ entorno = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = configuracionDeAvancys(entorno);
  if (!config) return null;

  let uid = null;
  let serie = 0;

  async function rpc(service, method, args) {
    const id = ++serie;
    const señal = AbortSignal.timeout(TIMEOUT_MS);
    let respuesta;
    try {
      respuesta = await fetchImpl(`${config.origen}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id }),
        redirect: 'manual',
        signal: señal,
      });
    } catch {
      falla(señal.aborted ? 'AVANCYS_TIEMPO_AGOTADO' : 'AVANCYS_RED_FALLO');
    }
    if (!respuesta.ok) {
      falla(respuesta.status === 401 || respuesta.status === 403 ? 'AVANCYS_ACCESO_DENEGADO' : 'AVANCYS_HTTP_FALLO');
    }
    const cuerpo = await respuesta.text();
    if (cuerpo.length > MAX_BYTES) falla('AVANCYS_RESPUESTA_GRANDE');
    let datos;
    try { datos = JSON.parse(cuerpo); } catch { falla('AVANCYS_RESPUESTA_INVALIDA'); }
    // Un error de Odoo llega con HTTP 200. Sin esta rama, un permiso denegado se leería como una
    // respuesta vacía y el catálogo diría "el puesto no existe" cuando lo que falta es el permiso.
    if (datos && datos.error) falla('AVANCYS_RPC_FALLO');
    if (!datos || datos.id !== id || !Object.hasOwn(datos, 'result')) falla('AVANCYS_RESPUESTA_INVALIDA');
    return datos.result;
  }

  async function autenticar() {
    if (uid !== null) return uid;
    const resultado = await rpc('common', 'authenticate', [config.database, config.username, config.clave, {}]);
    if (!Number.isSafeInteger(resultado) || resultado <= 0) falla('AVANCYS_AUTENTICACION_FALLO');
    uid = resultado;
    return uid;
  }

  // La única puerta al RPC de datos: un modelo de la lista, `search_read` y nada más, y los campos
  // de la lista. El dominio lo arma este archivo; no entra por parámetro desde afuera.
  async function leer(clave, dominio, { limite = MAX_FILAS, orden = 'id asc' } = {}) {
    const modelo = MODELO[clave];
    const campos = CAMPOS[clave];
    if (!modelo || !campos) falla('AVANCYS_CONSULTA_NO_PERMITIDA');
    const id = await autenticar();
    const nombrado = { fields: [...campos], limit: Math.min(limite, MAX_FILAS), order: orden };
    if (config.companyId) nombrado.context = { allowed_company_ids: [config.companyId] };
    const filas = await rpc('object', 'execute_kw',
      [config.database, id, config.clave, modelo, 'search_read', [dominio], nombrado]);
    if (!Array.isArray(filas)) falla('AVANCYS_RESPUESTA_INVALIDA');
    return filas;
  }

  // Qué le prestamos a cada cliente, para poder filtrar la lista por producto y por tipo de
  // servicio sin una consulta por cliente. Una sola agrupación devuelve ~2.700 filas para los
  // 1.312 clientes con orden, en unos dos segundos; mil consultas no habrían sido viables.
  async function serviciosPorCliente(idsCliente) {
    if (idsCliente.length === 0) return new Map();
    const modelo = MODELO.orden;
    const id = await autenticar();
    const porCliente = new Map();
    // Por lotes, y no de un tirón: `read_group` de Odoo devuelve el dominio completo de cada
    // grupo, así que la respuesta pesa muchísimo más que los datos. Con los 1.439 clientes de la
    // compañía pasaba del tope de 8 MB y el lector fallaba justo en la vista de dirección, que es
    // la única que lo pide entero.
    const grupos = [];
    for (let desde = 0; desde < idsCliente.length; desde += LOTE_AGRUPACION) {
      const lote = idsCliente.slice(desde, desde + LOTE_AGRUPACION);
      const nombrado = { lazy: false, limit: 20000 };
      if (config.companyId) nombrado.context = { allowed_company_ids: [config.companyId] };
      const parcial = await rpc('object', 'execute_kw', [config.database, id, config.clave, modelo, 'read_group',
        [[['state', '=', 'aprobado'], ['client_id', 'in', lote]], ['id'], ['client_id', 'product_id', 'service_type']],
        nombrado]);
      if (!Array.isArray(parcial)) falla('AVANCYS_RESPUESTA_INVALIDA');
      grupos.push(...parcial);
    }
    for (const grupo of grupos) {
      const cliente = unoAMuchos(grupo.client_id);
      if (cliente === null) continue;
      if (!porCliente.has(cliente)) porCliente.set(cliente, { productos: new Set(), tipos: new Set() });
      const entrada = porCliente.get(cliente);
      const producto = Array.isArray(grupo.product_id) ? texto(grupo.product_id[1]) : null;
      if (producto) entrada.productos.add(producto);
      const tipo = texto(grupo.service_type);
      if (tipo) entrada.tipos.add(tipo);
    }
    return porCliente;
  }

  async function clientesPorId(ids) {
    const unicos = [...new Set(ids.filter(valor => Number.isSafeInteger(valor) && valor > 0))];
    if (unicos.length === 0) return new Map();
    const filas = await leer('cliente', [['id', 'in', unicos]], { limite: unicos.length });
    return new Map(filas.map(fila => [fila.id, fila]));
  }

  /**
   * La llave, en la dirección que necesita quien ve un puesto y no sabe de quién es: dado el
   * código del puesto, su cliente y su contrato.
   *
   * El código NO es único —10 códigos se repiten, uno de ellos en 4 puestos, medido el
   * 2026-10-28—, así que la respuesta es una lista. Quien la lea sabe si hubo uno o varios.
   *
   * El cliente llega por dos caminos y los dos se recorren: el contrato lleva su `partner_id` y la
   * cuenta analítica también. De 3.646 puestos, 3.583 coinciden y 27 discrepan. Cuando discrepan,
   * la respuesta no escoge: los entrega los dos y el catálogo la marca en disputa.
   */
  async function clienteDelPuesto({ codigo }) {
    const buscado = texto(codigo);
    if (!buscado) falla('AVANCYS_PUESTO_SIN_CODIGO');
    const puestos = await leer('puesto', [['code', '=', buscado]], { limite: 50 });
    if (puestos.length === 0) {
      return Object.freeze({ encontrado: false, codigo: buscado, puestos: Object.freeze([]), as_of: null });
    }

    const contratos = await leer('contrato',
      [['id', 'in', [...new Set(puestos.map(p => unoAMuchos(p.cliente_contract_id)).filter(Boolean))]]],
      { limite: puestos.length });
    const cuentas = await leer('cuenta',
      [['id', 'in', [...new Set(puestos.map(p => unoAMuchos(p.analytic_account_id)).filter(Boolean))]]],
      { limite: puestos.length });
    const porContrato = new Map(contratos.map(fila => [fila.id, fila]));
    const porCuenta = new Map(cuentas.map(fila => [fila.id, fila]));
    const clientes = await clientesPorId([
      ...contratos.map(fila => unoAMuchos(fila.partner_id)),
      ...cuentas.map(fila => unoAMuchos(fila.partner_id)),
    ].filter(Boolean));

    const detalle = puestos.map(puesto => {
      const contrato = porContrato.get(unoAMuchos(puesto.cliente_contract_id)) || null;
      const cuenta = porCuenta.get(unoAMuchos(puesto.analytic_account_id)) || null;
      const porRutaContrato = contrato ? clientes.get(unoAMuchos(contrato.partner_id)) || null : null;
      const porRutaCuenta = cuenta ? clientes.get(unoAMuchos(cuenta.partner_id)) || null : null;
      const idContrato = porRutaContrato?.id ?? null;
      const idCuenta = porRutaCuenta?.id ?? null;
      return Object.freeze({
        puesto_id: puesto.id,
        codigo: texto(puesto.code),
        nombre: texto(puesto.name),
        centro_de_costo: cuenta ? texto(cuenta.code) : null,
        contrato: contrato ? Object.freeze({
          nombre: texto(contrato.name),
          inicia: contrato.date_start || null,
          vence: contrato.date || null,
        }) : null,
        cliente: clientePublico(porRutaContrato || porRutaCuenta),
        // Dos rutas, y la respuesta dice cuál la sostiene. `coinciden: false` es el caso de los 27.
        rutas: Object.freeze({
          por_contrato: clientePublico(porRutaContrato),
          por_cuenta_analitica: clientePublico(porRutaCuenta),
          coinciden: idContrato !== null && idCuenta !== null ? idContrato === idCuenta : null,
        }),
      });
    });

    return Object.freeze({
      encontrado: true,
      codigo: buscado,
      total: detalle.length,
      puestos: Object.freeze(detalle),
      as_of: corteDe([puestos, contratos, cuentas, [...clientes.values()]]),
    });
  }

  /**
   * La llave en la dirección que necesita el CRM: dado el NIT de un cliente, sus contratos y sus
   * puestos en Avancys. `ref_num` sí es único —1.432 distintos, ninguno repetido—, así que un NIT
   * identifica a un cliente.
   */
  async function puestosDelCliente({ identificacion }) {
    const numero = normalizarIdentificacion(identificacion);
    if (!numero) falla('AVANCYS_CLIENTE_SIN_IDENTIFICACION');
    const clientes = await leer('cliente', [['ref_num', '=', numero]], { limite: 10 });
    if (clientes.length === 0) {
      return Object.freeze({ encontrado: false, identificacion: numero, as_of: null });
    }
    const cliente = clientes[0];
    const contratos = await leer('contrato', [['partner_id', '=', cliente.id]]);
    if (contratos.length === 0) {
      return Object.freeze({
        encontrado: true,
        identificacion: numero,
        cliente: clientePublico(cliente),
        total_contratos: 0,
        total_puestos: 0,
        contratos: Object.freeze([]),
        as_of: corteDe([clientes]),
      });
    }
    const puestos = await leer('puesto', [['cliente_contract_id', 'in', contratos.map(fila => fila.id)]]);
    const porContrato = new Map(contratos.map(fila => [fila.id, []]));
    for (const puesto of puestos) {
      porContrato.get(unoAMuchos(puesto.cliente_contract_id))?.push(puesto);
    }

    // Los contratos con puesto primero: un cliente con 1.002 puestos entrega su total exacto y
    // una porción, y los contratos vacíos no gastan el recorte.
    const ordenados = contratos
      .map(contrato => ({ contrato, suyos: porContrato.get(contrato.id) || [] }))
      .sort((a, b) => b.suyos.length - a.suyos.length);
    let cupo = MAX_PUESTOS_LISTADOS;
    const detalle = ordenados.map(({ contrato, suyos }) => {
      const listados = suyos.slice(0, Math.max(cupo, 0));
      cupo -= listados.length;
      return Object.freeze({
        nombre: texto(contrato.name),
        inicia: contrato.date_start || null,
        vence: contrato.date || null,
        total_puestos: suyos.length,
        puestos: Object.freeze(listados.map(puesto => Object.freeze({
          codigo: texto(puesto.code),
          nombre: texto(puesto.name),
        }))),
      });
    });

    return Object.freeze({
      encontrado: true,
      identificacion: numero,
      cliente: clientePublico(cliente),
      total_contratos: contratos.length,
      total_puestos: puestos.length,
      puestos_listados: MAX_PUESTOS_LISTADOS - Math.max(cupo, 0),
      contratos: Object.freeze(detalle),
      as_of: corteDe([clientes, contratos, puestos]),
    });
  }

  /**
   * Busca clientes por nombre, para el selector que aparece al escribir el cliente de una
   * oportunidad nueva.
   *
   * Es una consulta dirigida con `ilike` y tope bajo, no la cartera entera: esto corre mientras
   * alguien teclea, así que traer 1.439 clientes por pulsación sería inaceptable.
   *
   * Busca en TODA la compañía, no sólo en la cartera de quien escribe, y es a propósito: sirve
   * para no crear por segunda vez un cliente que ya existe. Por eso cada resultado dice quién lo
   * atiende, en vez de esconderlo.
   */
  async function buscarClientes({ texto: consulta, limite = 10 }) {
    const buscado = texto(consulta);
    if (!buscado || buscado.length < 3) return Object.freeze({ clientes: Object.freeze([]), as_of: null });
    const filas = await leer('cliente', [['customer_rank', '>', 0], ['name', 'ilike', buscado]],
      { limite: Math.min(Math.max(limite, 1), 25), orden: 'name asc' });
    return Object.freeze({
      clientes: Object.freeze(filas.map(fila => Object.freeze({
        ...clientePublico(fila),
        atendido_por: Array.isArray(fila.user_id) ? texto(fila.user_id[1]) : null,
        departamento: Array.isArray(fila.state_id) ? texto(fila.state_id[1]) : null,
      }))),
      as_of: corteDe([filas]),
    });
  }

  /**
   * La cartera de un comercial: los clientes que Avancys le tiene asignados.
   *
   * Recibe los ids de usuario de Odoo, no el perfil del CRM, porque la equivalencia entre los dos
   * es una decisión de negocio que vive en la base del CRM —incluido a quién se le muestran los
   * clientes de quienes ya no están— y no tiene por qué conocerla un lector de Odoo.
   *
   * Devuelve la lista sin contratos ni puestos: son 564 clientes en el peor caso y contarlos uno
   * por uno serían mil consultas. Para el detalle de uno está `puestosDelCliente`.
   */
  async function clientesDelComercial({ odooUserIds, todos = false }) {
    const ids = [...new Set((Array.isArray(odooUserIds) ? odooUserIds : [])
      .filter(valor => Number.isSafeInteger(valor) && valor > 0))];
    // `todos` es para la dirección, que ve la cartera entera. Sin él, una lista de ids vacía NO
    // se convierte en "sin filtro": eso le mostraría a un comercial los clientes de todos.
    if (!todos && ids.length === 0) falla('AVANCYS_COMERCIAL_SIN_USUARIO');
    const dominio = todos
      ? [['customer_rank', '>', 0]]
      : [['customer_rank', '>', 0], ['user_id', 'in', ids]];
    const filas = await leer('cliente', dominio,
      { limite: MAX_CLIENTES_LISTADOS, orden: 'name asc' });
    const servicios = await serviciosPorCliente(filas.map(fila => fila.id));
    const clientes = filas.map(fila => {
      const suyos = servicios.get(fila.id);
      return Object.freeze({
        ...clientePublico(fila),
        atendido_por: Array.isArray(fila.user_id) ? texto(fila.user_id[1]) : null,
        // Departamento sí, ciudad no: la tienen 1.435 de 1.439 clientes contra 234. Un filtro que
        // esconde el 84% de la lista es peor que no tenerlo.
        departamento: Array.isArray(fila.state_id) ? texto(fila.state_id[1]) : null,
        productos: Object.freeze(suyos ? [...suyos.productos].sort() : []),
        tipos_de_servicio: Object.freeze(suyos ? [...suyos.tipos].sort() : []),
      });
    });
    return Object.freeze({
      total: clientes.length,
      // Avisa cuando la lista pudo quedar recortada, en vez de mentir con un total que no lo es.
      recortada: clientes.length >= MAX_CLIENTES_LISTADOS,
      clientes: Object.freeze(clientes),
      as_of: corteDe([filas]),
    });
  }

  return Object.freeze({ origen: config.origen, database: config.database, clienteDelPuesto, puestosDelCliente, clientesDelComercial, buscarClientes });
}
