// Qué puede leer hoy el usuario de integración de Avancys, y qué no.
//
// El 2026-10-29 se midió que cinco modelos estaban denegados y se pidió el permiso. Nadie volvió
// a medir: la respuesta a "¿ya lo dieron?" se suponía en vez de preguntarle a Odoo.
//
// Las credenciales están marcadas como sensibles en Vercel: no se pueden descargar, solo las lee
// la aplicación desplegada. Por eso la medición vive aquí y la sirve un endpoint del CRM, en vez de
// correr desde una consola con las llaves copiadas.
//
// Solo lectura: login, search_count y fields_get. No escribe nada en Avancys.

import { configuracionDeAvancys } from './avancys-odoo-lectura.js';

// Lo que la Torre ya usa: se confirma que sigue abierto.
export const MODELOS_EN_USO = Object.freeze([
  ['res.partner', 'clientes'],
  ['hr.employee', 'empleados'],
  ['hr.contract', 'contratos laborales'],
  ['project.service.order.line', 'líneas de orden de servicio (devengado)'],
  ['account.move', 'facturas (facturación y cartera)'],
  ['hr.roster.puesto', 'puestos'],
  ['account.analytic.account', 'cuentas analíticas (centro de costo)'],
  ['project.project', 'contratos de proyecto'],
]);

// Pedidos al administrador de Avancys el 2026-10-29.
export const MODELOS_PEDIDOS = Object.freeze([
  ['hr.tarifario', 'tarifas'],
  ['project.profitability.report', 'rentabilidad que calcula Odoo'],
  ['hr.contract.risk', 'riesgo del contrato'],
  ['hr.roster.modalidad', 'modalidades de turno'],
]);

// El único que desbloquea rentabilidad por cliente: un campo de hr.contract.
export const CAMPO_CLAVE = Object.freeze({
  modelo: 'hr.contract',
  campo: 'analytic_distribution',
  para: 'cómo se reparte el costo de cada empleado entre las cuentas analíticas',
  grupo: 'Human Resources / Jefe de Nómina',
});

const TIEMPO_MAXIMO_MS = 30_000;

// El informe de rentabilidad que calcula Odoo. El 2026-10-29 se concluyó que no servía, pero
// estaba denegado y nadie pudo mirar adentro; el 2026-11-12 apareció legible con 2.965 filas.
// Antes de construir encima, hay que saber qué trae: qué columnas, cuánto suma cada una y en
// cuántas filas viene llena. Solo agregados: ninguna fila de cliente sale de aquí.
export const INFORME_RENTABILIDAD = 'project.profitability.report';
const TIPOS_NUMERICOS = new Set(['monetary', 'float', 'integer']);
const VINCULOS = ['partner_id', 'project_id', 'analytic_account_id', 'sale_order_id', 'company_id'];
const FECHAS = ['line_date', 'date'];

function motivoDe(error) {
  return String(error?.message || error).split('\n')[0].slice(0, 200);
}

export async function medirAccesoAvancys({ config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date() } = {}) {
  if (!config) return { configurado: false, motivo: 'Avancys no está configurado en este ambiente.' };

  let serie = 0;
  async function rpc(service, method, args) {
    const respuesta = await fetchImpl(`${config.origen}/jsonrpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++serie, params: { service, method, args } }),
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const cuerpo = await respuesta.json();
    if (cuerpo.error) {
      const dato = cuerpo.error.data || {};
      throw new Error(`${dato.name || cuerpo.error.message}: ${String(dato.message || '').split('\n')[0]}`);
    }
    return cuerpo.result;
  }

  let uid;
  try {
    uid = await rpc('common', 'login', [config.database, config.username, config.clave]);
  } catch (error) {
    return { configurado: true, autenticado: false, origen: config.origen, motivo: motivoDe(error), medido_en: ahora().toISOString() };
  }
  if (!uid) return { configurado: true, autenticado: false, origen: config.origen, motivo: 'Odoo rechazó el usuario o la clave de API.', medido_en: ahora().toISOString() };

  const ejecutar = (modelo, metodo, args, kwargs = {}) =>
    rpc('object', 'execute_kw', [config.database, uid, config.clave, modelo, metodo, args, kwargs]);

  async function probar([modelo, para]) {
    try {
      const filas = await ejecutar(modelo, 'search_count', [[]]);
      return { modelo, para, permitido: true, filas };
    } catch (error) {
      return { modelo, para, permitido: false, motivo: motivoDe(error) };
    }
  }

  const enUso = [];
  for (const modelo of MODELOS_EN_USO) enUso.push(await probar(modelo));
  const pedidos = [];
  for (const modelo of MODELOS_PEDIDOS) pedidos.push(await probar(modelo));

  const clave = { ...CAMPO_CLAVE, permitido: false };
  try {
    const campos = await ejecutar(CAMPO_CLAVE.modelo, 'fields_get', [[CAMPO_CLAVE.campo]], { attributes: ['string', 'type'] });
    if (campos?.[CAMPO_CLAVE.campo]) {
      clave.permitido = true;
      clave.total = await ejecutar(CAMPO_CLAVE.modelo, 'search_count', [[]]);
      clave.diligenciados = await ejecutar(CAMPO_CLAVE.modelo, 'search_count', [[[CAMPO_CLAVE.campo, '!=', false]]]);
    } else {
      clave.motivo = `El campo no aparece para este usuario; lo abre el grupo ${CAMPO_CLAVE.grupo}.`;
    }
  } catch (error) {
    clave.motivo = motivoDe(error);
  }

  let informe = null;
  if (pedidos.find(fila => fila.modelo === INFORME_RENTABILIDAD)?.permitido) {
    informe = await mirarInformeRentabilidad(ejecutar);
  }
  const lineas = await mirarLineasAnaliticas(ejecutar, { ahora });

  return {
    configurado: true,
    autenticado: true,
    origen: config.origen,
    medido_en: ahora().toISOString(),
    en_uso: enUso,
    pedidos,
    campo_clave: clave,
    rentabilidad_por_cliente: clave.permitido ? 'desbloqueada' : 'bloqueada',
    informe_rentabilidad: informe,
    lineas_analiticas: lineas,
  };
}

// Suma de una columna en todo el informe. Odoo 14 no siempre acepta read_group sin agrupar,
// así que si falla se agrupa por compañía y se suma aquí.
async function sumar(ejecutar, campo) {
  try {
    const grupos = await ejecutar(INFORME_RENTABILIDAD, 'read_group', [[], [`${campo}:sum`], []], { lazy: false });
    return (grupos || []).reduce((total, grupo) => total + (Number(grupo[campo]) || 0), 0);
  } catch {
    const grupos = await ejecutar(INFORME_RENTABILIDAD, 'read_group', [[], [`${campo}:sum`], ['company_id']], { lazy: false });
    return (grupos || []).reduce((total, grupo) => total + (Number(grupo[campo]) || 0), 0);
  }
}

export async function mirarInformeRentabilidad(ejecutar) {
  try {
    const campos = await ejecutar(INFORME_RENTABILIDAD, 'fields_get', [], { attributes: ['string', 'type', 'relation', 'store'] });
    const filas = await ejecutar(INFORME_RENTABILIDAD, 'search_count', [[]]);
    const numericos = [];
    for (const [campo, def] of Object.entries(campos || {})) {
      if (!TIPOS_NUMERICOS.has(def.type) || def.store === false || campo === 'id') continue;
      const total = await sumar(ejecutar, campo);
      const conValor = await ejecutar(INFORME_RENTABILIDAD, 'search_count', [[[campo, '!=', 0]]]);
      numericos.push({ campo, etiqueta: def.string || campo, tipo: def.type, total, filas_con_valor: conValor });
    }
    numericos.sort((izq, der) => Math.abs(der.total) - Math.abs(izq.total));

    const vinculos = [];
    for (const campo of VINCULOS) {
      if (!campos?.[campo]) continue;
      const conValor = await ejecutar(INFORME_RENTABILIDAD, 'search_count', [[[campo, '!=', false]]]);
      vinculos.push({ campo, etiqueta: campos[campo].string || campo, relacion: campos[campo].relation || null, filas_con_valor: conValor });
    }

    let fechas = null;
    const campoFecha = FECHAS.find(campo => campos?.[campo]);
    if (campoFecha) {
      const primera = await ejecutar(INFORME_RENTABILIDAD, 'search_read', [[[campoFecha, '!=', false]]], { fields: [campoFecha], limit: 1, order: `${campoFecha} asc` });
      const ultima = await ejecutar(INFORME_RENTABILIDAD, 'search_read', [[[campoFecha, '!=', false]]], { fields: [campoFecha], limit: 1, order: `${campoFecha} desc` });
      fechas = { campo: campoFecha, desde: primera?.[0]?.[campoFecha] || null, hasta: ultima?.[0]?.[campoFecha] || null };
    }

    // Mes a mes, para saber si es un mes de operación o tres, y compararlo con lo facturado.
    let porMes = [];
    if (campoFecha) {
      const columnas = numericos.filter(col => col.filas_con_valor > 0).map(col => col.campo);
      if (columnas.length) try {
        const grupos = await ejecutar(INFORME_RENTABILIDAD, 'read_group', [[], columnas.map(c => `${c}:sum`), [`${campoFecha}:month`]], { lazy: false, orderby: `${campoFecha} asc` });
        porMes = (grupos || []).map(grupo => ({
          mes: grupo[`${campoFecha}:month`] || null,
          filas: grupo.__count ?? null,
          sumas: Object.fromEntries(columnas.map(c => [c, Number(grupo[c]) || 0])),
        }));
      } catch {
        // Sin el desglose por mes el resto del informe sigue valiendo.
      }
    }

    // Un costo con nombre de costo y con valor en alguna fila. Es una pista, no una conclusión:
    // la lectura la hace una persona con la tabla completa al lado.
    const costos = numericos.filter(col => /cost|costo/i.test(`${col.campo} ${col.etiqueta}`) && col.filas_con_valor > 0);
    return {
      legible: true,
      filas,
      columnas: Object.keys(campos || {}).length,
      numericos,
      vinculos,
      fechas,
      por_mes: porMes,
      trae_costos: costos.length > 0,
      columnas_de_costo: costos.map(col => col.campo),
    };
  } catch (error) {
    return { legible: false, motivo: motivoDe(error) };
  }
}

// Las líneas analíticas son de donde Odoo saca el informe de rentabilidad. El informe trae el
// costo de partes de horas en cero, pero "otros costos" lleno: si Avancys contabiliza la nómina
// con la cuenta analítica de cada contrato, el costo por cliente ya está aquí, aunque el campo que
// dice cómo se reparte (hr.contract.analytic_distribution) siga oculto. Se mira por mes y por
// cuenta contable (los cuatro primeros dígitos del PUC: 5105, 7205… son gastos de personal).
// Solo agregados, del último año.
export const LINEAS_ANALITICAS = 'account.analytic.line';
const MESES_ATRAS = 12;
// Gastos y costos de personal en el PUC colombiano.
const PUC_PERSONAL = /^(5105|5205|6105|6205|7105|7205|7305|7405|7505)/;

function cuentaPuc(valor) {
  const nombre = Array.isArray(valor) ? String(valor[1] || '') : '';
  const codigo = (nombre.match(/^\s*(\d+)/) || [])[1] || '';
  return { codigo: codigo.slice(0, 4) || 'sin cuenta', nombre: nombre.replace(/^\s*\d+\s*/, '') };
}

export async function mirarLineasAnaliticas(ejecutar, { ahora = () => new Date() } = {}) {
  try {
    const inicio = new Date(ahora());
    inicio.setUTCMonth(inicio.getUTCMonth() - MESES_ATRAS, 1);
    const desde = inicio.toISOString().slice(0, 10);
    const enRango = [['date', '>=', desde]];

    const total = await ejecutar(LINEAS_ANALITICAS, 'search_count', [[]]);
    const filas = await ejecutar(LINEAS_ANALITICAS, 'search_count', [enRango]);
    const conCliente = await ejecutar(LINEAS_ANALITICAS, 'search_count', [[...enRango, ['partner_id', '!=', false]]]);
    const primera = await ejecutar(LINEAS_ANALITICAS, 'search_read', [[]], { fields: ['date'], limit: 1, order: 'date asc' });

    const sumarPor = async (filtro, agrupar) => (await ejecutar(LINEAS_ANALITICAS, 'read_group', [[...enRango, filtro], ['amount:sum'], [agrupar]], { lazy: false })) || [];

    const meses = new Map();
    for (const [lado, filtro] of [['ingresos', ['amount', '>', 0]], ['costos', ['amount', '<', 0]]]) {
      for (const grupo of await sumarPor(filtro, 'date:month')) {
        const mes = grupo['date:month'] || 'sin fecha';
        const fila = meses.get(mes) || { mes, ingresos: 0, costos: 0, filas: 0 };
        fila[lado] += Number(grupo.amount) || 0;
        fila.filas += grupo.__count || 0;
        meses.set(mes, fila);
      }
    }

    const cuentas = new Map();
    for (const grupo of await sumarPor(['amount', '!=', 0], 'general_account_id')) {
      const { codigo, nombre } = cuentaPuc(grupo.general_account_id);
      const fila = cuentas.get(codigo) || { codigo, nombre, monto: 0, filas: 0, personal: PUC_PERSONAL.test(codigo) };
      fila.monto += Number(grupo.amount) || 0;
      fila.filas += grupo.__count || 0;
      cuentas.set(codigo, fila);
    }
    const porCuenta = [...cuentas.values()].sort((izq, der) => Math.abs(der.monto) - Math.abs(izq.monto));
    const personal = porCuenta.filter(fila => fila.personal).reduce((suma, fila) => suma + fila.monto, 0);

    return {
      legible: true,
      total,
      desde,
      filas,
      con_cliente: conCliente,
      primera_fecha: primera?.[0]?.date || null,
      por_mes: [...meses.values()],
      por_cuenta: porCuenta.slice(0, 15),
      cuentas: porCuenta.length,
      costo_de_personal: personal,
      trae_nomina: personal < 0,
    };
  } catch (error) {
    return { legible: false, motivo: motivoDe(error) };
  }
}
