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
export function sostieneAfirmacion(fuente) {
  return fuente?.estado === ESTADOS.VIGENTE && fuente?.forma === FORMAS.TIPADO;
}

/**
 * Da a las fuentes resueltas la forma con que viajan al modelo. La comparten todos los lectores
 * —la Mesa y el copiloto comercial—, porque si cada uno inventara la suya volveríamos al problema
 * del principio: el mismo hecho contado de dos maneras distintas.
 */
export function minimizarFuentes(fuentes, { sanitizar, maxFuentes = 10, maxValor = 6000, maxProcedencia = 500 } = {}) {
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
    valor: recorte(JSON.stringify(fuente.valor ?? null), maxValor),
  })));
}

const RESOLVEDORES = Object.freeze({
  'empresa.identidad': (database) => resolverIdentidadEmpresa(database),
  'empresa.sedes': (database) => resolverSedes(database),
  'empresa.codigos_rup': (database) => resolverCodigosRup(database),
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
    const resuelto = await resolvedor(database, { tenderId, puestoCodigo, clienteIdentificacion, avancys: lectorAvancys });
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
