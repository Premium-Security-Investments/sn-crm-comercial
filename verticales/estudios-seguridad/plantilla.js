// Estudios de Seguridad Física — plantilla "Instalaciones físicas v1".
//
// Los procesos salen del DOCUMENTO MAESTRO DE RIESGOS ESU 2026 (P01–P22, sha256 cff1ca17…c887); los riesgos, de la lista
// base RB-01–RB-31 (abajo). Es una ayuda para capturar, no una lista cerrada: un estudio puede registrar un riesgo propio
// (sin código de catálogo), y si se repite en varios estudios pasa a la lista en una versión nueva de la plantilla.
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
  // Lista base de riesgos (Juan, 2026-11-11: "una sola lista base de riesgos que usan todos los estudios; cada estudio le
  // agrega los riesgos propios del sitio"). Junta las cuatro listas del equipo —documento maestro ESU, matriz y lista de
  // amenazas de la sede Medellín, matrices HADA y EXCO: 95 entradas— sin duplicados: los que eran el mismo riesgo con otro
  // nombre quedaron en uno, y las causas y consecuencias de otros riesgos no son riesgos (continuidad operativa y
  // reputación se valoran en el impacto). `cubre` marca el límite entre los que se parecen. La correspondencia completa
  // está en el handoff 2026-11-11-AGT-000-estudios-seguridad-lista-base. No se ata a procesos: el proceso es del cliente.
  riesgos: Object.freeze([
    ["RB-01", "Accesos y perímetro", "Acceso no autorizado de personas", "Entrar a la sede por sus accesos sin autorización ni identificación; fallas del control de acceso en portería."],
    ["RB-02", "Accesos y perímetro", "Acceso indebido a áreas restringidas o críticas", "Ya dentro de la sede, entrar a bodegas, áreas de proceso, cuartos técnicos o zonas de almacenamiento sin autorización."],
    ["RB-03", "Accesos y perímetro", "Intrusión o vulneración del perímetro", "Entrar sin pasar por los accesos: por cerramientos, cubiertas, muros o bordes, o por deterioro de la estructura."],
    ["RB-04", "Accesos y perímetro", "Ingreso de elementos prohibidos", "Armas, sustancias u objetos no permitidos que entran a las instalaciones."],
    ["RB-05", "Bienes, carga e instalaciones", "Hurto de bienes, equipos, mercancía o carga", "Sustracción o salida irregular de activos, insumos, materiales o mercancía, en la sede o en tránsito (piratería terrestre)."],
    ["RB-06", "Bienes, carga e instalaciones", "Hurto a personas", "Hurto a empleados, usuarios, visitantes o terceros dentro o en el entorno de la sede."],
    ["RB-07", "Bienes, carga e instalaciones", "Vandalismo, sabotaje o daño intencional", "Daño intencional a instalaciones, equipos o mobiliario, con o sin interrupción de la operación (la interrupción se valora en el impacto)."],
    ["RB-08", "Bienes, carga e instalaciones", "Contaminación o manipulación de carga", "Carga de despacho o exportación contaminada o alterada (sustancias ilícitas, faltantes, sellos)."],
    ["RB-09", "Personas", "Agresión, amenaza o intimidación", "Agresión física o verbal, amenazas o intimidación al personal, usuarios o terceros, sin exigencia a cambio."],
    ["RB-10", "Personas", "Secuestro o extorsión", "Secuestro, o amenaza con exigencia (dinero, información o favores) contra directivos, personal o la empresa."],
    ["RB-11", "Personas", "Infiltración de personal con intención delictiva", "Vinculación de personal propio o tercero con antecedentes, intención delictiva o conflicto de interés."],
    ["RB-12", "Personas", "Fraude interno, colusión o corrupción", "Uso indebido de recursos, complicidad interna o corrupción que facilita otros riesgos."],
    ["RB-13", "Personas", "Accidentes o lesiones a personas", "Accidentes de trabajo o por condiciones locativas inseguras; lesiones en la operación."],
    ["RB-14", "Personas", "Afectación a niños, niñas, adolescentes o población vulnerable", "Riesgos sobre menores o población vulnerable en el sitio."],
    ["RB-15", "Personas", "Aglomeración no controlada", "Concentración excesiva en ingresos, filas, pasillos o eventos."],
    ["RB-16", "Entorno", "Alteración del orden público, asonada o bloqueos", "Disturbios, conflictividad social, bloqueo de vías o accesos."],
    ["RB-17", "Entorno", "Terrorismo o atentado", "Atentado terrorista o sabotaje grave de origen externo."],
    ["RB-18", "Entorno", "Microtráfico o entorno criminógeno", "Consumo o venta de sustancias y presencia criminal en el entorno."],
    ["RB-19", "Entorno", "Uso indebido u ocupación irregular del espacio", "Uso del sitio o de sus áreas para fines no autorizados, incluida la invasión u ocupación de terrenos."],
    ["RB-20", "Información", "Pérdida, fuga o divulgación de información", "Información confidencial o estratégica sustraída, filtrada o divulgada sin autorización."],
    ["RB-21", "Información", "Fraude documental, suplantación o uso indebido de credenciales", "Documentos o soportes falsos, validación deficiente, y carnés, listas o acreditaciones falsas, prestadas o vencidas."],
    ["RB-22", "Información", "Ciberataque o falla de sistemas informáticos", "Ataque o falla tecnológica con efecto en la operación o la reputación."],
    ["RB-23", "Medios técnicos y servicio", "Falla del sistema de videovigilancia", "Cámaras, grabación o monitoreo que fallan o detectan tarde."],
    ["RB-24", "Medios técnicos y servicio", "Falla del sistema de alarma", "Alarma que no funciona, no se supervisa o no tiene capacidad de respuesta."],
    ["RB-25", "Medios técnicos y servicio", "Falla de comunicaciones operativas", "Radios, telefonía o medios de comunicación del servicio que fallan."],
    ["RB-26", "Medios técnicos y servicio", "Falla operativa del servicio de vigilancia", "Incumplimiento de protocolos, error humano, negligencia o respuesta deficiente del servicio ante incidentes de seguridad."],
    ["RB-27", "Emergencias", "Incendio", "Incendio o conato de incendio."],
    ["RB-28", "Emergencias", "Falla eléctrica", "Cortocircuito, sobrecarga o corte del suministro que deja sin energía la operación o los sistemas de seguridad."],
    ["RB-29", "Emergencias", "Explosión, fuga de gas o de sustancias químicas", "Fugas, sobrepresión o explosión por falla técnica."],
    ["RB-30", "Emergencias", "Desastre natural", "Sismo, inundación u otros eventos naturales con daño estructural u operativo."],
    ["RB-31", "Emergencias", "Fallas en la evacuación o la respuesta a emergencias", "Evacuación, primeros auxilios o atención inicial deficientes ante una emergencia (incendio, sismo, accidente)."],
  ].map(([codigo, categoria, nombre, cubre]) => Object.freeze({ codigo, categoria, nombre, cubre, procesos: Object.freeze([]) }))),
});

// Los nombres que ve el cliente (informe de HADA, 2026-11-05): los de la casa, no los del documento maestro. Cambian
// sólo los nombres; los números y la fórmula de la metodología v1 son los mismos.
export const ESCALAS = Object.freeze({
  probabilidad: Object.freeze(['Muy baja', 'Baja', 'Media', 'Alta', 'Muy alta']),
  impacto: Object.freeze(['Insignificante', 'Leve', 'Moderado', 'Grave', 'Catastrófico']),
  // Calificación del control en palabras. 2 a 4, verificados contra los Excel; 1 y 5, de la «Guía de calificación de la
  // matriz 5×5 y controles» de la sede Medellín (analista de riesgos, noviembre de 2026), que los propone para
  // estandarizar los informes. Juan, 2026-11-11: "adelante con los nombres".
  control: Object.freeze({
    calidad: Object.freeze({ 1: 'No confiable', 2: 'Poco confiable', 3: 'Medianamente confiable', 4: 'Confiable', 5: 'Altamente confiable' }),
    eficacia: Object.freeze({ 1: 'Ineficaz', 2: 'Poco eficaz', 3: 'Medianamente eficaz', 4: 'Eficaz', 5: 'Altamente eficaz' }),
    eficiencia: Object.freeze({ 1: 'Ineficiente', 2: 'Poco eficiente', 3: 'Medianamente eficiente', 4: 'Eficiente', 5: 'Altamente eficiente' }),
  }),
});

/** "Medianamente confiable", o el número cuando la escala no tiene nombre para ese valor. */
export function controlWord(dimension, value) {
  if (value === null || value === undefined) return null;
  return ESCALAS.control[dimension]?.[value] || `Calificación ${value}`;
}

export const PLANTILLAS = Object.freeze({ [PLANTILLA_INSTALACIONES_FISICAS_V1.id]: PLANTILLA_INSTALACIONES_FISICAS_V1 });
