// AGT-002 — vigilancia de la ficha de empresa contra los cierres abiertos (mejora 2 del encargo del
// 2026-10-31: "que la ficha se vigile sola").
//
// El caso que lo pidió: cuatro defectos encontrados a mano en tres días, ninguno reportado por el
// sistema. El listado de armas venció en agosto y nadie lo notó, con diez puestos armados en
// Supersalud. El bloque de la póliza RCE figuraba aprobado sin apuntar a ningún documento, y por eso
// nadie había leído el monto asegurado.
//
// **Las reglas ya existían.** `buildTenderCompanyDocumentBridge` calcula desde el 2026-10-30 si cada
// documento llega vigente al cierre, y la pantalla de Empresa ya trata una aprobación sin ancla como
// "Falta confirmar" (`src/tenders/companyBase.ts`). Lo que no existía es que alguien lo dijera: las
// dos cosas sólo se ven si una persona abre la pantalla y mira. Este módulo no vuelve a derivar nada;
// recorre lo que ya se deriva y lo deja escrito en la oportunidad.
//
// ## Lo que NO avisa, y es la decisión de diseño
//
// El encargo lo dice: "una falsa alarma de la vigilancia hace que la gente deje de leer las alarmas,
// que es el único daño difícil de revertir". Así que sólo se avisa de **certezas que cambian una
// decisión**:
//
//   - `sin_archivo` NO avisa. Hoy 9 de 20 bloques no tienen documento cargado: es el estado normal de
//     una ficha que se está llenando, lo muestra el panel, y repetirlo a diario por cada licitación
//     abierta son catorce líneas de ruido que enseñan a ignorar el aviso.
//   - `vigencia_por_confirmar` NO avisa como vencimiento. Es un desconocido por diseño —el registro
//     guarda muchas vigencias en prosa—, y alarmar sobre lo que no se sabe es la forma más rápida de
//     gastar la credibilidad del canal. **Pero sí se avisa de la ceguera misma** cuando esa prosa
//     declara un plazo en días: entonces no es un desconocido, es un dato que existe y no está
//     registrado como fecha, y el silencio es nuestro. Se dice sin calcular la fecha.
//   - Lo que sí avisa es lo que es cierto y decide: un documento **vencido**, uno que **no llega
//     vigente al cierre**, y una **aprobación que no nombra su documento**.
//
// Módulo puro en su parte de reglas: sin red, sin base de datos, sin express.

import { buildTenderCompanyDocumentBridge } from './tender-company-document-bridge.js';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fecha de cierre que manda. Réplica deliberada de `resolveCanonicalTenderDeadline` (server/index.js):
 * ese módulo arranca express, así que importarlo desde aquí sería peor que repetir tres líneas. La
 * fecha vive en tres sitios y la que gobierna NO es una columna: cuando `raw.deadline` trae la fecha
 * de calendario exacta, ésa es la autoridad, porque `deadline_at` es un timestamptz anclado a
 * medianoche UTC que se corre un día al leerse en Bogotá. Usar la columna aquí produciría avisos de
 * "no llega al cierre" por un día de diferencia inventado — exactamente la falsa alarma que este
 * módulo existe para no dar. La prueba `fija esta equivalencia`; si la original cambia, debe cambiar
 * aquí y el pendiente de unificarlas está declarado en el handoff.
 */
export function agt002WatchCloseDate(tender) {
  const raw = tender?.raw?.deadline;
  if (typeof raw === 'string' && CALENDAR_DATE.test(raw)) return raw;
  return tender?.deadline_at ?? tender?.deadline ?? null;
}

const day = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (CALENDAR_DATE.test(text)) return text;
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
};

const list = items => items.map(item => `«${item}»`).join(', ');

/**
 * Prosa que declara una vida finita: una fecha de expedición y un plazo en días. No se intenta
 * calcular la fecha —«60 días» desde el 19 de junio puede ser corridos o hábiles, y una fecha
 * adivinada es peor que un hueco visible—, sólo se detecta que el documento SÍ caduca y que su
 * caducidad no está registrada como fecha.
 */
const DECLARED_FINITE_LIFE = /\b\d{1,4}\s*d[íi]as?\b/i;

/**
 * Una aprobación vale para el documento contra el que se tomó. Misma regla que la pantalla de Empresa
 * (`companyBase.ts`): una decisión que no nombra su documento, habiendo documento cargado, no se puede
 * dar por buena. Es el caso de las aprobaciones anteriores a la migración 159 — la póliza RCE, aprobada
 * el 2026-10-27 sin ancla, que es por lo que nadie había leído el monto asegurado.
 */
export function agt002EvidenceDecisionsWithoutAnchor({ registry = [], documents = [] } = {}) {
  const currentByType = new Map();
  for (const document of documents || []) {
    if (document?.current === false) continue;
    const type = String(document?.document_type || '');
    if (type && !currentByType.has(type)) currentByType.set(type, document);
  }
  return (registry || [])
    .filter(entry => entry?.current !== false)
    .filter(entry => entry?.human_review_status === 'approved' || entry?.human_review_status === 'rejected')
    .map(entry => ({ entry, support: currentByType.get(String(entry?.entry_id || '')) || null }))
    // Sin documento cargado no hay nada contra qué confirmar: ese bloque no es este defecto.
    .filter(({ entry, support }) => support && (entry.decision_support_document_id || null) !== (support.id || null))
    .map(({ entry, support }) => ({
      entryId: String(entry.entry_id || ''),
      label: String(entry.document_class || entry.entry_id || ''),
      decidedAt: entry.decision_humana_fecha || null,
      supportId: support.id || null,
    }));
}

/**
 * Avisos de una licitación abierta contra la ficha. Una línea por asunto y no una por documento: el
 * aviso se agrega a diario y una línea por fila sería ruido. Devuelve la misma forma que los avisos de
 * frescura (`code`, `severity`, `text`) para que el canal sea uno solo.
 */
export function agt002CompanyEvidenceNotices({
  registry = [], documents = [], tender = {}, now = new Date(),
} = {}) {
  const closeDate = agt002WatchCloseDate(tender);
  const close = day(closeDate);
  // Sin fecha de cierre no se puede concluir nada sobre "llega vigente al cierre", y afirmarlo sería
  // inventar. El proceso sin fecha es un problema del Radar, no de la ficha.
  if (!close) return [];
  const bridge = buildTenderCompanyDocumentBridge({ registry, documents, closeDate: close, now });
  const rows = Array.isArray(bridge?.rows) ? bridge.rows : [];
  const notices = [];

  const expired = rows.filter(row => row.state === 'vencido');
  const expiring = rows.filter(row => row.state === 'vence_antes_del_cierre');

  if (expiring.length) {
    notices.push({
      code: 'ficha_no_llega_al_cierre',
      severity: 'alta',
      text: `Vig-IA, vigilancia de la ficha: ${expiring.length === 1 ? 'un documento corporativo no llega' : `${expiring.length} documentos corporativos no llegan`} vigente${expiring.length === 1 ? '' : 's'} al cierre del ${close}: ${list(expiring.map(row => `${row.label}, vence ${row.expires_at}`))}. Reexpedir antes del cierre o el requisito queda sin soporte.`,
    });
  }
  if (expired.length) {
    notices.push({
      code: 'ficha_vencida',
      severity: 'alta',
      text: `Vig-IA, vigilancia de la ficha: ${expired.length === 1 ? 'un documento corporativo está vencido' : `${expired.length} documentos corporativos están vencidos`} hoy, con el cierre el ${close}: ${list(expired.map(row => `${row.label}, venció ${row.expires_at}`))}.`,
    });
  }

  // La ceguera, dicha en voz alta. Este aviso existe porque la primera versión de esta vigilancia NO
  // detectaba el caso que la pidió: el listado de armas venció el 2026-08-18 y su vigencia vive sólo
  // como prosa en el registro —«Expedido 2026-06-19; vigencia declarada de 60 días»—, sin fecha y sin
  // documento cargado. Las reglas no pueden vigilar lo que no es una fecha, y derivarla de la prosa
  // sería exactamente la fecha adivinada que la casa prohíbe. Lo que sí se puede afirmar sin adivinar
  // nada es que ese bloque declara una vida finita y nadie la está vigilando. Eso se dice, para que una
  // persona registre la fecha y el bloque entre al radar de los dos avisos de arriba.
  const unwatchable = rows.filter(row => {
    if (row.expires_at) return false;
    const prose = String(row.vigencia_text || '');
    return DECLARED_FINITE_LIFE.test(prose);
  });
  if (unwatchable.length) {
    notices.push({
      code: 'vigencia_solo_en_prosa',
      severity: 'media',
      text: `Vig-IA, vigilancia de la ficha: ${unwatchable.length === 1 ? 'un bloque declara' : `${unwatchable.length} bloques declaran`} una vigencia con plazo pero sin fecha registrada, así que nadie la puede vigilar —ni esta revisión—: ${list(unwatchable.map(row => `${row.label}: ${row.vigencia_text}`))}. Mientras siga en prosa, un vencimiento como el del listado de armas (expedido el 2026-06-19 con 60 días declarados) no lo detecta nadie. Registrar la fecha en la pantalla de Empresa para que entre a los avisos de vencimiento.`,
    });
  }

  const unanchored = agt002EvidenceDecisionsWithoutAnchor({ registry, documents });
  // Sólo molesta si ese bloque hace falta para esta licitación. Un bloque aprobado sin ancla que
  // ninguna fila del puente usa no cambia nada aquí y su sitio es la pantalla de Empresa.
  const usedEntries = new Set(rows.filter(row => row.document).map(row => row.registry_entry));
  const relevant = unanchored.filter(item => usedEntries.has(item.entryId));
  if (relevant.length) {
    notices.push({
      code: 'aprobacion_sin_documento',
      severity: 'alta',
      text: `Vig-IA, vigilancia de la ficha: ${relevant.length === 1 ? 'un bloque de evidencia figura decidido' : `${relevant.length} bloques de evidencia figuran decididos`} sin nombrar el documento que se miró: ${list(relevant.map(item => item.label))}. Una decisión sin ancla no dice qué se revisó —es como quedó la póliza RCE el 2026-10-27, y por eso nadie había leído el monto asegurado—. Volver a confirmar el bloque en la pantalla de Empresa, que amarra la decisión a su documento.`,
    });
  }
  return notices;
}

/**
 * Revisión programada: por cada licitación convertida y activa con cierre abierto, compara la ficha
 * contra ese cierre y deja el aviso como línea en la oportunidad. Misma forma que
 * `runAgt002ScheduleFreshnessReview`: cada licitación falla por separado, sólo lee y agrega avisos, y
 * nunca marca evidencia como verificada (restricción de custodia del encargo, §6).
 */
export async function runAgt002CompanyEvidenceWatch(database, {
  now = new Date(), log = () => {}, inactiveReason, appendLine, limit = 50,
} = {}) {
  const events = [];
  const { data: registry, error: registryError } = await database
    .from('psi_agt002_company_evidence_registry')
    .select('entry_id,document_class,existence_status,human_review_status,vigencia_text,expiry,current,integration_active,decision_support_document_id,decision_humana_fecha')
    .eq('current', true);
  if (registryError) {
    log({ event: 'agt002_company_evidence_watch_unavailable', message: String(registryError.message || registryError).slice(0, 200) });
    return events;
  }
  const { data: documents, error: documentsError } = await database
    .from('psi_company_procurement_documents')
    .select('id,document_type,display_name,issued_at,expires_at,version,current')
    .eq('current', true);
  if (documentsError) {
    log({ event: 'agt002_company_evidence_watch_unavailable', message: String(documentsError.message || documentsError).slice(0, 200) });
    return events;
  }
  const { data: tenders, error: tendersError } = await database
    .from('psi_public_tenders')
    .select('id,ref,entity,status,deadline_at,raw,converted_opportunity_id,internal_status')
    .eq('internal_status', 'convertida_oportunidad')
    .limit(limit);
  if (tendersError) {
    log({ event: 'agt002_company_evidence_watch_unavailable', message: String(tendersError.message || tendersError).slice(0, 200) });
    return events;
  }

  const todayMs = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  for (const tender of tenders || []) {
    const opportunityId = tender?.converted_opportunity_id;
    if (!opportunityId) continue;
    try {
      if (inactiveReason && await inactiveReason(database, opportunityId, tender.id)) continue;
      // Un cierre que ya pasó no admite avisos: lo que no se alcanzó a reexpedir ya no se reexpide.
      const close = day(agt002WatchCloseDate(tender));
      const closeMs = close ? Date.parse(`${close}T00:00:00.000Z`) : null;
      if (closeMs === null || closeMs < todayMs) {
        events.push({ event: 'agt002_company_evidence_watch_closed', opportunityId, ref: tender.ref || null });
        continue;
      }
      const notices = agt002CompanyEvidenceNotices({ registry: registry || [], documents: documents || [], tender, now });
      for (const notice of notices) {
        if (appendLine) await appendLine(database, opportunityId, notice.text);
        events.push({ event: 'agt002_company_evidence_watch_notice', opportunityId, ref: tender.ref || null, code: notice.code, severity: notice.severity });
      }
      if (!notices.length) events.push({ event: 'agt002_company_evidence_watch_ok', opportunityId, ref: tender.ref || null });
    } catch (cause) {
      events.push({ event: 'agt002_company_evidence_watch_failed', opportunityId, message: String(cause?.message || cause).slice(0, 200) });
    }
  }
  for (const event of events) log(event);
  return events;
}
