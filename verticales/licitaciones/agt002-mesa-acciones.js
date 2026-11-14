// Lo que se dice en la Mesa se hace (Juan, 2026-11-12, paso 4 del expediente vivo). En Rama Medellín Juan pidió
// «podemos actualizar la información en el CRM para que no salga 1.000» y Vig-IA sólo pudo contestar «yo no modifico el
// CRM». Y lo que una persona decide en el chat («yo me encargo del socio») no llegaba a la ficha del proceso.
//
// Regla acordada con Juan:
//   * Si la persona lo pide en el mensaje, Vig-IA lo hace y lo dice («Anoté…», «Corregí… de A a B, según…»), con
//     constancia en la oportunidad. Lo que dijo una persona no se vuelve a confirmar.
//   * Si Vig-IA encuentra el error por su cuenta, no lo cambia: pregunta «¿lo corrijo?».
//   * Sólo una lista corta: notas y decisiones de la ficha, presupuesto, fecha de cierre y contratista actual. Nunca la
//     ficha de empresa, nunca una oferta ya presentada.
// El servidor comprueba que la frase con que la persona lo pidió está en su mensaje; si no está, no se hace nada.
//
// Bloqueos (Juan, 2026-11-13, plan de la pestaña «Requisitos»): si la persona dice que algo del pliego nos inhabilita y
// pide llevarlo a Requisitos, queda anotado en ese grupo con el motivo y la cita, aunque el análisis no lo haya marcado.
import { REQUIREMENT_FOCUS } from './requirement-catalog.js';
import { applyOfficialSourceLink } from './tender-phase-identity.js';
import { noticeUidFromTenderUrl, recordAgt002PhaseChangeDetected } from './agt002-phase-change-followup.js';

/**
 * El enlace oficial de un proceso de SECOP II a partir de lo que la persona pegó (Juan, 2026-11-14: Rama Pereira cambió
 * de aviso al publicar el definitivo, CO1.NTC.11107533 → CO1.NTC.11222448, y los datos abiertos tardaron días en
 * traerlo). Acepta el enlace público o el de la entidad; devuelve siempre el público con `noticeUID`. Pura.
 */
export function enlaceSecopOficial(valor) {
  const texto = String(valor || '').trim();
  const aviso = texto.match(/CO1\.NTC\.\d{5,12}/)?.[0];
  if (!aviso || !/secop\.gov\.co/i.test(texto)) return null;
  return `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${aviso}`;
}

export const AGT002_MESA_GRUPOS_BLOQUEO = Object.freeze(Object.fromEntries(REQUIREMENT_FOCUS.map(focus => [focus.key, focus.title])));

const PRESENTADA = new Set(['presentada', 'adjudicada', 'no_adjudicada', 'cerrada_no_go']);
export const AGT002_MESA_MAX_ACCIONES = 5;

const pesos = value => `$${Math.round(Number(value)).toLocaleString('es-CO')}`;

export const AGT002_MESA_CAMPOS = Object.freeze({
  presupuesto: {
    nombre: 'el presupuesto (valor de la oportunidad)',
    columna: 'offer_value',
    leer: valor => {
      const limpio = String(valor || '').replace(/[^\d,.]/g, '').replace(/,\d{1,2}$/, '').replace(/[.,]/g, '');
      const numero = Number(limpio);
      return Number.isSafeInteger(numero) && numero >= 1_000_000 ? numero : null;
    },
    mostrar: valor => (valor ? pesos(valor) : 'vacío'),
  },
  cierre: {
    nombre: 'la fecha de cierre',
    columna: 'expected_close_date',
    leer: valor => (/^\d{4}-\d{2}-\d{2}$/.test(String(valor || '').trim()) && !Number.isNaN(Date.parse(String(valor).trim())) ? String(valor).trim() : null),
    mostrar: valor => (valor ? String(valor).slice(0, 10) : 'vacía'),
  },
  contratista_actual: {
    nombre: 'el contratista actual',
    columna: 'current_security_provider',
    leer: valor => { const t = String(valor || '').replace(/\s+/g, ' ').trim(); return t.length >= 2 && t.length <= 200 ? t : null; },
    mostrar: valor => (valor ? `«${valor}»` : 'vacío'),
  },
});

export const AGT002_MESA_ACCIONES_SCHEMA = Object.freeze({
  type: 'array',
  maxItems: AGT002_MESA_MAX_ACCIONES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['tipo', 'campo', 'valor', 'fuente', 'pedido_literal'],
    properties: {
      tipo: { type: 'string', enum: ['anotar', 'corregir', 'bloqueo'] },
      campo: { type: 'string', enum: ['', ...Object.keys(AGT002_MESA_CAMPOS), 'enlace_secop', ...Object.keys(AGT002_MESA_GRUPOS_BLOQUEO)] },
      valor: { type: 'string', minLength: 1, maxLength: 1000 },
      fuente: { type: 'string', maxLength: 600 },
      pedido_literal: { type: 'string', minLength: 1, maxLength: 400 },
    },
  },
});

export const AGT002_MESA_ACCIONES_POLICY = [
  'ACCIONES. Puedes hacer dos cosas en el CRM, y sólo si la persona lo pide en ESTE mensaje: (a) anotar en la ficha del proceso una decisión o un hecho que ella dice (por ejemplo «yo me encargo de definir el socio», «no observamos el proyecto», «somos el contratista actual»): tipo «anotar», campo vacío, valor = la decisión en una frase clara en tercera persona;',
  '(b) corregir un dato del proceso que ella pide corregir: tipo «corregir», campo presupuesto (valor en pesos), cierre (AAAA-MM-DD) o contratista_actual, y fuente = el archivo de la carpeta y la frase literal que lo sostiene; búscalo en la carpeta antes de proponer el valor.',
  `(c) llevar a la pestaña Requisitos un requisito de este pliego que nos inhabilita, cuando la persona lo pide («anótelo como bloqueo», «llévelo a Requisitos»): tipo «bloqueo», campo = el grupo (${Object.entries(AGT002_MESA_GRUPOS_BLOQUEO).map(([key, title]) => `${key}: ${title}`).join('; ')}), valor = por qué nos inhabilita en una frase (qué piden y cómo estamos), fuente = el numeral y la frase literal del pliego; búscalo en la carpeta.`,
  '(d) cambiar el enlace de SECOP del proceso cuando la persona pega uno nuevo y pide usarlo («este es el enlace nuevo», «el proceso cambió de link»): tipo «corregir», campo enlace_secop, valor = el enlace tal como lo pegó; fuente vacía.',
  'En pedido_literal copia EXACTAMENTE las palabras del mensaje de la persona con que lo pide; si no lo pidió en este mensaje, no pongas ninguna acción. Si encuentras un dato equivocado por tu cuenta, no lo corrijas: dilo y pregunta «¿lo corrijo?». El servidor ejecuta las acciones y agrega al final de tu respuesta lo que hizo; no digas que ya lo hiciste.',
].join(' ');

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** ¿La frase con que «la persona lo pidió» está de verdad en su mensaje? Pura. */
export function pidioLaPersona(pedidoLiteral, mensaje) {
  const pedido = normalizar(pedidoLiteral);
  return pedido.split(' ').filter(Boolean).length >= 2 && normalizar(mensaje).includes(pedido);
}

/**
 * Cambia el enlace de SECOP del proceso, igual que lo hace la importación del Radar cuando SECOP publica un aviso nuevo:
 * el enlace de la licitación, el «Link fuente» de la oportunidad (el anterior queda como «Link fuente histórico»), la
 * marca de cambio de aviso con la que el seguimiento baja los documentos y relanza el análisis, y la constancia.
 */
async function cambiarEnlaceSecop(database, { accion, opportunityId, tenderId, autorNombre, fecha, ahora }) {
  const nuevo = enlaceSecopOficial(accion.valor);
  if (!nuevo) return `No cambié el enlace de SECOP: «${String(accion.valor).slice(0, 120)}» no es el enlace de un proceso de SECOP II (debe traer noticeUID=CO1.NTC.…).`;
  const { data: licitacion, error: tenderError } = await database.from('psi_public_tenders').select('id,url,ref,status,deadline_at').eq('id', tenderId).maybeSingle();
  if (tenderError || !licitacion) throw tenderError || new Error('licitación no encontrada');
  const { data: oportunidad, error: oppError } = await database.from('psi_sales_opportunities').select('id,observaciones,tender_offer_status').eq('id', opportunityId).maybeSingle();
  if (oppError || !oportunidad) throw oppError || new Error('oportunidad no encontrada');
  if (PRESENTADA.has(oportunidad.tender_offer_status)) return `No cambié el enlace de SECOP: la oferta ya está ${oportunidad.tender_offer_status} y eso no se toca desde la Mesa.`;
  const anterior = licitacion.url || '';
  if (noticeUidFromTenderUrl(anterior) === noticeUidFromTenderUrl(nuevo)) return `El enlace de SECOP ya era ${nuevo}; no cambié nada.`;
  const { error: urlError } = await database.from('psi_public_tenders').update({ url: nuevo, updated_at: ahora.toISOString() }).eq('id', tenderId);
  if (urlError) throw urlError;
  const observaciones = applyOfficialSourceLink(oportunidad.observaciones, { officialUrl: nuevo, historicalUrl: anterior || null });
  if (observaciones !== String(oportunidad.observaciones || '')) {
    const { error: obsError } = await database.from('psi_sales_opportunities').update({ observaciones }).eq('id', opportunityId);
    if (obsError) throw obsError;
  }
  await recordAgt002PhaseChangeDetected(database, opportunityId, {
    change: 'phase', url: nuevo, ref: licitacion.ref, newPhase: null, deadline: licitacion.deadline_at, previousUrl: anterior || null,
    detectedAt: ahora.toISOString(), origin: 'mesa',
  }, { now: ahora });
  const viejo = noticeUidFromTenderUrl(anterior) || 'sin enlace';
  await database.rpc('psi_append_opportunity_observation_line', {
    p_opportunity_id: opportunityId,
    p_line: `Vig-IA, a pedido de ${autorNombre || 'la persona'} en la Mesa (${fecha}): el enlace de SECOP pasó del aviso ${viejo} al ${noticeUidFromTenderUrl(nuevo)}.`,
  });
  return `Cambié el enlace de SECOP del aviso ${viejo} al ${noticeUidFromTenderUrl(nuevo)}. Quedó la constancia, y en la próxima revisión (9 a. m., 2 p. m. o 7 p. m.) el seguimiento baja los documentos nuevos y relanza el análisis; si SECOP todavía no los publica en sus datos abiertos, los puede subir usted.`;
}

/**
 * Ejecuta las acciones que pidió la persona y devuelve las líneas para agregar a la respuesta. Nunca lanza: lo que no se
 * pudo hacer se dice.
 */
export async function ejecutarAgt002AccionesDeLaMesa(database, { acciones, mensaje, opportunityId, tenderId, autorId, autorNombre, ahora = new Date() }) {
  const lineas = [];
  const lista = Array.isArray(acciones) ? acciones.slice(0, AGT002_MESA_MAX_ACCIONES) : [];
  if (!lista.length) return lineas;
  if (!opportunityId || !tenderId || !autorId) return ['No pude hacer cambios en el CRM: falta saber el proceso o quién lo pidió.'];
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
  let oportunidad = null;
  for (const accion of lista) {
    try {
      if (!pidioLaPersona(accion?.pedido_literal, mensaje)) {
        lineas.push(`No hice «${String(accion?.valor || '').slice(0, 120)}»: no encontré en su mensaje el pedido. Si lo quiere, pídamelo directamente.`);
        continue;
      }
      if (accion.tipo === 'anotar') {
        // Sin target_kind: la tabla sólo admite «requirement» o «finding», y siempre con target_id (2026-11-13: con «mesa»
        // la inserción fallaba en producción).
        const { error } = await database.from('psi_agt002_clarifications').insert({
          opportunity_id: opportunityId, tender_id: tenderId, author_id: autorId,
          content: String(accion.valor).trim().slice(0, 1000), target_kind: null, target_label: `Dicho en la Mesa: «${String(accion.pedido_literal).trim().slice(0, 300)}»`,
        });
        if (error) throw error;
        lineas.push(`Anoté en la ficha del proceso: «${String(accion.valor).trim()}».`);
        continue;
      }
      if (accion.tipo === 'bloqueo') {
        const grupo = AGT002_MESA_GRUPOS_BLOQUEO[accion.campo];
        const motivo = String(accion.valor || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        if (!grupo || motivo.length < 5) {
          lineas.push(`No llevé a Requisitos «${motivo.slice(0, 120)}»: falta el grupo o el motivo.`);
          continue;
        }
        const { error } = await database.from('psi_tender_requirement_blocks').insert({
          opportunity_id: opportunityId, focus_key: accion.campo, reason: motivo, citation: String(accion.fuente || '').trim().slice(0, 500) || null,
          source: 'mesa', created_by: autorId,
        });
        if (error && String(error.code || '') === '23505') { lineas.push(`Ese bloqueo ya estaba en Requisitos (${grupo}).`); continue; }
        if (error) throw error;
        lineas.push(`Llevé a Requisitos, en «${grupo}»: ${motivo}`);
        continue;
      }
      if (accion.tipo === 'corregir' && accion.campo === 'enlace_secop') {
        lineas.push(await cambiarEnlaceSecop(database, { accion, opportunityId, tenderId, autorNombre, fecha, ahora }));
        continue;
      }
      const campo = AGT002_MESA_CAMPOS[accion.campo];
      const valor = campo?.leer(accion.valor);
      if (accion.tipo !== 'corregir' || !campo || valor === null) {
        lineas.push(`No corregí ${campo ? campo.nombre : 'ese dato'}: el valor «${String(accion.valor).slice(0, 80)}» no es válido.`);
        continue;
      }
      if (!oportunidad) {
        const { data, error } = await database.from('psi_sales_opportunities')
          .select('id,offer_value,expected_close_date,current_security_provider,tender_offer_status').eq('id', opportunityId).maybeSingle();
        if (error || !data) throw error || new Error('oportunidad no encontrada');
        oportunidad = data;
      }
      if (PRESENTADA.has(oportunidad.tender_offer_status)) {
        lineas.push(`No corregí ${campo.nombre}: la oferta ya está ${oportunidad.tender_offer_status} y eso no se toca desde la Mesa.`);
        continue;
      }
      const anterior = oportunidad[campo.columna];
      if (String(anterior ?? '') === String(valor)) {
        lineas.push(`${campo.nombre[0].toUpperCase()}${campo.nombre.slice(1)} ya era ${campo.mostrar(valor)}; no cambié nada.`);
        continue;
      }
      const cambios = { [campo.columna]: valor, ...(campo.columna === 'current_security_provider' ? { current_security_provider_none: false } : {}) };
      const { error } = await database.from('psi_sales_opportunities').update(cambios).eq('id', opportunityId);
      if (error) throw error;
      oportunidad = { ...oportunidad, ...cambios };
      const fuente = String(accion.fuente || '').trim().slice(0, 400);
      await database.rpc('psi_append_opportunity_observation_line', {
        p_opportunity_id: opportunityId,
        p_line: `Vig-IA, a pedido de ${autorNombre || 'la persona'} en la Mesa (${fecha}): ${campo.nombre} pasó de ${campo.mostrar(anterior)} a ${campo.mostrar(valor)}.${fuente ? ` Fuente: ${fuente}.` : ''}`,
      });
      lineas.push(`Corregí ${campo.nombre}: de ${campo.mostrar(anterior)} a ${campo.mostrar(valor)}${fuente ? `, según ${fuente}` : ''}. Quedó la constancia en la oportunidad.`);
    } catch (error) {
      console.warn('agt002_mesa_accion_failed', { event: 'agt002_mesa_accion_failed', code: error?.code || 'accion_failed' });
      lineas.push(`No pude hacer «${String(accion?.valor || '').slice(0, 120)}» en el CRM por un error; avise a Innovación.`);
    }
  }
  return lineas;
}
