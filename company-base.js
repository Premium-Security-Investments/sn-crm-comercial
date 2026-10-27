import { assertAgt002CompanyEvidenceRegistryMinimalExposureSelect } from './verticales/licitaciones/agt002-company-evidence-classes.js';

// Vista Empresa (fase 1): sólo los metadatos que la pantalla muestra. Ambas listas previas (clases y legado)
// ya exponen estas columnas; aquí no se añade ninguna (sin source_reference, hash ni notas restringidas).
export const COMPANY_BASE_REGISTRY_ALLOWED_COLUMNS = Object.freeze([
  'entry_id', 'document_class', 'existence_status', 'human_review_status', 'vigencia_text', 'expiry', 'current', 'integration_active',
  // 159: identificador del documento que sustenta la decisión. Es el id de un documento que esta
  // misma pantalla ya lista; no añade exposición y es lo que permite no heredar una aprobación.
  'decision_support_document_id',
]);
export const COMPANY_BASE_REGISTRY_SELECT = assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(
  'entry_id,document_class,existence_status,human_review_status,vigencia_text,expiry,current,integration_active,decision_support_document_id',
  COMPANY_BASE_REGISTRY_ALLOWED_COLUMNS,
);
export const COMPANY_SITE_SELECT = 'id,department,city,address,is_main,supervigilancia_authorization,support_document_id,notes,source,updated_at';
export const COMPANY_EXPERIENCE_SELECT = 'id,rup_number,contracting_party,contract_object,value_smmlv,value_cop,contract_year,source,notes,updated_at';

// Tablas opcionales hasta aplicar 127: la vista sigue funcionando sin ellas.
const TABLE_ABSENT_ERROR_CODES = ['PGRST205', '42P01'];
// Columna que aún no existe: 42703 en Postgres, PGRST204 cuando el esquema en caché no la ve.
const COLUMN_ABSENT_ERROR_CODES = ['42703', 'PGRST204'];

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function text(value, max = 500) {
  const cleaned = String(value ?? '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function number(value, label, { integer = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/\s/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) throw inputError(`${label} no es un número válido.`);
  return parsed;
}

async function optionalRows(query) {
  const { data, error } = await query;
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return { rows: [], available: false };
    throw error;
  }
  return { rows: data || [], available: true };
}

// El ancla de la decisión (159) puede no existir todavía: la pantalla no se cae por eso, pide la
// lista sin esa columna y los bloques se muestran como antes. Desplegar y migrar son dos actos.
const COMPANY_BASE_REGISTRY_SELECT_SIN_ANCLA = COMPANY_BASE_REGISTRY_SELECT
  .split(',').filter(column => column !== 'decision_support_document_id').join(',');

async function registryRows(database) {
  const consulta = select => database.from('psi_agt002_company_evidence_registry')
    .select(select).eq('current', true).eq('integration_active', true).order('entry_id');
  const { data, error } = await consulta(COMPANY_BASE_REGISTRY_SELECT);
  if (!error) return { rows: data || [], available: true };
  if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return { rows: [], available: false };
  if (!COLUMN_ABSENT_ERROR_CODES.includes(String(error.code))) throw error;
  return optionalRows(consulta(COMPANY_BASE_REGISTRY_SELECT_SIN_ANCLA));
}

export async function loadCompanyBase(database) {
  const [registry, sites, experience] = await Promise.all([
    registryRows(database),
    optionalRows(database.from('psi_company_sites').select(COMPANY_SITE_SELECT)
      .order('is_main', { ascending: false }).order('department')),
    optionalRows(database.from('psi_company_experience').select(COMPANY_EXPERIENCE_SELECT)
      .order('value_smmlv', { ascending: false, nullsFirst: false }).order('contracting_party')),
  ]);
  return {
    registry: registry.rows,
    sites: sites.rows,
    experience: experience.rows,
    structured_tables_available: sites.available && experience.available,
  };
}

export function cleanCompanySite(input = {}) {
  const department = text(input.department, 80);
  if (!department) throw inputError('El departamento es obligatorio.');
  return {
    department,
    city: text(input.city, 120),
    address: text(input.address, 240),
    is_main: input.is_main === true,
    supervigilancia_authorization: text(input.supervigilancia_authorization, 240),
    support_document_id: text(input.support_document_id, 36),
    notes: text(input.notes, 1000),
    source: text(input.source, 240),
  };
}

export const COMPANY_EVIDENCE_DECISIONS = Object.freeze(['approved', 'rejected']);
const COMPANY_EVIDENCE_EXISTENCE = Object.freeze(['verified', 'reported', 'not_verified']);
// Lo que la decisión escribe. Nunca `applicability_status` ni `vigente_para_habilitacion`:
// la 061 separó esas dimensiones para que una revisión de empresa no se lea como
// aplicabilidad a un proceso. La proyección de vuelta es la de mínima exposición, así que
// `decision_humana` se escribe y no se devuelve.
export const COMPANY_EVIDENCE_DECISION_COLUMNS = Object.freeze([
  'existence_status', 'human_review_status', 'decision_humana', 'decision_humana_fecha',
  'estado_posterior_decision', 'decision_humana_por', 'decision_support_document_id',
]);

function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw inputError('La fecha de la decisión no es válida.');
  return date.toISOString().slice(0, 10);
}

export function cleanCompanyEvidenceDecision(input = {}, { actorId = null, now = new Date() } = {}) {
  const entryId = text(input.entry_id, 80);
  if (!entryId) throw inputError('Indique la ficha sobre la que se decide.');
  const decision = text(input.decision, 20);
  if (!COMPANY_EVIDENCE_DECISIONS.includes(decision)) throw inputError('La decisión debe ser "approved" o "rejected".');
  const reason = text(input.decision_humana, 500);
  if (!reason) throw inputError('Escriba en qué se basa la decisión: el registro no acepta una revisión sin motivo.');
  const author = text(actorId, 36);
  if (!author) throw inputError('No se pudo identificar quién decide.');
  const requested = text(input.existence_status, 20);
  if (requested && !COMPANY_EVIDENCE_EXISTENCE.includes(requested)) throw inputError('El estado de existencia no es válido.');
  return {
    entryId,
    payload: {
      human_review_status: decision,
      decision_humana: reason,
      decision_humana_fecha: isoDay(now),
      decision_humana_por: author,
      estado_posterior_decision: decision === 'approved'
        ? 'Aprobado en revisión humana'
        : 'Rechazado en revisión humana',
      existence_status: requested || (decision === 'approved' ? 'verified' : 'not_verified'),
    },
  };
}

export function cleanCompanyExperience(input = {}) {
  const contractingParty = text(input.contracting_party, 240);
  if (!contractingParty) throw inputError('El contratante es obligatorio.');
  const source = text(input.source, 240);
  if (!source) throw inputError('Indique de dónde sale el dato (por ejemplo, "RUP 17-jun-2026" o la certificación).');
  const year = number(input.contract_year, 'El año', { integer: true });
  if (year !== null && (year < 1950 || year > 2100)) throw inputError('El año no es válido.');
  return {
    rup_number: number(input.rup_number, 'El número del RUP', { integer: true }),
    contracting_party: contractingParty,
    contract_object: text(input.contract_object, 500),
    value_smmlv: number(input.value_smmlv, 'El valor en SMMLV'),
    value_cop: number(input.value_cop, 'El valor en pesos'),
    contract_year: year,
    source,
    notes: text(input.notes, 1000),
  };
}

async function upsertRow(database, table, select, id, payload, actorId) {
  const query = id
    ? database.from(table).update({ ...payload, updated_by: actorId }).eq('id', id)
    : database.from(table).insert({ ...payload, created_by: actorId, updated_by: actorId });
  const { data, error } = await query.select(select).single();
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) {
      const unavailable = new Error('Sedes y experiencia aún no están habilitadas (falta aplicar la migración 127).');
      unavailable.status = 409;
      throw unavailable;
    }
    throw error;
  }
  return data;
}

export function saveCompanySite(database, input, actorId) {
  return upsertRow(database, 'psi_company_sites', COMPANY_SITE_SELECT, text(input?.id, 36), cleanCompanySite(input), actorId);
}

async function currentSupportDocumentId(database, entryId) {
  const { data, error } = await database.from('psi_company_procurement_documents')
    .select('id').eq('document_type', entryId).eq('current', true).maybeSingle();
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return null;
    throw error;
  }
  return data?.id || null;
}

export async function saveCompanyEvidenceDecision(database, input, actorId, now = new Date()) {
  const { entryId, payload } = cleanCompanyEvidenceDecision(input, { actorId, now });
  payload.decision_support_document_id = await currentSupportDocumentId(database, entryId);
  const { data, error } = await database.from('psi_agt002_company_evidence_registry')
    .update(payload).eq('entry_id', entryId).eq('current', true)
    .select(COMPANY_BASE_REGISTRY_SELECT).maybeSingle();
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) {
      const unavailable = new Error('El registro de evidencia empresarial no está disponible.');
      unavailable.status = 409;
      throw unavailable;
    }
    // 42501: falta el grant por columna de la migración 158. Se dice qué falta, no "error".
    if (error.code === '42501') {
      const blocked = new Error('La decisión humana aún no está habilitada en la base: falta aplicar la migración 158.');
      blocked.status = 409;
      throw blocked;
    }
    throw error;
  }
  if (!data) throw inputError('Esa ficha no existe o no es la versión vigente del registro.');
  return data;
}

// Decisión 1.3 del plan del 2026-10-27: si una persona carga el soporte, la verificación ya
// ocurrió al escoger el bloque y subir el archivo. Pedirle después que firme lo que acaba de hacer
// es lo que produjo la única decisión registrada hasta hoy, cuyo motivo escrito fue "Documento
// adjunto". Un agente, en cambio, deduce tres cosas que pueden fallar en silencio, así que no
// escribe decisión y el bloque queda "falta confirmar".
export async function recordUploadAsVerification(database, { entryId, documentId, actorId, actorName, displayName, issuedAt }, now = new Date()) {
  const entry = text(entryId, 80);
  const document = text(documentId, 36);
  const author = text(actorId, 36);
  if (!entry || !document || !author) return null;
  const quien = text(actorName, 120) || 'una persona del equipo';
  const cuando = issuedAt ? ` expedido el ${text(issuedAt, 10)},` : '';
  const payload = {
    human_review_status: 'approved',
    existence_status: 'verified',
    decision_humana: `Soporte cargado por ${quien}:${cuando} ${text(displayName, 240) || 'documento sin nombre'}.`.slice(0, 500),
    decision_humana_fecha: isoDay(now),
    decision_humana_por: author,
    estado_posterior_decision: 'Verificado al cargar el soporte',
    decision_support_document_id: document,
  };
  // Nada de lo que pase aquí puede tumbar la carga: el documento ya quedó registrado, y perder
  // la carga por no poder escribir la decisión es justo el defecto que costó cuatro archivos
  // huérfanos. Si no se escribe, el bloque se muestra como "falta confirmar", que es la verdad.
  try {
    const { data, error } = await database.from('psi_agt002_company_evidence_registry')
      .update(payload).eq('entry_id', entry).eq('current', true)
      .select('entry_id').maybeSingle();
    return error ? null : data;
  } catch {
    return null;
  }
}

export function saveCompanyExperience(database, input, actorId) {
  return upsertRow(database, 'psi_company_experience', COMPANY_EXPERIENCE_SELECT, text(input?.id, 36), cleanCompanyExperience(input), actorId);
}
