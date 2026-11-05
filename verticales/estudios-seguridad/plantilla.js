// Estudios de Seguridad Física — plantilla "Instalaciones físicas v1".
//
// El catálogo sale del DOCUMENTO MAESTRO DE RIESGOS ESU 2026 (tablas de procesos P01–P22 y de riesgos R01–R26,
// sha256 cff1ca17…c887): es el lenguaje común que ese documento pide para todas las sedes. Es una ayuda para
// capturar, no una lista cerrada: un estudio puede registrar un riesgo propio (sin código de catálogo), y el revisor
// decide si pasa al catálogo en una versión nueva de la plantilla.
//
// Vive en el código, versionado con git, como la metodología: cambiarlo es una versión nueva, no una edición suelta.

export const PLANTILLA_INSTALACIONES_FISICAS_V1 = Object.freeze({
  id: 'instalaciones-fisicas-v1',
  nombre: 'Instalaciones físicas',
  metodologia: 'instalaciones-fisicas-v1',
  procesos: Object.freeze([
    ['P01', 'Planeación y gobierno del servicio'],
    ['P02', 'Gestión de accesos peatonales y vehiculares'],
    ['P03', 'Control perimetral y cerramientos'],
    ['P04', 'Monitoreo tecnológico y CCTV'],
    ['P05', 'Rondas, puestos y reacción operativa'],
    ['P06', 'Gestión de aglomeraciones y flujos'],
    ['P07', 'Control de áreas restringidas y técnicas'],
    ['P08', 'Convivencia, atención y orientación al usuario'],
    ['P09', 'Articulación con autoridades y primeros respondientes'],
    ['P10', 'Emergencias, evacuación y continuidad inicial'],
    ['P11', 'Protección de activos, bienes e inventarios'],
    ['P12', 'Recaudo, taquilla y medios de pago'],
    ['P13', 'Programación, reservas, listas y acreditaciones'],
    ['P14', 'Eventos, competencias, montajes y desmontajes'],
    ['P15', 'Carga, descargue, logística y proveedores'],
    ['P16', 'Protección de niños, niñas, adolescentes y población vulnerable'],
    ['P17', 'Gestión de contratistas y terceros'],
    ['P18', 'Información, evidencia y cadena documental'],
    ['P19', 'Uso comunitario y relación con entorno'],
    ['P20', 'Transporte interno, equipos y movilización de grupos'],
    ['P21', 'Supervisión, auditoría y desempeño del servicio'],
    ['P22', 'Gestión reputacional y crisis visible'],
  ].map(([codigo, nombre]) => Object.freeze({ codigo, nombre }))),
  riesgos: Object.freeze([
    ['R01', 'Acceso no autorizado', ['P02', 'P13']],
    ['R02', 'Intrusión perimetral', ['P03']],
    ['R03', 'Aglomeración no controlada', ['P06']],
    ['R04', 'Alteración del orden público o convivencia', ['P08', 'P09', 'P19']],
    ['R05', 'Lesiones a personas en el entorno de operación', ['P05', 'P06', 'P10']],
    ['R06', 'Vandalismo o daño a infraestructura', ['P03', 'P11', 'P19']],
    ['R07', 'Hurto a usuarios o terceros', ['P05', 'P06', 'P08']],
    ['R08', 'Hurto de bienes, equipos o inventarios', ['P07', 'P11']],
    ['R09', 'Ingreso de elementos prohibidos', ['P02', 'P06']],
    ['R10', 'Fallas en evacuación o respuesta inicial', ['P09', 'P10']],
    ['R11', 'Detección tardía por falla de monitoreo', ['P04', 'P18']],
    ['R12', 'Falla operativa del servicio de vigilancia', ['P01', 'P05', 'P21']],
    ['R13', 'Uso indebido del espacio público o institucional', ['P08', 'P19']],
    ['R14', 'Conflicto interpersonal, agresión o violencia', ['P08', 'P16']],
    ['R15', 'Riesgo reputacional institucional', ['P22']],
    ['R16', 'Amenaza terrorista o sabotaje grave', ['P02', 'P07', 'P10', 'P22']],
    ['R17', 'Microtráfico, consumo o entorno criminógeno', ['P08', 'P19']],
    ['R18', 'Fraude, suplantación o uso indebido de credenciales', ['P02', 'P13', 'P17']],
    ['R19', 'Extorsión, amenaza o coacción', ['P08', 'P09', 'P17']],
    ['R20', 'Colusión interna o corrupción facilitadora', ['P01', 'P11', 'P18', 'P21']],
    ['R21', 'Pérdida o uso indebido de información y evidencia', ['P04', 'P18']],
    ['R22', 'Fraude documental o validación deficiente', ['P13', 'P18']],
    ['R23', 'Bloqueo de accesos o interrupción de la operación', ['P06', 'P09', 'P10']],
    ['R24', 'Incendio o contingencia técnica con impacto operacional', ['P07', 'P10', 'P15']],
    ['R25', 'Afectación a niños, niñas, adolescentes o población vulnerable', ['P16']],
    ['R26', 'Riesgo asociado a carga, montaje o proveedores', ['P14', 'P15', 'P17']],
  ].map(([codigo, nombre, procesos]) => Object.freeze({ codigo, nombre, procesos: Object.freeze(procesos) }))),
});

// Los nombres que ve el cliente (informe de HADA, 2026-11-05): los de la casa, no los del documento maestro. Cambian
// sólo los nombres; los números y la fórmula de la metodología v1 son los mismos.
export const ESCALAS = Object.freeze({
  probabilidad: Object.freeze(['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']),
  impacto: Object.freeze(['Insignificante', 'Leve', 'Moderado', 'Grave', 'Catastrófico']),
  // Calificación del control en palabras, verificada contra los Excel: 2 = "Poco…", 3 = "Medianamente…", 4 = pleno.
  // Para 1 y 5 no hay ejemplo en ningún estudio: se muestra el número (por confirmar con el analista).
  control: Object.freeze({
    calidad: Object.freeze({ 2: 'Poco confiable', 3: 'Medianamente confiable', 4: 'Confiable' }),
    eficacia: Object.freeze({ 2: 'Poco eficaz', 3: 'Medianamente eficaz', 4: 'Eficaz' }),
    eficiencia: Object.freeze({ 2: 'Poco eficiente', 3: 'Medianamente eficiente', 4: 'Eficiente' }),
  }),
});

/** "Medianamente confiable", o el número cuando la escala no tiene nombre para ese valor. */
export function controlWord(dimension, value) {
  if (value === null || value === undefined) return null;
  return ESCALAS.control[dimension]?.[value] || `Calificación ${value}`;
}

export const PLANTILLAS = Object.freeze({ [PLANTILLA_INSTALACIONES_FISICAS_V1.id]: PLANTILLA_INSTALACIONES_FISICAS_V1 });
