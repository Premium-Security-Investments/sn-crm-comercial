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

// La programación de turnos de Avancys. Hoy no se usa (0 programaciones medidas el 2026-10-29, y
// Juan confirma el 2026-11-12 que se empezará allá). Cuando tenga registros, ahí estará quién cubrió
// qué puesto: el dato real para el costo por cliente. Se cuenta en cada medición para notarlo.
export const MODELOS_TURNOS = Object.freeze([
  ['hr.roster.programacion', 'programaciones de turnos'],
  ['hr.roster.programacion.line', 'líneas de programación (persona, puesto, día)'],
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

// Login y un `ejecutar` de solo lectura. Si no hay sesión, `estado` dice por qué.
export async function abrirSesion({ config, fetchImpl, ahora = () => new Date() }) {
  if (!config) return { estado: { configurado: false, motivo: 'Avancys no está configurado en este ambiente.' } };

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
    return { estado: { configurado: true, autenticado: false, origen: config.origen, motivo: motivoDe(error), medido_en: ahora().toISOString() } };
  }
  if (!uid) return { estado: { configurado: true, autenticado: false, origen: config.origen, motivo: 'Odoo rechazó el usuario o la clave de API.', medido_en: ahora().toISOString() } };

  const ejecutar = (modelo, metodo, args, kwargs = {}) =>
    rpc('object', 'execute_kw', [config.database, uid, config.clave, modelo, metodo, args, kwargs]);
  return { ejecutar };
}

export async function medirAccesoAvancys({ config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date() } = {}) {
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const { ejecutar } = sesion;

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
  const turnos = [];
  for (const modelo of MODELOS_TURNOS) turnos.push(await probar(modelo));

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
    turnos,
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
// costo de partes de horas en cero, pero "otros costos" lleno: Avancys contabiliza la nómina con la
// cuenta analítica de cada contrato (medido el 2026-11-12: 7201 Sueldo vigilantes, 7202 Cesantías,
// 7203 Aportes a riesgos, 7301 Sueldos supervisores). Así el costo por cliente está aquí aunque el
// campo de reparto (hr.contract.analytic_distribution) siga oculto: Avancys no dará el grupo que lo
// abre porque ese grupo escribe.
//
// Avancys reparte por cuenta analítica también las cuentas de balance (1305 clientes, 2505
// nóminas, 1110 bancos, 9999 puente). Esas no son resultado: ingresos y costos se cuentan solo
// con las clases 4 a 7 del PUC. Solo agregados, del último año.
export const LINEAS_ANALITICAS = 'account.analytic.line';
const MESES_ATRAS = 12;
const PUC_PERSONAL = /^(5105|5205|72)/;
const NOMBRE_PERSONAL = /SUELD|SALARI|CESANT|PRIMA|VACACI|APORTE|PARAFISCAL|HORAS EXTRA|RECARGO|INDEMNIZ|AUXILIO DE TRANSP|BONIFIC|SEGURIDAD SOCIAL|PENSION|CAJA DE COMPENS|ICBF|SENA\b/i;

export function cuentaPuc(valor) {
  const nombre = Array.isArray(valor) ? String(valor[1] || '') : '';
  const codigo = (nombre.match(/^\s*(\d+)/) || [])[1] || '';
  return { id: Array.isArray(valor) ? valor[0] : null, codigo: codigo.slice(0, 4) || 'sin cuenta', nombre: nombre.replace(/^\s*\d+\s*/, '') };
}

// De resultados (clase 4 a 7) y, si es costo o gasto, si es de personal.
export function claseDeCuenta({ codigo, nombre }) {
  const clase = codigo[0];
  if (clase === '4') return 'ingreso';
  if (!['5', '6', '7'].includes(clase)) return 'balance';
  return PUC_PERSONAL.test(codigo) || NOMBRE_PERSONAL.test(nombre) ? 'personal' : 'otro_costo';
}

// Las cuentas contables que tocan las líneas del rango, cada una con su clase.
async function cuentasDelRango(ejecutar, rango) {
  const grupos = (await ejecutar(LINEAS_ANALITICAS, 'read_group', [[...rango, ['amount', '!=', 0]], ['amount:sum'], ['general_account_id']], { lazy: false })) || [];
  const cuentas = new Map();
  for (const grupo of grupos) {
    const cuenta = cuentaPuc(grupo.general_account_id);
    const fila = cuentas.get(cuenta.codigo) || { codigo: cuenta.codigo, nombre: cuenta.nombre, ids: [], monto: 0, filas: 0, clase: claseDeCuenta(cuenta) };
    if (cuenta.id) fila.ids.push(cuenta.id);
    fila.monto += Number(grupo.amount) || 0;
    fila.filas += grupo.__count || 0;
    cuentas.set(cuenta.codigo, fila);
  }
  return [...cuentas.values()];
}

const CLASES = Object.freeze({ ingreso: 'ingresos', personal: 'personal', otro_costo: 'otros_costos' });
const idsDe = (cuentas, clase) => cuentas.filter(c => c.clase === clase).flatMap(c => c.ids);

// Suma por clase (ingreso, personal, otro costo) agrupando por `agrupar`.
async function sumarPorClase(ejecutar, rango, cuentas, agrupar, clave) {
  const filas = new Map();
  for (const clase of Object.keys(CLASES)) {
    const ids = idsDe(cuentas, clase);
    if (!ids.length) continue;
    const grupos = (await ejecutar(LINEAS_ANALITICAS, 'read_group', [[...rango, ['general_account_id', 'in', ids]], ['amount:sum'], [agrupar]], { lazy: false })) || [];
    for (const grupo of grupos) {
      const llave = clave(grupo);
      const fila = filas.get(llave) || { ingresos: 0, personal: 0, otros_costos: 0, filas: 0 };
      fila[CLASES[clase]] += Number(grupo.amount) || 0;
      fila.filas += grupo.__count || 0;
      filas.set(llave, fila);
    }
  }
  return filas;
}

const conMargen = fila => ({ ...fila, margen: fila.ingresos + fila.personal + fila.otros_costos });

export async function mirarLineasAnaliticas(ejecutar, { ahora = () => new Date() } = {}) {
  try {
    const inicio = new Date(ahora());
    inicio.setUTCMonth(inicio.getUTCMonth() - MESES_ATRAS, 1);
    const desde = inicio.toISOString().slice(0, 10);
    const enRango = [['date', '>=', desde]];

    const total = await ejecutar(LINEAS_ANALITICAS, 'search_count', [[]]);
    const filas = await ejecutar(LINEAS_ANALITICAS, 'search_count', [enRango]);
    const primera = await ejecutar(LINEAS_ANALITICAS, 'search_read', [[]], { fields: ['date'], limit: 1, order: 'date asc' });
    const cuentas = await cuentasDelRango(ejecutar, enRango);
    const meses = await sumarPorClase(ejecutar, enRango, cuentas, 'date:month', grupo => grupo['date:month'] || 'sin fecha');

    const resultado = cuentas.filter(c => c.clase !== 'balance').sort((izq, der) => Math.abs(der.monto) - Math.abs(izq.monto));
    const personal = resultado.filter(c => c.clase === 'personal').reduce((suma, c) => suma + c.monto, 0);

    return {
      legible: true,
      total,
      desde,
      filas,
      primera_fecha: primera?.[0]?.date || null,
      por_mes: [...meses].map(([mes, fila]) => conMargen({ mes, ...fila })),
      por_cuenta: resultado.slice(0, 20).map(({ ids, ...fila }) => ({ ...fila, personal: fila.clase === 'personal' })),
      cuentas: resultado.length,
      cuentas_de_balance: cuentas.length - resultado.length,
      costo_de_personal: personal,
      trae_nomina: personal < 0,
    };
  } catch (error) {
    return { legible: false, motivo: motivoDe(error) };
  }
}

// Estado de resultados de un mes por cliente: ingresos, nómina y otros costos de las líneas
// analíticas. El cliente es el de la cuenta analítica (la misma ruta que usa clienteDelPuesto).
// Las cuentas analíticas sin cliente quedan juntas (administración, sedes).
export const MAX_CLIENTES_PYG = 30;
export const MAX_CUENTAS_DE_COSTO = 40;
const LOTE_CUENTAS = 1000;

export function rangoDelMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(String(mes || ''))) return null;
  const [anio, numero] = mes.split('-').map(Number);
  if (numero < 1 || numero > 12) return null;
  const siguiente = numero === 12 ? `${anio + 1}-01` : `${anio}-${String(numero + 1).padStart(2, '0')}`;
  return [['date', '>=', `${mes}-01`], ['date', '<', `${siguiente}-01`]];
}

export function mesCerradoAnterior(ahora = new Date()) {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}

export async function pygPorCliente(ejecutar, { mes }) {
  const rango = rangoDelMes(mes);
  if (!rango) return { legible: false, mes: mes || null, motivo: 'El mes debe venir como AAAA-MM.' };
  try {
    const cuentas = await cuentasDelRango(ejecutar, rango);
    const porCuenta = await sumarPorClase(ejecutar, rango, cuentas, 'account_id', grupo => (Array.isArray(grupo.account_id) ? grupo.account_id[0] : null));

    const ids = [...porCuenta.keys()].filter(Boolean);
    const clienteDe = new Map();
    const datosDe = new Map();
    for (let i = 0; i < ids.length; i += LOTE_CUENTAS) {
      const lote = ids.slice(i, i + LOTE_CUENTAS);
      const filas = (await ejecutar('account.analytic.account', 'search_read', [[['id', 'in', lote]]], { fields: ['partner_id', 'code', 'name', 'group_id'], limit: lote.length })) || [];
      for (const fila of filas) {
        if (Array.isArray(fila.partner_id)) clienteDe.set(fila.id, fila.partner_id);
        datosDe.set(fila.id, fila);
      }
    }

    const clientes = new Map();
    for (const [id, montos] of porCuenta) {
      const partner = clienteDe.get(id);
      const llave = partner ? partner[0] : 'sin_cliente';
      const fila = clientes.get(llave) || { cliente: partner ? String(partner[1]) : 'Sin cliente en la cuenta analítica', sin_cliente: !partner, cuentas_analiticas: 0, ingresos: 0, personal: 0, otros_costos: 0 };
      fila.cuentas_analiticas += 1;
      fila.ingresos += montos.ingresos;
      fila.personal += montos.personal;
      fila.otros_costos += montos.otros_costos;
      clientes.set(llave, fila);
    }
    const todas = [...clientes.values()].map(conMargen);
    const suma = campo => todas.reduce((total, fila) => total + fila[campo], 0);
    const conCliente = todas.filter(fila => !fila.sin_cliente).sort((izq, der) => der.ingresos - izq.ingresos);

    // Dónde cae el costo. El 2026-11-12 (octubre) la nómina apareció entera en 79 cuentas analíticas
    // cuyo cliente es la propia empresa, no en las de cada cliente. Para saber si esas cuentas se
    // pueden ligar a un cliente (una por puesto o contrato) o son centros internos (sede, área),
    // se listan las de mayor costo con su código, nombre y grupo.
    const cuentasDeCosto = [...porCuenta]
      .map(([id, montos]) => {
        const datos = datosDe.get(id) || {};
        return {
          codigo: datos.code || null,
          nombre: datos.name || (id ? `cuenta ${id}` : 'Sin cuenta analítica'),
          grupo: Array.isArray(datos.group_id) ? String(datos.group_id[1]) : null,
          cliente: Array.isArray(datos.partner_id) ? String(datos.partner_id[1]) : null,
          ...conMargen(montos),
        };
      })
      .filter(fila => fila.personal + fila.otros_costos < 0)
      .sort((izq, der) => (izq.personal + izq.otros_costos) - (der.personal + der.otros_costos));

    return {
      legible: true,
      mes,
      cuentas_con_costo: cuentasDeCosto.length,
      cuentas_de_costo: cuentasDeCosto.slice(0, MAX_CUENTAS_DE_COSTO).map(({ filas, ...fila }) => fila),
      totales: { ingresos: suma('ingresos'), personal: suma('personal'), otros_costos: suma('otros_costos'), margen: suma('margen') },
      clientes_con_movimiento: conCliente.length,
      clientes: conCliente.slice(0, MAX_CLIENTES_PYG),
      sin_cliente: todas.find(fila => fila.sin_cliente) || null,
    };
  } catch (error) {
    return { legible: false, mes, motivo: motivoDe(error) };
  }
}

export async function medirPygPorCliente({ mes, config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date() } = {}) {
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const resultado = await pygPorCliente(sesion.ejecutar, { mes: mes || mesCerradoAnterior(ahora()) });
  return { ...resultado, configurado: true, autenticado: true, origen: config.origen, medido_en: ahora().toISOString() };
}

// Rentabilidad aproximada por cliente (acordada con Juan el 2026-11-12).
//
// Avancys no sabe qué vigilante cubrió qué puesto: cada contrato laboral va a una sola cuenta de
// agencia × área (lo confirmó el administrador), y la programación de turnos todavía no se hace
// allá. Lo real es el ingreso de cada cliente y el costo de cada centro. Lo que se estima es
// cuánto del costo de vigilantes le toca a cada cliente:
//
//   costo por hora   = nómina y costos de los centros "…VIGILANTES" del mes ÷ horas vendidas del mes
//   costo del cliente = horas de sus líneas de orden de servicio × costo por hora
//   lo indirecto      = el resto de los centros de la empresa, repartido por la facturación
//
// Las horas salen del horario de cada línea activa de orden de servicio de vigilancia física
// (productos [VI…]): entrada y salida, o la duración, o el nombre; la que no tiene ninguno recibe el
// promedio. Las líneas de monitoreo y electrónica ([MO…]) no reciben costo de vigilantes.
const CENTRO_VIGILANTES = /VIGILANTES\s*$/i;
const EMPRESA = /^\s*(\[\d+\]\s*)?SEGURIDAD NACIONAL LTDA/i;

export function horasPorDiaDelProducto(nombre) {
  const texto = String(nombre || '').toUpperCase();
  const encontrado = texto.match(/(\d{1,2})\s*(?:H|HR|HRS|HORAS)\b/);
  const horas = encontrado ? Number(encontrado[1]) : null;
  if (!horas || horas > 24) return null;
  let dias = 1;
  if (/LUNES A VIERNES|\bL\s*[-A]\s*V\b/.test(texto)) dias = 5 / 7;
  else if (/LUNES A S[AÁ]BADO|\bL\s*[-A]\s*S\b/.test(texto)) dias = 6 / 7;
  return horas * dias;
}

// En Avancys `time_in` y `time_out` son texto ("06:00:00"). Un turno que cruza la medianoche
// termina "antes" de empezar; entrada igual a salida es un puesto de 24 horas.
function aHoras(valor) {
  if (typeof valor === 'number') return valor;
  const partes = String(valor || '').match(/^\s*(\d{1,2}):(\d{2})/);
  return partes ? Number(partes[1]) + Number(partes[2]) / 60 : null;
}

export function horasDelTurno(entrada, salida) {
  // Odoo devuelve `false` en un campo vacío, y Number(false) sería medianoche.
  if (entrada === false || salida === false || entrada == null || salida == null) return null;
  const desde = aHoras(entrada);
  const hasta = aHoras(salida);
  if (desde === null || hasta === null) return null;
  const horas = hasta > desde ? hasta - desde : 24 - desde + hasta;
  return horas > 0 && horas <= 24 ? horas : null;
}

const VIGILANCIA_FISICA = /^\s*\[VI\d+\]/i;
// Medido el 2026-11-12 sobre las 6.329 líneas activas: `duration` (horas por día) y
// `dias_facturables` (días del mes) vienen en casi todas; `partner_id` solo en 8, por eso el cliente
// sale del contrato; `horas_facturables` está vacío.
const CAMPOS_HORARIO = ['partner_id', 'project_id', 'puesto_id', 'product_id', 'time_in', 'time_out', 'duration', 'dias_facturables', 'cantidad_vigilantes'];
const PAGINA_ORDENES = 2000;

export async function horariosDeVigilancia(ejecutar, { diasDelMes }) {
  const modelo = 'project.service.order.line';
  const existentes = await ejecutar(modelo, 'fields_get', [CAMPOS_HORARIO], { attributes: ['type'] }) || {};
  const campos = CAMPOS_HORARIO.filter(campo => existentes[campo]);
  const filas = [];
  for (let offset = 0; ; offset += PAGINA_ORDENES) {
    const lote = (await ejecutar(modelo, 'search_read', [[['state', '=', 'active']]], { fields: campos, limit: PAGINA_ORDENES, offset, order: 'id asc' })) || [];
    filas.push(...lote);
    if (lote.length < PAGINA_ORDENES) break;
  }

  const fuentes = { horario: 0, duracion: 0, nombre: 0, promedio: 0 };
  const excluidas = new Map();
  const lineas = [];
  const porDia = [];
  const vigilantes = [];
  // El cliente de la línea: el suyo, o el del contrato (project.project). La primera corrida real
  // (2026-11-12) dejó 7 líneas de miles: la mayoría no trae `partner_id` propio.
  const proyectos = [...new Set(filas.filter(f => !Array.isArray(f.partner_id) && Array.isArray(f.project_id)).map(f => f.project_id[0]))];
  const clienteDelProyecto = new Map();
  for (let i = 0; i < proyectos.length; i += LOTE_CUENTAS) {
    const lote = proyectos.slice(i, i + LOTE_CUENTAS);
    for (const p of (await ejecutar('project.project', 'search_read', [[['id', 'in', lote]]], { fields: ['partner_id'], limit: lote.length })) || []) {
      if (Array.isArray(p.partner_id)) clienteDelProyecto.set(p.id, p.partner_id);
    }
  }
  const cuenta = { leidas: filas.length, cliente_por_contrato: 0, sin_cliente: 0, sin_producto: 0, sin_puesto: 0 };

  for (const fila of filas) {
    let cliente = Array.isArray(fila.partner_id) ? fila.partner_id : null;
    if (!cliente && Array.isArray(fila.project_id)) {
      cliente = clienteDelProyecto.get(fila.project_id[0]) || null;
      if (cliente) cuenta.cliente_por_contrato += 1;
    }
    if (!cliente) { cuenta.sin_cliente += 1; continue; }
    const producto = Array.isArray(fila.product_id) ? String(fila.product_id[1]) : null;
    // Sin producto, la línea cuenta como vigilancia física si tiene puesto: el puesto es el
    // objeto que se le vende al cliente. Se cuenta aparte para saber cuántas fueron.
    if (!producto) {
      if (campos.includes('puesto_id') && !Array.isArray(fila.puesto_id)) { cuenta.sin_puesto += 1; continue; }
      cuenta.sin_producto += 1;
    } else if (!VIGILANCIA_FISICA.test(producto)) {
      excluidas.set(producto, (excluidas.get(producto) || 0) + 1);
      continue;
    }
    fila.partner_id = cliente;
    let horas = Number(fila.duration) > 0 && Number(fila.duration) <= 24 ? Number(fila.duration) : null;
    let fuente = horas ? 'duracion' : null;
    if (!horas) { horas = horasDelTurno(fila.time_in, fila.time_out); fuente = horas ? 'horario' : null; }
    if (!horas) { horas = horasPorDiaDelProducto(producto); fuente = horas ? 'nombre' : null; }
    if (horas) porDia.push(horas);
    const dias = Number(fila.dias_facturables) > 0 ? Math.min(Number(fila.dias_facturables), diasDelMes) : diasDelMes;
    if (Number(fila.cantidad_vigilantes) > 0) vigilantes.push(Number(fila.cantidad_vigilantes));
    lineas.push({ cliente_id: fila.partner_id[0], cliente: String(fila.partner_id[1]), producto: producto || 'Sin producto', porDia: horas, dias, fuente });
  }

  // La línea de vigilancia física sin horario recibe el promedio de las que sí lo tienen.
  const promedio = porDia.length ? porDia.reduce((suma, valor) => suma + valor, 0) / porDia.length : 24;
  let total = 0;
  for (const linea of lineas) {
    if (!linea.fuente) { linea.porDia = promedio; linea.fuente = 'promedio'; }
    fuentes[linea.fuente] += 1;
    linea.horas = linea.porDia * linea.dias;
    total += linea.horas;
  }
  const ordenadas = [...porDia].sort((izq, der) => izq - der);
  return {
    lineas,
    horas: total,
    fuentes,
    cuenta,
    horas_por_dia: {
      promedio,
      mediana: ordenadas.length ? ordenadas[Math.floor(ordenadas.length / 2)] : null,
      minimo: ordenadas[0] ?? null,
      maximo: ordenadas.at(-1) ?? null,
      con_dato: ordenadas.length,
      campos_leidos: campos,
    },
    vigilantes_por_linea: {
      con_dato: vigilantes.length,
      promedio: vigilantes.length ? vigilantes.reduce((suma, valor) => suma + valor, 0) / vigilantes.length : null,
      mas_de_uno: vigilantes.filter(valor => valor > 1).length,
    },
    excluidas: [...excluidas].map(([producto, cantidad]) => ({ producto, lineas: cantidad })).sort((izq, der) => der.lineas - izq.lineas).slice(0, 10),
  };
}

export async function rentabilidadAproximada(ejecutar, { mes }) {
  const rango = rangoDelMes(mes);
  if (!rango) return { legible: false, mes: mes || null, motivo: 'El mes debe venir como AAAA-MM.' };
  try {
    const [anio, numero] = mes.split('-').map(Number);
    const diasDelMes = new Date(Date.UTC(anio, numero, 0)).getUTCDate();

    // 1. Lo real: resultado por cuenta analítica.
    const cuentas = await cuentasDelRango(ejecutar, rango);
    const porCuenta = await sumarPorClase(ejecutar, rango, cuentas, 'account_id', grupo => (Array.isArray(grupo.account_id) ? grupo.account_id[0] : null));
    const ids = [...porCuenta.keys()].filter(Boolean);
    const datosDe = new Map();
    for (let i = 0; i < ids.length; i += LOTE_CUENTAS) {
      const lote = ids.slice(i, i + LOTE_CUENTAS);
      for (const fila of (await ejecutar('account.analytic.account', 'search_read', [[['id', 'in', lote]]], { fields: ['partner_id', 'name'], limit: lote.length })) || []) datosDe.set(fila.id, fila);
    }

    const clientes = new Map();
    const fondo = { vigilantes: 0, indirecto: 0, ingresos_sin_cliente: 0, centros_vigilantes: 0 };
    for (const [id, montos] of porCuenta) {
      const datos = datosDe.get(id) || {};
      const partner = Array.isArray(datos.partner_id) ? datos.partner_id : null;
      const interna = !partner || EMPRESA.test(String(partner[1])) || EMPRESA.test(String(datos.name || ''));
      const costo = montos.personal + montos.otros_costos;
      if (interna) {
        if (CENTRO_VIGILANTES.test(String(datos.name || ''))) { fondo.vigilantes += costo; fondo.centros_vigilantes += 1; }
        else fondo.indirecto += costo;
        fondo.ingresos_sin_cliente += montos.ingresos;
        continue;
      }
      const fila = clientes.get(partner[0]) || { cliente: String(partner[1]), ingresos: 0, costo_directo: 0, horas: 0, lineas: 0, lineas_sin_horas: 0 };
      fila.ingresos += montos.ingresos;
      fila.costo_directo += costo;
      clientes.set(partner[0], fila);
    }

    // 2. Lo que se estima: horas de vigilancia física vendidas a cada cliente. El producto no dice
    // las horas (medido el 2026-11-12: "VIGILANCIA FISICA SIN ARMA", "CON ARMA"…); el horario
    // vive en la línea de la orden de servicio (`time_in`, `time_out`, `duration`, `weekdays`).
    // Se leen las líneas activas hoy: es el mismo servicio del mes salvo altas y retiros recientes.
    const horario = await horariosDeVigilancia(ejecutar, { diasDelMes });
    for (const linea of horario.lineas) {
      const fila = clientes.get(linea.cliente_id) || { cliente: linea.cliente, ingresos: 0, costo_directo: 0, horas: 0, lineas: 0, lineas_sin_horas: 0 };
      fila.lineas += 1;
      fila.horas += linea.horas;
      if (linea.fuente === 'promedio') fila.lineas_sin_horas += 1;
      clientes.set(linea.cliente_id, fila);
    }
    const horasTotales = horario.horas;

    // 3. El reparto.
    const costoHora = horasTotales ? fondo.vigilantes / horasTotales : 0;
    const ingresosClientes = [...clientes.values()].reduce((suma, fila) => suma + Math.max(fila.ingresos, 0), 0);
    const filas = [...clientes.values()].map(fila => {
      const vigilantes = fila.horas * costoHora;
      const indirecto = ingresosClientes ? fondo.indirecto * Math.max(fila.ingresos, 0) / ingresosClientes : 0;
      const margen = fila.ingresos + fila.costo_directo + vigilantes + indirecto;
      return { ...fila, costo_vigilantes: vigilantes, costo_indirecto: indirecto, margen, precio_hora: fila.horas ? fila.ingresos / fila.horas : null };
    }).sort((izq, der) => der.ingresos - izq.ingresos);

    return {
      legible: true,
      aproximado: true,
      mes,
      costo_por_hora: costoHora,
      horas: horasTotales,
      lineas: horario.lineas.length,
      lineas_con_horas: horario.lineas.length - horario.fuentes.promedio,
      fuentes_de_horas: horario.fuentes,
      horas_por_dia: horario.horas_por_dia,
      vigilantes_por_linea: horario.vigilantes_por_linea,
      excluidas: horario.excluidas,
      lectura_de_ordenes: horario.cuenta,
      fondo,
      ingresos_clientes: ingresosClientes,
      clientes_con_ingreso: filas.filter(fila => fila.ingresos > 0).length,
      clientes: filas.slice(0, MAX_CLIENTES_PYG),
    };
  } catch (error) {
    return { legible: false, mes, motivo: motivoDe(error) };
  }
}

export async function medirRentabilidadAproximada({ mes, config = configuracionDeAvancys(), fetchImpl = globalThis.fetch, ahora = () => new Date() } = {}) {
  const sesion = await abrirSesion({ config, fetchImpl, ahora });
  if (!sesion.ejecutar) return sesion.estado;
  const resultado = await rentabilidadAproximada(sesion.ejecutar, { mes: mes || mesCerradoAnterior(ahora()) });
  return { ...resultado, configurado: true, autenticado: true, origen: config.origen, medido_en: ahora().toISOString() };
}
