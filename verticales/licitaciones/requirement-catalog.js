// Pestaña «Requisitos» (Juan, 2026-11-11: «vamos así y luego vemos detalles»; migración 210).
//
// Un catálogo histórico de requisitos habilitantes y puntuables, con una fila por TIPO de requisito y no por cada vez que
// un pliego lo pidió: en la matriz de SharePoint 577 de 585 habilitantes tenían texto distinto, aunque «RUP vigente» o
// «garantía de seriedad» se repetían en todos los procesos con otras palabras. Fuentes:
//   * la matriz histórica de SharePoint, copiada a diario a psi_tender_requirement_history (~20 procesos de 2025-2026);
//   * los requisitos de cada análisis del CRM (envelope.requirements), en vivo;
//   * lo que impidió presentarse según las actas de cierre (requirements_unmet), en vivo.
// Nunca hubo un rechazo en un informe de evaluación: «nos frenó» es que el análisis lo marcó bloqueante o el acta lo
// registró como incumplido.
//
// Módulo puro: la clasificación por reglas de texto (sin modelo) y el armado del catálogo.

export const REQUIREMENT_CATEGORIES = Object.freeze({
  juridico: 'Jurídico',
  rup: 'RUP y códigos',
  financiero: 'Financiero',
  experiencia: 'Experiencia',
  licencias: 'Licencias y permisos',
  presencia: 'Presencia en la ciudad',
  garantias: 'Garantías y pólizas',
  personal: 'Personal',
  tecnico: 'Técnico y operativo',
  economico: 'Oferta económica',
  puntaje: 'Puntaje',
});

// Orden = prioridad: gana el primer tipo cuyo patrón aparece. Los más específicos van antes que los generales.
// `area` es la categoría del CRM (envelope.requirements[].category) que el tipo acepta como pista, si la hay.
const H = 'habilitante';
const P = 'puntuable';
// `unless`: si aparece, el tipo no aplica aunque el patrón sí («domicilio» en el documento de conformación no es presencia).
const T = (key, kind, category, title, pattern, unless = null) => Object.freeze({ key, kind, category, title, pattern, unless });

export const REQUIREMENT_TYPES = Object.freeze([
  // Puntuables: sólo se prueban sobre filas puntuables.
  T('p_industria_nacional', P, 'puntaje', 'Apoyo a la industria nacional', /industria nacional|apoyo a la industria|ley 816|origen nacional|servicios? nacional|componente nacional|reciprocidad|trato nacional/),
  T('p_discapacidad', P, 'puntaje', 'Personas con discapacidad en la nómina', /discapacidad/),
  T('p_mujeres', P, 'puntaje', 'Emprendimiento o empresa de mujeres', /mujer|genero/),
  T('p_mipyme', P, 'puntaje', 'Mipyme o emprendimiento', /mipyme|pyme|emprendimiento|micro ?empresa/),
  T('p_poblaciones', P, 'puntaje', 'Vinculación de poblaciones (víctimas, reincorporados, jóvenes, etnias, adulto mayor)', /victima|reincorpora|reintegra|joven|etnic|indigena|afro|adulto mayor|madre cabeza|padre cabeza|pospenad|vulnerab|primer empleo/),
  T('p_desempate', P, 'puntaje', 'Factores de desempate', /desempate|empate/),
  T('p_sanciones', P, 'puntaje', 'Sin multas ni incumplimientos previos', /sancion|multa|incumplimiento|clausula penal|caducidad/),
  T('p_calidad', P, 'puntaje', 'Certificaciones de calidad (ISO, BASC, SST)', /\biso\b|basc|\bntc\b|certificacion(es)? de (calidad|gestion)|sistema de gestion|calidad/),
  T('p_capacitacion', P, 'puntaje', 'Capacitación adicional del personal', /capacitaci|curso|formacion|entrenamiento|reentrenamiento|diplomado|seminario/),
  T('p_sedes', P, 'puntaje', 'Sedes, sucursales o agencias en la zona', /sucursal|agencia|sede|oficina|domicilio|presencia/),
  T('p_tecnologia', P, 'puntaje', 'Medios tecnológicos, equipos o armamento adicionales', /\barmas?\b|armamento|mantenimiento|frecuencia|tecnolog|cctv|camara|video|monitoreo|alarma|gps|boton|detector|radio|equipo|dron|software|plataforma|biometr|control de acceso/),
  T('p_vehiculos', P, 'puntaje', 'Vehículos o motos adicionales', /vehiculo|moto|camioneta|automotor|reaccion/),
  T('p_personal', P, 'puntaje', 'Personal adicional o más calificado', /guarda|vigilante|supervisor|coordinador|director|jefe|profesional|personal|operador|escolta|tecnico|ingeniero|psicolog|sst|canino|perro|consultor|analista|evaluador de competencias/),
  T('p_experiencia', P, 'puntaje', 'Experiencia adicional', /experiencia|contratos? (ejecutad|adicional)/),
  T('p_economico', P, 'puntaje', 'Factor económico (precio)', /precio|economic|valor|tarifa|oferta|ponderaci|media (aritmetica|geometrica)|menor valor|tasa de cambio|trm/),
  T('p_bienestar', P, 'puntaje', 'Bienestar y condiciones laborales', /salario|bienestar|horario|jornada|prestacion|laboral|dotacion|uniforme/),
  T('p_otros', P, 'puntaje', 'Otros factores de puntaje', /./),

  // Habilitantes.
  T('presencia_local', H, 'presencia', 'Sede, sucursal, agencia o domicilio en la ciudad o el departamento', /sucursal|agencia|domicilio|presencia|sede (principal|local|en)|sedes?\b|oficina (en|local|principal)|territorial/,
    /extranjer|conformacion|identificacion|notificaci|direccion (de|para) (correspondencia|notificaciones)|razon social/),
  T('codigos_unspsc', H, 'rup', 'Códigos UNSPSC en el RUP', /unspsc|clasificador|clasificacion (de bienes|del rup|en el rup)|clasificad[oa]s? en (el )?rup|^(rup )?codigos?( rup| unspsc)?$|codigos? (\d|unspsc|del rup|en el rup|exigidos)|con los codigos|\b\d{8}\b/),
  T('rup_vigente', H, 'rup', 'RUP inscrito, vigente y en firme', /\brup\b|registro unico de proponentes/),
  T('liquidez', H, 'financiero', 'Índice de liquidez', /liquidez/),
  T('endeudamiento', H, 'financiero', 'Nivel de endeudamiento', /endeudamiento/),
  T('cobertura_intereses', H, 'financiero', 'Razón de cobertura de intereses', /cobertura de intereses|razon de cobertura/),
  T('capital_trabajo', H, 'financiero', 'Capital de trabajo', /capital (de )?trabajo/),
  T('rentabilidad', H, 'financiero', 'Rentabilidad del patrimonio y del activo (ROE, ROA)', /rentabilidad|\broe\b|\broa\b|capacidad organizacional/),
  T('patrimonio', H, 'financiero', 'Patrimonio mínimo', /patrimonio/),
  T('capacidad_residual', H, 'financiero', 'Capacidad residual de contratación', /capacidad residual|\bk de contratacion/),
  T('estados_financieros', H, 'financiero', 'Estados financieros y documentos financieros', /estados financieros|indicadores|indices|financier|balance|revisor fiscal|contador|dictamen/),
  T('garantia_seriedad', H, 'garantias', 'Garantía de seriedad de la oferta', /seriedad/),
  T('poliza_rce', H, 'garantias', 'Póliza de responsabilidad civil extracontractual', /responsabilidad civil|extracontractual|\brce\b/),
  T('poliza_vida', H, 'garantias', 'Seguro de vida colectivo del personal', /seguro de vida|poliza de vida|vida colectiv|^vida$/),
  T('garantias_contrato', H, 'garantias', 'Garantías del contrato (cumplimiento, salarios, calidad)', /garantia|poliza|amparo|asegurad|seguro|hurto/),
  T('licencia_comunicaciones', H, 'licencias', 'Licencia de comunicaciones o espectro (MinTIC)', /mintic|espectro|frecuencia|comunicacion|radio|telecomunicaci|\btic\b|valor agregado|telematic|habilitante convergente|\bvas\b/),
  T('armas', H, 'licencias', 'Armas: permisos de tenencia, porte y listado', /\barmas?\b|armamento|salvoconducto|\btenencia\b|\bporte\b|indumil|comercio de armas/),
  T('canina', H, 'licencias', 'Medio canino: resolución, certificación y póliza', /canin|perro|cane/),
  T('uniformes', H, 'licencias', 'Uniformes aprobados por la Supervigilancia', /uniforme|distintivo/),
  T('red_apoyo', H, 'licencias', 'Red de apoyo de la Policía', /red (de apoyo|policia)|frente de seguridad/),
  T('registro_tecnologia', H, 'licencias', 'Registro de comercializador o fabricante de equipos tecnológicos', /comercializador|fabricante|distribuidor autorizado|carta del fabricante|registro (de )?(productores|equipos)/),
  T('horas_extras', H, 'juridico', 'Autorización de horas extras del Ministerio del Trabajo', /horas extra|trabajo suplementario|ministerio del trabajo/),
  T('sanciones_supervigilancia', H, 'juridico', 'Certificado de multas y sanciones de la Supervigilancia', /sancion|multa/),
  T('licencia_supervigilancia', H, 'licencias', 'Licencia de funcionamiento de la Supervigilancia (modalidades y medios)', /licencia de funcionamiento|licencia (de|para) (la )?(vigilancia|prestacion|utilizacion|uso)|\blicencia\b(?! (de|para) (uso del espectro|valor agregado))|superintendencia de vigilancia|supervigilancia|modalidad|medio tecnologico|medios tecnologicos|resolucion de funcionamiento|svsp/,
    /organo social|estatutos|representante legal|salud en el trabajo|\bsst\b|subcontrat/),
  T('antecedentes', H, 'juridico', 'Antecedentes fiscales, disciplinarios, judiciales, REDAM y medidas correctivas', /antecedente|\bfiscal(es)?\b|disciplinari|judicial|redam|medidas correctivas|contraloria|procuraduria|policia nacional|cert(ificado)? policia|dijin|siri|deudores alimentarios|inhabilidades por delitos sexuales/),
  T('seguridad_social', H, 'juridico', 'Pago de seguridad social y parafiscales', /seguridad social|parafiscal|aportes|articulo 50|ley 789|sena|icbf|caja de compensacion|planilla/),
  T('existencia_representacion', H, 'juridico', 'Existencia y representación legal, objeto social y duración', /existencia|representacion legal|camara de comercio|objeto social|duracion|matricula mercantil|registro mercantil|constitu|representante legal|persona juridica|apoderado/),
  T('inhabilidades', H, 'juridico', 'Inhabilidades, incompatibilidades y conflicto de interés', /inhabilidad|incompatibilidad|conflicto de inter|prohibicion|capacidad legal|capacidad juridica/),
  T('sarlaft', H, 'juridico', 'Origen de fondos y prevención de lavado de activos (SARLAFT)', /sarlaft|lavado|origen de (los )?fondos|terroris/),
  T('rut', H, 'juridico', 'RUT', /\brut\b|registro unico tributario/),
  T('experiencia_especifica', H, 'experiencia', 'Experiencia específica (objeto, valor y lugar del contrato)', /experiencia especifica|especifica/),
  T('experiencia_general', H, 'experiencia', 'Experiencia general (número de contratos y valor en SMMLV)', /experiencia|\bexp\b|contrato|smmlv|certificacion(es)? de (cumplimiento|contrato)|acta de liquidacion/),
  T('responsable_sst', H, 'personal', 'Responsable o coordinador de SST', /\bsst\b|salud en el trabajo|sg-?sst/),
  T('personal_minimo', H, 'personal', 'Personal mínimo (guardas, supervisores, coordinadores, director)', /personal|guarda|vigilante|supervisor|coordinador|director|jefe|escolta|operador|mujer|hoja de vida|perfil|renova|credencial|curso|capacitaci|analista|evaluador de competencias|consultor/),
  T('centro_operaciones', H, 'tecnico', 'Centro de operaciones o central de monitoreo', /central|centro (de )?(operaciones|control|monitoreo)|monitoreo|24 ?horas/),
  T('vehiculos', H, 'tecnico', 'Vehículos y motos', /vehiculo|moto|camioneta|automotor|parque automotor/),
  T('equipos_tecnologia', H, 'tecnico', 'Equipos y medios tecnológicos (CCTV, alarmas, control de acceso)', /cctv|camara|video|alarma|control de acceso|equipo|tecnolog|software|nodo|biometr|grabador/),
  T('calidad_sst', H, 'tecnico', 'Sistemas de gestión (SG-SST, ISO, calificación ARL)', /\biso\b|calidad|sistema de gestion|\barl\b|estandares minimos|basc/),
  T('oferta_economica', H, 'economico', 'Oferta económica, tarifas mínimas y tope del presupuesto', /precio|economic|tarifa|presupuesto|valor (total|de la oferta|ofertado)|aiu|iva|anexo (economico|9)|tope/),
  T('identificacion', H, 'juridico', 'Documento de identidad y situación militar', /cedula|documento de identidad|identificacion|situacion militar|pasaporte/, /conformacion|consorcio|union temporal|plural/),
  T('estructura_organizacional', H, 'tecnico', 'Estructura organizacional, organigrama y atención al cliente', /organigrama|estructura organizacional|atencion al (cliente|usuario|consumidor)|pqr/),
  T('muestras_fichas', H, 'tecnico', 'Muestras físicas y fichas técnicas', /muestra|ficha tecnica/),
  T('cronograma', H, 'tecnico', 'Plazos, cronograma, empalme y manifestación de interés', /plazo|cronograma|empalme|manifestacion de interes|cierre|fecha/),
  T('proponente_plural', H, 'juridico', 'Consorcio o unión temporal: conformación y reglas', /consorcio|union temporal|plural|conjunt|integrante|documento de conformacion|participacion/),
  T('carta_formatos', H, 'juridico', 'Carta de presentación, formatos y compromisos', /carta|formato|compromiso|anexo|declaraci|manifestaci|juramento|pacto|firmad/),
  T('tecnico_otros', H, 'tecnico', 'Otros requisitos técnicos y operativos', /./),
]);

const TYPE_BY_KEY = new Map(REQUIREMENT_TYPES.map(type => [type.key, type]));
export const requirementType = key => TYPE_BY_KEY.get(key) || null;

/** Minúsculas, sin tildes, guiones como espacios: así se comparan los patrones. Pura. */
export function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// La categoría del CRM orienta cuando el texto es ambiguo (un «certificado» de LICENSE no es uno de LEGAL).
const CRM_HINT = { ECONOMIC: 'economico', EXPERIENCE: 'experiencia', FINANCIAL: 'financiero', INSURANCE: 'garantias', LICENSE: 'licencias', PERSONNEL: 'personal' };

/** Si un requisito del análisis del CRM es de puntaje (el análisis no separa habilitantes de puntuables). Pura. */
export function looksLikeScoring(parts) {
  return parts.some(part => /puntaje|puntua|pondera|industria nacional|desempate/.test(foldText(part)));
}

/**
 * El tipo de un requisito. `parts` son los textos en orden de peso (identificador, título, texto); gana el primer tipo
 * cuyo patrón aparezca en alguno, probando primero en las partes más cortas. Pura.
 */
export function classifyRequirement({ kind = H, parts = [], crmCategory = null } = {}) {
  const candidates = REQUIREMENT_TYPES.filter(type => type.kind === (kind === P ? P : H));
  const hint = CRM_HINT[String(crmCategory || '').toUpperCase()];
  const folded = parts.map(foldText).filter(Boolean);
  for (const text of folded) {
    const fits = type => type.pattern.source !== '.' && type.pattern.test(text) && !(type.unless && type.unless.test(text));
    const preferred = hint ? candidates.find(type => type.category === hint && fits(type)) : null;
    if (preferred) return preferred.key;
    const found = candidates.find(fits);
    if (found) return found.key;
  }
  return kind === P ? 'p_otros' : 'tecnico_otros';
}

/**
 * Un pedazo de frase del pliego que la matriz registró como requisito («5.1 REQUISITOS HABILITANTES JURÍDICOS:», «su
 * posterior calificación. Se evaluará con CUMPLE o NO CUMPLE.»): el PDF cortó la línea. Si aun así nombra un tema
 * conocido, cuenta para ese tema con la marca de texto incompleto; si no nombra ninguno, no cuenta. Pura.
 */
export function isRequirementFragment(text) {
  const raw = String(text || '').trim();
  if (raw.length < 12) return true;
  if (/^[a-záéíóúñ(,;.]/.test(raw)) return true;
  if (/^[▪*•\-–]/.test(raw)) return true;
  const letters = raw.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  if (letters.length && letters === letters.toUpperCase()) return true;
  const folded = foldText(raw);
  return /^(\d+(\.\d+)*\.? )?(criterios?|factor(es)? de (calificacion|evaluacion|escogencia)|requisitos habilitantes|la evaluacion|el comite|para la evaluacion|este criterio)\b/.test(folded);
}

// «Lo que nos inhabilita» (Juan, 2026-11-11 y 2026-11-12): sólo los HECHOS que nos faltan y exigen un trámite —una
// sede o sucursal, un código en el RUP, un registro o una licencia—, para que Katherine decida si se inicia el trámite y
// en el futuro no nos inhabiliten por eso. Los papeles que se renuevan (Cámara de Comercio, RUP con fecha nueva,
// certificados, garantía de seriedad) no van: se sacan en minutos. Un grupo aparece sólo si algún requisito suyo nos
// inhabilita según la ficha, o un análisis o un acta lo marcó como bloqueo. `fix` es la propuesta inicial.
export const REQUIREMENT_FOCUS = Object.freeze([
  { key: 'presencia', title: 'Sede, sucursal o agencia en la ciudad', types: ['presencia_local'], live: 'sedes',
    fix: 'Decidir en qué ciudades abrir sucursal o convertir la agencia en sucursal (las agencias no sirven cuando piden sucursal), empezando por las que más se repiten; mientras tanto, socio en unión temporal.' },
  { key: 'codigos', title: 'Códigos UNSPSC que no tenemos en el RUP', types: ['codigos_unspsc'], live: 'codigos',
    fix: 'Inscribir en el RUP los códigos que faltan (el 46101500, armas, primero) con contratos que los respalden; queda en firme 10 días hábiles después.' },
  { key: 'comunicaciones', title: 'Registro o permiso de telecomunicaciones nacional', types: ['licencia_comunicaciones'], live: null,
    fix: 'Tramitar ante MinTIC la ampliación del permiso de espectro a cobertura nacional.' },
  { key: 'importador', title: 'Registro de importador, comercializador o distribuidor de equipos', types: ['registro_tecnologia'], live: null,
    fix: 'Inscribirse ante la Supervigilancia como importador o comercializador de equipos de vigilancia, si vamos a licitar procesos de tecnología.' },
  { key: 'canino', title: 'Sede canina (criadero) autorizada', types: ['canina'], live: null,
    fix: 'Obtener la resolución de la Supervigilancia para una sede canina (criadero) en Pereira.' },
  { key: 'financiero', title: 'Indicadores financieros por debajo de lo que piden', types: ['liquidez', 'endeudamiento', 'cobertura_intereses', 'rentabilidad', 'capital_trabajo', 'patrimonio', 'capacidad_residual', 'estados_financieros'], live: 'financiero',
    fix: 'Revisar con Financiero si al próximo corte se puede subir la liquidez a 2,5 o más y bajar el endeudamiento del 50 %; mientras tanto, socio con buenos indicadores en unión temporal.' },
  { key: 'certificaciones', title: 'Certificaciones que no tenemos', types: ['calidad_sst'], live: null,
    fix: 'Decidir si se tramita la certificación que piden.' },
  { key: 'horas_extras', title: 'Autorización de horas extras del Ministerio del Trabajo', types: ['horas_extras'], live: null,
    fix: 'Confirmar si la tenemos; si no, solicitarla al Ministerio del Trabajo.' },
  // Juan, 2026-11-13. Estos cuatro no se pueden medir contra la ficha: entran cuando un análisis, un acta o una persona
  // (bloqueo anotado) dicen que nos inhabilitan, y no van a «por confirmar» (casi todo pliego pide personal y experiencia).
  { key: 'experiencia', title: 'Experiencia que no podemos acreditar', types: ['experiencia_especifica', 'experiencia_general'], live: null, pending: false,
    fix: 'Pedir ya los certificados de los contratos que más se repiten (Jerónimo Martins 070 y 089, Megabús 088, Terminales de Medellín 086); si el objeto o el alcance no alcanza, socio en unión temporal.' },
  { key: 'personal', title: 'Personal acreditado que no tenemos', types: ['personal_minimo', 'responsable_sst'], live: null, pending: false,
    fix: 'Con Talento Humano: quién tiene credencial de consultor de la Supervigilancia, los años de vínculo y los cursos que piden; tramitar lo que falte.' },
  { key: 'armas', title: 'Armas y salvoconductos a nombre de la empresa', types: ['armas'], live: null, pending: false,
    fix: 'Con Operaciones: cuántas armas tenemos con salvoconducto a nombre de la empresa y en qué ciudad; si no alcanzan, comprar o trasladar.' },
  { key: 'red_apoyo', title: 'Red de Apoyo de la Policía en la ciudad', types: ['red_apoyo'], live: null,
    fix: 'Confirmar en qué ciudades estamos inscritos en la Red de Apoyo de la Policía y registrarlo en la ficha; inscribirse donde haya procesos.' },
]);
export const FOCUS_STATUSES = Object.freeze({ por_decidir: 'Por decidir', iniciar: 'Iniciar trámite', en_tramite: 'En trámite', resuelto: 'Resuelto', no_por_ahora: 'No por ahora' });

const processKeyOf = occurrence => foldText(occurrence.process || '');

/**
 * El catálogo: una fila por tipo con sus ocurrencias, cuántos procesos lo piden y en cuáles nos frenó. Pura.
 *   matriz: filas de psi_tender_requirement_history; crm: [{ opportunity_id, process, url, requirement_id, category, text, validity,
 *   blocker, evaluation }]; actas: [{ opportunity_id, process, title, text, source }]. `assess(occurrence)` → veredicto
 *   contra la ficha (requirement-assessment.js), sólo para los habilitantes.
 */
export function buildRequirementCatalog({ matriz = [], crm = [], actas = [], blocks = [], assess = null } = {}) {
  const occurrences = [];
  let excluded = 0;
  // Los bloqueos anotados van primero: una persona leyó el pliego, así que su motivo es el que se muestra.
  for (const item of blocks) {
    const focus = REQUIREMENT_FOCUS.find(entry => entry.key === item.focus_key);
    if (!focus) continue;
    occurrences.push({ type: focus.types[0], source: 'anotado', id: item.id || null, opportunity_id: item.opportunity_id, process: item.process,
      text: item.reason || '', threshold: null, quote: item.citation || null, url: item.url || null, incomplete: false, blocked: true, annotated: true });
  }
  for (const row of matriz) {
    const key = classifyRequirement({ kind: row.kind, parts: [row.requisito, row.categoria] });
    const fragment = isRequirementFragment(row.requisito);
    if (fragment && key.endsWith('_otros')) { excluded += 1; continue; }
    const processes = row.procesos?.length ? row.procesos : ['Matriz histórica (proceso sin identificar)'];
    for (const process of processes) {
      occurrences.push({ type: key, source: 'matriz', id: row.id, process, text: row.requisito, threshold: row.umbral || null,
        points: row.puntos || null, quote: row.cita || null, url: row.url || null, incomplete: fragment, blocked: false });
    }
  }
  for (const item of crm) {
    const parts = [item.requirement_id ? String(item.requirement_id).replace(/^REQ-/, '') : '', item.text || ''];
    const kind = looksLikeScoring(parts) ? P : H;
    const key = classifyRequirement({ kind, parts, crmCategory: item.category });
    occurrences.push({ type: key, source: 'crm', id: item.requirement_id || null, opportunity_id: item.opportunity_id, process: item.process, city: item.city || null,
      text: item.text || item.requirement_id || '', threshold: item.validity || null, quote: null, url: item.url || null, incomplete: false,
      blocked: item.blocker === true || item.evaluation === 'BLOCKER' });
  }
  for (const item of actas) {
    const key = classifyRequirement({ kind: H, parts: [item.title || '', item.text || ''] });
    occurrences.push({ type: key, source: 'acta', id: null, opportunity_id: item.opportunity_id, process: item.process,
      text: item.title || '', threshold: null, quote: item.text || null, url: item.url || null, incomplete: false, blocked: true });
  }

  if (assess) for (const occurrence of occurrences) {
    if (requirementType(occurrence.type)?.kind === H && !occurrence.annotated) occurrence.assessment = assess(occurrence);
  }
  const byType = new Map();
  for (const occurrence of occurrences) {
    if (!byType.has(occurrence.type)) byType.set(occurrence.type, []);
    byType.get(occurrence.type).push(occurrence);
  }
  const types = [...byType].map(([key, list]) => {
    const type = requirementType(key);
    const processes = new Map();
    for (const occurrence of list) if (!processes.has(processKeyOf(occurrence))) processes.set(processKeyOf(occurrence), occurrence.process);
    const blocked = new Map();
    for (const occurrence of list.filter(item => item.blocked)) {
      const id = occurrence.opportunity_id || processKeyOf(occurrence);
      if (!blocked.has(id)) blocked.set(id, { opportunity_id: occurrence.opportunity_id || null, process: occurrence.process });
    }
    return { key, kind: type.kind, category: type.category, category_label: REQUIREMENT_CATEGORIES[type.category], title: type.title,
      processes: processes.size, blocked_in: [...blocked.values()],
      occurrences: list.sort((a, b) => Number(b.blocked) - Number(a.blocked) || Number(a.incomplete) - Number(b.incomplete)) };
  }).sort((a, b) => b.blocked_in.length - a.blocked_in.length || b.processes - a.processes || a.title.localeCompare(b.title));

  const allProcesses = new Set(occurrences.map(processKeyOf));
  return { types, totals: { occurrences: occurrences.length, excluded_fragments: excluded, processes: allProcesses.size, types: types.length } };
}

/**
 * «Lo que nos inhabilita»: un grupo por hecho que nos falta, sólo si algún requisito suyo nos inhabilita según la ficha o
 * un análisis, un acta o una persona lo marcó como bloqueo. Cada proceso una vez, con el motivo.
 *
 * Próximos y pasados (Juan, 2026-11-13: «mostrar en la tarjeta los procesos futuros que nos bloquea ese requisito y tal
 * vez con un desplegable ver los pasados»): `opportunities` dice, por oportunidad del CRM, si sigue abierta y cuándo
 * cierra. Los abiertos van en `upcoming` por fecha de cierre; el resto (cerrados, archivados y los de la matriz
 * histórica) en `past`. Los grupos con procesos próximos van primero. Pura.
 */
export function buildRequirementFocus(catalog, { state = [], opportunities = new Map() } = {}) {
  const byKey = new Map((catalog?.types || []).map(type => [type.key, type]));
  const saved = new Map(state.map(row => [row.focus_key, row]));
  return REQUIREMENT_FOCUS.map(focus => {
    const occurrences = focus.types.flatMap(key => byKey.get(key)?.occurrences || [])
      .filter(item => item.assessment?.verdict === 'inhabilita' || item.blocked)
      .sort((a, b) => Number(Boolean(b.annotated)) - Number(Boolean(a.annotated)));
    const processes = new Map();
    for (const item of occurrences) {
      const id = item.opportunity_id || processKeyOf(item);
      if (processes.has(id)) continue;
      const opportunity = item.opportunity_id ? opportunities.get(item.opportunity_id) : null;
      processes.set(id, { opportunity_id: item.opportunity_id || null, process: item.process,
        reason: item.assessment?.verdict === 'inhabilita' ? item.assessment.reason : item.text, blocked: item.blocked, annotated: Boolean(item.annotated),
        deadline: opportunity?.deadline || null, upcoming: Boolean(opportunity?.open) });
    }
    const list = [...processes.values()];
    const upcoming = list.filter(item => item.upcoming).sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
    const row = saved.get(focus.key) || {};
    return { key: focus.key, title: focus.title, types: focus.types, live: focus.live, processes: list, upcoming, past: list.filter(item => !item.upcoming),
      blocked: list.filter(item => item.blocked).length,
      status: row.status || 'por_decidir', owner: row.owner || null, note: row.note || null, current_state: row.current_state || null,
      fix_action: row.fix_action || focus.fix, updated_at: row.updated_at || null };
  }).filter(focus => focus.processes.length)
    .sort((a, b) => b.upcoming.length - a.upcoming.length || b.processes.length - a.processes.length);
}

/** «Por confirmar»: hechos de los mismos grupos que la ficha no deja decidir. Pura. */
export function buildRequirementPending(catalog) {
  const keys = new Set(REQUIREMENT_FOCUS.filter(focus => focus.pending !== false).flatMap(focus => focus.types));
  return (catalog?.types || []).filter(type => keys.has(type.key)).map(type => {
    const items = type.occurrences.filter(item => item.assessment?.verdict === 'verificar');
    return { key: type.key, title: type.title, processes: [...new Map(items.map(item => [item.opportunity_id || processKeyOf(item), { opportunity_id: item.opportunity_id || null, process: item.process, reason: item.assessment.reason }])).values()] };
  }).filter(item => item.processes.length);
}
