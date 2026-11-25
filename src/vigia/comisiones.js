// AGT-003 — Comisiones por pagos recibidos (Juan, 2026-11-25). Módulo puro: recibe lo leído de Avancys y devuelve la
// comisión de referencia por comercial. Sin red, sin base y sin reloj.
//
// Reglas (otrosí de comerciales del 17-09-2025 y decisiones de Juan del 2026-11-10 y 2026-11-25):
//   · «A los comerciales se les paga por lo que ya haya pagado el cliente; si paga parcial se le paga parcial.» Cada
//     recaudo del mes cuenta en el mes en que entró, por la parte antes de IVA de lo que pagó.
//   · Vigilancia (facturas del diario de Servicios): tabla PLANA. Un solo porcentaje, el del tramo donde cae el valor
//     mensual del contrato en salarios mínimos: hasta 60, 0,70 %; hasta 120, 0,56 %; hasta 200, 0,42 %; más, 0,28 %.
//   · El valor mensual del contrato es lo que Avancys le facturó a ese cliente por Servicios en el mes de la factura
//     que se está pagando, antes de IVA y neto de notas crédito (Juan, 2026-11-25).
//   · Monitoreo y Comercialización: todavía sin regla en el CRM; se muestra lo pagado, sin comisión.
//   · Renovación (50 %) y cliente entregado por la gerencia (50 %): sin la marca todavía; se calcula al 100 % y se dice.
// Es una REFERENCIA: el número que se paga es el de cartera.

export const TRAMOS_VIGILANCIA = Object.freeze([
  Object.freeze({ hasta: 60, porcentaje: 0.007 }),
  Object.freeze({ hasta: 120, porcentaje: 0.0056 }),
  Object.freeze({ hasta: 200, porcentaje: 0.0042 }),
  Object.freeze({ hasta: Infinity, porcentaje: 0.0028 }),
]);

/** El porcentaje de la tabla plana para un valor mensual en salarios mínimos. */
export function porcentajeVigilancia(enSalariosMinimos) {
  const valor = Number(enSalariosMinimos);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return TRAMOS_VIGILANCIA.find(tramo => valor <= tramo.hasta).porcentaje;
}

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

const redondo = valor => Math.round(valor);

/**
 * @param {object} entrada
 * @param {{ id: number, fecha: string, valor: number, texto: string, diario: string }[]} entrada.recaudos  Abonos a cartera del mes.
 * @param {Record<string, { cliente_id: number, cliente: string, comercial_id: number|null, comercial: string|null, sin_iva: number, total: number, tipo: string, fecha: string, diario: string }>} entrada.facturas  Por número.
 * @param {Record<string, number>} entrada.servicioMensual  `${cliente_id}|AAAA-MM` → facturado por Servicios en ese mes, antes de IVA.
 * @param {(dia: string) => number} entrada.salarioMinimoDe  El salario mínimo vigente en una fecha.
 */
export function calcularComisiones({ recaudos = [], facturas = {}, servicioMensual = {}, salarioMinimoDe }) {
  const conocidas = new Set(Object.keys(facturas));
  const porComercial = new Map();
  const otras = { monitoreo: 0, comercializacion: 0, otra: 0 };
  const revisar = [];
  let saldosAnteriores = 0;

  for (const recaudo of recaudos) {
    const valor = Number(recaudo.valor) || 0;
    if (valor <= 0) continue;
    const nombradas = facturasNombradas(recaudo.texto, conocidas);
    if (nombradas.length !== 1) {
      // Los recaudos de saldos de antes de Avancys (SBI) no nombran factura: no son comisiones nuevas.
      if (!nombradas.length && /\bSBI\b/i.test(recaudo.texto || '')) { saldosAnteriores += valor; continue; }
      revisar.push(Object.freeze({ fecha: recaudo.fecha, valor: redondo(valor), texto: String(recaudo.texto || '').slice(0, 120), motivo: nombradas.length ? 'Nombra varias facturas: no se sabe cuánto va a cada una.' : 'No nombra una factura conocida.' }));
      continue;
    }
    const numero = nombradas[0];
    const factura = facturas[numero];
    if (factura.tipo !== 'out_invoice' || !(factura.total > 0)) {
      revisar.push(Object.freeze({ fecha: recaudo.fecha, valor: redondo(valor), texto: String(recaudo.texto || '').slice(0, 120), motivo: 'La factura nombrada no es una factura de venta.' }));
      continue;
    }
    if (valor > factura.total + 1) {
      revisar.push(Object.freeze({ fecha: recaudo.fecha, valor: redondo(valor), texto: String(recaudo.texto || '').slice(0, 120), motivo: `El abono es mayor que la factura ${numero}.` }));
      continue;
    }
    const pagadoSinIva = valor * (factura.sin_iva / factura.total);
    const linea = lineaDeNegocio(factura.diario);
    if (linea !== 'servicios') { otras[linea] += pagadoSinIva; continue; }

    const mesFactura = String(factura.fecha).slice(0, 7);
    const mensual = Number(servicioMensual[`${factura.cliente_id}|${mesFactura}`]) || 0;
    const salarioMinimo = Number(salarioMinimoDe(factura.fecha)) || 0;
    const enSalarios = salarioMinimo > 0 ? mensual / salarioMinimo : null;
    const porcentaje = porcentajeVigilancia(enSalarios);
    if (porcentaje === null) {
      revisar.push(Object.freeze({ fecha: recaudo.fecha, valor: redondo(valor), texto: String(recaudo.texto || '').slice(0, 120), motivo: `No se pudo establecer el valor mensual del cliente en ${mesFactura}.` }));
      continue;
    }
    const clave = factura.comercial_id === null ? 'sin_comercial' : String(factura.comercial_id);
    const c = porComercial.get(clave) || { avancys_user_id: factura.comercial_id, nombre: factura.comercial, pagos: [], base: 0, comision: 0 };
    const comision = pagadoSinIva * porcentaje;
    c.base += pagadoSinIva;
    c.comision += comision;
    c.pagos.push(Object.freeze({
      fecha_pago: recaudo.fecha, cliente: factura.cliente, factura: numero, fecha_factura: factura.fecha,
      pagado_sin_iva: redondo(pagadoSinIva), mensual_cliente: redondo(mensual),
      salarios_minimos: Math.round(enSalarios * 10) / 10, porcentaje, comision: redondo(comision),
    }));
    porComercial.set(clave, c);
  }

  const comerciales = [...porComercial.values()].map(c => Object.freeze({
    ...c,
    base: redondo(c.base),
    comision: redondo(c.comision),
    pagos: Object.freeze([...c.pagos].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.factura.localeCompare(b.factura))),
  })).sort((a, b) => b.comision - a.comision);

  return Object.freeze({
    comerciales: Object.freeze(comerciales),
    total_base: comerciales.reduce((suma, c) => suma + c.base, 0),
    total_comision: comerciales.reduce((suma, c) => suma + c.comision, 0),
    sin_regla: Object.freeze({ monitoreo: redondo(otras.monitoreo), comercializacion: redondo(otras.comercializacion), otra: redondo(otras.otra) }),
    saldos_anteriores: redondo(saldosAnteriores),
    revisar: Object.freeze(revisar),
  });
}
