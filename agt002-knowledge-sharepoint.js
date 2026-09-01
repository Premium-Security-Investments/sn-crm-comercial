// AGT-002 knowledge — SharePoint publication (design §16, §19.6).
//
// `publishTenderKnowledgeVersion` is the only mechanism allowed to write the
// governed corporate knowledge library. The relative path is always
// `<scope_type>/<knowledge_item_id>.md` under the exact corporate root —
// never derived from the human title. It never fabricates a publication when
// the Graph/SharePoint adapter is unavailable (fail-closed §16.4), and it
// reconciles an existing remote item by deterministic path + rendered
// content instead of creating a duplicate drive item on retry (§16.1, §17).

const LIBRARY_ROOT = 'Comercial/Licitaciones/02 Biblioteca corporativa';
const SCOPE_TYPES = new Set(['general', 'regional', 'cliente', 'tipo_servicio']);
const CONFIDENTIALITY_VALUES = new Set(['interno', 'restringido']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireField(value, message) {
  if (!nonEmptyString(value)) throw new Error(`invalid_review_input: ${message}`);
}

function buildKnowledgeRelativePath(scopeType, knowledgeItemId) {
  if (!SCOPE_TYPES.has(scopeType)) {
    throw new Error(`invalid_review_input: scope_type inválido para publicación (${scopeType}).`);
  }
  if (!UUID_RE.test(String(knowledgeItemId))) {
    throw new Error('invalid_review_input: knowledge_item_id debe ser un UUID para publicación.');
  }
  return `${scopeType}/${knowledgeItemId}.md`;
}

function assertSharePointUrl(webUrl) {
  if (!nonEmptyString(webUrl)) {
    throw new Error('sharepoint_publication_invalid: falta la URL de SharePoint publicada.');
  }
  let parsed;
  try {
    parsed = new URL(webUrl);
  } catch {
    throw new Error('sharepoint_publication_invalid: la URL de SharePoint no es válida.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('sharepoint_publication_invalid: la URL de SharePoint debe ser HTTPS.');
  }
  if (!parsed.hostname.toLowerCase().endsWith('.sharepoint.com')) {
    throw new Error(`sharepoint_publication_invalid: host no reconocido como SharePoint (${parsed.hostname}).`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error('sharepoint_publication_invalid: la URL de SharePoint no admite query ni enlaces firmados/fragmento.');
  }
  return parsed;
}

// Deterministic curated Markdown (§16.2): header, scope, validity, review
// date, reusable summary, tags, confidentiality, responsible and opaque SIIO
// references. No attachment links, signed URLs, secrets or storage paths.
function renderKnowledgeMarkdown(input) {
  const tags = Array.isArray(input.tags) ? input.tags : [];
  return [
    `# ${input.title}`,
    '',
    `- Alcance: ${input.scopeType}${input.scopeValue ? ` (${input.scopeValue})` : ''}`,
    `- Vigente desde: ${input.validFrom}`,
    `- Vigente hasta: ${input.validUntil || 'Sin vencimiento'}`,
    `- Próxima revisión: ${input.reviewOn}`,
    `- Confidencialidad: ${input.confidentiality}`,
    `- Responsable: ${input.responsibleProfileName}`,
    `- Etiquetas: ${tags.length ? tags.join(', ') : 'Ninguna'}`,
    '',
    '## Resumen reutilizable',
    '',
    input.reusableSummary,
    '',
    '## Referencias SIIO',
    '',
    `- knowledge_item_id: ${input.knowledgeItemId}`,
    `- knowledge_version_id: ${input.knowledgeVersionId}`,
    `- content_hash: ${input.contentHash}`,
    '',
  ].join('\n');
}

export async function publishTenderKnowledgeVersion(input) {
  const { adapter } = input || {};
  if (!adapter || typeof adapter.createOrUpdate !== 'function') {
    throw new Error('sharepoint_publication_unavailable: SharePoint no está configurado (no configurado).');
  }

  requireField(input.knowledgeItemId, 'knowledge_item_id es obligatorio.');
  requireField(input.knowledgeVersionId, 'knowledge_version_id es obligatorio.');
  requireField(input.title, 'title es obligatorio.');
  requireField(input.reusableSummary, 'reusable_summary es obligatorio.');
  requireField(input.validFrom, 'valid_from es obligatorio.');
  requireField(input.reviewOn, 'review_on es obligatorio.');
  requireField(input.responsibleProfileName, 'responsible_profile_name es obligatorio.');
  requireField(input.contentHash, 'content_hash es obligatorio.');
  requireField(input.actorId, 'actorId (aprobador humano) es obligatorio para publicar; no hay publicación automática.');
  if (!CONFIDENTIALITY_VALUES.has(input.confidentiality)) {
    throw new Error(`invalid_review_input: confidentiality inválida (${input.confidentiality}).`);
  }

  const relativePath = buildKnowledgeRelativePath(input.scopeType, input.knowledgeItemId);
  const content = renderKnowledgeMarkdown(input);

  const existing = typeof adapter.get === 'function' ? await adapter.get({ relativePath }) : null;
  if (existing) assertSharePointUrl(existing.webUrl);

  // Explicit If-Match from the caller (§16.1) is trusted as-is. With no
  // previousETag — a retry after a local failure of unknown remote outcome —
  // reconcile against whatever is already published at the deterministic
  // path: identical content is treated as the same logical publication;
  // divergent content requires a fresh human confirmation instead of a
  // silent overwrite.
  let expectedETag = input.previousETag;
  if (expectedETag === undefined && existing) {
    if (existing.content === content) {
      expectedETag = existing.eTag;
    } else {
      throw new Error(`sharepoint_publication_conflict: ya existe contenido distinto en ${relativePath}; requiere confirmación humana explícita (reconciliación por eTag).`);
    }
  }

  let record;
  try {
    record = await adapter.createOrUpdate({ relativePath, content, expectedETag });
  } catch (error) {
    if (error && error.code === 'etag_conflict') {
      const remote = typeof adapter.get === 'function' ? await adapter.get({ relativePath }) : null;
      if (remote) assertSharePointUrl(remote.webUrl);
      if (remote && remote.content === content) {
        record = remote;
      } else {
        throw new Error(`sharepoint_publication_conflict: conflicto de eTag en ${relativePath}; el contenido remoto difiere y requiere nueva confirmación humana (reconciliación).`);
      }
    } else {
      throw error;
    }
  }

  assertSharePointUrl(record.webUrl);

  if (input.simulateLocalFailureAfterRemoteSuccess) {
    throw new Error('knowledge_publication_local_persistence_failed: SharePoint confirmó la escritura pero la persistencia local falló; el reintento reconcilia por ruta/hash, nunca crea otra publicación.');
  }

  return {
    library_root: LIBRARY_ROOT,
    relative_path: relativePath,
    web_url: record.webUrl,
    drive_item_id: record.driveItemId,
    e_tag: record.eTag,
    sharepoint_version: record.sharepointVersion,
    content_hash: input.contentHash,
  };
}

export { LIBRARY_ROOT, buildKnowledgeRelativePath };
