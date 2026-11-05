// Estudios de Seguridad Física — metodología de valoración del riesgo.
//
// Decisión de Juan Botero, 2026-11-04 (docs/decisions/2026-11-04-estudios-seguridad-metodologia-v1.md): la
// metodología oficial v1 toma del documento maestro ESU 2026 el impacto doble (empresa y personas, cuenta el
// mayor) y los cuatro niveles; de la matriz de Cancha Horizontes, la calificación del control (calidad × eficacia
// × eficiencia / 125) y que el control baje la probabilidad, para que el residual caiga en una casilla del mapa
// 5×5. Se le pone tope de 0,9 al control: ninguno elimina el riesgo.
//
// Aquí sólo hay aritmética pura. Ni el cliente ni la base de datos calculan por su cuenta: llaman a esto, y cada
// estudio queda amarrado al `id` de la metodología con que se calculó.

export const METODOLOGIA_V1 = Object.freeze({
  id: 'instalaciones-fisicas-v1',
  topeControl: 0.9,
  niveles: Object.freeze([
    Object.freeze({ codigo: 'bajo', etiqueta: 'Bajo', hasta: 5 }),
    Object.freeze({ codigo: 'moderado', etiqueta: 'Moderado', hasta: 10 }),
    Object.freeze({ codigo: 'alto', etiqueta: 'Alto', hasta: 15 }),
    Object.freeze({ codigo: 'critico', etiqueta: 'Crítico', hasta: 25 }),
  ]),
});

// La matriz histórica (Cancha Horizontes y sus hermanas). No es oficial: sirve para que el importador recalcule
// el Excel y avise cuando lo que trae escrito no coincide con sus propias fórmulas.
export const MATRIZ_HISTORICA = Object.freeze({
  id: 'matriz-historica-2026',
  topeControl: 1,
  niveles: Object.freeze([
    Object.freeze({ codigo: 'aceptable', etiqueta: 'Aceptable', hasta: 6 }),
    Object.freeze({ codigo: 'tolerable', etiqueta: 'Tolerable', hasta: 14 }),
    Object.freeze({ codigo: 'inaceptable', etiqueta: 'Inaceptable', hasta: 25 }),
  ]),
});

// La variante de los estudios reales entregados (HADA International y EXCO Colombiana, enero de 2026): el control
// baja la probabilidad y DESPUÉS vuelve a descontarse de la magnitud, ⌈P actual × (1 − control) × I⌉. Cuenta el
// mismo control dos veces y por eso da un riesgo actual menor que la v1. Tampoco es oficial: sólo para recalcular.
export const MATRIZ_HISTORICA_CONTROL_DOBLE = Object.freeze({
  ...MATRIZ_HISTORICA,
  id: 'matriz-historica-control-doble-2026',
  controlTambienEnMagnitud: true,
});

function escala(valor, campo) {
  if (!Number.isInteger(valor) || valor < 1 || valor > 5) throw new RangeError(`${campo} debe ser un entero de 1 a 5`);
  return valor;
}

// Math.ceil(3 * 0.936) debe dar 3 y no 4 por un residuo binario; se redondea antes a 9 decimales.
const techo = valor => Math.ceil(Math.round(valor * 1e9) / 1e9);

// Sin control (null) la efectividad es 0.
export function efectividadControl(control, metodologia = METODOLOGIA_V1) {
  if (control == null) return 0;
  const bruto = escala(control.calidad, 'calidad') * escala(control.eficacia, 'eficacia') * escala(control.eficiencia, 'eficiencia') / 125;
  return Math.min(metodologia.topeControl, bruto);
}

export function nivelDeMagnitud(magnitud, metodologia = METODOLOGIA_V1) {
  const nivel = metodologia.niveles.find(item => magnitud <= item.hasta);
  if (!nivel) throw new RangeError('magnitud fuera de la escala');
  return nivel.codigo;
}

const probabilidadTrasControl = (probabilidad, efectividad) => Math.max(1, techo(probabilidad * (1 - efectividad)));

// riesgo: { probabilidad, impactoEmpresa, impactoPersonas, controlActual, controlPropuesto }
// Los controles son { calidad, eficacia, eficiencia } o null.
export function valorarRiesgo(riesgo, metodologia = METODOLOGIA_V1) {
  const probabilidad = escala(riesgo.probabilidad, 'probabilidad');
  const impacto = Math.max(escala(riesgo.impactoEmpresa, 'impactoEmpresa'), escala(riesgo.impactoPersonas, 'impactoPersonas'));
  const efectividadActual = efectividadControl(riesgo.controlActual, metodologia);
  const efectividadPropuesta = efectividadControl(riesgo.controlPropuesto, metodologia);

  const probabilidadActual = probabilidadTrasControl(probabilidad, efectividadActual);
  const probabilidadResidual = probabilidadTrasControl(probabilidadActual, efectividadPropuesta);
  const inherente = probabilidad * impacto;
  const actual = metodologia.controlTambienEnMagnitud ? techo(probabilidadActual * (1 - efectividadActual) * impacto) : probabilidadActual * impacto;
  const residual = probabilidadResidual * impacto;

  return {
    metodologia: metodologia.id,
    impacto,
    inherente: { magnitud: inherente, nivel: nivelDeMagnitud(inherente, metodologia) },
    actual: { probabilidad: probabilidadActual, efectividadControl: efectividadActual, magnitud: actual, nivel: nivelDeMagnitud(actual, metodologia) },
    residual: { probabilidad: probabilidadResidual, efectividadControl: efectividadPropuesta, magnitud: residual, nivel: nivelDeMagnitud(residual, metodologia) },
  };
}

// Un Excel histórico trae un solo impacto: se toma igual para empresa y personas, y el revisor lo separa.
export function riesgoDesdeMatrizHistorica({ probabilidad, impacto, controlActual, controlPropuesto }) {
  return { probabilidad, impactoEmpresa: impacto, impactoPersonas: impacto, controlActual, controlPropuesto };
}
