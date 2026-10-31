import { ACTIONS, requireAction } from '../../access-control.js';
import {
  AGT002_WORKBENCH_CAPABILITIES,
  AGT002_WORKBENCH_CONTRACT_VERSION,
  AGT002_WORKBENCH_POLICY_VERSION,
} from './agt002-workbench-contract.js';
import { buildAgt002WorkbenchInitialReference } from './agt002-workbench-context.js';
import {
  appendAgt002HumanMessage,
  computeAgt002WorkbenchIdempotencyKey,
  getAgt002Workbench,
  getLatestCanonicalAgt002AnalysisRun,
  getOrCreateAgt002WorkbenchThread,
  retryAgt002WorkbenchJob,
  reviewAgt002LearningProposal,
} from './agt002-workbench-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Closed message body, preserved key-for-key for compatibility with clients already in
 * production. `snapshot_id` and `context_links` remain accepted and are still validated as
 * well-formed, but they are NOT authoritative: the server re-derives the canonical
 * reference on every POST and overwrites both before persisting or hashing anything.
 */
const MESSAGE_KEYS = Object.freeze([
  'opportunity_id', 'thread_id', 'client_message_id', 'content', 'context_links',
  'capability_id', 'snapshot_id', 'base_version_id',
]);
/**
 * Claves del mensaje que llegaron después del primer cliente. `artifact_id` nombra el documento del
 * expediente que un borrador va a escribir, y sólo la capacidad `draft` lo usa. Es opcional porque
 * una pestaña ya abierta sigue enviando el body de ocho claves de siempre y debe seguir
 * funcionando; una clave que no esté en ninguna de las dos listas se sigue rechazando.
 */
const MESSAGE_OPTIONAL_KEYS = Object.freeze(['artifact_id']);
const RETRY_KEYS = Object.freeze(['opportunity_id', 'job_id']);
const REVIEW_KEYS = Object.freeze(['opportunity_id', 'proposal_id', 'decision', 'scope', 'comment']);

function apiError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertEnabled(options) {
  if (options?.enabled !== true) {
    throw apiError('La Mesa de trabajo de Vig-IA está desactivada.', 503, 'AGT002_WORKBENCH_DISABLED');
  }
}

function exactBody(value, expected, optional = []) {
  const admitted = new Set([...expected, ...optional]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !expected.every(key => Object.hasOwn(value, key))
    || !Object.keys(value).every(key => admitted.has(key))) {
    throw apiError('El body contiene claves inesperadas; actor_id no está permitido.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
}

/**
 * Capacidad del contrato, rechazada en la puerta. El RPC la vuelve a validar con la misma lista,
 * pero sin este paso no se puede decidir qué exige cada capacidad antes de leer nada.
 */
function capability(value) {
  if (!Object.values(AGT002_WORKBENCH_CAPABILITIES).includes(value)) {
    throw apiError('capability_id no pertenece al contrato de la Mesa.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return value;
}

function uuid(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw apiError(`${label} debe ser UUID.`, 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return value.toLowerCase();
}

function actor(profile, action) {
  try {
    requireAction(profile, action);
  } catch (error) {
    throw apiError(error?.message || 'No tiene autorización para realizar esta operación.', 403, 'AGT002_WORKBENCH_FORBIDDEN');
  }
  return uuid(profile?.id, 'El actor autenticado');
}

function mapDatabaseError(error) {
  // An error this module already shaped (gate, bad request, missing canonical analysis)
  // is already public and mapped; re-mapping it would flatten it into a generic 503.
  if (typeof error?.code === 'string' && error.code.startsWith('AGT002_WORKBENCH_')) return error;
  const mapped = new Error(error?.message || 'No fue posible operar la Mesa de trabajo.');
  const publicError = ({
    '42501': [403, 'AGT002_WORKBENCH_FORBIDDEN'],
    P0002: [404, 'AGT002_WORKBENCH_NOT_FOUND'],
    '23505': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
    '23514': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
    '22023': [400, 'AGT002_WORKBENCH_BAD_REQUEST'],
    '55000': [409, 'AGT002_WORKBENCH_IN_PROGRESS'],
  })[error?.code] || (error?.status === 403
    ? [403, 'AGT002_WORKBENCH_FORBIDDEN']
    : error?.status === 404
      ? [404, 'AGT002_WORKBENCH_NOT_FOUND']
      : error?.status === 409
        ? [409, 'AGT002_WORKBENCH_IN_PROGRESS']
        : error?.status === 400
          ? [400, 'AGT002_WORKBENCH_BAD_REQUEST']
          : [503, 'AGT002_WORKBENCH_UNAVAILABLE']);
  [mapped.status, mapped.code] = publicError;
  return mapped;
}

async function mapped(operation) {
  try {
    return await operation();
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

/**
 * Server-derived canonical reference for an opportunity — the single admissible provenance
 * of everything a Mesa freezes, used identically by the GET (initial reference) and by every
 * POST (persisted snapshot + context links). Fails closed: an opportunity with no completed
 * canonical Vig-IA run has no admissible starting point for a Mesa, and the alternative —
 * inventing a snapshot id so the composer looks usable — would queue work against a case that
 * was never analysed. The run's own `opportunity_id` is re-checked here (the loader already
 * filters by it) so no reference can ever carry another dossier's provenance. The mapped
 * error carries no identifiers.
 */
async function resolveCanonicalReference(database, opportunityId, { dossierContext = false, question = null, artifactLink = null } = {}) {
  const run = await getLatestCanonicalAgt002AnalysisRun(database, { opportunityId });
  if (!run) {
    throw apiError(
      'La Mesa Vig-IA requiere un análisis canónico Vig-IA completado de esta oportunidad.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
  if (typeof run.opportunity_id !== 'string' || run.opportunity_id.toLowerCase() !== opportunityId) {
    throw apiError(
      'El análisis canónico Vig-IA leído no pertenece a esta oportunidad.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
  let reference;
  try {
    reference = buildAgt002WorkbenchInitialReference(run);
  } catch {
    throw apiError(
      'El análisis canónico Vig-IA de esta oportunidad no ofrece una referencia inicial válida para la Mesa.',
      409, 'AGT002_WORKBENCH_NO_CANONICAL_ANALYSIS',
    );
  }
  // El artefacto del borrador va inmediatamente después de las referencias de origen, antes de
  // fragmentos y tareas: es la única referencia sin la cual el trabajo no puede ejecutarse, así que
  // nunca puede quedar fuera por el tope de 20 — lo que se recorta son las tareas, que rellenan.
  const anchored = artifactLink
    ? { ...reference, context_links: [...reference.context_links, artifactLink] }
    : reference;
  if (!dossierContext) return anchored;
  // Con pregunta, primero los fragmentos de los documentos que la responden; después las tareas.
  const passages = question ? await documentPassageLinks(database, opportunityId, question, MAX_PASSAGE_LINKS) : [];
  const base = [...anchored.context_links, ...passages];
  return { ...anchored, context_links: [...base, ...await dossierTaskLinks(database, opportunityId, MAX_CONTEXT_LINKS - base.length)] };
}

// El contrato admite hasta 20 referencias por trabajo; las de origen (paquete, análisis) van primero.
const MAX_CONTEXT_LINKS = 20;
const MAX_PASSAGE_LINKS = 6;
const STOPWORDS = new Set(('para pero como cual cuales cuando donde desde hasta hacia entre sobre esta este estos estas ese esos esas '
  + 'tiene tienen tenemos hace hacer puede pueden podemos debe deben debemos favor quiero quisiera saber dime digame '
  + 'nuestra nuestro nuestros nuestras ellos ellas usted ustedes algo algun alguna algunos todo todos toda todas '
  + 'porque pues tambien solo cada otra otro otros otras mismo misma ante tras segun sino aqui alli entonces ahora '
  + 'licitacion proceso vigia que hay son fue ser esta estan').split(/\s+/));
const DATE_QUESTION = /\b(cu[aá]ndo|fecha|fechas|plazo|plazos|hasta|vence|vencen|cronograma|d[ií]a)\b/i;

/** Términos de búsqueda de una pregunta: raíces de las palabras de 4 o más letras que no son de relleno, más "cronograma" si pregunta por fechas. */
export function passageSearchTerms(question) {
  const plain = String(question || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = [...new Set(plain.match(/[a-z0-9%]{4,}/g) || [])].filter(word => !STOPWORDS.has(word));
  if (DATE_QUESTION.test(question || '')) words.push('cronograma');
  // Raíz de 6 letras: "presentar" encuentra "presentación", "observación" encuentra "observaciones".
  return [...new Set(words.map(word => (/^\d/.test(word) ? word : word.slice(0, 6))))].slice(0, 12);
}

/**
 * Fragmentos de los documentos vigentes que mejor responden la pregunta (126). Sin esto Vig-IA solo veía
 * el análisis, que puede tener huecos: el 2026-10-13 el análisis perdió el cronograma de la Resolución
 * 00390. Un vínculo por documento (el contrato no repite recursos), con el nombre del documento como
 * etiqueta para que Vig-IA cite la fuente. Si la búsqueda falla, la Mesa sigue sin fragmentos.
 */
export async function documentPassageLinks(database, opportunityId, question, room) {
  const terms = passageSearchTerms(question);
  if (room <= 0 || terms.length === 0 || typeof database?.rpc !== 'function') return [];
  let rows;
  try {
    const { data, error } = await database.rpc('psi_search_tender_document_passages', { p_opportunity_id: opportunityId, p_terms: terms });
    if (error || !Array.isArray(data)) return [];
    rows = data;
  } catch {
    return [];
  }
  return rows
    .filter(row => typeof row?.document_version_id === 'string' && /^[0-9a-f-]{36}$/i.test(row.document_version_id) && Number(row.score) >= 20)
    .sort((a, b) => Number(b.score) - Number(a.score))
    .slice(0, room)
    .map(row => ({
      kind: 'source',
      id: row.document_version_id.toLowerCase(),
      label: compact(`Documento del proceso: ${row.name || 'sin nombre'}`, 300),
      source_ref: compact(`Fragmento: ${row.excerpt || ''}`, 1000),
    }));
}
const ARTIFACT_REVIEW = { pendiente: 'por revisar', aprobado: 'aprobado', rechazado: 'rechazado' };
const MAX_SOURCE_REF = 1000;
const CONTENT_TRUNCATED = ' […contenido recortado]';

/**
 * Vínculo del documento sobre el que se pide un borrador, derivado en el servidor desde el
 * expediente de la oportunidad —nunca del body— junto con la versión vigente que la RPC terminal va
 * a comparar. El responder exige exactamente un vínculo `artifact` para la capacidad `draft` y de
 * ahí saca el `artifact_id` del resultado, así que aquí falla cerrado: un documento que no está en
 * este expediente no produce vínculo y el mensaje se rechaza antes de encolar nada, en vez de
 * encolar un trabajo que reventaría después del claim sin contexto de artefacto. La lectura es la
 * del expediente, filtrada por oportunidad en el propio RPC, así que no hay forma de anclar un
 * borrador a un documento de otra licitación.
 *
 * `source_ref` lleva el contenido vigente dentro del tope de 1000 caracteres del contrato y marca
 * el recorte cuando no cabe, para que Vig-IA redacte sobre lo que hay y pueda declarar lo que no
 * alcanzó a ver en vez de rellenarlo.
 */
export async function dossierArtifactLink(database, opportunityId, artifactId) {
  if (typeof database?.rpc !== 'function') throw new TypeError('database.rpc es obligatorio.');
  const { data, error } = await database.rpc('psi_get_tender_dossier_workspace', { p_opportunity_id: opportunityId });
  if (error) throw error;
  const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
  const artifact = artifacts.find(row => typeof row?.id === 'string' && row.id.toLowerCase() === artifactId);
  if (!artifact) {
    throw apiError('El documento del borrador no pertenece a este expediente.', 404, 'AGT002_WORKBENCH_NOT_FOUND');
  }
  const current = artifact.current_version;
  const currentVersionId = typeof current?.id === 'string' ? current.id.toLowerCase() : null;
  // El tope de 1000 caracteres de `source_ref` es el presupuesto con el que Vig-IA ve el documento,
  // así que la procedencia no repite lo que ya dice la etiqueta: cada carácter gastado en el
  // encabezado es un carácter menos del contenido real. Con el encabezado corto, el Anexo 7 de
  // Terminal —940 caracteres compactados, el más largo de los once puestos a mano— llega entero.
  const head = compact([
    `estado ${ARTIFACT_REVIEW[artifact.review_status] || artifact.review_status}`,
    currentVersionId ? `versión vigente ${current.version}` : 'sin versión registrada',
  ].join(' · '), 300);
  const content = compact(current?.content_text || '', MAX_SOURCE_REF);
  const prefix = `${head} · contenido: `;
  const room = MAX_SOURCE_REF - prefix.length;
  return {
    currentVersionId,
    link: {
      kind: 'artifact',
      id: artifactId,
      label: compact(`Documento de la oferta: ${artifact.title || 'sin título'}`, 300),
      source_ref: !content
        ? `${head} · sin contenido que tomar como base`
        : content.length <= room
          ? `${prefix}${content}`
          : `${prefix}${content.slice(0, room - CONTENT_TRUNCATED.length).trimEnd()}${CONTENT_TRUNCATED}`,
    },
  };
}

const REJECTION_MARK = /\s*[—-]\s*CAUSA RECHAZO\s*$/i;
const TASK_STATUS = { pendiente: 'pendiente', en_progreso: 'en progreso', bloqueado: 'bloqueada', listo: 'lista' };
const compact = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Sin contexto Vig-IA respondía a ciegas: solo veía el mensaje y dos identificadores. Las tareas
 * abiertas del expediente (lo que causa rechazo primero, luego por fecha) viajan como referencias
 * `requirement`, derivadas en el servidor en cada lectura y cada mensaje, igual que el resto de la
 * referencia: el cliente no puede agregarlas ni cambiarlas. Si el expediente no se puede leer, la
 * Mesa sigue con la referencia mínima.
 */
export async function dossierTaskLinks(database, opportunityId, room) {
  if (room <= 0 || typeof database?.rpc !== 'function') return [];
  let workspace;
  try {
    const { data, error } = await database.rpc('psi_get_tender_dossier_workspace', { p_opportunity_id: opportunityId });
    if (error) return [];
    workspace = data;
  } catch {
    return [];
  }
  const items = (Array.isArray(workspace?.checklist) ? workspace.checklist : [])
    .filter(item => item && item.applicability !== 'no_aplica' && item.status !== 'listo' && !(item.item_type === 'documento' && item.origin === 'seed_go'))
    .filter(item => typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && typeof item.title === 'string' && item.title.trim());
  items.sort((a, b) => Number(REJECTION_MARK.test(b.title)) - Number(REJECTION_MARK.test(a.title))
    || String(a.target_date || '9999-12-31').localeCompare(String(b.target_date || '9999-12-31')));
  return items.slice(0, room).map(item => ({
    kind: 'requirement',
    id: item.id.toLowerCase(),
    label: compact(item.title, 300),
    source_ref: compact([
      `Tarea del expediente · estado ${TASK_STATUS[item.status] || item.status}`,
      `responsable ${item.assignee_name || 'sin asignar'}`,
      `fecha ${item.target_date || 'sin fecha'}`,
      item.latest_evidence ? `soporte: ${item.latest_evidence.kind === 'url' ? item.latest_evidence.url : item.latest_evidence.text}` : 'sin soporte',
      item.instruction ? `detalle: ${item.instruction.replace(/Cargado por Vig-IA[^\n]*/g, '')}` : '',
    ].filter(Boolean).join(' · '), 1000),
  }));
}

/**
 * Job event types the append-only log admits (migration 045) mapped to the status the human
 * surface may act on. `released` is a re-queue (retry or expired-lease sweep), so it reads as
 * queued again. `failed` is the only retryable status, and it is the only one the composer
 * offers a retry for, because `psi_retry_agt002_workbench_job` accepts exactly that event.
 *
 * `stale` is terminal but deliberately NOT mapped to `failed`: both of its emitters (045)
 * raise it when the dossier artifact moved past the job's frozen `base_version_id`, and the
 * job row is append-only, so re-queueing it would re-run against the same stale base version
 * and go stale again on every attempt. Offering a retry there would promise a recovery the
 * system cannot deliver; the real recovery is a new message over the current version, which
 * the composer already supports. So it gets its own visible terminal status instead.
 */
const JOB_EVENT_STATUS = Object.freeze({
  queued: 'queued',
  released: 'queued',
  claimed: 'in_progress',
  completed: 'completed',
  failed: 'failed',
  stale: 'obsolete',
});

/**
 * Truthful job status from the job's latest event, which migration 070 projects into the read
 * RPC as `latest_event_type` (ordered created_at desc, id desc — the same ordering the claim and
 * lease sweep already use). Fails conservatively: an unknown or missing event type is never
 * reported as `completed` (that would assert a terminal result nobody persisted) and never as
 * `failed` (that would offer a retry the database would refuse); it degrades to `in_progress`.
 *
 * Every projected status is server-owned: `status` is assigned after the spread, so a stored
 * column of the same name could never override it.
 */
function projectJobStatus(workbench) {
  const jobs = Array.isArray(workbench?.jobs) ? workbench.jobs : [];
  return jobs.map(job => {
    const latest = typeof job?.latest_event_type === 'string' ? job.latest_event_type : null;
    return {
      ...job,
      // Normalizados a null cuando la lectura no los trae (base sin 070 aplicada), para que
      // el contrato servido sea el mismo en ambos casos y el cliente no reciba `undefined`.
      latest_event_type: latest,
      latest_event_at: typeof job?.latest_event_at === 'string' ? job.latest_event_at : null,
      status: (latest !== null && Object.hasOwn(JOB_EVENT_STATUS, latest))
        ? JOB_EVENT_STATUS[latest]
        : 'in_progress',
    };
  });
}

export async function getAgt002WorkbenchApi(database, opportunityId, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  const id = uuid(opportunityId, 'opportunity_id');
  return mapped(async () => {
    // The thread is bootstrapped first and idempotently: the RPC re-asserts the actor's
    // permission and the recorded GO decision in the database, so a pre-GO or unauthorised
    // case never reaches the Mesa read below, and a fresh case is never left thread-less.
    const thread = await getOrCreateAgt002WorkbenchThread(database, { opportunityId: id, actorId });
    const threadId = uuid(thread?.id, 'thread_id');
    const workbench = await getAgt002Workbench(database, { opportunityId: id, actorId });
    const reference = await resolveCanonicalReference(database, id, { dossierContext: options.dossierContext === true });
    // Server-owned fields are assigned after the spread on purpose: neither the stored
    // workbench payload nor anything a client could influence may override the gate, the
    // bootstrapped thread, the projected job status or the canonical reference.
    return {
      ...(workbench || {}),
      enabled: true,
      thread_id: threadId,
      jobs: projectJobStatus(workbench),
      reference,
    };
  });
}

/**
 * Queues one human message. The provenance the job freezes — `snapshot_id` and
 * `context_links` — is derived server-side on EVERY post, from the same canonical loader and
 * context builder the GET uses, and it overwrites whatever the body carried: a client that
 * replays a stale reference, or forges one pointing at another dossier, cannot move the job
 * off the case's current canonical analysis, nor fork its idempotency key (which is hashed
 * over the derived snapshot, never the body's). The body keys stay accepted for compatibility
 * and are still rejected when malformed, so an obviously broken client fails loudly instead of
 * silently having its input ignored.
 *
 * The reference is resolved exactly once per request, so if the canonical analysis was promoted
 * between the GET the operator saw and this POST, the job is frozen on ONE internally coherent
 * current reference — snapshot, canonical run and links all from the same run — never a mix.
 *
 * Un borrador (`draft.v1`) nombra además el documento del expediente que va a escribir. El cliente
 * sólo manda su identificador: la etiqueta, la procedencia y el contenido vigente del vínculo los
 * deriva el servidor del expediente, igual que el resto de la referencia, y el pedido se rechaza si
 * ese documento no es de esta oportunidad o si la versión que el cliente vio ya no es la vigente.
 */
export async function postAgt002MessageApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  exactBody(body, MESSAGE_KEYS, MESSAGE_OPTIONAL_KEYS);
  const opportunityId = uuid(body.opportunity_id, 'opportunity_id');
  const threadId = uuid(body.thread_id, 'thread_id');
  const messageId = uuid(body.client_message_id, 'client_message_id');
  // Validated for shape, then discarded: the server-derived reference replaces it below.
  uuid(body.snapshot_id, 'snapshot_id');
  const baseVersionId = uuid(body.base_version_id, 'base_version_id', true);
  const capabilityId = capability(body.capability_id);
  const artifactId = uuid(Object.hasOwn(body, 'artifact_id') ? body.artifact_id : null, 'artifact_id', true);
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 12000 || !Array.isArray(body.context_links)) {
    throw apiError('content o context_links no es válido.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  // Un borrador tiene que decir sobre qué documento se escribe; cualquier otra capacidad que lo
  // mande está equivocada y se rechaza en vez de ignorarlo en silencio.
  if (capabilityId === AGT002_WORKBENCH_CAPABILITIES.draft) {
    if (!artifactId) {
      throw apiError('Un borrador requiere el documento del expediente que va a escribir.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
    }
  } else if (artifactId) {
    throw apiError('artifact_id sólo aplica a la capacidad de borrador.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return mapped(async () => {
    const anchor = artifactId ? await dossierArtifactLink(database, opportunityId, artifactId) : null;
    // El control optimista de la versión vive en la RPC terminal, que ante un desajuste registra
    // `stale` y no escribe. Se comprueba además aquí, con la versión vigente del momento, para que
    // una pantalla desactualizada reciba una respuesta que se puede leer en vez de un trabajo que
    // nace condenado y gasta una llamada al modelo. La guarda de la RPC sigue intacta: cubre lo que
    // cambie entre este POST y el final del trabajo.
    if (anchor && anchor.currentVersionId !== baseVersionId) {
      throw apiError(
        'El documento cambió de versión mientras se pedía el borrador; vuelva a abrir el expediente.',
        409, 'AGT002_WORKBENCH_STALE_ARTIFACT',
      );
    }
    const reference = await resolveCanonicalReference(database, opportunityId, {
      dossierContext: options.dossierContext === true,
      question: body.content,
      artifactLink: anchor?.link ?? null,
    });
    const idempotencyKey = computeAgt002WorkbenchIdempotencyKey({
      threadId,
      originMessageId: messageId,
      snapshotId: reference.snapshot_id,
      capabilityId,
      contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
      policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
      baseVersionId,
    });
    return appendAgt002HumanMessage(database, {
      opportunityId,
      actorId,
      threadId,
      messageId,
      content: body.content.trim(),
      contextLinks: reference.context_links,
      idempotencyKey,
      contractVersion: AGT002_WORKBENCH_CONTRACT_VERSION,
      policyVersion: AGT002_WORKBENCH_POLICY_VERSION,
      capabilityId,
      snapshotId: reference.snapshot_id,
      baseVersionId,
    });
  });
}

export async function postAgt002RetryApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_USE);
  exactBody(body, RETRY_KEYS);
  return mapped(() => retryAgt002WorkbenchJob(database, {
    opportunityId: uuid(body.opportunity_id, 'opportunity_id'),
    actorId,
    jobId: uuid(body.job_id, 'job_id'),
  }));
}

export async function postAgt002LearningReviewApi(database, body, currentProfile, options = {}) {
  assertEnabled(options);
  const actorId = actor(currentProfile, ACTIONS.LICITACIONES_WORKBENCH_CUSTODY);
  exactBody(body, REVIEW_KEYS);
  if (!['approved', 'rejected'].includes(body.decision)) {
    throw apiError('decision no es válida.', 400, 'AGT002_WORKBENCH_BAD_REQUEST');
  }
  return mapped(() => reviewAgt002LearningProposal(database, {
    opportunityId: uuid(body.opportunity_id, 'opportunity_id'),
    actorId,
    proposalId: uuid(body.proposal_id, 'proposal_id'),
    decision: body.decision,
    scope: body.scope,
    comment: body.comment,
  }));
}
