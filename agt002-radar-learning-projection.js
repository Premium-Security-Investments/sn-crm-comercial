import { extractTenderCoreServiceTerms } from './tender-relevance-terms.js';

const DECISIONS_TABLE = 'psi_tender_go_no_go_decisions';
const TENDER_EMBED = 'psi_public_tenders(id,title,description,entity,city,dept,source,category)';
// Columnas reales de la tabla: `created_at` sólo respalda el orden cuando `decided_at` viene nulo.
const DECISION_FIELDS = `id,tender_id,decision,decided_at,created_at,supersedes_decision_id,${TENDER_EMBED}`;
const SUPERSESSION_EDGE_FIELDS = 'id,supersedes_decision_id';
// Los identificadores viajan en un `in.(...)` dentro de la URL: 50 UUID por consulta dejan la cadena
// muy por debajo del límite de línea de petición de PostgREST y de cualquier proxy intermedio.
const SUPERSESSION_LOOKUP_CHUNK = 50;
const MAX_LIMIT = 5000;
const EPOCH = '1970-01-01T00:00:00.000Z';

function normalize(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : null;
}
function iso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function tenderShape(row) {
  const tender = row.tender || row.psi_public_tenders || row;
  const serviceText = Array.isArray(tender.service_terms)
    ? tender.service_terms.join(' ')
    : `${tender.title || ''} ${tender.description || tender.desc || ''}`;
  return {
    tender_id: String(tender.id || row.tender_id || ''),
    service_terms: extractTenderCoreServiceTerms(serviceText),
    entity_key: normalize(tender.entity_nit || tender.entity),
    modality_key: normalize(tender.category || tender.modality),
    source_key: normalize(tender.source),
    territory_key: { city: normalize(tender.city), dept: normalize(tender.dept) },
  };
}
function observation(row, type, polarity, dateField) {
  const shape = tenderShape(row);
  const id = String(row.id || '');
  if (!id || !shape.tender_id) return null;
  return {
    observation_id: `${type}:${id}`,
    tender_id: shape.tender_id,
    service_terms: shape.service_terms,
    entity_key: shape.entity_key,
    modality_key: shape.modality_key,
    source_key: shape.source_key,
    territory_key: shape.territory_key,
    decided_at: iso(row[dateField] || row.updated_at || row.created_at) || EPOCH,
    signal_polarity: polarity,
    evidence: [{ record_id: id, evidence_type: type }],
  };
}
async function read(database, table, fields, limit, { equal = [], included = [], order = [] } = {}) {
  let query = database.from(table).select(fields);
  for (const [column, value] of equal) query = query.eq(column, value);
  for (const [column, values] of included) query = query.in(column, values);
  for (const [column, options] of order) query = query.order(column, options);
  const response = await query.limit(limit);
  if (response?.error) throw response.error;
  return response?.data || [];
}

function identifier(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
function decisionRank(row) {
  return iso(row.decided_at || row.updated_at || row.created_at) || EPOCH;
}
function moreRecentDecision(row, other) {
  const rank = decisionRank(row);
  const otherRank = decisionRank(other);
  return rank === otherRank ? identifier(row.id) > identifier(other.id) : rank > otherRank;
}
function supersededTargets(rows) {
  const targets = new Set();
  for (const row of rows) {
    const target = identifier(row?.supersedes_decision_id);
    if (target) targets.add(target);
  }
  return targets;
}

// `supersedes_decision_id` no expone una relación PostgREST autorreferente utilizable (PGRST200 en producción),
// así que la sucesión se resuelve con lecturas planas: la arista inversa se consulta acotada a los identificadores
// que el lote todavía considera vigentes. Eso es exacto sin paginar la tabla completa: un sucesor que quedó fuera
// del lote principal sigue apareciendo porque se busca por `supersedes_decision_id in (...)`, no por posición.
async function readSupersessionEdges(database, decisionIds) {
  const superseded = new Set();
  const pending = [];
  for (let index = 0; index < decisionIds.length; index += SUPERSESSION_LOOKUP_CHUNK) {
    pending.push(decisionIds.slice(index, index + SUPERSESSION_LOOKUP_CHUNK));
  }
  while (pending.length) {
    const chunk = pending.shift();
    const batchLimit = Math.min(MAX_LIMIT, Math.max(chunk.length * 2, 2));
    const rows = await read(database, DECISIONS_TABLE, SUPERSESSION_EDGE_FIELDS, batchLimit, {
      included: [['supersedes_decision_id', chunk]],
      order: [['supersedes_decision_id', { ascending: true }], ['id', { ascending: true }]],
    });
    // Un lote saturado podría esconder identificadores enteros detrás de un predecesor muy sucedido:
    // se subdivide hasta que la respuesta quepa, o hasta que el trozo sea un único identificador
    // (con uno solo, cualquier fila devuelta ya prueba que está supersedido).
    if (rows.length >= batchLimit && chunk.length > 1) {
      const middle = Math.ceil(chunk.length / 2);
      pending.push(chunk.slice(0, middle), chunk.slice(middle));
      continue;
    }
    for (const target of supersededTargets(rows)) superseded.add(target);
  }
  return superseded;
}

// Cadenas A←B←C: las aristas presentes en el lote marcan a sus predecesores y la consulta inversa cubre a los
// sucesores ausentes, de modo que sólo la hoja de cada cadena sobrevive. Si un tender conserva varias hojas
// (sucesión nunca registrada), se conserva la más reciente por `decided_at` con desempate por `id`.
async function resolveCurrentHumanDecisions(database, rows) {
  const unique = new Map();
  for (const row of rows) {
    const id = identifier(row?.id);
    if (!id || unique.has(id)) continue;
    unique.set(id, row);
  }
  const superseded = supersededTargets(unique.values());
  const unresolved = [...unique.keys()].filter(id => !superseded.has(id));
  for (const target of await readSupersessionEdges(database, unresolved)) superseded.add(target);

  const currentByTender = new Map();
  for (const [id, row] of unique) {
    if (superseded.has(id)) continue;
    const key = identifier(row?.tender_id) || identifier(row?.psi_public_tenders?.id) || `sin-tender:${id}`;
    const previous = currentByTender.get(key);
    if (!previous || moreRecentDecision(row, previous)) currentByTender.set(key, row);
  }
  return [...currentByTender.values()];
}

export async function projectAgt002RadarLearningObservations(database, { limit = 1000 } = {}) {
  if (!database || typeof database.from !== 'function' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    const error = new Error('AGT002_RADAR_LEARNING_SIGNALS_INVALID: projection input');
    error.code = 'AGT002_RADAR_LEARNING_SIGNALS_INVALID';
    throw error;
  }
  let groups;
  let currentDecisions;
  try {
    groups = await Promise.all([
      read(database, 'psi_public_tenders', 'id,title,description,entity,city,dept,source,category,updated_at', limit, {
        equal: [['internal_status', 'convertida_oportunidad']],
        order: [['updated_at', { ascending: false }], ['id', { ascending: false }]],
      }),
      read(database, 'psi_tender_analysis_runs', 'id,tender_id,status,completed_at,result,psi_public_tenders(id,title,description,entity,city,dept,source,category)', limit, {
        equal: [['canonical', true], ['status', 'completed']],
        order: [['completed_at', { ascending: false }], ['id', { ascending: false }]],
      }),
      read(database, DECISIONS_TABLE, DECISION_FIELDS, limit, {
        order: [['decided_at', { ascending: false }], ['id', { ascending: false }]],
      }),
      read(database, 'psi_tender_offer_status_transitions', 'id,tender_id,to_status,changed_at,psi_public_tenders(id,title,description,entity,city,dept,source,category)', limit, {
        included: [['to_status', ['presentada', 'adjudicada', 'no_adjudicada']]],
        order: [['changed_at', { ascending: false }], ['id', { ascending: false }]],
      }),
    ]);
    currentDecisions = await resolveCurrentHumanDecisions(database, groups[2]);
  } catch (error) {
    error.runtime_boundary_code = 'AGT002_RADAR_LEARNING_SIGNALS_INVALID';
    throw error;
  }

  const precedents = [];
  for (const row of groups[0]) {
    const item = observation(row, 'converted_tender', 'favorable', 'updated_at');
    if (item) precedents.push(item);
  }
  for (const row of groups[1]) {
    const item = observation(row, 'canonical_analysis', 'neutra', 'completed_at');
    if (item) precedents.push(item);
  }
  for (const row of currentDecisions) {
    const decision = normalize(row.decision);
    const item = observation(row, 'human_decision', decision === 'go' ? 'favorable' : decision === 'no-go' || decision === 'nogo' ? 'desfavorable' : 'neutra', 'decided_at');
    if (item) precedents.push(item);
  }
  for (const row of groups[3]) {
    const status = normalize(row.to_status);
    const item = observation(row, 'offer_outcome', status === 'adjudicada' ? 'favorable' : status === 'no-adjudicada' ? 'desfavorable' : 'neutra', 'changed_at');
    if (item) precedents.push(item);
  }
  precedents.sort((a, b) => a.observation_id.localeCompare(b.observation_id));
  return { schema_version: 'agt002-radar-learning-observations-v1', precedents };
}
