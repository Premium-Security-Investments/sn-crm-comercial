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
const ROLE_ORDER = ['aliado', 'aliado_potencial', 'sin_clasificar', 'competidor'];

/** Clave de ciudad: minúsculas, sin tildes, sin «D.C.», sin signos. */
export function cityKey(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bd\.?\s*c\.?\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const normProcess = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

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
      all(database, 'psi_vigilance_participations', 'id,nit,company_label,entity,process_ref,kind,detail,source,occurred_on,created_at'),
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
export function rankAllyCandidates(companies, { cityKeys, processRef = null, limit = 5 }) {
  if (!cityKeys.length) return [];
  const target = normProcess(processRef);
  const scored = companies
    .filter(company => company.role !== 'descartado' && company.role !== 'nosotros' && company.nit !== OUR_NIT)
    .map(company => {
      const have = new Set((company.cities || []).map(city => city.city_key));
      const covered = cityKeys.filter(key => have.has(key));
      const inProcess = target ? (company.participations || []).filter(part => normProcess(part.process_ref) === target || (target.length >= 6 && normProcess(part.process_ref).includes(target))) : [];
      const incumbent = inProcess.some(part => part.kind === 'contratista_actual' || part.kind === 'adjudicatario');
      return {
        nit: company.nit, name: company.name, role: company.role, contact: [company.contact_name, company.contact_title, company.contact_phone, cleanEmail(company.contact_email)].filter(Boolean).join(' · ') || company.contact || null, phone: company.phone || null, email: cleanEmail(company.email),
        covered: covered.map(key => (company.cities || []).find(city => city.city_key === key)?.city || key),
        covers_all: covered.length === cityKeys.length,
        times_seen: (company.participations || []).length,
        warning: incumbent ? 'Es el contratista actual de este proceso.' : inProcess.length ? 'Ya se mueve en este proceso (ofertó u observó): es competidor directo.' : company.role === 'competidor' ? 'Lo tenemos marcado como competidor.' : null,
        evidence: 'Oficina en el listado de la Superintendencia de Vigilancia; para el pliego hay que pedirle la resolución y el certificado de Cámara.',
        _score: [covered.length === cityKeys.length ? 0 : 1, -covered.length, ROLE_ORDER.indexOf(company.role), -((company.participations || []).length), -(company.cities || []).length],
      };
    })
    .filter(candidate => candidate.covered.length > 0);
  const full = scored.filter(candidate => candidate.covers_all);
  const pool = full.length ? full : scored;
  const cmp = (a, b) => { for (let i = 0; i < a._score.length; i += 1) if (a._score[i] !== b._score[i]) return a._score[i] - b._score[i]; return a.name.localeCompare(b.name); };
  return pool.sort(cmp).slice(0, limit).map(({ _score, ...candidate }) => candidate);
}
