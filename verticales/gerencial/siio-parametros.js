// AGT-001 / Gerencia: la pestaña «Parámetros» de la Torre de Control.
// Regla de Juan (2026-11-13): la Torre sale 100 % de Avancys; lo que Avancys no tiene y debe ingresar una persona vive
// aquí, con encargado y registro de cambios, nunca en un Excel. Los 11 puntos se definieron con Juan ese día
// (handoff 2026-11-13-AGT-001-torre-resultado-en-vivo.md). Dos de ellos ya tienen su lugar y aquí sólo se señalan:
// los clientes de mes vencido (casilla en la ficha del cliente) y el histórico (Excel de Finanzas en «Fuentes y detalle»).
//
// Cada guardado es una versión nueva: la anterior queda marcada como reemplazada, no se borra (migración 219).
import { LINEAS } from '../../avancys-pyg.js';

export const PARAMETROS_TABLE = 'siio_parametros';

// Los 18 rubros del «Mapa de ejecución» de Finanzas (hoja AnVal11), en su orden. El número es el que marca cada cuenta
// en la columna de rubro del Excel: 1–18 en vigilancia; en tecnología, el mismo rubro suma 20.
export const RUBROS = Object.freeze([
  { clave: 'salarios', numero: 1, etiqueta: 'Salarios' },
  { clave: 'prestaciones', numero: 2, etiqueta: 'Prestaciones y seguridad social' },
  { clave: 'dotacion', numero: 3, etiqueta: 'Dotación' },
  { clave: 'logistica', numero: 4, etiqueta: 'Logística' },
  { clave: 'seguros', numero: 5, etiqueta: 'Seguros' },
  { clave: 'supervision', numero: 6, etiqueta: 'Supervisión' },
  { clave: 'servicios_adicionales', numero: 7, etiqueta: 'Servicios adicionales' },
  { clave: 'valores_agregados', numero: 8, etiqueta: 'Valores agregados' },
  { clave: 'seleccion', numero: 9, etiqueta: 'Selección' },
  { clave: 'comisiones', numero: 10, etiqueta: 'Comisiones' },
  { clave: 'impuestos', numero: 11, etiqueta: 'Impuestos' },
  { clave: 'comercializacion', numero: 12, etiqueta: 'Comercialización' },
  { clave: 'personal_administrativo', numero: 13, etiqueta: 'Personal administrativo' },
  { clave: 'administrativos', numero: 14, etiqueta: 'Gastos administrativos' },
  { clave: 'financieros', numero: 15, etiqueta: 'Gastos financieros' },
  { clave: 'siniestralidad', numero: 16, etiqueta: 'Siniestralidad' },
  { clave: 'imprevistos', numero: 17, etiqueta: 'Imprevistos' },
  { clave: 'discrecionales', numero: 18, etiqueta: 'Discrecionales' },
]);

const INDICADORES = [
  ['liquidez', 'Índice de liquidez'], ['endeudamiento', 'Nivel de endeudamiento'], ['capital_trabajo', 'Capital de trabajo'],
  ['cobertura_intereses', 'Razón de cobertura de intereses'], ['rentabilidad_patrimonio', 'Rentabilidad del patrimonio'],
  ['rentabilidad_activo', 'Rentabilidad del activo'],
];
const LINEAS_PYG = LINEAS.map(linea => [linea.clave, linea.etiqueta]);

// forma: 'campos' (un objeto), 'filas' (una lista), 'tabla' (filas fijas × columnas) o 'externo' (vive en otra pantalla).
// periodo: 'anio' ('2026'), 'mes' ('2026-11') o 'ninguno'.
export const PARAMETROS = Object.freeze([
  { numero: 1, clave: 'presupuesto_rubros', grupo: 'persona', nombre: 'Presupuesto por rubro', encargado: 'Finanzas', frecuencia: 'Anual, con revisiones', periodo: 'anio',
    para: 'Presupuesto contra ejecución: cada rubro como % del ingreso de su unidad de negocio.',
    forma: 'tabla', filas: RUBROS.map(rubro => [rubro.clave, rubro.etiqueta]),
    campos: [{ clave: 'vigilancia', etiqueta: 'Vigilancia', tipo: 'pct' }, { clave: 'tecnologia', etiqueta: 'Tecnología', tipo: 'pct' }] },
  { numero: 2, clave: 'metas_mes', grupo: 'persona', nombre: 'Metas financieras del mes', encargado: 'Gerencia', frecuencia: 'Mensual', periodo: 'mes',
    para: 'Cumplimiento del mes en la Torre. Las metas de ventas siguen en «Cargar metas».',
    forma: 'campos', campos: [{ clave: 'ingresos', etiqueta: 'Ingresos', tipo: 'pesos' }, { clave: 'margen_operacional', etiqueta: 'Margen operacional', tipo: 'pct' }] },
  { numero: 3, clave: 'creditos', grupo: 'persona', nombre: 'Créditos', encargado: 'Finanzas / Tesorería', frecuencia: 'Cuando hay un crédito nuevo', periodo: 'ninguno',
    para: 'Endeudamiento y cobertura de intereses. El saldo sale de Avancys; aquí lo que Avancys no tiene.',
    forma: 'filas', campos: [{ clave: 'banco', etiqueta: 'Banco', tipo: 'texto', requerido: true }, { clave: 'concepto', etiqueta: 'Concepto', tipo: 'texto', requerido: true },
      { clave: 'tasa', etiqueta: 'Tasa E.A.', tipo: 'pct' }, { clave: 'fecha_final', etiqueta: 'Fecha final', tipo: 'fecha' }] },
  { numero: 4, clave: 'provision_renta', grupo: 'persona', nombre: 'Provisión de impuesto de renta', encargado: 'Contabilidad', frecuencia: 'Anual', periodo: 'anio',
    para: 'Utilidad neta del mes mientras la renta no se cause en Avancys. Tasa efectiva o valor mensual.',
    forma: 'campos', campos: [{ clave: 'tasa_efectiva', etiqueta: 'Tasa efectiva', tipo: 'pct' }, { clave: 'valor_mensual', etiqueta: 'Valor mensual', tipo: 'pesos' }] },
  { numero: 5, clave: 'clientes_mes_vencido', grupo: 'persona', nombre: 'Clientes que se facturan mes vencido', encargado: 'Finanzas', frecuencia: 'Cuando cambia', periodo: 'ninguno',
    para: 'Provisión de ingresos del mes.', forma: 'externo', donde: 'Se marca en la ficha del cliente, en Clientes: «Se le provisiona el mes».' },
  { numero: 6, clave: 'regla_diciembre', grupo: 'persona', nombre: 'Regla de diciembre', encargado: 'Finanzas', frecuencia: 'Una vez al año', periodo: 'anio',
    para: 'Devengado y provisión de diciembre: quién no se factura en diciembre y quién se factura doble.',
    forma: 'campos', campos: [{ clave: 'regla', etiqueta: 'Regla', tipo: 'texto_largo', requerido: true }] },
  { numero: 7, clave: 'aumento_tarifa', grupo: 'persona', nombre: 'Aumento de tarifa del año', encargado: 'Gerencia / Comercial', frecuencia: 'Anual', periodo: 'anio',
    para: 'Separar en el crecimiento del ingreso lo que es tarifa de lo que es venta nueva.',
    forma: 'campos', campos: [{ clave: 'vigilancia', etiqueta: 'Vigilancia', tipo: 'pct' }, { clave: 'monitoreo', etiqueta: 'Monitoreo', tipo: 'pct' }] },
  { numero: 8, clave: 'requisitos_licitaciones', grupo: 'persona', nombre: 'Indicadores financieros que piden las licitaciones', encargado: 'Licitaciones', frecuencia: 'Cuando cambian', periodo: 'ninguno',
    para: 'Semáforo cumple / no cumple contra los indicadores del balance.',
    forma: 'filas', campos: [{ clave: 'indicador', etiqueta: 'Indicador', tipo: 'opcion', opciones: INDICADORES, requerido: true },
      { clave: 'minimo', etiqueta: 'Mínimo', tipo: 'numero' }, { clave: 'maximo', etiqueta: 'Máximo', tipo: 'numero' }, { clave: 'nota', etiqueta: 'Nota', tipo: 'texto' }] },
  { numero: 9, clave: 'ajustes_cierre', grupo: 'temporal', nombre: 'Ajustes de cierre que aún no están en Avancys', encargado: 'Contabilidad', frecuencia: 'Al cerrar el mes', periodo: 'mes',
    para: 'Comodatos y reclasificaciones con su motivo. La meta es que quede en cero: que se registren en Avancys.',
    forma: 'filas', campos: [{ clave: 'linea', etiqueta: 'Línea del estado de resultados', tipo: 'opcion', opciones: LINEAS_PYG, requerido: true },
      { clave: 'valor', etiqueta: 'Valor', tipo: 'pesos', requerido: true }, { clave: 'motivo', etiqueta: 'Motivo', tipo: 'texto', requerido: true }] },
  { numero: 10, clave: 'historico', grupo: 'temporal', nombre: 'Histórico enero 2025 – julio 2026', encargado: 'Finanzas', frecuencia: 'Carga única', periodo: 'ninguno',
    para: 'Comparativo y acumulado de los meses de Yeminus.', forma: 'externo', donde: 'Se carga con el Excel de Finanzas, en «Fuentes y detalle».' },
  { numero: 11, clave: 'mapeo_cuentas', grupo: 'mantenimiento', nombre: 'Cuenta → rubro del presupuesto', encargado: 'Finanzas', frecuencia: 'Cuando aparece una cuenta nueva', periodo: 'ninguno',
    para: 'Con qué rubro suma cada cuenta en el presupuesto contra ejecución.',
    forma: 'filas', campos: [{ clave: 'cuenta', etiqueta: 'Cuenta', tipo: 'texto', requerido: true }, { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto' },
      { clave: 'rubro', etiqueta: 'Rubro', tipo: 'numero', requerido: true }] },
]);

const POR_CLAVE = new Map(PARAMETROS.map(parametro => [parametro.clave, parametro]));
const EDIT_ROLES = new Set(['admin', 'gerencia']);
const MAX_FILAS = 600;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function puedeEditarParametros(profile) {
  return Boolean(profile?.id && EDIT_ROLES.has(profile.role));
}

export function periodoValido(parametro, periodo) {
  const valor = typeof periodo === 'string' ? periodo.trim() : '';
  if (parametro.periodo === 'ninguno') return '';
  const patron = parametro.periodo === 'anio' ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!patron.test(valor)) throw invalid(parametro.periodo === 'anio' ? 'Año inválido (AAAA).' : 'Mes inválido (AAAA-MM).');
  return valor;
}

function limpiarCampo(campo, valor, donde) {
  if (valor === undefined || valor === null || valor === '') {
    if (campo.requerido) throw invalid(`${donde}${campo.etiqueta}: dato obligatorio.`);
    return null;
  }
  if (campo.tipo === 'pct' || campo.tipo === 'pesos' || campo.tipo === 'numero') {
    const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(numero)) throw invalid(`${donde}${campo.etiqueta}: debe ser un número.`);
    if (campo.tipo === 'pct' && Math.abs(numero) > 100) throw invalid(`${donde}${campo.etiqueta}: un porcentaje va entre −100 y 100.`);
    return numero;
  }
  if (campo.tipo === 'fecha') {
    if (typeof valor !== 'string' || !ISO_DATE.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) throw invalid(`${donde}${campo.etiqueta}: fecha inválida (AAAA-MM-DD).`);
    return valor;
  }
  if (campo.tipo === 'opcion') {
    if (!campo.opciones.some(([clave]) => clave === valor)) throw invalid(`${donde}${campo.etiqueta}: opción no válida.`);
    return valor;
  }
  const texto = String(valor).replace(/[ \t]+/g, ' ').trim();
  const maximo = campo.tipo === 'texto_largo' ? 2000 : 300;
  if (texto.length > maximo) throw invalid(`${donde}${campo.etiqueta}: máximo ${maximo} caracteres.`);
  if (!texto && campo.requerido) throw invalid(`${donde}${campo.etiqueta}: dato obligatorio.`);
  return texto || null;
}

function limpiarObjeto(campos, entrada, donde = '') {
  const fuente = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const salida = {};
  for (const campo of campos) salida[campo.clave] = limpiarCampo(campo, fuente[campo.clave], donde);
  return salida;
}

// Puro: valida el valor según la forma del parámetro y deja sólo los campos del catálogo.
export function limpiarValor(parametro, valor) {
  if (parametro.forma === 'campos') {
    const limpio = limpiarObjeto(parametro.campos, valor);
    if (Object.values(limpio).every(item => item === null)) throw invalid('No hay datos para guardar.');
    return limpio;
  }
  if (parametro.forma === 'filas') {
    if (!Array.isArray(valor)) throw invalid('Se esperaba una lista de filas.');
    if (valor.length > MAX_FILAS) throw invalid(`Máximo ${MAX_FILAS} filas.`);
    // Una fila en blanco (la que deja «Agregar fila» sin llenar) se descarta; una a medias, no.
    const llena = fila => fila && typeof fila === 'object' && Object.values(fila).some(item => item !== null && item !== undefined && String(item).trim() !== '');
    return valor.filter(llena).map((fila, indice) => limpiarObjeto(parametro.campos, fila, `Fila ${indice + 1}: `));
  }
  if (parametro.forma === 'tabla') {
    const fuente = valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
    const salida = {};
    for (const [clave, etiqueta] of parametro.filas) salida[clave] = limpiarObjeto(parametro.campos, fuente[clave], `${etiqueta}: `);
    return salida;
  }
  throw invalid('Este parámetro se registra en otra pantalla.');
}

function sinTabla(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01' || error?.code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache');
}

// Lo que ve la pestaña: el catálogo, el valor vigente de cada clave y periodo, y los últimos cambios.
// Si la migración 219 no ha corrido, la pestaña se muestra igual, sin datos, y lo dice.
export async function listarParametros(db, profile) {
  const respuesta = { catalogo: PARAMETROS, rubros: RUBROS, vigentes: [], cambios: [], disponible: true, puede_editar: puedeEditarParametros(profile), clientes_mes_vencido: null };
  const [vigentes, cambios, provision] = await Promise.all([
    db.from(PARAMETROS_TABLE).select('id,clave,periodo,valor,nota,estado,creado_por_nombre,creado_at').is('reemplazado_at', null).order('periodo', { ascending: false }),
    db.from(PARAMETROS_TABLE).select('id,clave,periodo,nota,estado,creado_por_nombre,creado_at,reemplazado_at').order('creado_at', { ascending: false }).limit(30),
    db.from('psi_cliente_provision').select('avancys_ref_num', { count: 'exact', head: true }).eq('activo', true),
  ]);
  if (vigentes.error) {
    if (!sinTabla(vigentes.error)) throw vigentes.error;
    respuesta.disponible = false;
  } else {
    respuesta.vigentes = vigentes.data || [];
    respuesta.cambios = cambios.data || [];
  }
  if (!provision.error) respuesta.clientes_mes_vencido = provision.count ?? null;
  return respuesta;
}

// Guarda una versión nueva: marca la vigente como reemplazada y deja la nueva. Si la nueva no entra, la anterior vuelve
// a quedar vigente.
export async function guardarParametro(db, clave, body = {}, profile, now = new Date()) {
  if (!puedeEditarParametros(profile)) throw invalid('Tu perfil puede ver los parámetros pero no cambiarlos.', 403);
  const parametro = POR_CLAVE.get(clave);
  if (!parametro || parametro.forma === 'externo') throw invalid('Parámetro no válido.');
  const periodo = periodoValido(parametro, body.periodo);
  const valor = limpiarValor(parametro, body.valor);
  const nota = typeof body.nota === 'string' ? body.nota.replace(/\s+/g, ' ').trim().slice(0, 500) || null : null;
  const stamp = now.toISOString();
  const { data: anterior, error: errorAnterior } = await db.from(PARAMETROS_TABLE).select('id')
    .eq('clave', clave).eq('periodo', periodo).is('reemplazado_at', null).maybeSingle();
  if (errorAnterior) throw sinTabla(errorAnterior) ? invalid('La tabla de parámetros todavía no existe (migración 219).', 503) : errorAnterior;
  if (anterior) {
    const { error } = await db.from(PARAMETROS_TABLE).update({ reemplazado_at: stamp }).eq('id', anterior.id);
    if (error) throw error;
  }
  const { data, error } = await db.from(PARAMETROS_TABLE).insert({
    clave, periodo, valor, nota, estado: 'confirmado', creado_por: profile.id, creado_por_nombre: profile.full_name || null, creado_at: stamp,
  }).select('id,clave,periodo,valor,nota,estado,creado_por_nombre,creado_at').single();
  if (error) {
    if (anterior) await db.from(PARAMETROS_TABLE).update({ reemplazado_at: null }).eq('id', anterior.id);
    throw error;
  }
  return data;
}
