// Aliados, segunda etapa (Juan, 2026-11-15: «en las respuestas de la entidad sí sabe quién observó y podría actualizar
// la base»). Vig-IA ya separa cada observación de un documento de respuestas con su observante
// (psi_agt002_respuestas_observacion, migración 217). Aquí cada observante se identifica como empresa y se registra su
// participación con psi_register_process_participant (migración 223). Sólo entra lo 100 % identificado:
//   1. el NIT escrito en el texto del observante;
//   2. el nombre igual al de una sola empresa de la base (sin tildes, puntuación, «Ltda.», «S.A.S.» ni paréntesis), o
//      una palabra distintiva que está en una sola empresa de la base;
//   3. el nombre exacto de un solo proveedor del registro de SECOP, que trae NIT y contacto.
// Las uniones temporales, lo nuestro y lo que no se identifica con certeza no entran.
import { isJointVenture } from './tender-allies.js';
import { secopNit, supplierContact } from './aliados-proponentes-secop.js';

const SUPPLIERS_URL = 'https://www.datos.gov.co/resource/qmzu-gj57.json';
const LEGAL = new Set(['LTDA', 'LIMITADA', 'LIMITAD', 'LIMTADA', 'SAS', 'SA', 'S', 'A', 'CTA', 'BIC', 'EU', 'EN', 'LIQUIDACION', 'REORGANIZACION', 'Y', 'CIA']);

/** «Seguridad Camaleón Ltda.» → «SEGURIDAD CAMALEON». Pura. */
export function companyNameKey(name) {
  return String(name || '').split(/anteriormente/i)[0].replace(/\([^)]*\)/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(word => word && !LEGAL.has(word)).join(' ');
}
const parts = name => String(name || '').split(/\s[-–—]\s|\s\/\s/).map(companyNameKey).filter(Boolean);
const words = key => key.split(' ').filter(word => word.length >= 6);

/** Índice de la base para identificar por nombre: nombre exacto, sigla y palabras que están en una sola empresa. Pura. */
export function buildCompanyIndex(companies) {
  const byKey = new Map();
  const byWord = new Map();
  const add = (key, nit) => { if (!key) return; byKey.set(key, byKey.has(key) && byKey.get(key) !== nit ? null : nit); };
  for (const company of companies || []) {
    const keys = [...parts(company.name), ...parts(company.acronyms)];
    for (const key of keys) add(key, company.nit);
    for (const word of new Set(keys.flatMap(words))) byWord.set(word, byWord.has(word) && byWord.get(word) !== company.nit ? null : company.nit);
  }
  return { byKey, byWord, nits: new Set((companies || []).map(company => company.nit)) };
}

/** El NIT de un observante en la base, o null si no hay certeza. Pura. */
export function identifyInBase(observante, index) {
  const written = String(observante || '').match(/\b([89]\d{8})(?:\s*-\s*\d)?\b/)?.[1];
  if (written && index.nits.has(written)) return written;
  const keys = parts(observante);
  for (const key of keys) if (index.byKey.get(key)) return index.byKey.get(key);
  const found = new Set(keys.flatMap(words).map(word => index.byWord.get(word)).filter(Boolean));
  return found.size === 1 ? [...found][0] : null;
}

const phaseKind = documentName => (/definitiv/i.test(String(documentName || '')) ? 'observo_definitivo' : 'observo_proyecto');

/**
 * Una pasada: los observantes de las respuestas leídas por Vig-IA, identificados y registrados. Devuelve el resumen; lo
 * que no se identifica queda contado, no registrado.
 */
export async function registerResponseObservers(database, { fetchImpl = fetch, log = () => {} } = {}) {
  const page = async (table, select) => {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await database.from(table).select(select).range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  };
  const [responses, companies, tenders] = await Promise.all([
    page('psi_agt002_respuestas_observacion', 'opportunity_id,document_version_id,observante,es_nuestra'),
    page('psi_vigilance_companies', 'nit,name,acronyms'),
    page('psi_public_tenders', 'entity,ref,converted_opportunity_id'),
  ]);
  const versionIds = [...new Set(responses.map(row => row.document_version_id))];
  const { data: versions, error: versionsError } = versionIds.length
    ? await database.from('psi_tender_document_versions').select('id,name').in('id', versionIds) : { data: [], error: null };
  if (versionsError) throw versionsError;
  const documentName = new Map((versions || []).map(row => [row.id, row.name]));
  const tenderOf = new Map(tenders.filter(row => row.converted_opportunity_id).map(row => [row.converted_opportunity_id, row]));
  const index = buildCompanyIndex(companies);
  const summary = { observantes: 0, identificados: 0, empresas_nuevas: 0, participaciones_nuevas: 0, sin_identificar: [], errores: [] };
  const seen = new Set();
  for (const row of responses) {
    const label = String(row.observante || '').trim();
    const tender = tenderOf.get(row.opportunity_id);
    if (!label || row.es_nuestra || isJointVenture(label) || !tender) continue;
    const kind = phaseKind(documentName.get(row.document_version_id));
    const key = `${row.opportunity_id}|${companyNameKey(label)}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    summary.observantes += 1;
    try {
      let nit = identifyInBase(label, index);
      let contact = {};
      if (!nit) {
        const exact = String(label).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().replace(/'/g, "''");
        const query = new URLSearchParams({ $where: `upper(nombre)='${exact}'`, $limit: '2' }).toString();
        const response = await fetchImpl(`${SUPPLIERS_URL}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
        const suppliers = response.ok ? await response.json() : [];
        if (suppliers.length === 1 && secopNit(suppliers[0].nit)) { nit = secopNit(suppliers[0].nit); contact = supplierContact(suppliers[0]) || {}; }
      }
      if (!nit) { summary.sin_identificar.push(label.slice(0, 120)); continue; }
      summary.identificados += 1;
      const { data: result, error } = await database.rpc('psi_register_process_participant', { p_payload: {
        nit, name: label.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), phone: contact.phone, email: contact.email, representative: contact.representative,
        process_ref: tender.ref, entity: tender.entity, opportunity_id: row.opportunity_id, kind,
        detail: 'Observó el pliego (respuestas de la entidad, leídas por Vig-IA).', source: `Respuestas a observaciones: ${documentName.get(row.document_version_id) || 'documento del proceso'}`,
      } });
      if (error) throw error;
      if (result?.status === 'empresa_nueva') { summary.empresas_nuevas += 1; summary.participaciones_nuevas += 1; }
      else if (result?.status === 'participacion_nueva') summary.participaciones_nuevas += 1;
    } catch (failure) {
      summary.errores.push({ observante: label.slice(0, 120), error: String(failure?.message || failure).slice(0, 200) });
      log({ event: 'agt002_aliados_observantes_error' });
    }
  }
  return summary;
}
