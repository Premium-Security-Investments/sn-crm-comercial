// Aliados para uniones temporales (encargo AGT-002 del 2026-11-09; decisiones de Juan del mismo día; migración 196).
// La base de empresas de vigilancia (listado de la Superintendencia), lo nuestro de cada una (rol, contacto, notas), en
// qué procesos las hemos visto, y la propuesta de candidatos cuando la recomendación dice «Solo en unión temporal».
//
// Lo que nos falta se calcula con NUESTRA ficha (psi_company_sites), no con el listado: el listado nos muestra sólo con
// Pereira, Manizales y Cartago y la ficha tiene agencias con resolución en Bogotá, Medellín y Cali. Una oficina en el
// listado no prueba la agencia para un pliego: eso lo dice cada candidato.

export const ALLY_ROLES = Object.freeze({
  sin_clasificar: 'Sin clasificar', aliado_potencial: 'Aliado potencial', aliado: 'Aliado', competidor: 'Competidor', descartado: 'Descartado', nosotros: 'Nosotros',
});
export const PARTICIPATION_KINDS = Object.freeze({
  oferto: 'Ofertó', observo_proyecto: 'Observó el proyecto de pliego', observo_definitivo: 'Observó el pliego definitivo',
  adjudicatario: 'Adjudicatario', contratista_actual: 'Contratista actual', otro: 'Otro',
});
export const OUR_NIT = '891408256';
// Estatal de Seguridad nunca se propone como socio (Juan, 2026-11-10); sigue contando como competidor.
export const NEVER_PROPOSED_NITS = Object.freeze(['816004965']);
const ROLE_ORDER = ['aliado', 'aliado_potencial', 'sin_clasificar', 'competidor'];
const roleRank = role => { const index = ROLE_ORDER.indexOf(role); return index === -1 ? ROLE_ORDER.indexOf('sin_clasificar') : index; };

/** «Pereira», «Manizales y Armenia», «Pereira, Manizales y Armenia». */
export function joinNames(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || '';
}

/** El nombre de una ciudad del listado (en mayúsculas) escrito normal: «QUIBDO» → «Quibdo», «BOGOTÁ D.C.» → «Bogotá D.C.». */
export function cityName(value) {
  return String(value || '').toLowerCase().replace(/(^|[\s(-])([a-záéíóúñ])/g, (match, lead, letter) => lead + letter.toUpperCase()).replace(/\bD\.c\./, 'D.C.').replace(/\b(De|Del|La|Las|Los|Y)\b/g, word => word.toLowerCase());
}

/** Clave de ciudad: minúsculas, sin tildes, sin «D.C.», sin signos. */
export function cityKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bd\.?\s*c\.?\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const normProcess = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
/** La clave de una referencia de proceso, para comparar («LP-01-2026» = «LP 01 2026»). */
export const processKey = normProcess;

function fail(message, status) { return Object.assign(new Error(message), { status }); }
function missingTable(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('42883') || text.includes('pgrst202') || text.includes('psi_vigilance');
}
function mapError(error) {
  if (missingTable(error)) return fail('Aliados todavía no está instalado en la base.', 503);
  const code = String(error?.code || '');
  return fail(error?.message || 'No fue posible guardar.', code === '42501' ? 403 : code === 'P0002' ? 404 : 400);
}

async function all(database, table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await database.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

const COMPANY_COLUMNS = 'nit,dv,name,acronyms,representative,phone,email,license_resolution,role,contact,notes,updated_at';
const CONTACT_COLUMNS = 'contact_name,contact_title,contact_phone,contact_email';
const missingColumn = error => String(error?.code || '') === '42703' || /contact_(name|title|phone|email)/.test(String(error?.message || ''));
const missingFunction = error => ['42883', 'PGRST202'].includes(String(error?.code || '').toUpperCase());

/** Las empresas con el contacto en cuatro campos (197); sin la 197, sin ellos. */
async function allCompanies(database) {
  try { return await all(database, 'psi_vigilance_companies', `${COMPANY_COLUMNS},${CONTACT_COLUMNS}`); }
  catch (error) { if (missingColumn(error)) return all(database, 'psi_vigilance_companies', COMPANY_COLUMNS); throw error; }
}

/** El PDF de la Superintendencia parte algunos correos con un espacio («expertoseguridad.co m.co»): se muestran sin él. */
export function cleanEmail(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return text || null;
}

/**
 * La base completa para la pantalla: empresas con sus ciudades y cuántas veces las vimos, y cuántas participaciones de la
 * semilla faltan por cargar (para que la pantalla lo diga). Sin la 196, vacía.
 */
export async function listAllies(database, { participationsSeed = [] } = {}) {
  try {
    const [companies, offices, participations] = await Promise.all([
      allCompanies(database),
      all(database, 'psi_vigilance_company_offices', 'nit,city,city_key,department,office_type'),
      all(database, 'psi_vigilance_participations', 'id,nit,company_label,entity,process_ref,opportunity_id,kind,detail,source,occurred_on,created_at'),
    ]);
    const citiesByNit = new Map();
    for (const office of offices) {
      if (!String(office.city || '').trim() || !office.city_key) continue;
      const list = citiesByNit.get(office.nit) || [];
      if (!list.some(item => item.city_key === office.city_key)) list.push({ city: office.city, city_key: office.city_key, department: office.department });
      citiesByNit.set(office.nit, list);
    }
    const partsByNit = new Map();
    for (const part of participations) if (part.nit) partsByNit.set(part.nit, [...(partsByNit.get(part.nit) || []), part]);
    return {
      installed: true,
      companies: companies.map(company => ({ ...company, email: cleanEmail(company.email), contact_email: cleanEmail(company.contact_email), cities: citiesByNit.get(company.nit) || [], participations: partsByNit.get(company.nit) || [] })),
      participations_without_nit: participations.filter(part => !part.nit),
      seed_missing: missingSeedCount(participations, participationsSeed),
    };
  } catch (error) {
    if (missingTable(error)) return { installed: false, companies: [], participations_without_nit: [], seed_missing: 0 };
    throw error;
  }
}

/** Una empresa con sus ciudades y sus participaciones: la ficha que se abre desde «Posibles socios» en Decidir. */
export async function getAlly(database, nit) {
  const key = String(nit || '').replace(/\D/g, '');
  if (!/^[0-9]{6,12}$/.test(key)) throw fail('La empresa no es válida.', 400);
  const one = select => database.from('psi_vigilance_companies').select(select).eq('nit', key).maybeSingle();
  let { data: company, error } = await one(`${COMPANY_COLUMNS},${CONTACT_COLUMNS}`);
  if (error && missingColumn(error)) ({ data: company, error } = await one(COMPANY_COLUMNS));
  if (error) throw mapError(error);
  if (!company) throw fail('Esa empresa no está en la base.', 404);
  const [{ data: offices, error: officesError }, { data: participations, error: partsError }] = await Promise.all([
    database.from('psi_vigilance_company_offices').select('nit,city,city_key,department,office_type').eq('nit', key),
    database.from('psi_vigilance_participations').select('id,nit,company_label,entity,process_ref,kind,detail,source,occurred_on,created_at').eq('nit', key),
  ]);
  if (officesError) throw mapError(officesError);
  if (partsError) throw mapError(partsError);
  const cities = [];
  for (const office of offices || []) {
    if (!String(office.city || '').trim() || !office.city_key || cities.some(item => item.city_key === office.city_key)) continue;
    cities.push({ city: office.city, city_key: office.city_key, department: office.department });
  }
  return { ...company, email: cleanEmail(company.email), contact_email: cleanEmail(company.contact_email), cities, participations: participations || [] };
}

/** Carga (o actualiza) el listado en tandas, sin tocar rol, contacto ni notas; la primera vez, también las participaciones. */
export async function loadAlliesListing(database, { actorId, listing, source, participationsSeed = [] }) {
  let companies = 0;
  let offices = 0;
  for (let start = 0; start < listing.length; start += 100) {
    const { data, error } = await database.rpc('psi_load_vigilance_listing', { p_actor_id: actorId, p_source: source, p_companies: listing.slice(start, start + 100) });
    if (error) throw mapError(error);
    companies += Number(data?.companies || 0);
    offices += Number(data?.offices || 0);
  }
  // Nosotros, para que nunca salgamos como candidato de nosotros mismos.
  const { data: own } = await database.from('psi_vigilance_companies').select('role').eq('nit', OUR_NIT).maybeSingle();
  if (own && own.role === 'sin_clasificar') await database.rpc('psi_update_vigilance_company', { p_actor_id: actorId, p_nit: OUR_NIT, p_role: 'nosotros', p_contact: null, p_notes: null });
  // Las participaciones de la semilla que falten (por proceso, empresa y tipo): volver a cargar no duplica y completa una
  // carga que se haya cortado (2026-11-10: la primera se cayó en la 42, que traía sólo el año «2023»).
  const existing = await all(database, 'psi_vigilance_participations', 'process_ref,company_label,kind');
  const seen = new Set(existing.map(participationKey));
  let seeded = 0;
  for (const part of participationsSeed.map(normalizeSeedParticipation)) {
    if (seen.has(participationKey(part))) continue;
    const { error } = await database.rpc('psi_add_vigilance_participation', { p_actor_id: actorId, p_payload: part });
    if (error) throw mapError(error);
    seen.add(participationKey(part));
    seeded += 1;
  }
  return { companies, offices, participations_seeded: seeded };
}

/** Cuántas participaciones de la semilla no están en la base (por proceso, empresa y tipo). */
export function missingSeedCount(participations, participationsSeed) {
  const seen = new Set(participations.map(participationKey));
  return participationsSeed.map(normalizeSeedParticipation).filter(part => !seen.has(participationKey(part))).length;
}

const participationKey = part => [part.process_ref, part.company_label, part.kind].map(value => String(value || '').trim().toUpperCase()).join('|');

/** Una fecha sólo con el año («2023») no es una fecha: va al detalle y la fecha queda vacía. */
export function normalizeSeedParticipation(part) {
  const when = String(part?.occurred_on || '').trim();
  if (!when || /^\d{4}-\d{2}-\d{2}$/.test(when)) return part;
  return { ...part, occurred_on: null, detail: [/^\d{4}$/.test(when) ? `Año ${when}` : when, part.detail].filter(Boolean).join('. ') };
}

/**
 * Guarda lo nuestro de una empresa. `contact` = {name, title, phone, email} (197); sin la 197, los cuatro campos se
 * guardan juntos en el texto libre de la 196.
 */
export async function updateAlly(database, { actorId, nit, role, contact, notes }) {
  if (!/^[0-9]{6,12}$/.test(String(nit || ''))) throw fail('La empresa no es válida.', 400);
  if (role && !Object.hasOwn(ALLY_ROLES, role)) throw fail('El rol no es válido.', 400);
  const parts = contact && typeof contact === 'object' ? {
    name: String(contact.name || '').trim().slice(0, 200), title: String(contact.title || '').trim().slice(0, 200),
    phone: String(contact.phone || '').trim().slice(0, 100), email: cleanEmail(contact.email)?.slice(0, 200) || '',
  } : { name: String(contact || '').trim().slice(0, 200), title: '', phone: '', email: '' };
  const saved = await database.rpc('psi_save_vigilance_company', { p_actor_id: actorId, p_nit: nit, p_role: role || null, p_contact: parts, p_notes: notes ?? null });
  if (!saved.error) return saved.data;
  if (!missingFunction(saved.error)) throw mapError(saved.error);
  const text = [parts.name, parts.title, parts.phone, parts.email].filter(Boolean).join(' · ') || null;
  const { data, error } = await database.rpc('psi_update_vigilance_company', { p_actor_id: actorId, p_nit: nit, p_role: role || null, p_contact: text, p_notes: notes ?? null });
  if (error) throw mapError(error);
  return data;
}

export async function addParticipation(database, { actorId, body }) {
  const label = String(body?.company_label || '').trim();
  const processRef = String(body?.process_ref || '').trim();
  if (!label || !processRef) throw fail('Falta la empresa o el proceso.', 400);
  if (!Object.hasOwn(PARTICIPATION_KINDS, body?.kind || '')) throw fail('El tipo de participación no es válido.', 400);
  const payload = {
    nit: String(body?.nit || '').replace(/\D/g, '') || null, company_label: label.slice(0, 300), entity: String(body?.entity || '').trim().slice(0, 300) || null,
    process_ref: processRef.slice(0, 200), opportunity_id: body?.opportunity_id || null, kind: body.kind,
    detail: String(body?.detail || '').trim().slice(0, 1000) || null, source: String(body?.source || '').trim().slice(0, 500) || null,
    occurred_on: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.occurred_on || '')) ? body.occurred_on : null,
  };
  const { data, error } = await database.rpc('psi_add_vigilance_participation', { p_actor_id: actorId, p_payload: payload });
  if (error) throw mapError(error);
  return data;
}

/**
 * Las ciudades que el socio tendría que aportar, a partir del texto de la recomendación: las ciudades del listado que el
 * texto nombra y que no tenemos con autorización vigente en la ficha. Si todas las nombradas son nuestras (p. ej. el
 * pliego pide domicilio principal en Cali y sólo tenemos agencia), se usan las que nombra lo que «el socio debería aportar».
 */
export function citiesToCover(label, { ourCityKeys = new Set(), knownCityKeys = new Set() } = {}) {
  const text = ` ${cityKey(label)} `;
  const find = segment => [...knownCityKeys].filter(key => key.length >= 4 && ` ${segment} `.includes(` ${key} `));
  const mentioned = find(text);
  const missing = mentioned.filter(key => !ourCityKeys.has(key));
  if (missing.length) return missing;
  const ask = /socio deberia aportar(.*)$/.exec(text);
  return ask ? find(ask[1]) : [];
}

/** Hasta `limit` candidatos que tienen oficina en todas las ciudades (o, si nadie, los que cubren más), sin descartados. */
// Punto 3 del encargo de Aliados (2026-11-11): el orden sale de hechos de competencia y de la relación, no sólo de las
// ciudades. Quien compitió contra nosotros (en procesos donde también estuvimos) va después; el tamaño no ordena: se
// muestra, porque un socio mucho más grande querrá liderar la unión.
export const LARGE_COMPANY_OFFICES = 30;

export function rankAllyCandidates(companies, { cityKeys, processRef = null, limit = 5, ourCities = new Map(), ourProcessRefs = new Set() }) {
  if (!cityKeys.length) return [];
  const target = normProcess(processRef);
  const scored = companies
    .filter(company => company.role !== 'descartado' && company.role !== 'nosotros' && company.nit !== OUR_NIT && !NEVER_PROPOSED_NITS.includes(company.nit))
    .map(company => {
      const have = new Set((company.cities || []).map(city => city.city_key));
      const covered = cityKeys.filter(key => have.has(key));
      const inProcess = target ? (company.participations || []).filter(part => normProcess(part.process_ref) === target || (target.length >= 6 && normProcess(part.process_ref).includes(target))) : [];
      const incumbent = inProcess.some(part => part.kind === 'contratista_actual' || part.kind === 'adjudicatario');
      // Encargo del 2026-11-10, punto 2: no se esconde a nadie; se avisa si tiene oficina en nuestras ciudades.
      const ourZone = [...ourCities.keys()].filter(key => have.has(key)).map(key => ourCities.get(key));
      // Procesos nuestros (con oportunidad en el CRM o con la referencia de una licitación convertida), sin contar éste.
      const competed = new Set((company.participations || [])
        .filter(part => !inProcess.includes(part) && (part.opportunity_id || ourProcessRefs.has(normProcess(part.process_ref))))
        .map(part => normProcess(part.process_ref))).size;
      const offices = (company.cities || []).length;
      return {
        nit: company.nit, name: company.name, role: company.role, contact: [company.contact_name, company.contact_title, company.contact_phone, cleanEmail(company.contact_email)].filter(Boolean).join(' · ') || company.contact || null, phone: company.phone || null, email: cleanEmail(company.email),
        covered: covered.map(key => (company.cities || []).find(city => city.city_key === key)?.city || key),
        covers_all: covered.length === cityKeys.length,
        times_seen: (company.participations || []).length,
        warning: incumbent ? 'Es el contratista actual de este proceso.' : inProcess.length ? 'Ya se mueve en este proceso (ofertó u observó): es competidor directo.' : company.role === 'competidor' ? 'Lo tenemos marcado como competidor.' : null,
        zone_warning: ourZone.length ? `Tiene oficina en ${joinNames(ourZone)}: compite en nuestra zona.` : null,
        competed_against_us: competed,
        offices,
        size_note: offices >= LARGE_COMPANY_OFFICES ? `Grande: ${offices} ciudades con oficina; querrá liderar la unión.` : null,
        evidence: 'Oficina en el listado de la Superintendencia de Vigilancia; para el pliego hay que pedirle la resolución y el certificado de Cámara.',
        _score: [covered.length === cityKeys.length ? 0 : 1, -covered.length, roleRank(company.role), competed > 0 ? 1 : 0, competed],
      };
    })
    .filter(candidate => candidate.covered.length > 0);
  const full = scored.filter(candidate => candidate.covers_all);
  const pool = full.length ? full : scored;
  const cmp = (a, b) => { for (let i = 0; i < a._score.length; i += 1) if (a._score[i] !== b._score[i]) return a._score[i] - b._score[i]; return a.name.localeCompare(b.name); };
  return pool.sort(cmp).slice(0, limit).map(({ _score, ...candidate }) => candidate);
}

// Punto 7 del encargo de Aliados (Juan, 2026-11-11: «vamos así»): quiénes se han movido en este proceso, agrupados por lo
// que hicieron, con cuántos procesos nuestros más tienen en la base, cómo los tenemos marcados y si tienen oficina en las
// ciudades nuestras que pide el pliego. Sólo lectura: los datos se registran en Aliados.
export const PARTICIPANT_GROUPS = Object.freeze([
  ['observo_proyecto', 'Observaron el proyecto de pliego'],
  ['observo_definitivo', 'Observaron el pliego definitivo'],
  ['oferto', 'Ofertaron'],
  ['contratista', 'Contratista actual o adjudicatario'],
  ['otro', 'Otros'],
]);
const groupOf = kind => (kind === 'contratista_actual' || kind === 'adjudicatario' ? 'contratista' : PARTICIPANT_GROUPS.some(([key]) => key === kind) ? kind : 'otro');

/** ¿Esta participación es de este proceso? Con oportunidad, sólo la exacta; sin ella, por la referencia. Pura. */
export function participationInProcess(part, { opportunityId, tenderRef }) {
  if (part.opportunity_id) return part.opportunity_id === opportunityId;
  const ref = normProcess(part.process_ref);
  const target = normProcess(tenderRef);
  if (!ref || !target) return false;
  return ref === target || (ref.length >= 8 && target.includes(ref)) || (target.length >= 8 && ref.includes(target));
}

/**
 * Los que se movieron en el proceso, agrupados. `companies` como los devuelve listAllies (con cities y participations);
 * `zoneCities`: Map(city_key → nombre) de nuestras ciudades que pide el pliego. Pura.
 */
export function processParticipants({ companies, withoutNit = [], opportunityId, tenderRef, zoneCities = new Map() }) {
  const groups = new Map(PARTICIPANT_GROUPS.map(([key, label]) => [key, { key, label, items: [] }]));
  const inProcess = part => participationInProcess(part, { opportunityId, tenderRef });
  for (const company of companies) {
    const here = (company.participations || []).filter(inProcess);
    if (!here.length) continue;
    const others = new Set((company.participations || []).filter(part => !inProcess(part)).map(part => normProcess(part.process_ref))).size;
    const have = new Set((company.cities || []).map(city => city.city_key));
    const zone = [...zoneCities.keys()].filter(key => have.has(key)).map(key => zoneCities.get(key));
    for (const part of here) {
      groups.get(groupOf(part.kind)).items.push({
        nit: company.nit, name: company.name, role: company.role, kind: part.kind, detail: part.detail || null,
        occurred_on: part.occurred_on || null, other_processes: others, zone_cities: zone,
      });
    }
  }
  for (const part of withoutNit.filter(inProcess)) {
    groups.get(groupOf(part.kind)).items.push({ nit: null, name: part.company_label, role: null, kind: part.kind, detail: part.detail || null, occurred_on: part.occurred_on || null, other_processes: 0, zone_cities: [] });
  }
  return [...groups.values()].filter(group => group.items.length).map(group => ({ ...group, items: group.items.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * Punto 4 del encargo de Aliados (Juan, 2026-11-11: «sería útil para procesos futuros»): combinaciones de dos socios que
 * entre los dos cubren las ciudades, sólo cuando ningún socio solo las cubre. Se ordenan por la suma de los puestos de
 * cada uno en el orden del punto 3 (relación y si compitió contra nosotros), sin repetir socio entre combinaciones.
 * Quien llama decide si aplica: sólo si el pliego permite sumar (o en la lista rotulada «sólo si la Entidad acepta»).
 */
export function rankAllyPairs(companies, { cityKeys, limit = 3, pool = 40, ...options }) {
  if (cityKeys.length < 2) return [];
  const ranked = rankAllyCandidates(companies, { cityKeys, ...options, limit: 500 });
  if (!ranked.length || ranked.some(candidate => candidate.covers_all)) return [];
  const keysOf = new Map(companies.map(company => [company.nit, new Set((company.cities || []).map(city => city.city_key))]));
  const top = ranked.slice(0, pool);
  const pairs = [];
  for (let i = 0; i < top.length; i += 1) {
    for (let j = i + 1; j < top.length; j += 1) {
      const a = keysOf.get(top[i].nit) || new Set();
      const b = keysOf.get(top[j].nit) || new Set();
      if (cityKeys.every(key => a.has(key) || b.has(key))) pairs.push({ score: i + j, first: top[i], second: top[j] });
    }
  }
  const used = new Set();
  const out = [];
  for (const pair of pairs.sort((x, y) => x.score - y.score)) {
    if (used.has(pair.first.nit) || used.has(pair.second.nit)) continue;
    used.add(pair.first.nit); used.add(pair.second.nit);
    out.push({ first: pair.first, second: pair.second });
    if (out.length === limit) break;
  }
  return out;
}
