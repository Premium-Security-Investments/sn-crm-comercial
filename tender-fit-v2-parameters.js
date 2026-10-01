// Módulo de parámetros versionado de tender-fit-v2.
// Única fuente de verdad para SMMLV, pisos y bandas de valor, umbrales de
// capacidad financiera, datos de territorio, bandas de tiempo (días hábiles),
// festivos de Colombia 2026, bandas de score y prioridad de impacto de razones.
// Este módulo contiene únicamente datos (congelados) — ninguna decisión de
// puntaje vive aquí; eso es responsabilidad de tender-fit-policy.js.

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export const TENDER_FIT_V2_PARAMETERS_VERSION = 'tender-fit-v2-parameters@1.0.0';

export const SMMLV_2026 = deepFreeze({
  value_cop: 1_750_905,
  year: 2026,
  source: 'Ministerio del Trabajo de Colombia — Decreto 0159 del 19 de febrero de 2026',
  norm: 'Decreto 0159 del 19 de febrero de 2026',
  status:
    'Vigente de manera transitoria para 2026: el Decreto 1469 de 2025 quedó suspendido ' +
    'provisionalmente por el Consejo de Estado, por lo cual el Decreto 0159 del 19-feb-2026 ' +
    'fijó este monto transitorio del SMMLV. El Decreto 1469/2025 no debe citarse en solitario ' +
    'como autoridad vigente.',
});

export const VALUE_FAMILY_FLOORS_SMMLV = deepFreeze({
  HIBRIDA: 170,
  FISICA: 170,
  ELECTRONICA: 60,
  SUMINISTRO: 30,
});

export const VALUE_BAND_THRESHOLDS_SMMLV = deepFreeze({
  TIER_1_MAX: 290,
  TIER_2_MAX: 1150,
  TIER_3_MAX: 5700,
});

export const VALUE_BAND_POINTS = deepFreeze({
  TIER_1: 6,
  TIER_2: 12,
  TIER_3: 17,
  TIER_4: 20,
});

export const CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP = 45_535_037_196;
export const CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE = 0.25;

export const CORPORATE_MAX_DEBT_RATIO = 0.5056;
export const CORPORATE_EXPERIENCE_CAPACITY_SMMLV = 136565.79;

export const TERRITORY_EXACT_CITY_POINTS_15 = deepFreeze([
  'Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Pereira',
]);

export const TERRITORY_EXACT_CITY_POINTS_10 = deepFreeze([
  'Cartagena', 'Manizales', 'Armenia',
]);

export const TERRITORY_DEPARTMENTS_POINTS_5 = deepFreeze([
  'Antioquia', 'Caldas', 'Caquetá', 'Cauca', 'Cundinamarca', 'Huila', 'Nariño',
  'Quindío', 'Risaralda', 'Tolima', 'Valle del Cauca',
]);

export const TERRITORY_NATIONAL_COVERAGE_PHRASES = deepFreeze([
  'cobertura nacional',
  'todo el país',
  'todo el territorio nacional',
  'alcance nacional',
]);

export const TIME_BUSINESS_DAY_BANDS = deepFreeze([
  deepFreeze({ max: 4, points: 0 }),
  deepFreeze({ max: 5, points: 4 }),
  deepFreeze({ max: 8, points: 7 }),
  deepFreeze({ max: 12, points: 10 }),
  deepFreeze({ max: 20, points: 13 }),
]);

export const TIME_BUSINESS_DAY_POINTS_ABOVE_20 = 15;
export const TIME_MISSING_DEADLINE_POINTS = 5;
export const TIME_FORCED_LOW_BUSINESS_DAY_THRESHOLD = 5;

// Festivos oficiales de Colombia para 2026 (19 en total): fijos no desplazables,
// los dos de Semana Santa que dependen de Pascua pero no se trasladan (Jueves y
// Viernes Santo), y los desplazados por la Ley Emiliani al lunes siguiente (salvo
// los que ya caen en lunes, como San Pedro y San Pablo y Día de la Raza en 2026).
export const COLOMBIA_HOLIDAYS_2026 = deepFreeze([
  '2026-01-01', // Año Nuevo
  '2026-01-12', // Reyes Magos (trasladado desde el 6 de enero, martes)
  '2026-03-23', // San José (trasladado desde el 19 de marzo, jueves)
  '2026-04-09', // Jueves Santo
  '2026-04-10', // Viernes Santo
  '2026-05-01', // Día del Trabajo
  '2026-05-25', // Ascensión del Señor (trasladado)
  '2026-06-15', // Corpus Christi (trasladado)
  '2026-06-22', // Sagrado Corazón de Jesús (trasladado)
  '2026-06-29', // San Pedro y San Pablo (ya cae en lunes, no se traslada)
  '2026-07-13', // Nuestra Señora del Rosario de Chiquinquirá (Ley 2578 de 2026; trasladado desde el 9 de julio)
  '2026-07-20', // Independencia
  '2026-08-07', // Batalla de Boyacá
  '2026-08-17', // Asunción de la Virgen (trasladado desde el 15 de agosto, sábado)
  '2026-10-12', // Día de la Raza (ya cae en lunes, no se traslada)
  '2026-11-02', // Todos los Santos (trasladado desde el 1 de noviembre, domingo)
  '2026-11-16', // Independencia de Cartagena (trasladado desde el 11 de noviembre, miércoles)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
]);

export const SCORE_BANDS = deepFreeze({
  ALTO_MIN: 80,
  MEDIO_MIN: 60,
});

export const AXIS_MAX_POINTS = deepFreeze({
  SERVICIO: 50,
  VALOR: 20,
  TERRITORIO: 15,
  TIEMPO: 15,
});

export const REASON_IMPACT_PRIORITY_GROUPS = deepFreeze([
  deepFreeze(['plazo_vencido', 'plazo_insuficiente']),
  deepFreeze(['servicio_ambiguo']),
  deepFreeze(['valor_ausente', 'valor_bajo_piso']),
  deepFreeze(['capacidad_financiera_por_validar']),
  deepFreeze(['plazo_ausente']),
  deepFreeze(['territorio_indeterminado']),
  deepFreeze(['cobertura_por_validar']),
  deepFreeze(['endeudamiento_por_validar', 'experiencia_por_validar']),
]);
