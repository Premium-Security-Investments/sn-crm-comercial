// Estudios de Seguridad Física: recorrido guiado (Juan, 2026-11-12: "ya que usted conoce la norma … puede definir un
// listado de preguntas que al ser respondidas permiten generar un estudio muy completo").
//
// Dos técnicas de la NTC-IEC/ISO 31010 (adopción de IEC 31010:2019):
//   · lista de verificación (B.2.2): preguntas cerradas por área de la sede. Cada una dice qué respuesta es la
//     favorable; la favorable deja un CONTROL EXISTENTE y la desfavorable una VULNERABILIDAD con su CONTRAMEDIDA;
//   · "¿qué pasaría si…?" estructurado, SWIFT (B.2.6): escenarios abiertos por área; la respuesta queda como análisis.
// Cada pregunta apunta a riesgos de la lista base (RB-xx). Las preguntas no califican: con ellas la plataforma propone
// qué riesgos incluir, con causas, controles y recomendaciones; probabilidad, impacto y controles los califica el
// analista. Viven en el código, versionadas como la metodología: cambiarlas es una versión nueva, por PR.

export const QUESTIONNAIRE_VERSION = 'recorrido-2026-11';

export const AREAS = Object.freeze([
  Object.freeze({ codigo: 'entorno', nombre: 'Entorno y contexto' }),
  Object.freeze({ codigo: 'perimetro', nombre: 'Perímetro' }),
  Object.freeze({ codigo: 'accesos', nombre: 'Accesos de personas y vehículos' }),
  Object.freeze({ codigo: 'interiores', nombre: 'Áreas restringidas e interiores' }),
  Object.freeze({ codigo: 'bienes', nombre: 'Bienes, carga e inventarios' }),
  Object.freeze({ codigo: 'tecnicos', nombre: 'Medios técnicos' }),
  Object.freeze({ codigo: 'vigilancia', nombre: 'Servicio de vigilancia' }),
  Object.freeze({ codigo: 'personas', nombre: 'Personas' }),
  Object.freeze({ codigo: 'informacion', nombre: 'Información' }),
  Object.freeze({ codigo: 'emergencias', nombre: 'Emergencias e instalaciones' }),
  Object.freeze({ codigo: 'antecedentes', nombre: 'Antecedentes' }),
]);

// [código, área, pregunta, respuesta favorable ('si' | 'no'), riesgos, control si es favorable, vulnerabilidad si no lo
// es, contramedida]
const CHECKLIST = [
  // Entorno
  ['ENT-01', 'entorno', '¿La zona tiene antecedentes de hurtos, atracos o extorsión en el último año?', 'no', ['RB-03', 'RB-05', 'RB-06', 'RB-10'], null, 'La zona tiene antecedentes de delitos en el último año.', 'Ajustar el dispositivo a los horarios y modalidades delictivas de la zona y coordinar con la Policía del cuadrante.'],
  ['ENT-02', 'entorno', '¿Colinda con lotes baldíos, vías sin iluminación, caños o zonas de difícil vigilancia?', 'no', ['RB-03', 'RB-19'], null, 'Colinda con zonas de difícil vigilancia que facilitan acercarse sin ser visto.', 'Reforzar el perímetro hacia esas colindancias con iluminación, detección y rondas.'],
  ['ENT-03', 'entorno', '¿Hay un CAI o estación de Policía que pueda reaccionar en menos de 10 minutos?', 'si', ['RB-03', 'RB-09', 'RB-16'], 'Apoyo de la Policía con reacción en menos de 10 minutos.', 'La reacción de la Policía tarda más de 10 minutos.', 'Establecer un protocolo de reacción propio (supervisor motorizado o reacción contratada) y la línea directa con el cuadrante.'],
  ['ENT-04', 'entorno', '¿Hay bloqueos, protestas o conflictividad social frecuentes en el sector?', 'no', ['RB-16', 'RB-15'], null, 'El sector tiene bloqueos o protestas frecuentes.', 'Protocolo de cierre preventivo de accesos y rutas alternas para personal y carga.'],
  ['ENT-05', 'entorno', '¿Hay expendios de droga, habitantes de calle o actividad criminal en el entorno inmediato?', 'no', ['RB-18', 'RB-06', 'RB-19'], null, 'El entorno inmediato tiene actividad criminal o consumo.', 'Articular con la Policía y la autoridad local; reforzar la vigilancia en los horarios críticos.'],
  ['ENT-07', 'entorno', '¿La sede o el cliente puede ser un objetivo simbólico o estratégico (infraestructura crítica, multinacional, entidad pública)?', 'no', ['RB-17', 'RB-07'], null, 'La sede puede ser un objetivo simbólico o estratégico.', 'Protocolo ante amenaza de atentado (revisión de paquetes y vehículos, evacuación) y enlace con autoridades.'],
  ['ENT-06', 'entorno', '¿La sede está en zona de riesgo de inundación, deslizamiento o alta amenaza sísmica?', 'no', ['RB-30'], null, 'La sede está en zona de amenaza natural.', 'Plan de contingencia por amenaza natural y revisión estructural.'],
  // Perímetro
  ['PER-01', 'perimetro', '¿El cerramiento perimetral es continuo, sin huecos ni tramos caídos?', 'si', ['RB-03'], 'Cerramiento perimetral continuo.', 'El cerramiento tiene huecos o tramos caídos.', 'Reparar el cerramiento y revisarlo en cada ronda.'],
  ['PER-02', 'perimetro', '¿El cerramiento tiene al menos 2,5 metros de altura?', 'si', ['RB-03'], 'Cerramiento de al menos 2,5 m.', 'El cerramiento es bajo y fácil de franquear.', 'Elevar el cerramiento o complementarlo con malla o concertina.'],
  ['PER-03', 'perimetro', '¿Tiene concertina, alambre de púas u otra barrera en la parte superior?', 'si', ['RB-03'], 'Barrera superior en el cerramiento (concertina o alambre).', 'El cerramiento no tiene barrera superior.', 'Instalar concertina o barrera superior en los tramos expuestos.'],
  ['PER-04', 'perimetro', '¿Hay árboles, contenedores, techos vecinos o estructuras que permitan trepar el cerramiento?', 'no', ['RB-03'], null, 'Hay elementos junto al cerramiento que permiten trepar.', 'Retirar o podar los elementos junto al cerramiento, o proteger esos tramos.'],
  ['PER-05', 'perimetro', '¿Todo el perímetro está iluminado de noche, sin zonas oscuras?', 'si', ['RB-03', 'RB-07'], 'Iluminación perimetral nocturna sin zonas oscuras.', 'Hay zonas del perímetro sin iluminación de noche.', 'Instalar iluminación perimetral, preferiblemente con sensor de movimiento.'],
  ['PER-06', 'perimetro', '¿Hay detección perimetral (sensores, barreras o cámaras con analítica)?', 'si', ['RB-03'], 'Detección perimetral.', 'No hay detección perimetral: una intrusión se descubre tarde.', 'Instalar detección perimetral monitoreada (sensores o analítica de video).'],
  ['PER-07', 'perimetro', '¿Las cubiertas, claraboyas y ventanas bajas están protegidas contra ingreso?', 'si', ['RB-03', 'RB-05'], 'Cubiertas, claraboyas y ventanas protegidas.', 'Hay cubiertas, claraboyas o ventanas por donde se puede entrar.', 'Proteger cubiertas y ventanas con rejas, mallas o sensores.'],
  // Accesos
  ['ACC-01', 'accesos', '¿Todos los accesos en uso tienen un guarda o control permanente?', 'si', ['RB-01', 'RB-04'], 'Control permanente en los accesos en uso.', 'Hay accesos en uso sin control permanente.', 'Asignar control a cada acceso en uso o cerrarlo.'],
  ['ACC-02', 'accesos', '¿Los accesos que no se usan están cerrados y asegurados?', 'si', ['RB-01', 'RB-03'], 'Accesos sin uso cerrados y asegurados.', 'Hay accesos sin uso que no están asegurados.', 'Sellar o asegurar los accesos sin uso y revisarlos en cada ronda.'],
  ['ACC-03', 'accesos', '¿Se registra a cada visitante con documento de identidad y a quién visita?', 'si', ['RB-01', 'RB-21'], 'Registro de visitantes con documento y anfitrión.', 'Los visitantes entran sin registro completo.', 'Implementar el registro de visitantes con documento, anfitrión, hora de entrada y salida.'],
  ['ACC-04', 'accesos', '¿Se verifica la autorización del visitante con quien lo recibe antes de dejarlo entrar?', 'si', ['RB-01', 'RB-21'], 'Verificación previa de la autorización del visitante.', 'No se confirma la autorización del visitante antes de dejarlo entrar.', 'Confirmar cada visita con el anfitrión o contra una lista autorizada.'],
  ['ACC-05', 'accesos', '¿Empleados, contratistas y proveedores portan carné vigente y se verifica?', 'si', ['RB-01', 'RB-21', 'RB-11'], 'Carnetización verificada de empleados y contratistas.', 'No se verifica el carné de empleados, contratistas o proveedores.', 'Carnetización obligatoria y verificación en el acceso; listas de contratistas actualizadas.'],
  ['ACC-06', 'accesos', '¿Hay barreras físicas en los accesos (torniquetes, talanqueras, esclusas)?', 'si', ['RB-01'], 'Barreras físicas en los accesos.', 'Los accesos no tienen barreras físicas.', 'Instalar torniquetes o talanqueras en los accesos principales.'],
  ['ACC-07', 'accesos', '¿Se inspeccionan los vehículos y la carga que entran y salen?', 'si', ['RB-04', 'RB-05', 'RB-08'], 'Inspección de vehículos y carga en entradas y salidas.', 'Vehículos y carga entran o salen sin inspección.', 'Protocolo de inspección vehicular (cabina, furgón, bajos) con registro.'],
  ['ACC-08', 'accesos', '¿Se hace requisa o revisión de paquetes a la salida del personal?', 'si', ['RB-05', 'RB-12'], 'Revisión de paquetes a la salida.', 'No se revisan los paquetes a la salida.', 'Revisión aleatoria y documentada de paquetes a la salida.'],
  // Interiores
  ['INT-01', 'interiores', '¿Las áreas críticas (bodegas, cuarto técnico, caja, archivo) tienen control de acceso propio?', 'si', ['RB-02', 'RB-05', 'RB-20'], 'Control de acceso propio en las áreas críticas.', 'Las áreas críticas no tienen control de acceso propio.', 'Control de acceso por tarjeta o llave restringida en cada área crítica, con registro.'],
  ['INT-02', 'interiores', '¿Hay custodia y registro de las llaves (quién las tiene y cuándo)?', 'si', ['RB-02', 'RB-12'], 'Custodia y registro de llaves.', 'Las llaves no tienen custodia ni registro.', 'Llavero bajo custodia con registro de entrega y devolución; cambio de guardas si hay pérdida.'],
  ['INT-03', 'interiores', '¿Puertas y cerraduras de las áreas críticas son robustas y están en buen estado?', 'si', ['RB-02', 'RB-05'], 'Puertas y cerraduras robustas en áreas críticas.', 'Puertas o cerraduras de áreas críticas débiles o dañadas.', 'Reforzar puertas y cambiar cerraduras de las áreas críticas.'],
  ['INT-04', 'interiores', '¿Las áreas críticas tienen alarma de intrusión fuera del horario laboral?', 'si', ['RB-02', 'RB-05'], 'Alarma de intrusión en áreas críticas.', 'Las áreas críticas no tienen alarma fuera del horario.', 'Instalar alarma de intrusión monitoreada en las áreas críticas.'],
  // Bienes
  ['BIE-01', 'bienes', '¿Se guardan bienes de alto valor o fácil reventa (producto terminado, cobre, electrónica, dinero)?', 'no', ['RB-05', 'RB-10'], null, 'Se guardan bienes de alto valor o fácil reventa.', 'Proteger esos bienes en áreas restringidas, con inventario frecuente y vigilancia focalizada.'],
  ['BIE-02', 'bienes', '¿Se hacen inventarios periódicos y se concilian las diferencias?', 'si', ['RB-05', 'RB-12'], 'Inventarios periódicos conciliados.', 'No hay inventarios periódicos conciliados.', 'Inventarios cíclicos con conciliación y reporte de diferencias.'],
  ['BIE-03', 'bienes', '¿Toda salida de mercancía o equipos requiere documento autorizado y se coteja en portería?', 'si', ['RB-05', 'RB-12'], 'Salida de mercancía con documento cotejado en portería.', 'Sale mercancía o equipos sin documento cotejado.', 'Exigir orden de salida firmada y cotejarla en portería.'],
  ['BIE-04', 'bienes', '¿La carga despachada lleva precintos o sellos registrados?', 'si', ['RB-08', 'RB-05'], 'Precintos o sellos registrados en la carga.', 'La carga sale sin precintos registrados.', 'Precintos numerados con registro y verificación en cargue y entrega.'],
  ['BIE-05', 'bienes', '¿El cargue y descargue se hace con supervisión y en zona vigilada por cámara?', 'si', ['RB-05', 'RB-08'], 'Cargue y descargue supervisado y grabado.', 'El cargue y descargue no se supervisa ni se graba.', 'Supervisar los muelles y cubrirlos con cámara grabando.'],
  ['BIE-06', 'bienes', '¿Los bienes tienen póliza de seguro vigente?', 'si', ['RB-05', 'RB-07', 'RB-27'], 'Póliza de seguro vigente sobre los bienes.', 'Los bienes no tienen póliza vigente.', 'Revisar con el cliente la cobertura de seguros.'],
  // Medios técnicos
  ['TEC-01', 'tecnicos', '¿El CCTV cubre accesos, perímetro y áreas críticas sin puntos ciegos relevantes?', 'si', ['RB-23', 'RB-01', 'RB-03', 'RB-05'], 'CCTV con cobertura de accesos, perímetro y áreas críticas.', 'El CCTV tiene puntos ciegos en zonas relevantes.', 'Ampliar la cobertura de cámaras a los puntos ciegos.'],
  ['TEC-02', 'tecnicos', '¿Las grabaciones se conservan al menos 30 días?', 'si', ['RB-23'], 'Grabación con retención de al menos 30 días.', 'Las grabaciones se conservan menos de 30 días.', 'Ampliar la capacidad de grabación a 30 días o más.'],
  ['TEC-03', 'tecnicos', '¿Alguien monitorea las cámaras en vivo (en sitio o central)?', 'si', ['RB-23', 'RB-03'], 'Monitoreo en vivo de las cámaras.', 'Nadie monitorea las cámaras en vivo.', 'Monitoreo en vivo desde la central o el puesto, al menos en las horas críticas.'],
  ['TEC-04', 'tecnicos', '¿Hay alarma conectada a una central con reacción?', 'si', ['RB-24', 'RB-03'], 'Alarma monitoreada con reacción.', 'No hay alarma monitoreada con reacción.', 'Conectar la alarma a la central de monitoreo con protocolo de reacción.'],
  ['TEC-05', 'tecnicos', '¿Los sistemas de seguridad tienen respaldo de energía (UPS o planta)?', 'si', ['RB-28', 'RB-23', 'RB-24'], 'Respaldo de energía para los sistemas de seguridad.', 'Los sistemas de seguridad se apagan si se va la energía.', 'Instalar UPS o conectar los sistemas de seguridad a la planta.'],
  ['TEC-06', 'tecnicos', '¿Los equipos de seguridad tienen mantenimiento preventivo programado?', 'si', ['RB-23', 'RB-24'], 'Mantenimiento preventivo de equipos de seguridad.', 'Los equipos no tienen mantenimiento preventivo.', 'Programa de mantenimiento preventivo con registro.'],
  ['TEC-07', 'tecnicos', '¿El guarda tiene radio, celular o botón de pánico que funcione?', 'si', ['RB-25', 'RB-09'], 'Comunicaciones del guarda funcionando (radio, celular o botón de pánico).', 'El guarda no tiene un medio de comunicación confiable.', 'Dotar de radio o celular con prueba diaria, y botón de pánico.'],
  // Vigilancia
  ['VIG-01', 'vigilancia', '¿El número de guardas por turno alcanza para cubrir accesos y rondas?', 'si', ['RB-26', 'RB-01'], 'Dispositivo de vigilancia suficiente por turno.', 'El dispositivo no alcanza para cubrir accesos y rondas.', 'Revisar el dispositivo con el cliente según los puntos a cubrir.'],
  ['VIG-02', 'vigilancia', '¿Se hacen rondas con puntos de control marcados y frecuencia definida?', 'si', ['RB-26', 'RB-03'], 'Rondas con puntos de control y frecuencia definida.', 'Las rondas no tienen puntos de control ni frecuencia definida.', 'Rondas con puntos de control (QR) y frecuencia variable.'],
  ['VIG-03', 'vigilancia', '¿El puesto recibe visitas de supervisión periódicas?', 'si', ['RB-26'], 'Supervisión periódica del puesto.', 'El puesto no tiene supervisión periódica.', 'Programar visitas de supervisión, incluidas nocturnas.'],
  ['VIG-04', 'vigilancia', '¿Hay consignas escritas, actualizadas y conocidas por los guardas?', 'si', ['RB-26'], 'Consignas escritas y actualizadas.', 'Las consignas no están escritas o no se conocen.', 'Actualizar las consignas, socializarlas y evaluarlas.'],
  ['VIG-05', 'vigilancia', '¿El personal está capacitado en los protocolos del puesto y en emergencias?', 'si', ['RB-26', 'RB-31'], 'Personal capacitado en protocolos y emergencias.', 'El personal no está capacitado en los protocolos del puesto.', 'Capacitación en protocolos, reacción y emergencias, con registro.'],
  ['VIG-06', 'vigilancia', '¿El servicio armado (si lo hay) tiene control de armas y municiones?', 'si', ['RB-26', 'RB-09'], 'Control de armas y municiones.', 'No hay control de armas y municiones.', 'Control de armas en cada relevo, con registro.'],
  // Personas
  ['PSN-01', 'personas', '¿Se hacen estudios de confiabilidad al personal propio y contratista que entra?', 'si', ['RB-11', 'RB-12'], 'Estudios de confiabilidad al personal.', 'No se hacen estudios de confiabilidad al personal.', 'Estudios de confiabilidad (antecedentes, referencias, visita) al vincular y periódicamente.'],
  ['PSN-02', 'personas', '¿Hay protocolo ante amenazas, extorsión o llamadas sospechosas?', 'si', ['RB-10', 'RB-09'], 'Protocolo ante amenazas y extorsión.', 'No hay protocolo ante amenazas o extorsión.', 'Protocolo de manejo de amenazas y extorsión con el Gaula.'],
  ['PSN-03', 'personas', '¿Los directivos o personal clave tienen medidas de protección acordes a su exposición?', 'si', ['RB-10'], 'Medidas de protección para directivos.', 'Los directivos expuestos no tienen medidas de protección.', 'Análisis de riesgo del personal clave y medidas de protección.'],
  ['PSN-04', 'personas', '¿Asisten menores de edad o población vulnerable a la sede?', 'no', ['RB-14'], null, 'Asisten menores o población vulnerable.', 'Protocolo de protección de menores y población vulnerable.'],
  ['PSN-05', 'personas', '¿Se presentan aglomeraciones (eventos, cambios de turno masivos, atención al público)?', 'no', ['RB-15'], null, 'Se presentan aglomeraciones.', 'Plan de manejo de flujos y aglomeraciones.'],
  // Información
  ['INF-01', 'informacion', '¿Los documentos confidenciales se guardan bajo llave y se destruyen de forma segura?', 'si', ['RB-20'], 'Custodia y destrucción segura de documentos.', 'Los documentos confidenciales no tienen custodia ni destrucción segura.', 'Archivo bajo llave y destrucción segura de documentos.'],
  ['INF-02', 'informacion', '¿El cuarto de servidores y los equipos de red tienen acceso restringido?', 'si', ['RB-20', 'RB-22'], 'Acceso restringido a servidores y red.', 'Servidores o equipos de red sin acceso restringido.', 'Restringir el acceso al cuarto técnico con registro.'],
  ['INF-03', 'informacion', '¿Hay medidas básicas de ciberseguridad (contraseñas, respaldo, antivirus)?', 'si', ['RB-22'], 'Medidas básicas de ciberseguridad.', 'No hay medidas básicas de ciberseguridad.', 'Recomendar al área de TI del cliente un diagnóstico de ciberseguridad.'],
  // Emergencias
  ['EME-01', 'emergencias', '¿Hay plan de emergencias actualizado y se hizo simulacro en el último año?', 'si', ['RB-31', 'RB-27', 'RB-30'], 'Plan de emergencias actualizado con simulacro reciente.', 'No hay plan de emergencias actualizado o no hubo simulacro.', 'Actualizar el plan de emergencias y programar simulacro.'],
  ['EME-02', 'emergencias', '¿Hay extintores vigentes, señalizados y accesibles?', 'si', ['RB-27'], 'Extintores vigentes, señalizados y accesibles.', 'Faltan extintores vigentes o están mal ubicados.', 'Recargar, señalizar y redistribuir los extintores.'],
  ['EME-03', 'emergencias', '¿Hay detección de humo o incendio en bodegas y áreas técnicas?', 'si', ['RB-27'], 'Detección de humo o incendio.', 'No hay detección de humo o incendio.', 'Instalar detección de humo monitoreada.'],
  ['EME-04', 'emergencias', '¿Las rutas de evacuación y salidas de emergencia están despejadas y señalizadas?', 'si', ['RB-31', 'RB-13'], 'Rutas de evacuación despejadas y señalizadas.', 'Rutas de evacuación obstruidas o sin señalizar.', 'Despejar y señalizar rutas y salidas de emergencia.'],
  ['EME-05', 'emergencias', '¿Se almacenan gas, combustibles o sustancias químicas peligrosas?', 'no', ['RB-29', 'RB-27'], null, 'Se almacenan gas, combustibles o químicos peligrosos.', 'Almacenamiento seguro, señalizado y con hojas de seguridad; detección de fugas.'],
  ['EME-06', 'emergencias', '¿Las instalaciones eléctricas están en buen estado (sin cables expuestos ni sobrecargas)?', 'si', ['RB-28', 'RB-27'], 'Instalaciones eléctricas en buen estado.', 'Instalaciones eléctricas en mal estado o sobrecargadas.', 'Revisión eléctrica por personal certificado.'],
  ['EME-07', 'emergencias', '¿Hay condiciones locativas inseguras (pisos, escaleras, alturas, estanterías sin anclar)?', 'no', ['RB-13'], null, 'Hay condiciones locativas inseguras.', 'Corregir las condiciones locativas y reportarlas a SST.'],
  // Antecedentes
  ['ANT-01', 'antecedentes', '¿Hubo hurtos, intrusiones o intentos en la sede en el último año?', 'no', ['RB-05', 'RB-03', 'RB-01'], null, 'Hubo hurtos, intrusiones o intentos en el último año.', 'Analizar cada caso (causa raíz) y ajustar los controles que fallaron.'],
  ['ANT-02', 'antecedentes', '¿Hubo agresiones, amenazas o extorsiones contra el personal en el último año?', 'no', ['RB-09', 'RB-10'], null, 'Hubo agresiones, amenazas o extorsiones en el último año.', 'Reforzar el protocolo ante amenazas y la coordinación con autoridades.'],
  ['ANT-03', 'antecedentes', '¿Hubo daños intencionales, sabotaje o vandalismo en el último año?', 'no', ['RB-07'], null, 'Hubo daños intencionales o sabotaje en el último año.', 'Identificar el origen y proteger los puntos atacados.'],
  ['ANT-04', 'antecedentes', '¿Hubo cambios recientes en las instalaciones u operación (ampliaciones, nuevos turnos, nuevos productos)?', 'no', ['RB-26'], null, 'Hubo cambios recientes en las instalaciones u operación.', 'Ajustar el dispositivo y las consignas a los cambios.'],
];

// "¿Qué pasaría si…?" (SWIFT): escenarios abiertos; la respuesta queda como análisis en el riesgo que se proponga.
const SCENARIOS = [
  ['SWI-01', 'perimetro', '¿Qué pasaría si alguien entra por el punto más débil del perímetro de noche? ¿Quién lo detecta y en cuánto tiempo?', ['RB-03']],
  ['SWI-02', 'accesos', '¿Qué pasaría si una persona entra con un carné o una autorización falsa?', ['RB-01', 'RB-21']],
  ['SWI-03', 'bienes', '¿Qué pasaría si alguien de adentro saca mercancía en un vehículo autorizado?', ['RB-05', 'RB-12']],
  ['SWI-04', 'tecnicos', '¿Qué pasaría si se va la energía de noche durante dos horas?', ['RB-28', 'RB-23', 'RB-24']],
  ['SWI-05', 'vigilancia', '¿Qué pasaría si el guarda queda incapacitado o no responde? ¿Quién se da cuenta?', ['RB-26', 'RB-25']],
  ['SWI-06', 'personas', '¿Qué pasaría si llaman a extorsionar a un directivo o a un empleado?', ['RB-10']],
  ['SWI-07', 'emergencias', '¿Qué pasaría si hay un incendio en la bodega principal en horario nocturno?', ['RB-27', 'RB-31']],
  ['SWI-08', 'entorno', '¿Qué pasaría si un bloqueo impide entrar o salir de la sede durante un día?', ['RB-16']],
];

export const QUESTIONS = Object.freeze([
  ...CHECKLIST.map(([codigo, area, texto, favorable, riesgos, control, vulnerabilidad, contramedida]) => Object.freeze({
    codigo, area, tipo: 'verificacion', texto, favorable, riesgos: Object.freeze(riesgos), control, vulnerabilidad, contramedida,
  })),
  ...SCENARIOS.map(([codigo, area, texto, riesgos]) => Object.freeze({ codigo, area, tipo: 'escenario', texto, riesgos: Object.freeze(riesgos) })),
]);
const BY_CODE = new Map(QUESTIONS.map(question => [question.codigo, question]));
export const questionByCode = code => BY_CODE.get(code) || null;
