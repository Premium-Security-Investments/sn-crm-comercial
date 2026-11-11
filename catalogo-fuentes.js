// Catálogo de fuentes de toda la compañía · entrega 1 (diseño aprobado el 2026-10-23).
//
// No es de licitaciones: es la puerta única por la que cualquier agente —Mesa, copiloto
// comercial, gerencia— pide un dato por nombre sin saber en qué sistema vive. Hoy sus entradas
// son de empresa y licitaciones porque ahí falló; mañana serán de Avancys, SharePoint o AWS sin
// que cambie el mecanismo.
//
// Tres niveles, y la separación es deliberada:
//   - el DATO declara nombre, estado, responsable humano y sus fuentes candidatas;
//   - la FUENTE declara dónde vive, cómo se lee, su forma, si es tipada o prosa, su frescura
//     y quién puede leerla;
//   - la PREGUNTA DECISIVA (todavía sin entradas) declara una definición escrita y su dueño.
//
// Un agente pide por nombre y nunca sabe en qué tabla está el dato. Lo que crece es el catálogo,
// no el contrato de la Mesa.

import { crearLectorAvancys } from './avancys-odoo-lectura.js';
import { buildTenderCompanyDocumentBridge } from './verticales/licitaciones/tender-company-document-bridge.js';
import { matchCompanyDocumentClasses } from './verticales/licitaciones/tender-compliance-matrix.js';
import { agt002ListarFormatos, agt002LocateFormato } from './verticales/licitaciones/agt002-formato-oficial.js';
import { agt002SeccionDelPedido } from './verticales/licitaciones/agt002-seccion-del-pliego.js';
import { agt002ReglasParaPlurales } from './verticales/licitaciones/agt002-reglas-plurales.js';
import { ALLY_BOARD_RULE, buildAllyBoard, buildProcessParticipantsBoard } from './verticales/licitaciones/tender-allies-board.js';
import { readAgt002InitialAnalysisReport } from './verticales/licitaciones/agt002-initial-analysis-report.js';
import { readAgt002InitialAnalysisStatus } from './verticales/licitaciones/agt002-initial-analysis-status.js';

export const ESTADOS = Object.freeze({
  VIGENTE: 'vigente',
  EN_DISPUTA: 'en_disputa',
  NO_VERIFICADO: 'no_verificado',
  VENCIDO: 'vencido',
});

export const FRESCURAS = Object.freeze({
  CONGELADA: 'congelada',
  VIVA: 'viva',
  CONGELADA_CON_VENCIMIENTO: 'congelada_con_vencimiento',
});

export const FORMAS = Object.freeze({ TIPADO: 'tipado', PROSA: 'prosa' });

// Peor estado gana: una respuesta compuesta no puede ser más cierta que su insumo más débil.
const ORDEN_DE_CERTEZA = Object.freeze([
  ESTADOS.VIGENTE,
  ESTADOS.VENCIDO,
  ESTADOS.EN_DISPUTA,
  ESTADOS.NO_VERIFICADO,
]);

export function peorEstado(estados) {
  const presentes = (Array.isArray(estados) ? estados : []).filter(estado => ORDEN_DE_CERTEZA.includes(estado));
  if (presentes.length === 0) return ESTADOS.NO_VERIFICADO;
  return presentes.reduce((peor, actual) => (
    ORDEN_DE_CERTEZA.indexOf(actual) > ORDEN_DE_CERTEZA.indexOf(peor) ? actual : peor
  ));
}

// El registro de datos. `responsable` es quien responde por que el dato sea cierto —una persona,
// nunca una aplicación—; un dato sin responsable se sirve como no_verificado aunque tenga fuente.
// ---------------------------------------------------------------------------------------------
// Sensibilidad: cuánto daño hace un dato si se filtra o si alguien lo repite donde no debe.
//
// No es lo mismo que el permiso. El permiso dice QUIÉN puede abrir la fuente; la sensibilidad dice
// QUÉ se puede hacer con el dato una vez abierto. Para calcular el costo de un puesto hay que leer
// el salario de quien lo cubre: el agente necesita el dato y a la vez no debe poder escribir
// "fulano gana tanto". Un permiso no sabe decir eso; una clasificación sí.
// ---------------------------------------------------------------------------------------------
export const SENSIBILIDADES = Object.freeze({
  PUBLICA: 'publica',          // ya es público por ley o por publicación: NIT, RUP, procesos de SECOP
  INTERNA: 'interna',          // cifras del negocio; no son secretas pero no salen de la empresa
  RESTRINGIDA: 'restringida',  // le sirve a un competidor: tarifas, márgenes, estrategia
  PERSONAL: 'personal',        // datos de personas identificadas; Ley 1581 de 2012
});

// La más sensible gana, igual que el peor estado gana. Una respuesta armada con tres datos, uno de
// ellos personal, queda marcada como personal entera: no se puede desagregar de vuelta.
const ORDEN_DE_SENSIBILIDAD = Object.freeze([
  SENSIBILIDADES.PUBLICA, SENSIBILIDADES.INTERNA, SENSIBILIDADES.RESTRINGIDA, SENSIBILIDADES.PERSONAL,
]);

export function sensibilidadCompuesta(sensibilidades) {
  const presentes = (Array.isArray(sensibilidades) ? sensibilidades : [])
    .filter(s => ORDEN_DE_SENSIBILIDAD.includes(s));
  if (presentes.length === 0) return SENSIBILIDADES.PERSONAL; // sin declarar, se trata como lo más delicado
  return presentes.reduce((peor, actual) => (
    ORDEN_DE_SENSIBILIDAD.indexOf(actual) > ORDEN_DE_SENSIBILIDAD.indexOf(peor) ? actual : peor
  ));
}

// Cómo se trae una fuente. No es un detalle de implementación: cambia lo que la respuesta puede
// sostener. Una búsqueda devuelve pasajes para citar, nunca una cifra.
export const RECUPERACION = Object.freeze({
  DIRECTA: 'directa',      // una fila nuestra; milisegundos
  DESTILADO: 'destilado',  // el análisis que ya se hizo una vez sobre los documentos
  LEXICA: 'lexica',        // búsqueda por coincidencia de palabras
  VECTORIAL: 'vectorial',  // búsqueda semántica
});

export const DEVUELVE = Object.freeze({ VALOR: 'valor', PASAJE_CON_CITA: 'pasaje_con_cita' });

// ---------------------------------------------------------------------------------------------
// Los diez dominios de la empresa, con su sensibilidad. Clasificación propuesta por el agente y
// aprobada por Juan el 2026-10-28. El dueño es de cada área y casi todos están sin declarar: un
// dominio sin dueño sirve sus datos como no_verificado, por mucha fuente que tenga.
// ---------------------------------------------------------------------------------------------
export const DOMINIOS = Object.freeze({
  'empresa':        Object.freeze({ sensibilidad: SENSIBILIDADES.PUBLICA,     fuente: 'CRM',          responsable: 'Katherine' }),
  'clientes':       Object.freeze({ sensibilidad: SENSIBILIDADES.INTERNA,     fuente: 'Avancys',      responsable: null }),
  'contratos':      Object.freeze({ sensibilidad: SENSIBILIDADES.RESTRINGIDA, fuente: 'Avancys',      responsable: null }),
  'puestos':        Object.freeze({ sensibilidad: SENSIBILIDADES.INTERNA,     fuente: 'Avancys',      responsable: null }),
  'tarifas':        Object.freeze({ sensibilidad: SENSIBILIDADES.RESTRINGIDA, fuente: 'Avancys',      responsable: null }),
  'facturacion':    Object.freeze({ sensibilidad: SENSIBILIDADES.RESTRINGIDA, fuente: 'Avancys',      responsable: null }),
  'personal':       Object.freeze({ sensibilidad: SENSIBILIDADES.PERSONAL,    fuente: 'Avancys',      responsable: null }),
  'programacion':   Object.freeze({ sensibilidad: SENSIBILIDADES.PERSONAL,    fuente: 'Programacion', responsable: null }),
  'operacion':      Object.freeze({ sensibilidad: SENSIBILIDADES.PERSONAL,    fuente: 'SecurityOps',  responsable: 'Fabián' }),
  'comercial':      Object.freeze({ sensibilidad: SENSIBILIDADES.RESTRINGIDA, fuente: 'CRM',          responsable: 'Katherine' }),
});

export function dominioDeclarado(nombre) {
  return Object.prototype.hasOwnProperty.call(DOMINIOS, nombre) ? DOMINIOS[nombre] : null;
}

/** Un dato hereda la sensibilidad de su dominio salvo que declare la suya, más alta o más baja. */
export function sensibilidadDelDato(nombre) {
  const dato = datoDeclarado(nombre);
  if (!dato) return SENSIBILIDADES.PERSONAL;
  if (dato.sensibilidad) return dato.sensibilidad;
  const dominio = dominioDeclarado(dato.dominio);
  return dominio ? dominio.sensibilidad : SENSIBILIDADES.PERSONAL;
}

export const DATOS = Object.freeze({
  'empresa.identidad': Object.freeze({
    dominio: 'empresa',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_company_procurement_profile']),
    lectores: Object.freeze(['agt002.mesa', 'agt002.analisis', 'agt003.copiloto']),
  }),
  'empresa.codigos_rup': Object.freeze({
    dominio: 'empresa',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_company_rup_codes']),
    lectores: Object.freeze(['agt002.mesa', 'agt002.analisis']),
  }),
  'empresa.sedes': Object.freeze({
    dominio: 'empresa',
    estado: ESTADOS.VIGENTE,
    responsable: 'Juan',
    fuentes: Object.freeze(['psi_company_sites']),
    lectores: Object.freeze(['agt002.mesa', 'agt002.analisis', 'agt003.copiloto']),
  }),
  // La evidencia de la empresa CONTRA LA FECHA DE CIERRE del proceso. Es el dato que la Mesa no tenía y que hace
  // la diferencia entre "el BASC vence el 2027-06-17" —cierto y useless— y "el BASC llega vigente al cierre del
  // 4-nov", que es lo que alguien necesita para responder.
  //
  // Dos bloques quedan FUERA a propósito: `legal_representative_vault` y `personnel_credentials_vault` traen datos
  // de personas identificadas (Ley 1581 de 2012) y no viajan a una respuesta de la Mesa ni como metadato. Si una
  // pregunta los necesita, la respuesta tiene que declararlo faltante y que una persona los mire.
  'empresa.evidencia_al_cierre': Object.freeze({
    dominio: 'empresa',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    sensibilidad: SENSIBILIDADES.INTERNA,
    fuentes: Object.freeze(['psi_agt002_company_evidence_registry', 'psi_company_procurement_documents']),
    lectores: Object.freeze(['agt002.mesa', 'agt002.analisis']),
  }),
  'empresa.experiencia': Object.freeze({
    dominio: 'empresa',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_company_experience']),
    lectores: Object.freeze(['agt002.mesa', 'agt002.analisis']),
  }),
  // Mejora 5 (2026-11-04): lo que la Mesa necesita para que un documento salga con los datos del proceso puestos.
  'proceso.datos_oficiales': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_public_tenders']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // El texto oficial del formato o anexo que se pide redactar: el archivo propio o la sección del pliego vigente.
  'proceso.formato_oficial': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_tender_document_versions']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // F1/F2 (auditoría Fiscalía): la sección completa del pliego que el pedido cita por numeral o por sus palabras.
  'proceso.seccion_del_pliego': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_tender_document_versions']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // Piloto Fiscalía (2026-11-11): las frases literales del pliego sobre consorcios y uniones temporales, con su numeral y
  // su lectura, cuando la pregunta es de unión temporal. Sin esto la Mesa no podía decir qué cumple cada integrante.
  'proceso.reglas_para_plurales': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_tender_document_versions']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // Punto 5 del encargo de Aliados (2026-11-11): la lista de «Posibles socios» que ve la persona en Decidir, con la
  // regla con que se armó, para que Vig-IA pueda explicar por qué sale cada uno. Es un cruce, no una recomendación.
  'aliados.candidatos': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_vigilance_companies', 'psi_vigilance_company_offices', 'psi_vigilance_participations', 'psi_tender_plural_readings']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // Punto 7 del encargo de Aliados: quiénes se han movido en este proceso (observaron, ofertaron, contratista actual).
  'aliados.competencia_del_proceso': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_vigilance_participations', 'psi_vigilance_companies']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // Mejora 6: los formatos y anexos numerados que pide el proceso, para la «relación de anexos» de la carta.
  'proceso.formatos_del_pliego': Object.freeze({
    dominio: 'licitacion',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_tender_document_versions']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  'analisis.canonico.company_fit': Object.freeze({
    dominio: 'comercial',
    estado: ESTADOS.VIGENTE,
    responsable: 'Katherine',
    fuentes: Object.freeze(['psi_tender_analysis_runs.result.company_fit']),
    lectores: Object.freeze(['agt002.mesa']),
  }),
  // La llave puesto↔cliente, las dos direcciones. Es el dato que no existía en ningún sistema
  // nuestro: SecurityOps tiene 3.048 puestos y no sabe de qué cliente es cada uno, y sin eso no
  // hay rentabilidad por cliente. Avancys lo tiene completo —los 3.646 puestos con contrato,
  // 2.602 contratos con cliente, medido el 2026-10-28— y es la fuente por decisión de Juan del
  // 2026-10-23.
  //
  // Responde Fabián Franco, nombrado por Juan el 2026-10-28. No es un trámite: sin una persona
  // nombrada el catálogo sirve el dato como `no_verificado` aunque la fuente esté verificada, y
  // Vig-IA no puede afirmar nada con él. Lo que Fabián responde no es que Avancys funcione, sino
  // que de quién es cada puesto sea cierto —incluidos los 27 que hoy llegan en disputa—.
  'operacion.cliente_del_puesto': Object.freeze({
    estado: ESTADOS.VIGENTE,
    responsable: 'Fabián Franco',
    fuentes: Object.freeze(['avancys.hr_roster_puesto']),
    lectores: Object.freeze(['agt003.copiloto']),
  }),
  'operacion.puestos_del_cliente': Object.freeze({
    estado: ESTADOS.VIGENTE,
    responsable: 'Fabián Franco',
    fuentes: Object.freeze(['avancys.project_project']),
    lectores: Object.freeze(['agt003.copiloto']),
  }),
});

// Los datos que se leen de Avancys y no de Postgres. Se usa para no abrir una sesión contra Odoo
// cuando nadie pidió nada de allá.
const DATOS_DE_AVANCYS = Object.freeze(new Set(['operacion.cliente_del_puesto', 'operacion.puestos_del_cliente']));

export function datoDeclarado(nombre) {
  return Object.prototype.hasOwnProperty.call(DATOS, nombre) ? DATOS[nombre] : null;
}

export function puedeLeer(nombre, lector) {
  const dato = datoDeclarado(nombre);
  return Boolean(dato && dato.lectores.includes(lector));
}

function fecha(valor) {
  if (!valor) return null;
  const parsed = new Date(valor);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function soloFecha(valor) {
  const iso = fecha(valor);
  return iso ? iso.slice(0, 10) : null;
}

// Una respuesta siempre dice de cuándo es y de dónde salió. `requiere_interpretacion` marca las
// fuentes en prosa: se sirven, pero quien las lea sabe que tuvo que entenderlas, no leerlas.
// El nombre importa: la primera corrida contra producción llevaba `interpretable: false` para las
// fuentes tipadas y el modelo lo leyó al revés — "los datos figuran como no interpretables, hay
// que confirmarlos contra el certificado" —, degradando un dato que era el más confiable de todos.
function respuesta({ nombre, valor, estado, frescura, forma, asOf, procedencia, venceEl = null }) {
  const vencida = venceEl && asOf && new Date(venceEl).getTime() < Date.now();
  return Object.freeze({
    nombre,
    valor,
    estado: vencida ? ESTADOS.VENCIDO : estado,
    frescura,
    forma,
    requiere_interpretacion: forma === FORMAS.PROSA,
    as_of: asOf,
    vence_el: venceEl,
    procedencia,
  });
}

const CODIGOS_DEL_PERFIL = /\b\d{8}\b/g;

// Resolvedor de empresa.codigos_rup. La tabla tipada manda; si todavía no existe (migración 153
// sin aplicar) cae a la prosa del perfil y lo declara, en vez de devolver vacío en silencio.
export async function resolverCodigosRup(database) {
  const { data, error } = await database
    .from('psi_company_rup_codes')
    .select('codigo,descripcion,contratos_con_el_codigo,contratos_base,inscrito_al,fuente')
    .order('codigo');
  if (!error && Array.isArray(data) && data.length > 0) {
    return respuesta({
      nombre: 'empresa.codigos_rup',
      valor: Object.freeze({
        total: data.length,
        inscritos_al: soloFecha(data[0].inscrito_al),
        codigos: Object.freeze(data.map(fila => Object.freeze({
          codigo: fila.codigo,
          descripcion: fila.descripcion,
          contratos_con_el_codigo: fila.contratos_con_el_codigo,
          contratos_base: fila.contratos_base,
        }))),
      }),
      estado: ESTADOS.VIGENTE,
      frescura: FRESCURAS.CONGELADA_CON_VENCIMIENTO,
      forma: FORMAS.TIPADO,
      asOf: soloFecha(data[0].inscrito_al),
      venceEl: vencimientoDelCertificado(data[0].inscrito_al),
      procedencia: Object.freeze({ tabla: 'psi_company_rup_codes', documento: data[0].fuente }),
    });
  }
  return resolverCodigosRupDesdeProsa(database);
}

// El certificado de la Cámara de Comercio es verificable 60 días calendario desde su expedición.
// El hecho inscrito no caduca; el papel sí, y un pliego pide el papel.
export const DIAS_DE_VIGENCIA_DEL_CERTIFICADO = 60;

export function vencimientoDelCertificado(inscritoAl) {
  const base = fecha(inscritoAl);
  if (!base) return null;
  const vence = new Date(base);
  vence.setUTCDate(vence.getUTCDate() + DIAS_DE_VIGENCIA_DEL_CERTIFICADO);
  return vence.toISOString().slice(0, 10);
}

async function resolverCodigosRupDesdeProsa(database) {
  const { data, error } = await database
    .from('psi_company_procurement_profile')
    .select('rup_unspsc_codes,rup_updated_at,updated_at')
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return respuesta({
      nombre: 'empresa.codigos_rup',
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.CONGELADA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ tabla: 'psi_company_rup_codes', nota: 'sin fuente disponible' }),
    });
  }
  const codigos = [...new Set(String(data.rup_unspsc_codes || '').match(CODIGOS_DEL_PERFIL) || [])].sort();
  return respuesta({
    nombre: 'empresa.codigos_rup',
    valor: Object.freeze({ total: codigos.length, inscritos_al: soloFecha(data.rup_updated_at), codigos: Object.freeze(codigos) }),
    estado: codigos.length > 0 ? ESTADOS.VIGENTE : ESTADOS.NO_VERIFICADO,
    frescura: FRESCURAS.CONGELADA_CON_VENCIMIENTO,
    forma: FORMAS.PROSA,
    asOf: soloFecha(data.rup_updated_at),
    venceEl: vencimientoDelCertificado(data.rup_updated_at),
    procedencia: Object.freeze({ tabla: 'psi_company_procurement_profile', campo: 'rup_unspsc_codes', nota: 'tabla tipada no disponible; leído de la prosa' }),
  });
}

// Resolvedor de empresa.identidad. Devuelve los hechos que la Mesa inventó el 23-oct: razón
// social y NIT. No viaja el perfil entero: una porción declarada, no 17 kB.
export async function resolverIdentidadEmpresa(database) {
  const { data, error } = await database
    .from('psi_company_procurement_profile')
    .select('legal_name,nit,supervigilancia_license,rup_updated_at,updated_at')
    .limit(1)
    .maybeSingle();
  // El domicilio sale de la sede principal (mejora 5): la carta de Supersalud lo dejó en amarillo teniéndolo el CRM.
  const sede = await database.from('psi_company_sites').select('city,department,address').eq('is_main', true).limit(1).maybeSingle()
    .then(result => (result?.error ? null : result?.data || null), () => null);
  if (error || !data || !data.legal_name) {
    return respuesta({
      nombre: 'empresa.identidad',
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ tabla: 'psi_company_procurement_profile' }),
    });
  }
  return respuesta({
    nombre: 'empresa.identidad',
    valor: Object.freeze({
      razon_social: data.legal_name,
      nit: data.nit,
      licencia_supervigilancia: data.supervigilancia_license,
      domicilio_principal: sede ? Object.freeze({ ciudad: sede.city || null, departamento: sede.department || null, direccion: sede.address || null }) : null,
      // Contacto corporativo impreso en el membrete (PLANTILLA_MEMBRETE_SEGURIDAD_NACIONAL_V1_20261030). El correo
      // para notificaciones de cada proceso no está en ninguna tabla: lo decide una persona.
      contacto_membrete: Object.freeze({ telefono: '(57-6) 3170660 Ext. 120', celular: '316 409 4983', sitio_web: 'www.seguridadnacional.co' }),
    }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.updated_at),
    procedencia: Object.freeze({ tabla: 'psi_company_procurement_profile' }),
  });
}

// Resolvedor de analisis.canonico.company_fit: la sección de ajuste del análisis vigente, 687
// bytes, no las 152 kB del análisis entero. Lee la instantánea congelada, no la base viva, así
// que la respuesta de ayer sigue siendo reproducible hoy.
export async function resolverCompanyFit(database, { tenderId }) {
  if (typeof tenderId !== 'string' || tenderId.trim() === '') {
    return respuesta({
      nombre: 'analisis.canonico.company_fit',
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.CONGELADA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ tabla: 'psi_tender_analysis_runs', nota: 'sin proceso en el expediente' }),
    });
  }
  // `psi_tender_analysis_runs` no tiene `updated_at`: pedirlo hacía fallar la consulta entera y
  // el análisis existente salía como inexistente. Lo descubrió la primera corrida contra
  // producción el 2026-10-24, donde la Mesa dijo "no hay análisis canónico con company_fit"
  // mientras la fila estaba ahí. La fecha de corte es `completed_at`, y `analysis_core_hash`
  // identifica la versión exacta del análisis que respondió.
  const { data, error } = await database
    .from('psi_tender_analysis_runs')
    .select('id,result,created_at,completed_at,analysis_core_hash')
    .eq('tender_id', tenderId)
    .eq('canonical', true)
    .limit(1)
    .maybeSingle();
  const seccion = data && data.result && typeof data.result === 'object' ? data.result.company_fit : null;
  if (error || !seccion) {
    return respuesta({
      nombre: 'analisis.canonico.company_fit',
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.CONGELADA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ tabla: 'psi_tender_analysis_runs', tender_id: tenderId, nota: 'sin análisis canónico con company_fit' }),
    });
  }
  return respuesta({
    nombre: 'analisis.canonico.company_fit',
    valor: seccion,
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.CONGELADA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.completed_at || data.created_at),
    procedencia: Object.freeze({
      tabla: 'psi_tender_analysis_runs',
      run_id: data.id,
      seccion: 'company_fit',
      analysis_core_hash: data.analysis_core_hash || null,
    }),
  });
}

// Resolvedor de empresa.sedes. Una línea por sede, con su estado ante la SVSP: la agencia de
// Armenia está declarada y pendiente de resolución, y esa diferencia es la que ningún agente
// debe tener que deducir de una nota en prosa.
export async function resolverSedes(database) {
  const { data, error } = await database
    .from('psi_company_sites')
    .select('department,city,is_main,supervigilancia_authorization,source,updated_at')
    .order('is_main', { ascending: false })
    .order('department');
  if (error || !Array.isArray(data) || data.length === 0) {
    return respuesta({
      nombre: 'empresa.sedes',
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ tabla: 'psi_company_sites' }),
    });
  }
  const sedes = data.map(fila => Object.freeze({
    departamento: fila.department,
    ciudad: fila.city,
    tipo: fila.is_main === true ? 'sede_principal' : 'agencia',
    autorizacion_supervigilancia: fila.supervigilancia_authorization || null,
  }));
  return respuesta({
    nombre: 'empresa.sedes',
    valor: Object.freeze({ total: sedes.length, sedes: Object.freeze(sedes) }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.map(fila => fila.updated_at).sort().pop()),
    procedencia: Object.freeze({ tabla: 'psi_company_sites' }),
  });
}

// Resolvedores de la llave puesto↔cliente. Los dos leen Avancys en vivo, así que los dos tienen
// que sobrevivir a que Avancys no esté: un Odoo caído, un permiso retirado o un despliegue sin
// credenciales devuelven `no_verificado` con la razón escrita. El copiloto responde peor, no
// falla. Odoo 14 está fuera de soporte desde 2023 y el proveedor hospeda la instancia: que un día
// no conteste no es una hipótesis.
function sinAvancys(nombre, nota, fuente) {
  return respuesta({
    nombre,
    valor: null,
    estado: ESTADOS.NO_VERIFICADO,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: null,
    procedencia: Object.freeze({ fuente, nota }),
  });
}

/**
 * Dado el código de un puesto, de quién es. El código no es único en Avancys —10 se repiten—, así
 * que la respuesta trae la lista y su total.
 *
 * Tres estados, y la diferencia importa: `vigente` cuando las dos rutas al cliente coinciden,
 * `en_disputa` cuando el contrato y la cuenta analítica apuntan a clientes distintos —27 puestos
 * de 3.646 el 2026-10-28— y `no_verificado` cuando el puesto no existe o no lleva cliente.
 * El peor caso de la lista manda: un lote con un puesto en disputa viaja en disputa.
 */
export async function resolverClienteDelPuesto(_database, { avancys, puestoCodigo } = {}) {
  const nombre = 'operacion.cliente_del_puesto';
  if (!avancys) return sinAvancys(nombre, 'Avancys no está configurado en este entorno', 'avancys.hr_roster_puesto');
  if (!puestoCodigo) return sinAvancys(nombre, 'sin código de puesto en el contexto', 'avancys.hr_roster_puesto');
  let leido;
  try {
    leido = await avancys.clienteDelPuesto({ codigo: puestoCodigo });
  } catch (error) {
    return sinAvancys(nombre, `Avancys no respondió: ${error?.codigo || 'error'}`, 'avancys.hr_roster_puesto');
  }
  const procedencia = Object.freeze({
    fuente: 'avancys.hr_roster_puesto',
    modelos: Object.freeze(['hr.roster.puesto', 'project.project', 'account.analytic.account', 'res.partner']),
    codigo_buscado: leido.codigo,
  });
  if (!leido.encontrado) {
    return respuesta({
      nombre,
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ ...procedencia, nota: 'el código no existe en Avancys' }),
    });
  }
  const estados = leido.puestos.map(puesto => {
    if (!puesto.cliente) return ESTADOS.NO_VERIFICADO;
    return puesto.rutas.coinciden === false ? ESTADOS.EN_DISPUTA : ESTADOS.VIGENTE;
  });
  return respuesta({
    nombre,
    valor: Object.freeze({ codigo: leido.codigo, total: leido.total, puestos: leido.puestos }),
    estado: peorEstado(estados),
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: leido.as_of,
    procedencia,
  });
}

/**
 * Dado el NIT de un cliente, qué tiene con nosotros en Avancys: sus contratos y sus puestos.
 * `ref_num` es único, así que el NIT identifica a uno. Los totales son exactos; la lista de
 * puestos viene recortada, porque un cliente tiene 1.002.
 */
export async function resolverPuestosDelCliente(_database, { avancys, clienteIdentificacion } = {}) {
  const nombre = 'operacion.puestos_del_cliente';
  if (!avancys) return sinAvancys(nombre, 'Avancys no está configurado en este entorno', 'avancys.project_project');
  if (!clienteIdentificacion) return sinAvancys(nombre, 'sin identificación del cliente en el contexto', 'avancys.project_project');
  let leido;
  try {
    leido = await avancys.puestosDelCliente({ identificacion: clienteIdentificacion });
  } catch (error) {
    return sinAvancys(nombre, `Avancys no respondió: ${error?.codigo || 'error'}`, 'avancys.project_project');
  }
  const procedencia = Object.freeze({
    fuente: 'avancys.project_project',
    modelos: Object.freeze(['res.partner', 'project.project', 'hr.roster.puesto']),
    identificacion_buscada: leido.identificacion,
  });
  if (!leido.encontrado) {
    return respuesta({
      nombre,
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO,
      asOf: null,
      // Que no aparezca no significa que no sea cliente: puede estar con otra identificación.
      // La respuesta lo dice en vez de dejar que se lea como "no es cliente nuestro".
      procedencia: Object.freeze({ ...procedencia, nota: 'ninguna tercera en Avancys tiene esa identificación' }),
    });
  }
  return respuesta({
    nombre,
    valor: Object.freeze({
      cliente: leido.cliente,
      total_contratos: leido.total_contratos,
      total_puestos: leido.total_puestos,
      puestos_listados: leido.puestos_listados ?? 0,
      contratos: leido.contratos,
    }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: leido.as_of,
    procedencia,
  });
}

// Una fuente resuelta sólo sostiene una afirmación si está vigente y viene tipada. En prosa, o
// sin verificar, viaja igual —quien la lea debe saber que existe— pero marcada como insuficiente,
// de modo que la salida honesta sea declararla faltante en vez de afirmar sobre ella.
// Los bloques de evidencia que NO viajan a una respuesta: datos de personas identificadas.
const BLOQUES_PERSONALES = Object.freeze(new Set(['legal_representative_vault', 'personnel_credentials_vault']));
const MAX_BLOQUES_EN_RESPUESTA = 6;

/** La fecha de cierre que manda para una licitación: `raw.deadline` primero, que es la autoridad del Radar. */
async function fechaDeCierreDeLaLicitacion(database, tenderId) {
  if (!tenderId) return null;
  const { data, error } = await database
    .from('psi_public_tenders')
    .select('deadline_at,raw')
    .eq('id', tenderId)
    .maybeSingle();
  if (error || !data) return null;
  const deLaRaw = typeof data.raw?.deadline === 'string' ? data.raw.deadline.slice(0, 10) : null;
  if (deLaRaw && /^\d{4}-\d{2}-\d{2}$/.test(deLaRaw)) return deLaRaw;
  return soloFecha(data.deadline_at);
}

/**
 * Resolvedor de `empresa.evidencia_al_cierre`. Reusa el puente ficha de empresa → expediente, que es donde vive el
 * cálculo de la vigencia contra el cierre, en vez de repetirlo aquí.
 *
 * El estado es lo importante, porque de él depende `sostiene_afirmacion`:
 *   - `vigente` sólo si TODO lo pertinente llega vigente al cierre **y** una persona confirmó el bloque;
 *   - `vencido` si algo no alcanza el cierre;
 *   - `no_verificado` si falta el soporte o el bloque está pendiente de confirmación.
 *
 * Y la forma es `prosa` en cuanto alguna vigencia dependa del texto del registro: una vigencia que hay que
 * interpretar no sostiene una afirmación habilitante.
 */
export async function resolverEvidenciaAlCierre(database, { tenderId = null, pregunta = null } = {}) {
  const nombre = 'empresa.evidencia_al_cierre';
  const procedenciaBase = Object.freeze({
    tablas: Object.freeze(['psi_agt002_company_evidence_registry', 'psi_company_procurement_documents']),
    nota: 'Bloques de personas excluidos (Ley 1581 de 2012).',
  });
  const cierre = await fechaDeCierreDeLaLicitacion(database, tenderId);
  const registro = await database.from('psi_agt002_company_evidence_registry')
    .select('entry_id,document_class,existence_status,human_review_status,vigencia_text,expiry')
    .eq('current', true).eq('integration_active', true);
  const documentos = await database.from('psi_company_procurement_documents')
    .select('id,document_type,display_name,issued_at,expires_at,current,version')
    .eq('current', true);
  if (registro.error || documentos.error || !cierre) {
    return respuesta({
      nombre,
      valor: null,
      estado: ESTADOS.NO_VERIFICADO,
      frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO,
      asOf: null,
      procedencia: Object.freeze({ ...procedenciaBase, nota: cierre ? 'No fue posible leer la ficha de empresa.' : 'La licitación no tiene fecha de cierre declarada.' }),
    });
  }

  const puente = buildTenderCompanyDocumentBridge({
    registry: registro.data || [],
    documents: documentos.data || [],
    closeDate: cierre,
  });
  const visibles = puente.rows.filter(fila => !BLOQUES_PERSONALES.has(fila.key));
  // Pertinencia, no volcado: si la pregunta nombra documentos, se responden esos; si no, los que están en riesgo,
  // que es lo que alguien necesita saber sin preguntarlo.
  const nombrados = new Set(matchCompanyDocumentClasses(pregunta || ''));
  const pertinentes = nombrados.size > 0
    ? visibles.filter(fila => nombrados.has(fila.key))
    : visibles.filter(fila => fila.state !== 'listo_al_cierre');
  const seleccion = (pertinentes.length ? pertinentes : visibles).slice(0, MAX_BLOQUES_EN_RESPUESTA);

  const confirmado = fila => fila.human_review_status === 'approved';
  const estado = seleccion.some(fila => fila.state === 'vencido' || fila.state === 'vence_antes_del_cierre')
    ? ESTADOS.VENCIDO
    : seleccion.length > 0 && seleccion.every(fila => fila.state === 'listo_al_cierre' && confirmado(fila))
      ? ESTADOS.VIGENTE
      : ESTADOS.NO_VERIFICADO;
  const forma = seleccion.some(fila => fila.state === 'vigencia_por_confirmar') ? FORMAS.PROSA : FORMAS.TIPADO;
  const vencimientos = seleccion.map(fila => fila.expires_at).filter(Boolean).sort();

  return respuesta({
    nombre,
    valor: Object.freeze({
      cierre_del_proceso: cierre,
      bloques_mirados: seleccion.length,
      bloques_de_la_ficha: visibles.length,
      listos_al_cierre: visibles.filter(fila => fila.state === 'listo_al_cierre').length,
      sin_soporte: visibles.filter(fila => fila.state === 'sin_archivo').length,
      bloques: Object.freeze(seleccion.map(fila => Object.freeze({
        bloque: fila.key,
        etiqueta: fila.label,
        estado_al_cierre: fila.state,
        clase: fila.kind,
        vence_el: fila.expires_at,
        dias_de_expedido_al_cierre: fila.age_at_close_days,
        confirmado_por_una_persona: confirmado(fila),
        responsable: fila.owner,
        vigencia_declarada: fila.expires_at ? null : fila.vigencia_text,
      }))),
    }),
    estado,
    frescura: FRESCURAS.CONGELADA_CON_VENCIMIENTO,
    forma,
    asOf: soloFecha(new Date()),
    venceEl: vencimientos[0] || null,
    procedencia: procedenciaBase,
  });
}

/**
 * Resolvedor de `empresa.experiencia`. Son más de cien contratos inscritos: no caben en una respuesta, así que se
 * seleccionan los que la pregunta nombra y, si no nombra ninguno, los de mayor valor. El total siempre viaja, para
 * que nadie lea la muestra como si fuera todo.
 */
export async function resolverExperiencia(database, { pregunta = null } = {}) {
  const nombre = 'empresa.experiencia';
  const procedencia = Object.freeze({ tabla: 'psi_company_experience' });
  // Mejora 8: con la 194, el consecutivo del contrato en el RUP (el que piden los pliegos); sin ella, la lectura de antes.
  const consulta = select => database.from('psi_company_experience').select(select).order('value_smmlv', { ascending: false, nullsFirst: false });
  let { data, error } = await consulta('rup_number,rup_consecutive,contracting_party,contract_object,value_smmlv,value_cop,contract_year,source,updated_at');
  if (error && ['42703', 'PGRST204'].includes(String(error.code))) {
    ({ data, error } = await consulta('rup_number,contracting_party,contract_object,value_smmlv,value_cop,contract_year,source,updated_at'));
  }
  if (error || !Array.isArray(data) || data.length === 0) {
    return respuesta({
      nombre, valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.VIVA,
      forma: FORMAS.TIPADO, asOf: null, procedencia,
    });
  }
  const terminos = String(pregunta || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]{5,}/g) || [];
  const texto = fila => `${fila.contracting_party || ''} ${fila.contract_object || ''}`
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nombrados = terminos.length ? data.filter(fila => terminos.some(termino => texto(fila).includes(termino))) : [];
  const seleccion = (nombrados.length ? nombrados : data).slice(0, 8);
  return respuesta({
    nombre,
    valor: Object.freeze({
      total_inscritas_en_el_crm: data.length,
      mostradas: seleccion.length,
      seleccionadas_por_la_pregunta: nombrados.length > 0,
      experiencias: Object.freeze(seleccion.map(fila => Object.freeze({
        contratante: fila.contracting_party,
        objeto: fila.contract_object,
        valor_smmlv: fila.value_smmlv,
        anio: fila.contract_year,
        numero_rup: fila.rup_number,
        // El número que piden los pliegos en el anexo de experiencia; distinto del número de la experiencia.
        consecutivo_del_contrato_en_el_rup: fila.rup_consecutive ?? null,
      }))),
    }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.map(fila => fila.updated_at).filter(Boolean).sort().pop()),
    procedencia,
  });
}

export function sostieneAfirmacion(fuente) {
  return fuente?.estado === ESTADOS.VIGENTE && fuente?.forma === FORMAS.TIPADO;
}

/**
 * Da a las fuentes resueltas la forma con que viajan al modelo. La comparten todos los lectores
 * —la Mesa y el copiloto comercial—, porque si cada uno inventara la suya volveríamos al problema
 * del principio: el mismo hecho contado de dos maneras distintas.
 */
export function minimizarFuentes(fuentes, { sanitizar, maxFuentes = 10, maxValor = 6000, maxProcedencia = 500, maxValorPorNombre = {} } = {}) {
  const recorte = typeof sanitizar === 'function' ? sanitizar : ((texto, max) => String(texto ?? '').slice(0, max));
  return Object.freeze((Array.isArray(fuentes) ? fuentes : []).slice(0, maxFuentes).map(fuente => Object.freeze({
    nombre: fuente.nombre,
    estado: fuente.estado,
    sensibilidad: fuente.sensibilidad || null,
    as_of: fuente.as_of,
    vence_el: fuente.vence_el,
    requiere_interpretacion: fuente.requiere_interpretacion === true,
    sostiene_afirmacion: sostieneAfirmacion(fuente),
    responsable: fuente.responsable || null,
    procedencia: recorte(JSON.stringify(fuente.procedencia ?? null), maxProcedencia),
    // Un formato oficial pesa más que un dato: el de Supersalud son ~6.500 caracteres ya limpios.
    valor: recorte(JSON.stringify(fuente.valor ?? null), maxValorPorNombre[fuente.nombre] || maxValor),
  })));
}

// Resolvedor de proceso.datos_oficiales: lo que SECOP publicó del proceso y el CRM guardó al convertirlo. La carta
// de Supersalud dejó en amarillo el número y el objeto del proceso porque la Mesa no los recibía.
export async function resolverDatosOficialesProceso(database, { tenderId }) {
  const vacio = nota => respuesta({
    nombre: 'proceso.datos_oficiales', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.VIVA, forma: FORMAS.TIPADO,
    asOf: null, procedencia: Object.freeze({ tabla: 'psi_public_tenders', nota }),
  });
  if (typeof tenderId !== 'string' || !tenderId.trim()) return vacio('sin proceso en el expediente');
  const { data, error } = await database.from('psi_public_tenders')
    .select('ref,entity,title,description,city,dept,value,deadline_at,url,raw,updated_at')
    .eq('id', tenderId).maybeSingle();
  if (error || !data) return vacio('proceso no encontrado');
  const raw = data.raw && typeof data.raw === 'object' ? data.raw : {};
  const texto = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return respuesta({
    nombre: 'proceso.datos_oficiales',
    valor: Object.freeze({
      referencia: texto(data.ref) || texto(raw.referencia_del_proceso),
      entidad: texto(data.entity) || texto(raw.entidad),
      objeto: texto(raw.descripci_n_del_procedimiento) || texto(data.description) || texto(data.title),
      nombre_del_procedimiento: texto(raw.nombre_del_procedimiento) || texto(data.title),
      modalidad: texto(raw.modalidad_de_contratacion),
      ciudad_entidad: texto(raw.ciudad_entidad) || texto(data.city),
      presupuesto_oficial: raw.precio_base ?? data.value ?? null,
      cierre: texto(raw.deadline) || (data.deadline_at ? String(data.deadline_at).slice(0, 10) : null),
      enlace_secop: texto(data.url) || texto(raw.urlproceso?.url) || null,
    }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.updated_at),
    procedencia: Object.freeze({ tabla: 'psi_public_tenders', nota: 'datos oficiales capturados de SECOP' }),
  });
}

// Resolvedor de proceso.formato_oficial (regla de Juan, 2026-11-04): cuando lo pedido es un formato o anexo, su
// texto completo, para que el documento lo siga. Sin pedido de documento no se resuelve nada.
/**
 * F1/F2 (auditoría del piloto Fiscalía): la sección del pliego vigente que el pedido cita —por numeral, o por sus
 * palabras si no cita ninguno—, completa hasta 10.000 caracteres. Sin pliego o sin sección clara, no se manda nada.
 */
export async function resolverSeccionDelPliego(database, { tenderId, pregunta }) {
  const vacio = nota => respuesta({
    nombre: 'proceso.seccion_del_pliego', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.CONGELADA, forma: FORMAS.PROSA,
    asOf: null, procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', nota }),
  });
  if (typeof tenderId !== 'string' || !tenderId.trim() || !pregunta) return vacio('sin pedido');
  const { data, error } = await database.from('psi_tender_document_versions')
    .select('id,name,document_type,created_at,extracted_text')
    .eq('tender_id', tenderId).eq('current', true);
  if (error || !Array.isArray(data)) return vacio('no se pudieron leer los documentos del proceso');
  const encontrada = agt002SeccionDelPedido({ documents: data, message: pregunta });
  if (!encontrada) return vacio('el pedido no cita un numeral del pliego vigente ni coincide claro con una sección');
  return respuesta({
    nombre: 'proceso.seccion_del_pliego',
    valor: Object.freeze({ numeral: encontrada.numeral, titulo: encontrada.titulo, recortado: encontrada.recortado, texto: encontrada.texto, como_se_encontro: encontrada.origen }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.CONGELADA,
    // Es texto del pliego: se cita, no se interpreta.
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.find(row => row.id === encontrada.document_id)?.created_at),
    procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', documento: encontrada.documento }),
  });
}

// Una pregunta es de unión temporal si nombra la figura, un socio o los integrantes.
const PREGUNTA_PLURAL = /consorci|uni[oó]n(?:es)? temporal|\bUT\b|plural|\bsocios?\b|aliad[oa]s?\b|integrantes?\b/i;

/**
 * Piloto Fiscalía (2026-11-11): las reglas del pliego vigente para consorcios y uniones temporales —frases literales,
 * con el numeral donde están y su lectura (basta_uno, se_suma, pondera, cada_uno)—, cuando la pregunta es de unión
 * temporal. La pregunta «qué cumple cada integrante y qué se suma» no cita un numeral, así que la sección del pliego no
 * llegaba, y las frases de «cada uno de los integrantes» se perdían. Se citan, no se interpretan.
 */
export async function resolverReglasParaPlurales(database, { tenderId, pregunta }) {
  const vacio = nota => respuesta({
    nombre: 'proceso.reglas_para_plurales', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.CONGELADA, forma: FORMAS.TIPADO,
    asOf: null, procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', nota }),
  });
  if (typeof tenderId !== 'string' || !tenderId.trim()) return vacio('sin proceso en el expediente');
  if (!PREGUNTA_PLURAL.test(String(pregunta || ''))) return vacio('la pregunta no es de consorcios ni de uniones temporales');
  const { data, error } = await database.from('psi_tender_document_versions')
    .select('id,name,created_at,extracted_text')
    .eq('tender_id', tenderId).eq('current', true);
  if (error || !Array.isArray(data)) return vacio('no se pudieron leer los documentos del proceso');
  const reglas = agt002ReglasParaPlurales(data, { max: 30 });
  if (!reglas.length) return vacio('el pliego vigente no trae frases sobre cómo cumple un consorcio o una unión temporal');
  const fechas = data.map(row => soloFecha(row.created_at)).filter(Boolean).sort();
  return respuesta({
    nombre: 'proceso.reglas_para_plurales',
    valor: Object.freeze(reglas.map(regla => Object.freeze({ documento: regla.documento, numeral: regla.numeral, lectura: regla.lectura, frase: regla.frase }))),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.CONGELADA,
    // Es texto del pliego: se cita, no se interpreta. La lectura y el numeral los saca el servidor del texto.
    forma: FORMAS.TIPADO,
    asOf: fechas.length ? fechas[fechas.length - 1] : null,
    procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', documentos: [...new Set(reglas.map(regla => regla.documento).filter(Boolean))] }),
  });
}

// Una pregunta es de competencia si pregunta quién observó, ofertó o ganó, o por competidores.
const PREGUNTA_COMPETENCIA = /compet|observ|ofert|oferent|contratista|adjudic|movid|rival|qui[eé]n(?:es)? (?:m[aá]s )?(?:se presenta|participa)/i;

async function oportunidadDelProceso(database, tenderId) {
  const { data } = await database.from('psi_public_tenders').select('converted_opportunity_id').eq('id', tenderId).maybeSingle();
  return data?.converted_opportunity_id || null;
}

/**
 * Punto 5 del encargo de Aliados (2026-11-11): la lista de «Posibles socios» de Decidir, con la lectura del pliego y la
 * regla con que se armó, cuando la pregunta es de unión temporal o de socios. Usa la lectura guardada del análisis
 * vigente (la que calculó Decidir); sin ella, la lista de lo que nos falta.
 */
export async function resolverAliadosCandidatos(database, { tenderId, pregunta }) {
  const vacio = nota => respuesta({ nombre: 'aliados.candidatos', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.VIVA, forma: FORMAS.TIPADO, asOf: null, procedencia: Object.freeze({ tabla: 'psi_vigilance_companies', nota }) });
  if (typeof tenderId !== 'string' || !tenderId.trim()) return vacio('sin proceso en el expediente');
  if (!PREGUNTA_PLURAL.test(String(pregunta || ''))) return vacio('la pregunta no es de socios ni de uniones temporales');
  const opportunityId = await oportunidadDelProceso(database, tenderId);
  if (!opportunityId) return vacio('el proceso no está convertido en oportunidad');
  const report = await readAgt002InitialAnalysisReport(database, opportunityId);
  const label = report?.available ? String(report.report?.recommendation?.label || '') : '';
  const board = await buildAllyBoard(database, { opportunityId, label, getReading: async () => {
    const status = await readAgt002InitialAnalysisStatus(database, opportunityId);
    const { data } = await database.from('psi_tender_plural_readings').select('*').eq('opportunity_id', opportunityId).eq('analysis_run_id', status.runId).maybeSingle();
    return data || null;
  } });
  if (!board.applies) return vacio('la recomendación vigente no es «Solo en unión temporal»: no se arma lista de socios');
  const socio = candidate => Object.freeze({ nombre: candidate.name, nit: candidate.nit, rol: candidate.role, cubre: candidate.covered, avisos: [candidate.warning, candidate.zone_warning, candidate.size_note].filter(Boolean), compitio_contra_nosotros_en_procesos: candidate.competed_against_us || 0 });
  return respuesta({
    nombre: 'aliados.candidatos',
    valor: Object.freeze({
      regla_de_la_lista: ALLY_BOARD_RULE,
      lectura_del_pliego: board.reading ? Object.freeze({ lectura: board.reading.mode, cita: board.reading.quote, documento: board.reading.document_name, numeral: board.reading.locator }) : null,
      ciudades: board.cities,
      candidatos: Object.freeze((board.candidates || []).map(socio)),
      alternativa: board.alternative ? Object.freeze({ rotulo: board.alternative.label, ciudades: board.alternative.cities, candidatos: board.alternative.candidates.map(socio) }) : null,
    }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(new Date().toISOString()),
    procedencia: Object.freeze({ tabla: 'psi_vigilance_companies', nota: 'misma lista que «Posibles socios» en Decidir' }),
  });
}

/** Punto 7 del encargo de Aliados: quiénes se han movido en este proceso, cuando la pregunta es de competencia o de socios. */
export async function resolverCompetenciaDelProceso(database, { tenderId, pregunta }) {
  const vacio = nota => respuesta({ nombre: 'aliados.competencia_del_proceso', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.VIVA, forma: FORMAS.TIPADO, asOf: null, procedencia: Object.freeze({ tabla: 'psi_vigilance_participations', nota }) });
  if (typeof tenderId !== 'string' || !tenderId.trim()) return vacio('sin proceso en el expediente');
  const texto = String(pregunta || '');
  if (!PREGUNTA_COMPETENCIA.test(texto) && !PREGUNTA_PLURAL.test(texto)) return vacio('la pregunta no es de competencia ni de socios');
  const opportunityId = await oportunidadDelProceso(database, tenderId);
  if (!opportunityId) return vacio('el proceso no está convertido en oportunidad');
  const board = await buildProcessParticipantsBoard(database, { opportunityId });
  if (!board.installed) return vacio('Aliados no está instalado');
  if (!board.groups.length) return vacio('no hay participaciones registradas en Aliados para este proceso');
  return respuesta({
    nombre: 'aliados.competencia_del_proceso',
    valor: Object.freeze(board.groups.map(group => Object.freeze({ grupo: group.label, empresas: group.items.map(item => Object.freeze({ nombre: item.name, nit: item.nit, rol: item.role, detalle: item.detail, fecha: item.occurred_on, otros_procesos_nuestros: item.other_processes, oficina_en_nuestra_zona: item.zone_cities })) }))),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.VIVA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(new Date().toISOString()),
    procedencia: Object.freeze({ tabla: 'psi_vigilance_participations', nota: 'lo registrado en Aliados; sólo lectura' }),
  });
}

/**
 * Mejora 6 (encargo desde Terminal): la lista de formatos y anexos numerados del proceso —títulos del pliego vigente y
 * archivos propios con número—, para que la «relación de anexos que se presentan» de la carta salga de lo que el
 * proceso pide y no de memoria. Qué va de verdad lo decide una persona: la lista no lo afirma.
 */
export async function resolverFormatosDelPliego(database, { tenderId, documento }) {
  const vacio = nota => respuesta({
    nombre: 'proceso.formatos_del_pliego', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.CONGELADA, forma: FORMAS.TIPADO,
    asOf: null, procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', nota }),
  });
  if (typeof tenderId !== 'string' || !tenderId.trim() || !documento) return vacio('sin documento pedido');
  const { data, error } = await database.from('psi_tender_document_versions')
    .select('id,name,document_type,created_at,extracted_text')
    .eq('tender_id', tenderId).eq('current', true);
  if (error || !Array.isArray(data)) return vacio('no se pudieron leer los documentos del proceso');
  const formatos = agt002ListarFormatos(data);
  if (!formatos.length) return vacio('el pliego vigente no trae formatos ni anexos numerados con título');
  return respuesta({
    nombre: 'proceso.formatos_del_pliego',
    valor: Object.freeze({ formatos: Object.freeze(formatos.map(formato => Object.freeze({ titulo: formato.titulo, origen: formato.origen }))) }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.CONGELADA,
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.map(row => row.created_at).filter(Boolean).sort().at(-1)),
    procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', nota: 'títulos numerados del pliego vigente y archivos propios' }),
  });
}

export async function resolverFormatoOficial(database, { tenderId, pregunta, documento }) {
  const vacio = nota => respuesta({
    nombre: 'proceso.formato_oficial', valor: null, estado: ESTADOS.NO_VERIFICADO, frescura: FRESCURAS.CONGELADA, forma: FORMAS.PROSA,
    asOf: null, procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', nota }),
  });
  if (typeof tenderId !== 'string' || !tenderId.trim() || !documento) return vacio('sin documento pedido');
  const { data, error } = await database.from('psi_tender_document_versions')
    .select('id,name,document_type,created_at,extracted_text')
    .eq('tender_id', tenderId).eq('current', true);
  if (error || !Array.isArray(data)) return vacio('no se pudieron leer los documentos del proceso');
  const encontrado = agt002LocateFormato({ documents: data, message: pregunta || '', title: documento });
  if (!encontrado) return vacio(`se buscó "${String(documento).slice(0, 120)}" en los documentos del proceso y en el pliego vigente, y no aparece`);
  return respuesta({
    nombre: 'proceso.formato_oficial',
    valor: Object.freeze({ titulo: encontrado.titulo, recortado: encontrado.recortado, texto: encontrado.texto }),
    estado: ESTADOS.VIGENTE,
    frescura: FRESCURAS.CONGELADA,
    // Es texto del pliego, y así hay que tratarlo: se reproduce, no se interpreta.
    forma: FORMAS.TIPADO,
    asOf: soloFecha(data.find(row => row.id === encontrado.document_id)?.created_at),
    procedencia: Object.freeze({ tabla: 'psi_tender_document_versions', documento: encontrado.documento, origen: encontrado.origen }),
  });
}

const RESOLVEDORES = Object.freeze({
  'proceso.datos_oficiales': (database, contexto) => resolverDatosOficialesProceso(database, contexto),
  'proceso.formato_oficial': (database, contexto) => resolverFormatoOficial(database, contexto),
  'proceso.formatos_del_pliego': (database, contexto) => resolverFormatosDelPliego(database, contexto),
  'proceso.seccion_del_pliego': (database, contexto) => resolverSeccionDelPliego(database, contexto),
  'proceso.reglas_para_plurales': (database, contexto) => resolverReglasParaPlurales(database, contexto),
  'aliados.candidatos': (database, contexto) => resolverAliadosCandidatos(database, contexto),
  'aliados.competencia_del_proceso': (database, contexto) => resolverCompetenciaDelProceso(database, contexto),
  'empresa.identidad': (database) => resolverIdentidadEmpresa(database),
  'empresa.sedes': (database) => resolverSedes(database),
  'empresa.codigos_rup': (database) => resolverCodigosRup(database),
  'empresa.evidencia_al_cierre': (database, contexto) => resolverEvidenciaAlCierre(database, contexto),
  'empresa.experiencia': (database, contexto) => resolverExperiencia(database, contexto),
  'analisis.canonico.company_fit': (database, contexto) => resolverCompanyFit(database, contexto),
  'operacion.cliente_del_puesto': (database, contexto) => resolverClienteDelPuesto(database, contexto),
  'operacion.puestos_del_cliente': (database, contexto) => resolverPuestosDelCliente(database, contexto),
});

/**
 * Resuelve por adelantado las entradas declaradas para un lector. Entrega 1: el servidor las
 * estampa antes de llamar al modelo, sin que el agente tenga que pedir nada. Un nombre que no
 * esté declarado, o que ese lector no pueda leer, no se resuelve: el silencio significa no.
 */
export async function resolverParaLector(database, {
  lector,
  nombres,
  tenderId = null,
  // La pregunta que se está respondiendo. Sirve para la PERTINENCIA: con 20 bloques de evidencia y más de cien
  // experiencias inscritas, un volcado no cabe en una respuesta y además tapa lo que importa. Un resolvedor que no
  // la necesite simplemente la ignora.
  pregunta = null,
  // El documento del expediente que se pide redactar (mejora 5): con él se localiza su formato oficial.
  documento = null,
  puestoCodigo = null,
  clienteIdentificacion = null,
  avancys,
  entorno = process.env,
} = {}) {
  const pedidos = Array.isArray(nombres) ? nombres : [];
  // La sesión contra Avancys se abre solo si alguien pidió algo de allá, y ese alguien además
  // tiene que poder leerlo. Un lector sin entradas de Avancys no toca Odoo.
  const pideAvancys = pedidos.some(nombre => DATOS_DE_AVANCYS.has(nombre) && puedeLeer(nombre, lector));
  const lectorAvancys = avancys !== undefined ? avancys : (pideAvancys ? crearLectorAvancys({ entorno }) : null);
  const resueltos = [];
  for (const nombre of pedidos) {
    if (!puedeLeer(nombre, lector)) continue;
    const resolvedor = RESOLVEDORES[nombre];
    if (!resolvedor) continue;
    const resuelto = await resolvedor(database, { tenderId, pregunta, documento, puestoCodigo, clienteIdentificacion, avancys: lectorAvancys });
    const declarado = datoDeclarado(nombre);
    resueltos.push(Object.freeze({
      ...resuelto,
      sensibilidad: sensibilidadDelDato(nombre),
      dominio: declarado.dominio || null,
      estado: peorEstado([resuelto.estado, declarado.responsable ? ESTADOS.VIGENTE : ESTADOS.NO_VERIFICADO]),
      responsable: declarado.responsable || null,
    }));
  }
  return Object.freeze(resueltos);
}
