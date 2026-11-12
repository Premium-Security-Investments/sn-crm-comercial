// Pestaña «Requisitos» (Juan, 2026-11-11; migraciones 210 y 211): lee las tres fuentes del catálogo y el estado de «lo
// que nos frena». La matriz histórica, de la tabla que carga el puente diario desde SharePoint; los análisis y las actas,
// en vivo, así cada análisis nuevo entra solo. «Cómo estamos hoy» sale de la ficha de la empresa para sedes, indicadores y códigos; lo demás lo escribe
// quien trabaja el requisito.
import { REQUIREMENT_MATRIX_PATH } from './requirement-history-import.js';
import { FOCUS_STATUSES, REQUIREMENT_FOCUS, buildRequirementCatalog, buildRequirementFocus } from './requirement-catalog.js';

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
  const { data, error } = await database.from('psi_public_tenders').select('ref,entity,url,converted_opportunity_id').in('converted_opportunity_id', opportunityIds);
  if (error) throw error;
  return new Map((data || []).map(row => [row.converted_opportunity_id, row]));
}

/** «Cómo estamos hoy» desde la ficha, para los focos que la ficha ya sabe responder. */
async function loadLiveState(database) {
  const [profile, sites, codes] = await Promise.all([
    database.from('psi_company_procurement_profile').select('financial_capacity,organizational_capacity').limit(1).maybeSingle(),
    database.from('psi_company_sites').select('city,is_main,supervigilancia_authorization'),
    database.from('psi_company_rup_codes').select('codigo'),
  ]);
  const live = {};
  if (!sites.error && sites.data?.length) {
    const main = sites.data.filter(site => site.is_main).map(site => site.city);
    const authorized = sites.data.filter(site => !site.is_main && /autorizad/i.test(String(site.supervigilancia_authorization || ''))).map(site => site.city);
    const pending = sites.data.filter(site => !site.is_main && !/autorizad/i.test(String(site.supervigilancia_authorization || ''))).map(site => site.city);
    live.sedes = [main.length ? `Domicilio principal en ${main.join(', ')}.` : '', authorized.length ? `Agencias en ${authorized.join(', ')}.` : '',
      'Ninguna sucursal registrada.', pending.length ? `Pendiente: ${pending.join(', ')}.` : ''].filter(Boolean).join(' ');
  }
  if (!profile.error && profile.data) {
    const text = `${profile.data.financial_capacity || ''}\n${profile.data.organizational_capacity || ''}`;
    const pick = label => text.match(new RegExp(`${label}[^:\\n]*:\\s*([^\\s—\\n]+)`, 'i'))?.[1]?.replace(/[.,;]$/, '') || null;
    const parts = [['Liquidez', pick('Índice de liquidez')], ['endeudamiento', pick('Índice de endeudamiento')], ['cobertura de intereses', pick('Razón de cobertura de intereses')],
      ['capital de trabajo', pick('Capital de trabajo calculado')], ['ROE', pick('Rentabilidad del patrimonio')], ['ROA', pick('Rentabilidad del activo')]]
      .filter(([, value]) => value).map(([label, value]) => `${label} ${value}`);
    const cut = text.match(/Corte(?: financiero)?:\s*([0-9/]+)/i)?.[1];
    if (parts.length) live.financiero = `${parts.join(', ')}${cut ? ` (corte ${cut})` : ''}.`;
  }
  if (!codes.error && codes.data) {
    const list = codes.data.map(row => String(row.codigo));
    live.codigos = `${list.length} códigos inscritos en el RUP${list.some(code => code.startsWith('461015')) ? '' : '; no está el 46101500'}.`;
    live.codigos_lista = list;
  }
  return live;
}

/** Todo lo que muestra la pestaña. */
export async function loadRequirementsBoard(database) {
  const latest = await loadCrmRequirements(database);
  const { data: actas, error: actasError } = await database.from('psi_tender_closure_acta').select('opportunity_id,requirements_unmet');
  if (actasError && !absent(actasError)) throw actasError;
  const tenders = await loadTenders(database, [...new Set([...latest.keys(), ...(actas || []).map(acta => acta.opportunity_id)])]);

  const crm = [];
  for (const [opportunityId, version] of latest) {
    const tender = tenders.get(opportunityId);
    const claims = new Map((Array.isArray(version.claims) ? version.claims : []).map(claim => [claim.claim_id, claim]));
    for (const requirement of Array.isArray(version.requirements) ? version.requirements : []) {
      if (requirement?.applicability === 'NOT_APPLICABLE') continue;
      crm.push({ opportunity_id: opportunityId, process: processLabel(tender), url: tender?.url || null, requirement_id: requirement.requirement_id,
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
  const catalog = buildRequirementCatalog({ matriz: matriz || [], crm, actas: actaGaps });
  const { data: state, error: stateError } = await database.from('psi_tender_requirement_focus').select('focus_key,status,owner,note,current_state,fix_action,updated_at');
  if (stateError && !absent(stateError)) throw stateError;
  const live = await loadLiveState(database);
  const focus = buildRequirementFocus(catalog, { state: state || [] }).map(item => ({ ...item, live_state: item.live ? live[item.live] || null : null }));
  const loaded = (matriz || [])[0] || null;
  return { installed: !stateError, crm_processes: latest.size, focus, catalog,
    matrix: { path: REQUIREMENT_MATRIX_PATH, rows: (matriz || []).length, loaded_at: loaded?.loaded_at || null, source_modified_at: loaded?.source_modified_at || null } };
}

/** Guarda el estado de un foco: responsable, estado, nota, cómo estamos y qué lo resuelve. */
export async function saveRequirementFocus(database, input, actorId) {
  const key = String(input?.focus_key || '');
  if (!REQUIREMENT_FOCUS.some(focus => focus.key === key)) throw fail('El requisito no es válido.', 400);
  const status = String(input?.status || 'pendiente');
  if (!Object.hasOwn(FOCUS_STATUSES, status)) throw fail('El estado no es válido.', 400);
  const row = { focus_key: key, status, owner: clip(input?.owner, 120), note: clip(input?.note, 1000), current_state: clip(input?.current_state, 1000),
    fix_action: clip(input?.fix_action, 1000), updated_by: actorId, updated_at: new Date().toISOString() };
  const { data, error } = await database.from('psi_tender_requirement_focus').upsert(row, { onConflict: 'focus_key' })
    .select('focus_key,status,owner,note,current_state,fix_action,updated_at').single();
  if (error) {
    if (absent(error)) throw fail('La pestaña de requisitos aún no está habilitada (falta aplicar la migración 210).', 409);
    throw error;
  }
  return data;
}
