// La ficha del proceso y el índice de procesos abiertos (Juan, 2026-11-12: «que la información de cada licitación quede
// muy bien organizada… tenemos 7 a 10 procesos al tiempo y Vig-IA debe poder saber de manera fácil y rápida qué está en
// un proceso u otro»). Una página por proceso que se lee primero, y una línea por proceso abierto. Sólo junta lo que el
// CRM ya tiene: la oportunidad, la licitación, la decisión GO/NO-GO, las aclaraciones que escribieron las personas y el
// reporte del análisis. No decide nada.
import { readAgt002InitialAnalysisReport } from './agt002-initial-analysis-report.js';
import { tenderSemanaDia, tenderSemanaTieneHora } from './tender-semana.js';

const ESTADOS_CERRADOS = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);
const MAX_PENDIENTES = 12;
const MAX_ACLARACIONES = 20;
const MAX_HALLAZGOS = 8;

const linea = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const corto = (value, max) => { const t = linea(value); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const pesos = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? `$${Math.round(Number(value)).toLocaleString('es-CO')}` : null);

function fecha(value) {
  const dia = tenderSemanaDia(value);
  if (!dia) return null;
  if (!tenderSemanaTieneHora(value)) return dia;
  const hora = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
  return `${dia} ${hora}`;
}

/** El cierre: el del cronograma que leyó Vig-IA, y si no, el de SECOP. */
function cierreDe({ deadlines = [], tender = null }) {
  const submission = deadlines.find(item => item.kind === 'SUBMISSION' && item.value);
  return submission?.value || tender?.deadline_at || null;
}

function proximaFecha(deadlines, hoy) {
  return deadlines.map(item => ({ ...item, dia: tenderSemanaDia(item.value) }))
    .filter(item => item.dia && item.dia >= hoy)
    .sort((a, b) => String(a.value).localeCompare(String(b.value)))[0] || null;
}

/** Módulo puro: la ficha en Markdown a partir de los datos ya leídos. */
export function fichaDelProcesoMarkdown({ oportunidad, tender = null, decision = null, aclaraciones = [], reporte = null, hoy }) {
  const deadlines = reporte?.deadlines || [];
  const cierre = cierreDe({ deadlines, tender });
  const out = [
    `# Ficha del proceso: ${linea(oportunidad.company_name) || 'sin entidad'}${tender?.ref ? ` · ${linea(tender.ref)}` : ''}`,
    '',
    `Generada desde el CRM el ${hoy}. Léala primero; el detalle está en los documentos de esta carpeta.`,
    '',
    '## Datos',
    `- Entidad: ${linea(tender?.entity || oportunidad.company_name) || 'sin dato'}`,
    `- Referencia: ${linea(tender?.ref) || 'sin dato'}`,
    `- Objeto: ${corto(tender?.title, 500) || 'sin dato'}`,
    // El valor de la oportunidad es el que se corrige (revisión programada o pedido en la Mesa); el de SECOP se dice si difiere.
    `- Presupuesto oficial: ${pesos(oportunidad.offer_value) || pesos(tender?.value) || 'sin dato'}${pesos(oportunidad.offer_value) && pesos(tender?.value) && Math.round(Number(oportunidad.offer_value)) !== Math.round(Number(tender?.value)) ? ` (SECOP trae ${pesos(tender.value)}; manda el del CRM, que sale de los documentos)` : ''}`,
    `- Cierre: ${fecha(cierre) || 'sin dato'}`,
    `- Ubicación: ${[tender?.city, tender?.dept].filter(Boolean).map(linea).join(', ') || 'sin dato'}`,
    `- SECOP: ${linea(tender?.url) || 'sin dato'}`,
    `- Contratista actual del servicio: ${oportunidad.current_security_provider_none ? 'ninguno registrado' : linea(oportunidad.current_security_provider) || 'sin dato en el CRM'}`,
    '',
    '## Estado',
    `- Estado de la oferta en el CRM: ${linea(oportunidad.tender_offer_status) || 'sin dato'}`,
    decision
      ? `- Decisión GO/NO-GO: ${linea(decision.decision)} por ${linea(decision.decided_by_name) || 'sin nombre'} el ${String(decision.decided_at || '').slice(0, 10)}${decision.justification ? `: «${corto(decision.justification, 400)}»` : ''}`
      : '- Decisión GO/NO-GO: no registrada',
  ];
  if (reporte) {
    out.push(`- Lectura de Vig-IA: ${corto(reporte.recommendation?.label, 600) || 'sin recomendación'}${reporte.companyFitLabel ? ` (empresa: ${linea(reporte.companyFitLabel)})` : ''}`);
  } else {
    out.push('- Lectura de Vig-IA: el análisis no está listo');
  }

  out.push('', '## Lo que dijeron las personas (aclaraciones registradas en el CRM)');
  if (aclaraciones.length) {
    for (const item of aclaraciones.slice(0, MAX_ACLARACIONES)) {
      out.push(`- ${String(item.created_at || '').slice(0, 10)}, ${linea(item.author_name) || 'encargado'}${item.target_label ? ` (sobre «${corto(item.target_label, 120)}»)` : ''}: «${corto(item.content, 600)}»`);
    }
  } else {
    out.push('- Ninguna registrada.');
  }

  out.push('', '## Cronograma (lo que leyó Vig-IA del pliego y las adendas)');
  if (deadlines.length) {
    for (const item of [...deadlines].sort((a, b) => String(a.value).localeCompare(String(b.value)))) {
      const dia = tenderSemanaDia(item.value);
      out.push(`- ${dia && dia < hoy ? '(pasó) ' : ''}${fecha(item.value) || 'sin fecha'}: ${linea(item.label || item.kind)}${item.certainty && item.certainty !== 'CONFIRMED' ? ' (por confirmar)' : ''}`);
    }
  } else {
    out.push('- Sin cronograma en el análisis.');
  }

  if (reporte) {
    const bloqueantes = (reporte.findings || []).filter(item => item.blocker).slice(0, MAX_HALLAZGOS);
    if (bloqueantes.length) {
      out.push('', '## Lo que nos impide o puede impedir presentarnos');
      for (const item of bloqueantes) out.push(`- ${linea(item.title)}: ${corto(item.impact, 500)}`);
    }
    const pendientes = (reporte.openItems || []).filter(item => item.status !== 'RESOLVED' && item.status !== 'CLOSED')
      .sort((a, b) => Number(b.critical) - Number(a.critical)).slice(0, MAX_PENDIENTES);
    if (pendientes.length) {
      out.push('', '## Pendientes');
      for (const item of pendientes) {
        out.push(`- ${item.critical ? '[crítico] ' : ''}${corto(item.description, 300)}${item.ownerRole ? ` · ${linea(item.ownerRole)}` : ''}${item.dueAt ? ` · antes de ${fecha(item.dueAt)}` : ''}`);
      }
    }
  }
  out.push('');
  return out.join('\n');
}

/** Módulo puro: una línea por proceso abierto, ordenados por la próxima fecha. */
export function indiceDeProcesosMarkdown({ procesos = [], hoy, actual = null }) {
  const filas = procesos.map(proceso => {
    const deadlines = proceso.reporte?.deadlines || [];
    const proxima = proximaFecha(deadlines, hoy);
    return { proceso, proxima, cierre: cierreDe({ deadlines, tender: proceso.tender }) };
  }).sort((a, b) => String(a.proxima?.value || a.cierre || '9999').localeCompare(String(b.proxima?.value || b.cierre || '9999')));
  const out = [
    '# Procesos abiertos de Seguridad Nacional',
    '',
    `Generado desde el CRM el ${hoy}: una línea por licitación abierta (entidad · referencia · estado · GO/NO-GO · cierre · próxima fecha · lectura de Vig-IA). El proceso de esta conversación va marcado con «→». Para el detalle de otro proceso, pregúntelo en su propia Mesa.`,
    '',
  ];
  for (const { proceso, proxima, cierre } of filas) {
    const marca = actual && proceso.oportunidad.id === actual ? '→ ' : '';
    out.push(`- ${marca}${linea(proceso.tender?.entity || proceso.oportunidad.company_name) || 'sin entidad'} · ${linea(proceso.tender?.ref) || 'sin referencia'} · ${linea(proceso.oportunidad.tender_offer_status) || 'sin estado'} · ${proceso.decision ? linea(proceso.decision.decision) : 'sin GO'} · cierre ${fecha(cierre) || 'sin dato'} · próxima: ${proxima ? `${fecha(proxima.value)} ${corto(proxima.label || proxima.kind, 90)}` : 'ninguna'} · ${proceso.reporte ? corto(proceso.reporte.recommendation?.label, 220) : 'análisis no listo'}`);
  }
  if (!filas.length) out.push('- No hay licitaciones abiertas.');
  out.push('');
  return out.join('\n');
}

async function ultimasDecisiones(database, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await database.from('psi_tender_go_no_go_decisions')
    .select('opportunity_id,decision,justification,decided_at,decided_by,supersedes_decision_id,id,author:psi_sales_profiles!decided_by(full_name)')
    .in('opportunity_id', ids).order('decided_at', { ascending: false });
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) if (!map.has(row.opportunity_id)) map.set(row.opportunity_id, { ...row, decided_by_name: row.author?.full_name || null });
  return map;
}

async function reporteDe(database, opportunityId) {
  try {
    const report = await readAgt002InitialAnalysisReport(database, opportunityId);
    return report?.available ? report.report : null;
  } catch { return null; }
}

const OPORTUNIDAD = 'id,company_name,offer_value,tender_offer_status,stage_code,current_security_provider,current_security_provider_none,archive_note,archived_at,discarded_at,lost_at,deleted_at';
const TENDER = 'id,entity,ref,process_id,title,value,status,deadline_at,dept,city,url,converted_opportunity_id';

/** Lee y arma la ficha del proceso de la licitación `tenderId`; null si no hay oportunidad. */
export async function armarAgt002FichaDelProceso(database, { tenderId, hoy }) {
  const { data: tender } = await database.from('psi_public_tenders').select(TENDER).eq('id', tenderId).maybeSingle();
  if (!tender?.converted_opportunity_id) return null;
  const { data: oportunidad } = await database.from('psi_sales_opportunities').select(OPORTUNIDAD).eq('id', tender.converted_opportunity_id).maybeSingle();
  if (!oportunidad) return null;
  const [decisiones, reporte, aclaraciones] = await Promise.all([
    ultimasDecisiones(database, [oportunidad.id]),
    reporteDe(database, oportunidad.id),
    database.from('psi_agt002_clarifications').select('content,target_label,created_at,author:psi_sales_profiles(full_name)')
      .eq('opportunity_id', oportunidad.id).order('created_at', { ascending: true }),
  ]);
  return fichaDelProcesoMarkdown({
    oportunidad, tender, decision: decisiones.get(oportunidad.id) || null, reporte, hoy,
    aclaraciones: (aclaraciones.data || []).map(row => ({ ...row, author_name: row.author?.full_name || null })),
  });
}

/** Lee y arma el índice de licitaciones abiertas (mismo criterio que la semana de Mi día). */
export async function armarAgt002IndiceDeProcesos(database, { hoy, actual = null }) {
  const { data } = await database.from('psi_sales_opportunities').select(OPORTUNIDAD).eq('service_type_code', 'licitacion_publica');
  const abiertas = (data || []).filter(row => !row.archive_note && !row.archived_at && !row.discarded_at && !row.lost_at && !row.deleted_at
    && row.stage_code !== 'descartado' && !ESTADOS_CERRADOS.has(row.tender_offer_status));
  const ids = abiertas.map(row => row.id);
  if (!ids.length) return indiceDeProcesosMarkdown({ procesos: [], hoy, actual });
  const [{ data: tenders }, decisiones] = await Promise.all([
    database.from('psi_public_tenders').select(TENDER).in('converted_opportunity_id', ids),
    ultimasDecisiones(database, ids),
  ]);
  const tenderDe = new Map((tenders || []).map(row => [row.converted_opportunity_id, row]));
  const procesos = [];
  for (const oportunidad of abiertas) {
    procesos.push({ oportunidad, tender: tenderDe.get(oportunidad.id) || null, decision: decisiones.get(oportunidad.id) || null, reporte: await reporteDe(database, oportunidad.id) });
  }
  return indiceDeProcesosMarkdown({ procesos, hoy, actual });
}
