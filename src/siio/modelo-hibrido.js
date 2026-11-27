// Cotizador de modelos de servicio (Gerencia, junto a la Torre). Decisiones de Juan del 24 y 25-nov-2026.
//
// Compara lo que un cliente paga hoy por guardas fijos en sus tiendas con un modelo híbrido:
//   · las tiendas de nivel A conservan su guarda;
//   · todas las tiendas de las zonas que entran al modelo quedan cubiertas por unidades de reacción (una persona en
//     moto, turnos de 12 h, que cubre tiendas de cualquier nivel), en proporción al número de tiendas de cada nivel,
//     de día y de noche;
//   · cada tienda de esas zonas lleva analítica de video con un precio mensual por tienda.
//
// Módulo puro: sin red, sin base y sin reloj. Los datos del cliente (tiendas, valores, merma) y los supuestos
// (precios, proporciones, costos) llegan como parámetro: viven en la base, nunca en el código (confidencialidad).
// Todas las cifras van en millones de pesos al mes, antes de IVA.

export const NIVELES = Object.freeze(['A', 'B', 'C']);

const numero = (valor, porDefecto = 0) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};
const positivo = valor => {
  const n = numero(valor);
  return n > 0 ? n : null;
};

/** Unidades de reacción de un turno para una zona: suma las fracciones de cada nivel y redondea hacia arriba. */
export function unidadesDeTurno(conteo, proporciones, turno) {
  let fraccion = 0;
  for (const nivel of NIVELES) {
    const tiendas = numero(conteo[nivel]);
    if (!tiendas) continue;
    const porUnidad = positivo(proporciones?.[nivel]?.[turno]);
    if (!porUnidad) return null;
    fraccion += tiendas / porUnidad;
  }
  // Evita que un error de coma flotante (14,999999…) sume una unidad que no existe.
  return Math.ceil(Math.round(fraccion * 1e9) / 1e9);
}

/** Agrupa las tiendas por zona: conteos por nivel, puestos de guarda, valor que se paga hoy y merma. */
export function resumirZonas(tiendas = []) {
  const zonas = new Map();
  for (const tienda of tiendas) {
    const nombre = String(tienda?.zona || '').trim();
    if (!nombre) continue;
    if (!zonas.has(nombre)) {
      zonas.set(nombre, { zona: nombre, tiendas: 0, A: 0, B: 0, C: 0, sinGuarda: 0, puestos: 0, puestosA: 0, tiendasASinGuarda: 0, valor: 0, valorA: 0, merma: 0 });
    }
    const z = zonas.get(nombre);
    const nivel = NIVELES.includes(tienda.nivel) ? tienda.nivel : 'C';
    const puestos = Math.max(0, numero(tienda.puestos));
    const valor = numero(tienda.valor);
    z.tiendas += 1;
    z[nivel] += 1;
    z.puestos += puestos;
    z.valor += valor;
    z.merma += numero(tienda.merma);
    if (!puestos) z.sinGuarda += 1;
    if (nivel === 'A') {
      z.puestosA += puestos;
      z.valorA += valor;
      if (!puestos) z.tiendasASinGuarda += 1;
    }
  }
  return [...zonas.values()];
}

/**
 * Calcula el modelo para todas las zonas.
 * supuestos: {
 *   zonas: { [zona]: { enModelo, margen, supervisoresHoy } },
 *   precioUnidad, analitica, proporciones: { A|B|C: { dia, noche } },
 *   personasPorTurno, costoPersona, costoAnalitica, valorGuardaNuevo,
 *   reduccionMerma, opcionE: { analitica, parteMerma }
 * }
 */
export function calcularModelo(tiendas, supuestos = {}) {
  const zonasBase = resumirZonas(tiendas);
  const conf = supuestos.zonas || {};
  const precioUnidad = numero(supuestos.precioUnidad);
  const analitica = numero(supuestos.analitica);
  const personasPorTurno = numero(supuestos.personasPorTurno);
  const costoPersona = numero(supuestos.costoPersona);
  const costoAnalitica = numero(supuestos.costoAnalitica);
  const valorGuardaNuevo = numero(supuestos.valorGuardaNuevo);

  const zonas = zonasBase.map(z => {
    const c = conf[z.zona] || {};
    const enModelo = c.enModelo === true;
    const margen = numero(c.margen);
    const supervisoresHoy = numero(c.supervisoresHoy);
    const dia = enModelo ? unidadesDeTurno(z, supuestos.proporciones, 'dia') : 0;
    const noche = enModelo ? unidadesDeTurno(z, supuestos.proporciones, 'noche') : 0;
    const unidades = (dia ?? 0) + (noche ?? 0);
    const guardasModelo = enModelo ? z.puestosA + z.tiendasASinGuarda : z.puestos;
    const valorGuardasModelo = enModelo ? z.valorA + z.tiendasASinGuarda * valorGuardaNuevo : z.valor;
    const valorUnidades = unidades * precioUnidad;
    const valorAnalitica = enModelo ? z.tiendas * analitica : 0;
    const personalModelo = valorGuardasModelo + valorUnidades;
    const totalModelo = personalModelo + valorAnalitica;
    // Nuestro lado (interno). Hoy los supervisores no se cobran: su costo sale del margen del guarda.
    const costoSupervisoresHoy = supervisoresHoy * costoPersona;
    const margenHoy = z.valor * margen - costoSupervisoresHoy;
    const personasUnidades = enModelo ? Math.max(unidades * personasPorTurno, supervisoresHoy) : supervisoresHoy;
    const costoModelo = valorGuardasModelo * (1 - margen) + personasUnidades * costoPersona + (enModelo ? z.tiendas * costoAnalitica : 0);
    return {
      ...z, enModelo, margen, supervisoresHoy,
      unidadesDia: dia ?? 0, unidadesNoche: noche ?? 0, unidades, proporcionInvalida: enModelo && (dia === null || noche === null),
      guardasModelo, valorGuardasModelo, valorUnidades, valorAnalitica, personalModelo, totalModelo,
      frenteAHoy: totalModelo - z.valor,
      costoHoy: z.valor - margenHoy, margenHoy, personasUnidades, costoModelo, margenModelo: totalModelo - costoModelo,
    };
  });

  const enModelo = zonas.filter(z => z.enModelo);
  const suma = (lista, campo) => lista.reduce((acc, z) => acc + numero(z[campo]), 0);
  const total = {};
  for (const campo of ['tiendas', 'A', 'B', 'C', 'sinGuarda', 'puestos', 'guardasModelo', 'unidadesDia', 'unidadesNoche', 'unidades', 'valor', 'valorGuardasModelo', 'valorUnidades', 'valorAnalitica', 'personalModelo', 'totalModelo', 'frenteAHoy', 'merma', 'costoHoy', 'margenHoy', 'personasUnidades', 'costoModelo', 'margenModelo']) {
    total[campo] = suma(enModelo, campo);
  }
  total.frenteAHoyPct = total.valor ? total.frenteAHoy / total.valor : 0;

  // Central de monitoreo (Juan, 2026-11-27): hoy hay un centro por CEDI; con el modelo se concentran en menos centros y con
  // menos operadores, y desde ellos se monitorean todas las tiendas. Los operadores no se le cobran aparte al cliente (van
  // dentro de los puestos de los CEDI), así que lo que cambia es nuestro costo: el ahorro suma al margen del modelo.
  const central = supuestos.central || {};
  const personasPorPuestoCentral = numero(central.personasPorPuesto, 3);
  const personasCentralHoy = numero(central.puestosHoy) * personasPorPuestoCentral;
  const personasCentralModelo = numero(central.puestosModelo) * personasPorPuestoCentral;
  const ahorroCentral = (personasCentralHoy - personasCentralModelo) * numero(central.costoPersona);
  total.centralPersonasHoy = personasCentralHoy;
  total.centralPersonasModelo = personasCentralModelo;
  total.ahorroCentral = ahorroCentral;
  total.costoModelo -= ahorroCentral;
  total.margenModelo += ahorroCentral;

  // Opciones de precio de la analítica: solo cambia la analítica; el personal es el mismo.
  const costoTotal = total.costoModelo;
  const mermaEvitada = total.merma * numero(supuestos.reduccionMerma);
  const opcionE = supuestos.opcionE || {};
  const opciones = (supuestos.opciones || []).map(op => {
    const esE = op.codigo === 'E';
    const precio = esE ? numero(opcionE.analitica) : numero(op.analitica);
    const valorAnalitica = total.tiendas * precio;
    const parteMerma = esE ? mermaEvitada * numero(opcionE.parteMerma) : 0;
    const paga = total.personalModelo + valorAnalitica + parteMerma;
    const margen = paga - costoTotal;
    return { codigo: op.codigo, etiqueta: op.etiqueta || op.codigo, analiticaPorTienda: precio, valorAnalitica, parteMerma, paga, frenteAHoy: paga - total.valor, margen, margenPct: paga ? margen / paga : 0 };
  });

  const escenariosMerma = [0, 0.1, 0.2, 0.3].map(reduccion => {
    const evitada = total.merma * reduccion;
    return { reduccion, evitada, ahorroModelo: -total.frenteAHoy, beneficio: evitada - total.frenteAHoy };
  });

  const costoUnidad = personasPorTurno * costoPersona;
  return {
    zonas, total, opciones, escenariosMerma,
    unidad: { costo: costoUnidad, precio: precioUnidad, margenPct: precioUnidad ? 1 - costoUnidad / precioUnidad : 0, pierde: costoUnidad >= precioUnidad },
  };
}
