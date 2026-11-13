// Pestaña «Requisitos» (Juan, 2026-11-11 y 2026-11-12; migraciones 210, 211 y 215): lee las tres fuentes del catálogo, cruza
// cada requisito habilitante con la ficha de la empresa y arma «lo que nos inhabilita» con su decisión. La matriz
// histórica, de la tabla que se cargó desde SharePoint; los análisis y las actas, en vivo, así cada análisis nuevo entra
// solo. «Cómo estamos hoy» sale de la ficha para sedes, indicadores y códigos.
import { REQUIREMENT_MATRIX_PATH } from './requirement-history-import.js';
import { FOCUS_STATUSES, REQUIREMENT_FOCUS, buildRequirementCatalog, buildRequirementFocus, buildRequirementPending } from './requirement-catalog.js';
import { assessRequirement } from './requirement-assessment.js';
import { TENDER_OPPORTUNITY_CLOSED_COMMERCIAL_STAGES } from './tender-opportunity-stage.js';

function fail(message, status) { return Object.assign(new Error(message), { status }); }
const absent = error => ['PGRST205', '42P01'].includes(String(error?.code || ''));
const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || null;
const processLabel = tender => [tender?.entity, tender?.ref].filter(Boolean).join(' · ') || 'Proceso del CRM';

/** Los requisitos del último análisis de cada proceso del CRM. */
async function loadCrmRequirements(database) {
  const { data: runs, error: runsError } = await database.from('psi_tender_analysis_runs').select('id,opportunity_id');
  if (runsError) throw runsError;
  const { data: versions, error } = await database.from('psi_agt002_pre_go_analysis_versions')
    .select('analysis_run_id,created_at,requirements:envelope->requirements,claims:envelope->claims');
  if (error) throw error;
  const opportunityOf = new Map((runs || []).map(run => [run.id, run.opportunity_id]));
  const latest = new Map();
  for (const version of versions || []) {
    const opportunityId = opportunityOf.get(version.analysis_run_id);
    if (!opportunityId) continue;
    const current = latest.get(opportunityId);
    if (!current || String(version.created_at) > String(current.created_at)) latest.set(opportunityId, version);
  }
  return latest;
}

async function loadTenders(database, opportunityIds) {
  if (!opportunityIds.length) return new Map();
  const { data, error } = await database.from('psi_public_tenders').select('ref,entity,city,url,deadline_at,converted_opportunity_id').in('converted_opportunity_id', opportunityIds);
  if (error) throw error;
  return new Map((data || []).map(row => [row.converted_opportunity_id, row]));
}

// El día de cierre en Colombia. Un cierre a las 00:00Z es una fecha sin hora (memoria «cierre de sólo fecha»): se toma tal
// cual; con hora, se pasa a la hora de Colombia (UTC−5).
export function closingDay(deadlineAt) {
  if (!deadlineAt) return null;
  const time = new Date(deadlineAt);
  if (Number.isNaN(time.getTime())) return null;
  const utc = time.toISOString();
  return utc.slice(11, 19) === '00:00:00' ? utc.slice(0, 10) : new Date(time.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
}
const TERMINAL_OFFER = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada', 'presentada']);

/**
 * Por oportunidad: si sigue abierta (no archivada ni descartada, sin NO GO, sin oferta presentada ni resultado, y con cierre de hoy en
 * adelante) y el día de cierre. Es lo que separa en la tarjeta los procesos próximos de los pasados.
 */
export async function loadOpportunityWindows(database, tenders, today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)) {
  const ids = [...tenders.keys()];
  if (!ids.length) return new Map();
  const [opportunities, decisions] = await Promise.all([
    database.from('psi_sales_opportunities').select('id,archived_at,tender_offer_status,stage_code').in('id', ids),
    database.from('psi_tender_go_no_go_decisions').select('opportunity_id,decision,decided_at').in('opportunity_id', ids),
  ]);
  if (opportunities.error) throw opportunities.error;
  if (decisions.error && !absent(decisions.error)) throw decisions.error;
  const latest = new Map();
  for (const row of decisions.data || []) {
    const current = latest.get(row.opportunity_id);
    if (!current || String(row.decided_at) > String(current.decided_at)) latest.set(row.opportunity_id, row);
  }
  const windows = new Map();
  for (const row of opportunities.data || []) {
    const deadline = closingDay(tenders.get(row.id)?.deadline_at);
    const open = !row.archived_at && !TENDER_OPPORTUNITY_CLOSED_COMMERCIAL_STAGES.has(row.stage_code)
      && !TERMINAL_OFFER.has(String(row.tender_offer_status || '')) && latest.get(row.id)?.decision !== 'no_go'
      && Boolean(deadline) && deadline >= today;
    windows.set(row.id, { deadline, open });
  }
  return windows;
}

/** Los bloqueos que una persona dejó anotados y siguen abiertos (migración 218). Sin la tabla, ninguno. */
async function loadAnnotatedBlocks(database) {
  const { data, error } = await database.from('psi_tender_requirement_blocks').select('id,opportunity_id,focus_key,reason,citation,source').is('resolved_at', null);
  if (error) {
    if (absent(error)) return [];
    throw error;
  }
  return data || [];
}

const numberFrom = raw => {
  const text = String(raw || '').replace(/^\$/, '').trim();
  return Number(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(',', '.'));
};

/**
 * La ficha de la empresa: el texto de «cómo estamos hoy» y los datos con que se cruzan los requisitos (indicadores,
 * códigos, sedes con el año de su resolución, licencia y documentos vigentes).
 */
async function loadCompany(database) {
  const [profile, sites, codes, documents] = await Promise.all([
    database.from('psi_company_procurement_profile').select('financial_capacity,organizational_capacity,supervigilancia_license').limit(1).maybeSingle(),
    database.from('psi_company_sites').select('city,is_main,supervigilancia_authorization'),
    database.from('psi_company_rup_codes').select('codigo'),
    database.from('psi_company_procurement_documents').select('document_type,display_name,expires_at').eq('current', true),
  ]);
  const live = {};
  const facts = { codes: [], mainCity: null, agencies: [], documents: [] };
  if (!sites.error && sites.data?.length) {
    const main = sites.data.filter(site => site.is_main).map(site => site.city);
    const authorized = sites.data.filter(site => !site.is_main && /autorizad/i.test(String(site.supervigilancia_authorization || ''))).map(site => site.city);
    const pending = sites.data.filter(site => !site.is_main && !/autorizad/i.test(String(site.supervigilancia_authorization || ''))).map(site => site.city);
    live.sedes = [main.length ? `Domicilio principal en ${main.join(', ')}.` : '', authorized.length ? `Agencias en ${authorized.join(', ')}.` : '',
      'Ninguna sucursal registrada.', pending.length ? `Pendiente: ${pending.join(', ')}.` : ''].filter(Boolean).join(' ');
    facts.mainCity = main[0] || null;
    facts.agencies = sites.data.filter(site => !site.is_main && /autorizad/i.test(String(site.supervigilancia_authorization || '')))
      .map(site => ({ city: site.city, since: Number(String(site.supervigilancia_authorization).match(/\b(19|20)\d{2}\b/)?.[0]) || null }));
  }
  if (!profile.error && profile.data) {
    const text = `${profile.data.financial_capacity || ''}\n${profile.data.organizational_capacity || ''}`;
    const pick = label => text.match(new RegExp(`${label}[^:\\n]*:\\s*([^\\s—\\n]+)`, 'i'))?.[1]?.replace(/[.,;]$/, '') || null;
    for (const [fact, label] of [['liquidez', 'Índice de liquidez'], ['endeudamiento', 'Índice de endeudamiento'], ['cobertura', 'Razón de cobertura de intereses'],
      ['capitalTrabajo', 'Capital de trabajo calculado'], ['roe', 'Rentabilidad del patrimonio'], ['roa', 'Rentabilidad del activo'], ['patrimonio', 'Patrimonio']]) {
      const value = numberFrom(pick(label));
      if (Number.isFinite(value) && pick(label)) facts[fact] = value;
    }
    facts.licenseUntil = String(profile.data.supervigilancia_license || '').match(/hasta el ([0-9]{1,2}-[a-z]{3}-[0-9]{4})/i)?.[1] || null;
    const parts = [['Liquidez', pick('Índice de liquidez')], ['endeudamiento', pick('Índice de endeudamiento')], ['cobertura de intereses', pick('Razón de cobertura de intereses')],
      ['capital de trabajo', pick('Capital de trabajo calculado')], ['ROE', pick('Rentabilidad del patrimonio')], ['ROA', pick('Rentabilidad del activo')]]
      .filter(([, value]) => value).map(([label, value]) => `${label} ${value}`);
    const cut = text.match(/Corte(?: financiero)?:\s*([0-9/]+)/i)?.[1];
    if (parts.length) live.financiero = `${parts.join(', ')}${cut ? ` (corte ${cut})` : ''}.`;
  }
  if (!codes.error && codes.data) {
    const list = codes.data.map(row => String(row.codigo));
    live.codigos = `${list.length} códigos inscritos en el RUP${list.some(code => code.startsWith('461015')) ? '' : '; no está el 46101500'}.`;
    facts.codes = list;
  }
  if (!documents.error) facts.documents = (documents.data || []).filter(row => !row.expires_at || String(row.expires_at) >= new Date().toISOString().slice(0, 10))
    .map(row => ({ type: row.document_type, name: row.display_name || '' }));
  return { live, facts };
}

/** Todo lo que muestra la pestaña. */
export async function loadRequirementsBoard(database) {
  const latest = await loadCrmRequirements(database);
  const { data: actas, error: actasError } = await database.from('psi_tender_closure_acta').select('opportunity_id,requirements_unmet');
  if (actasError && !absent(actasError)) throw actasError;
  const annotated = await loadAnnotatedBlocks(database);
  const tenders = await loadTenders(database, [...new Set([...latest.keys(), ...(actas || []).map(acta => acta.opportunity_id), ...annotated.map(item => item.opportunity_id)])]);
  const windows = await loadOpportunityWindows(database, tenders);
  const blocks = annotated.map(item => ({ ...item, process: processLabel(tenders.get(item.opportunity_id)), url: tenders.get(item.opportunity_id)?.url || null }));

  const crm = [];
  for (const [opportunityId, version] of latest) {
    const tender = tenders.get(opportunityId);
    const claims = new Map((Array.isArray(version.claims) ? version.claims : []).map(claim => [claim.claim_id, claim]));
    for (const requirement of Array.isArray(version.requirements) ? version.requirements : []) {
      if (requirement?.applicability === 'NOT_APPLICABLE') continue;
      crm.push({ opportunity_id: opportunityId, process: processLabel(tender), city: tender?.city || null, url: tender?.url || null, requirement_id: requirement.requirement_id,
        category: requirement.category, text: claims.get(requirement.text_claim_id)?.display_text || null, validity: requirement.validity_rule || null,
        blocker: requirement.blocker === true, evaluation: requirement.company_evaluation || null });
    }
  }
  const actaGaps = (actas || []).flatMap(acta => (Array.isArray(acta.requirements_unmet) ? acta.requirements_unmet : []).map(item => ({
    opportunity_id: acta.opportunity_id, process: processLabel(tenders.get(acta.opportunity_id)), url: tenders.get(acta.opportunity_id)?.url || null,
    title: item?.titulo || '', text: item?.detalle || '' })));

  const { data: matriz, error: matrizError } = await database.from('psi_tender_requirement_history')
    .select('id,kind,categoria,requisito,umbral,puntos,cita,procesos,url,source_modified_at,loaded_at').order('id').range(0, 4999);
  if (matrizError && !absent(matrizError)) throw matrizError;
  const company = await loadCompany(database);
  // La ciudad del proceso va con el nombre: «Dirección Ejecutiva · LP-07-2026» no dice que la sede es en Bogotá.
  const assess = occurrence => assessRequirement({ type: occurrence.type, process: [occurrence.process, occurrence.city].filter(Boolean).join(' · '),
    text: [occurrence.text, occurrence.threshold].filter(Boolean).join(' '), quote: occurrence.quote || '' }, company.facts);
  const catalog = buildRequirementCatalog({ matriz: matriz || [], crm, actas: actaGaps, blocks, assess });
  const { data: state, error: stateError } = await database.from('psi_tender_requirement_focus').select('focus_key,status,owner,note,current_state,fix_action,updated_at');
  if (stateError && !absent(stateError)) throw stateError;
  const focus = buildRequirementFocus(catalog, { state: state || [], opportunities: windows }).map(item => ({ ...item, live_state: item.live ? company.live[item.live] || null : null }));
  const loaded = (matriz || [])[0] || null;
  return { installed: !stateError, crm_processes: latest.size, focus, pending: buildRequirementPending(catalog), catalog,
    matrix: { path: REQUIREMENT_MATRIX_PATH, rows: (matriz || []).length, loaded_at: loaded?.loaded_at || null, source_modified_at: loaded?.source_modified_at || null } };
}

/** Guarda el estado de un foco: responsable, estado, nota, cómo estamos y qué lo resuelve. */
export async function saveRequirementFocus(database, input, actorId) {
  const key = String(input?.focus_key || '');
  if (!REQUIREMENT_FOCUS.some(focus => focus.key === key)) throw fail('El requisito no es válido.', 400);
  const status = String(input?.status || 'por_decidir');
  if (!Object.hasOwn(FOCUS_STATUSES, status)) throw fail('El estado no es válido.', 400);
  const row = { focus_key: key, status, owner: clip(input?.owner, 120), note: clip(input?.note, 1000), current_state: clip(input?.current_state, 1000),
    fix_action: clip(input?.fix_action, 1000), updated_by: actorId, updated_at: new Date().toISOString() };
  const { data, error } = await database.from('psi_tender_requirement_focus').upsert(row, { onConflict: 'focus_key' })
    .select('focus_key,status,owner,note,current_state,fix_action,updated_at').single();
  if (error) {
    if (absent(error)) throw fail('La pestaña de requisitos aún no está habilitada (falta aplicar la migración 215).', 409);
    if (String(error?.code || '') === '23514') throw fail('Este grupo todavía no se puede guardar (falta aplicar la migración 218).', 409);
    throw error;
  }
  return data;
}

// Segunda parte de la pestaña «Requisitos» (Juan, 2026-11-12: «vamos con eso»): Vig-IA recibe en cada análisis los
// hechos que nos faltan, para decir en el requisito del pliego que lo pida que no lo tenemos, cuántas veces nos ha
// inhabilitado y qué se decidió. Es contexto de la empresa, no evidencia del pliego.
export const AGT002_HECHOS_QUE_FALTAN_POLICY = [
  ' hechos_que_nos_faltan son requisitos que, según la ficha de la empresa, no cumplimos y que sólo se arreglan con un',
  'trámite (una sucursal, un código en el RUP, un registro, una licencia, un indicador financiero). Si este pliego pide',
  'uno de ellos, dilo en ese requisito: que la empresa no lo tiene, en cuántos procesos ya nos ha inhabilitado y la',
  'decisión vigente sobre el trámite; trátalo como bloqueo salvo que el pliego permita suplirlo (por ejemplo, con otro',
  'integrante de una unión temporal). Si el pliego no lo pide, no lo menciones. No es evidencia del pliego: la cita',
  'sigue siendo la del pliego.',
].join(' ');

/** Los hechos que nos faltan, para el análisis. Si algo falla, el análisis sigue sin ellos. */
export async function loadRequirementGapsForPrompt(database) {
  try {
    const board = await loadRequirementsBoard(database);
    return board.focus.filter(item => item.status !== 'resuelto').map(item => Object.freeze({
      id: item.key,
      hecho: item.title,
      nos_ha_inhabilitado_en: item.processes.length,
      ejemplos: item.processes.slice(0, 3).map(process => `${process.process}: ${process.reason}`.slice(0, 300)),
      como_estamos: (item.live_state || item.current_state || '').slice(0, 400) || null,
      decision: FOCUS_STATUSES[item.status] || item.status,
      que_lo_resuelve: item.fix_action.slice(0, 300),
    }));
  } catch (error) {
    console.warn('agt002_requirement_gaps_unavailable', { event: 'agt002_requirement_gaps_unavailable', code: String(error?.code || 'error').slice(0, 80) });
    return [];
  }
}
