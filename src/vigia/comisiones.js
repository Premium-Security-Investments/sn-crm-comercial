// AGT-003 — Comisiones por pagos recibidos. Módulo puro: recibe lo leído de Avancys y de la base y devuelve la
// comisión de referencia por comercial. Sin red, sin base y sin reloj.
//
// Regla base (Juan, 2026-11-26): el Excel «Comisiones Comerciales Condiciones 2026», hoja «2026». Reemplaza el otrosí
// de 2025. Se paga sobre lo que el cliente ya pagó (Juan, 2026-11-25). Es una REFERENCIA: el número que se paga es el
// de cartera.
//
//   · Vigilancia (diario Servicios): por cada abono del mes, la parte antes de IVA por el porcentaje del tramo donde cae
//     lo que se le factura al cliente al mes (salarios mínimos: 60/120/200). Sólo durante los 12 meses siguientes a la
//     firma del contrato o de su renovación. La firma sale del archivo de contratos; si el cliente no está ahí y entró
//     después del arranque de Avancys (agosto de 2026), de su primer servicio en Avancys. Sin ninguna de las dos, el abono
//     queda aparte («falta la fecha del contrato») y no se cuenta.
//     Tablas: comercial 0,70/0,56/0,42/0,28 %; clientes de la tabla de Juan Carlos Martínez, la mitad; licitaciones
//     (Katherine) 0,56/0,45/0,34/0,22 %.
//   · Equipos (diario Comercialización): una vez, cuando la factura queda pagada, sobre su valor antes de IVA, por tramos
//     de salarios mínimos (18/36/72/144): 5/4/3/2,5/2 %.
//   · Monitoreo (diario Monitoreo): un paquete mensual (el valor de la primera factura del cliente, antes de IVA), una
//     vez, cuando esa primera factura queda pagada. Sólo clientes que entraron después del arranque de Avancys.
//   · Todavía sin la marca que lo permita (se dice en pantalla): renovación sin sustentación (50 %), comisión del
//     director y del coordinador.

export const TRAMOS_VIGILANCIA = Object.freeze([
  Object.freeze({ hasta: 60, porcentaje: 0.007 }),
  Object.freeze({ hasta: 120, porcentaje: 0.0056 }),
  Object.freeze({ hasta: 200, porcentaje: 0.0042 }),
  Object.freeze({ hasta: Infinity, porcentaje: 0.0028 }),
]);
export const TRAMOS_MITAD = Object.freeze(TRAMOS_VIGILANCIA.map(t => Object.freeze({ hasta: t.hasta, porcentaje: t.porcentaje / 2 })));
export const TRAMOS_LICITACIONES = Object.freeze([
  Object.freeze({ hasta: 60, porcentaje: 0.0056 }),
  Object.freeze({ hasta: 120, porcentaje: 0.0045 }),
  Object.freeze({ hasta: 200, porcentaje: 0.0034 }),
  Object.freeze({ hasta: Infinity, porcentaje: 0.0022 }),
]);
export const TRAMOS_EQUIPOS = Object.freeze([
  Object.freeze({ hasta: 18, porcentaje: 0.05 }),
  Object.freeze({ hasta: 36, porcentaje: 0.04 }),
  Object.freeze({ hasta: 72, porcentaje: 0.03 }),
  Object.freeze({ hasta: 144, porcentaje: 0.025 }),
  Object.freeze({ hasta: Infinity, porcentaje: 0.02 }),
]);
// Hasta este mes los clientes aparecen en Avancys por la migración, no porque hayan entrado: su primer servicio o su
// primera factura no dicen cuándo empezó el contrato.
export const ARRANQUE_AVANCYS = '2026-08';
export const MESES_VIGILANCIA = 12;

function porTramo(tramos, enSalariosMinimos) {
  const valor = Number(enSalariosMinimos);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return tramos.find(tramo => valor <= tramo.hasta).porcentaje;
}

/** El porcentaje de la tabla de vigilancia de los comerciales para un valor mensual en salarios mínimos. */
export function porcentajeVigilancia(enSalariosMinimos, tramos = TRAMOS_VIGILANCIA) { return porTramo(tramos, enSalariosMinimos); }

/** Diario de la factura, por su nombre en Avancys: 1 Servicios, 2 Monitoreo, 3 Comercialización. */
export function lineaDeNegocio(nombreDiario) {
  const nombre = String(nombreDiario || '').toUpperCase();
  if (nombre.includes('SERVICIOS')) return 'servicios';
  if (nombre.includes('MONITOREO')) return 'monitoreo';
  if (nombre.includes('COMERCIALIZACION') || nombre.includes('COMERCIALIZACIÓN')) return 'comercializacion';
  return 'otra';
}

/** Los números de factura que nombra el texto de un recaudo ("AV04134 - SN385199"), entre los conocidos. */
export function facturasNombradas(textoRecaudo, conocidas) {
  const fichas = String(textoRecaudo || '').toUpperCase().match(/\b[A-Z]{1,4}\d{4,7}\b/g) || [];
  return [...new Set(fichas)].filter(ficha => conocidas.has(ficha));
}

/** AAAA-MM-DD + n meses (calendario). */
export function sumarMeses(dia, meses) {
  const [a, m, d] = String(dia).slice(0, 10).split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1 + meses, d));
  return fecha.toISOString().slice(0, 10);
}

const redondo = valor => Math.round(valor);
const texto = valor => String(valor || '').slice(0, 120);

/**
 * @param {object} e
 * @param {{ id: number, fecha: string, valor: number, texto: string }[]} e.recaudos  Abonos a cartera del mes.
 * @param {Record<string, object>} e.facturas  Por número: cliente_id, cliente, nit, comercial_id, comercial, sin_iva, total, pendiente, tipo, fecha, diario.
 * @param {Record<string, number>} e.servicioMensual  `${cliente_id}|AAAA-MM` → facturado por Servicios en ese mes, antes de IVA.
 * @param {(dia: string) => number} e.salarioMinimoDe
 * @param {string} e.mes  AAAA-MM de los pagos.
 * @param {Record<string, string>} [e.inicioContrato]  NIT → firma del contrato o de su última renovación (archivo).
 * @param {Record<number, string>} [e.primerServicio]  cliente_id → primer servicio en Avancys.
 * @param {Record<number, string>} [e.primeraMonitoreo]  cliente_id → fecha de su primera factura de monitoreo.
 * @param {Record<string, string>} [e.ultimoAbono]  número de factura de equipos → fecha de su último abono.
 * @param {Set<string>} [e.nitsTablaMitad]  Clientes de la tabla de Juan Carlos Martínez.
 * @param {Set<number>} [e.comercialesLicitaciones]  Comerciales de Avancys que cobran con la tabla de licitaciones.
 */
export function calcularComisiones({ recaudos = [], facturas = {}, servicioMensual = {}, salarioMinimoDe, mes = '',
  inicioContrato = {}, primerServicio = {}, primeraMonitoreo = {}, ultimoAbono = {}, nitsTablaMitad = new Set(), comercialesLicitaciones = new Set() }) {
  const conocidas = new Set(Object.keys(facturas));
  const porComercial = new Map();
  const revisar = [];
  let saldosAnteriores = 0;
  const sinFecha = { abonos: 0, base: 0 };
  const fuera12 = { abonos: 0, base: 0 };
  const yaContadas = new Set();
  const comercialDe = factura => {
    const clave = factura.comercial_id === null ? 'sin_comercial' : String(factura.comercial_id);
    const c = porComercial.get(clave) || { avancys_user_id: factura.comercial_id, nombre: factura.comercial, pagos: [], equipos: [], monitoreo: [], base: 0, comision: 0, comision_equipos: 0, comision_monitoreo: 0 };
    porComercial.set(clave, c);
    return c;
  };
  const aRevisar = (recaudo, motivo) => revisar.push(Object.freeze({ fecha: recaudo.fecha, valor: redondo(Number(recaudo.valor) || 0), texto: texto(recaudo.texto), motivo }));

  for (const recaudo of recaudos) {
    const valor = Number(recaudo.valor) || 0;
    if (valor <= 0) continue;
    const nombradas = facturasNombradas(recaudo.texto, conocidas);
    if (nombradas.length !== 1) {
      if (!nombradas.length && /\bSBI\b/i.test(recaudo.texto || '')) { saldosAnteriores += valor; continue; }
      aRevisar(recaudo, nombradas.length ? 'Nombra varias facturas: no se sabe cuánto va a cada una.' : 'No nombra una factura conocida.');
      continue;
    }
    const numero = nombradas[0];
    const factura = facturas[numero];
    if (factura.tipo !== 'out_invoice' || !(factura.total > 0)) { aRevisar(recaudo, 'La factura nombrada no es una factura de venta.'); continue; }
    if (valor > factura.total + 1) { aRevisar(recaudo, `El abono es mayor que la factura ${numero}.`); continue; }
    const linea = lineaDeNegocio(factura.diario);
    const salarioMinimo = Number(salarioMinimoDe(factura.fecha)) || 0;

    if (linea === 'comercializacion') {
      // Una vez, cuando la factura queda pagada: su último abono cae en este mes.
      const pagada = (Number(factura.pendiente) || 0) <= 1;
      if (!pagada || yaContadas.has(numero) || String(ultimoAbono[numero] || '').slice(0, 7) !== mes) continue;
      yaContadas.add(numero);
      const porcentaje = porTramo(TRAMOS_EQUIPOS, salarioMinimo ? factura.sin_iva / salarioMinimo : null);
      if (porcentaje === null) continue;
      const c = comercialDe(factura);
      const comision = factura.sin_iva * porcentaje;
      c.comision_equipos += comision;
      c.equipos.push(Object.freeze({ factura: numero, cliente: factura.cliente, valor_sin_iva: redondo(factura.sin_iva), porcentaje, comision: redondo(comision) }));
      continue;
    }

    if (linea === 'monitoreo') {
      // Un paquete mensual, una vez: la primera factura del cliente, ya pagada, de un cliente que entró después del arranque.
      const primera = primeraMonitoreo[factura.cliente_id];
      const pagada = (Number(factura.pendiente) || 0) <= 1;
      if (!primera || primera !== factura.fecha || primera.slice(0, 7) <= ARRANQUE_AVANCYS || !pagada || yaContadas.has(numero)) continue;
      yaContadas.add(numero);
      const c = comercialDe(factura);
      c.comision_monitoreo += factura.sin_iva;
      c.monitoreo.push(Object.freeze({ factura: numero, cliente: factura.cliente, paquete_sin_iva: redondo(factura.sin_iva), comision: redondo(factura.sin_iva) }));
      continue;
    }

    if (linea !== 'servicios') continue;
    const pagadoSinIva = valor * (factura.sin_iva / factura.total);
    const servicio = primerServicio[factura.cliente_id];
    const inicio = (factura.nit && inicioContrato[factura.nit]) || (servicio && servicio.slice(0, 7) > ARRANQUE_AVANCYS ? servicio : null);
    if (!inicio) { sinFecha.abonos++; sinFecha.base += pagadoSinIva; continue; }
    if (String(factura.fecha) < inicio || String(factura.fecha) >= sumarMeses(inicio, MESES_VIGILANCIA)) { fuera12.abonos++; fuera12.base += pagadoSinIva; continue; }

    const mesFactura = String(factura.fecha).slice(0, 7);
    const mensual = Number(servicioMensual[`${factura.cliente_id}|${mesFactura}`]) || 0;
    const enSalarios = salarioMinimo > 0 ? mensual / salarioMinimo : null;
    const tabla = comercialesLicitaciones.has(factura.comercial_id) ? 'licitaciones' : nitsTablaMitad.has(factura.nit) ? 'mitad' : 'comercial';
    const porcentaje = porTramo(tabla === 'licitaciones' ? TRAMOS_LICITACIONES : tabla === 'mitad' ? TRAMOS_MITAD : TRAMOS_VIGILANCIA, enSalarios);
    if (porcentaje === null) { aRevisar(recaudo, `No se pudo establecer el valor mensual del cliente en ${mesFactura}.`); continue; }
    const c = comercialDe(factura);
    const comision = pagadoSinIva * porcentaje;
    c.base += pagadoSinIva;
    c.comision += comision;
    c.pagos.push(Object.freeze({
      fecha_pago: recaudo.fecha, cliente: factura.cliente, factura: numero, fecha_factura: factura.fecha,
      pagado_sin_iva: redondo(pagadoSinIva), mensual_cliente: redondo(mensual),
      salarios_minimos: Math.round(enSalarios * 10) / 10, porcentaje, tabla, inicio_contrato: inicio, comision: redondo(comision),
    }));
  }

  const comerciales = [...porComercial.values()].map(c => Object.freeze({
    ...c,
    base: redondo(c.base),
    comision: redondo(c.comision),
    comision_equipos: redondo(c.comision_equipos),
    comision_monitoreo: redondo(c.comision_monitoreo),
    total: redondo(c.comision + c.comision_equipos + c.comision_monitoreo),
    pagos: Object.freeze([...c.pagos].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.factura.localeCompare(b.factura))),
    equipos: Object.freeze(c.equipos),
    monitoreo: Object.freeze(c.monitoreo),
  })).sort((a, b) => b.total - a.total);

  return Object.freeze({
    comerciales: Object.freeze(comerciales),
    total_base: comerciales.reduce((suma, c) => suma + c.base, 0),
    total_comision: comerciales.reduce((suma, c) => suma + c.total, 0),
    sin_fecha_contrato: Object.freeze({ abonos: sinFecha.abonos, base: redondo(sinFecha.base) }),
    fuera_de_12_meses: Object.freeze({ abonos: fuera12.abonos, base: redondo(fuera12.base) }),
    saldos_anteriores: redondo(saldosAnteriores),
    revisar: Object.freeze(revisar),
  });
}
