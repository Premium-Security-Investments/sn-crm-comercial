// «Posibles socios» y «Quiénes se han movido en este proceso», armados en un solo lugar para Decidir y para la Mesa
// (punto 5 del encargo de Aliados, 2026-11-11: Vig-IA tiene que poder explicar por qué sale cada socio, y no podía:
// «las fuentes verificadas no incluyen la lista de aliados del CRM ni su regla de filtrado»).
import { cityKey, cityName, citiesToCover, listAllies, processKey, processParticipants, rankAllyCandidates, rankAllyPairs } from './tender-allies.js';

const ALTERNATIVE_LABEL = 'Sólo si la Entidad acepta sumar entre integrantes (hay que aclararlo con ella)';
export const ALLY_BOARD_RULE = 'Cruce automático con la base de Aliados (listado de la Superintendencia de Vigilancia), no una recomendación de Vig-IA. '
  + 'Ciudades: si el pliego dice que basta con que un integrante cumpla, primero los que tienen todas las ciudades del requisito, y aparte, sólo si la Entidad acepta sumar, los que aportan las que nos faltan; si se suma, los que aportan las que nos faltan. '
  + 'Orden: primero quien cubre todas las ciudades; luego por relación (aliado, aliado potencial, sin clasificar, competidor); luego quien no ha competido contra nosotros. '
  + 'Combinaciones de dos socios: sólo donde se puede sumar y ningún socio solo cubre todo, ordenadas igual. '
  + 'El tamaño no ordena: desde 30 ciudades con oficina se avisa que querrá liderar la unión. Estatal de Seguridad nunca se propone. Una oficina en el listado no prueba la agencia: hay que pedir la resolución y el certificado de Cámara.';

async function ourCitiesOf(database) {
  const { data: sites } = await database.from('psi_company_sites').select('city,supervigilancia_authorization');
  const ourSites = (sites || []).filter(site => !/pendiente/i.test(String(site.supervigilancia_authorization || '')));
  return new Map(ourSites.map(site => [cityKey(site.city), site.city]));
}

/**
 * La lista de posibles socios. `label` es la recomendación vigente; `getReading({ knownCityKeys })` devuelve la lectura
 * del pliego para uniones temporales (o null). Sin «Solo en unión temporal», `applies: false`.
 */
export async function buildAllyBoard(database, { opportunityId, label, getReading }) {
  if (!/^solo en uni[oó]n temporal/i.test(String(label || ''))) return { applies: false, cities: [], candidates: [] };
  const allies = await listAllies(database);
  if (!allies.installed || !allies.companies.length) return { applies: true, installed: allies.installed, cities: [], candidates: [] };
  const ourCities = await ourCitiesOf(database);
  const knownCityKeys = new Set(allies.companies.flatMap(company => company.cities.map(city => city.city_key)));
  const names = new Map(allies.companies.flatMap(company => company.cities).map(city => [city.city_key, cityName(city.city)]));
  const { data: tender } = await database.from('psi_public_tenders').select('ref').eq('converted_opportunity_id', opportunityId).limit(1).maybeSingle();
  const missing = citiesToCover(label, { ourCityKeys: new Set(ourCities.keys()), knownCityKeys });
  // Punto 3: los procesos nuestros (licitaciones convertidas en oportunidad) para saber quién compitió contra nosotros.
  const { data: ourTenders } = await database.from('psi_public_tenders').select('ref').not('converted_opportunity_id', 'is', null);
  const ourProcessRefs = new Set((ourTenders || []).map(row => processKey(row.ref)).filter(Boolean));
  const reading = (await getReading({ knownCityKeys })) || null;
  const allCities = (reading?.required_cities || []).filter(key => knownCityKeys.has(key));
  // «Compite en nuestra zona» con nuestras ciudades que pide este pliego, no con todas las de la ficha (Juan, 2026-11-10).
  const zone = new Set([...allCities, ...missing]);
  const zoneCities = new Map([...ourCities].filter(([key]) => zone.has(key)));
  const rank = (keys, limit) => rankAllyCandidates(allies.companies, { cityKeys: keys, processRef: tender?.ref || null, ourCities: zoneCities, ourProcessRefs, limit });
  const list = keys => ({ cities: keys.map(key => names.get(key) || key), candidates: rank(keys, 5) });
  // Punto 4: combinaciones de dos, sólo donde se puede sumar y ningún socio solo cubre todo.
  const pairs = keys => rankAllyPairs(allies.companies, { cityKeys: keys, processRef: tender?.ref || null, ourCities: zoneCities, ourProcessRefs });
  const one = allCities.length > missing.length ? list(allCities) : null;
  const sum = list(missing);
  const readingOut = reading ? { mode: reading.mode, quote: reading.quote, quote_verified: reading.quote_verified, document_name: reading.document_name, locator: reading.locator, explanation: reading.explanation } : null;
  // «Basta con uno» no prohíbe sumar (Juan, 2026-11-10): con uno_cumple o no_dice van las dos listas, la segunda
  // rotulada como lo que depende de la Entidad y sin repetir a quienes ya están en la primera.
  if (reading && (reading.mode === 'uno_cumple' || reading.mode === 'no_dice') && one) {
    const first = new Set(one.candidates.map(candidate => candidate.nit));
    const others = rank(missing, 50).filter(candidate => !first.has(candidate.nit)).slice(0, 5);
    return { applies: true, installed: true, reading: readingOut, ...one, alternative: { label: ALTERNATIVE_LABEL, cities: sum.cities, candidates: others, pairs: pairs(missing) } };
  }
  // Sin lectura no se sabe si se puede sumar: no se proponen combinaciones.
  return { applies: true, installed: true, reading: readingOut, ...sum, pairs: reading?.mode === 'se_suma' ? pairs(missing) : [] };
}

/** Quiénes se han movido en el proceso (punto 7), con la zona según la última lectura para uniones temporales. */
export async function buildProcessParticipantsBoard(database, { opportunityId }) {
  const allies = await listAllies(database);
  if (!allies.installed) return { installed: false, groups: [] };
  const { data: tender } = await database.from('psi_public_tenders').select('ref').eq('converted_opportunity_id', opportunityId).limit(1).maybeSingle();
  const ourCities = await ourCitiesOf(database);
  const { data: reading } = await database.from('psi_tender_plural_readings').select('required_cities').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const required = new Set(reading?.required_cities || []);
  const zoneCities = required.size ? new Map([...ourCities].filter(([key]) => required.has(key))) : ourCities;
  return { installed: true, groups: processParticipants({ companies: allies.companies, withoutNit: allies.participations_without_nit, opportunityId, tenderRef: tender?.ref || null, zoneCities }) };
}
