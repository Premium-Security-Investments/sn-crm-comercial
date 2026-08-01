import { buildAgt002LegalSource } from './agt002-legal-corpus.js';
import {
  computeAgt002LegalManifestContentHash,
  validateAgt002LegalManifest,
} from './scripts/validate_agt002_legal_corpus.mjs';

const VERSION_FIELDS = 'id,corpus_version,status,content_sha256,published_at,published_by';
const SOURCE_FIELDS = [
  'corpus_version_id', 'source_id', 'norm_type', 'norm_number', 'year',
  'article_or_section', 'current_text', 'issuing_authority', 'issued_at',
  'effective_from', 'effective_to', 'modifications', 'official_url', 'topic',
  'sector', 'verified_at', 'verification_status', 'validity_status',
  'applicability_status',
].join(',');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function databaseError(response, fallback) {
  if (response?.error) throw new Error(response.error.message || String(response.error));
  if (!response || !Array.isArray(response.data)) throw new Error(fallback);
  return response.data;
}

// PostgreSQL/Supabase `timestamptz` columns are read back with a `+00:00` offset and an
// explicit (usually midnight) time component instead of the canonical, date-only string that
// was originally published — e.g. `1993-10-28` round-trips as `1993-10-28T00:00:00+00:00`.
// This normalizes that DB representation back to the canonical ISO form (date-only when the
// UTC time is exactly midnight, otherwise `Z`-suffixed) so the reconstructed manifest hashes
// identically to what was published, without broadening the canonical date contract itself.
const PG_UTC_TIMESTAMPTZ_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?\+00:00$/;
const DATE_FIELDS = ['issued_at', 'effective_from', 'effective_to', 'verified_at'];

function normalizePgTimestamptz(value) {
  if (typeof value !== 'string') return value;
  const match = PG_UTC_TIMESTAMPTZ_RE.exec(value);
  if (!match) return value;
  const [, datePart, timePart, fraction] = match;
  if (timePart === '00:00:00' && (!fraction || /^\.0+$/.test(fraction))) {
    return datePart;
  }
  const millis = fraction ? fraction.slice(0, 4) : '';
  return `${datePart}T${timePart}${millis}Z`;
}

function normalizeSourceRowDates(row) {
  const normalized = { ...row };
  for (const field of DATE_FIELDS) {
    if (field in normalized) normalized[field] = normalizePgTimestamptz(normalized[field]);
  }
  return normalized;
}

/**
 * Loads the only active, human-published legal corpus through an injected
 * service-role Supabase client. It never reads a local fixture or the network.
 */
export async function loadPublishedAgt002LegalCorpus(database) {
  if (!database || typeof database.from !== 'function') {
    throw new Error('Se requiere un cliente de base de datos para cargar el corpus jurídico publicado.');
  }

  const versions = databaseError(
    await database.from('psi_agt002_legal_corpus_versions')
      .select(VERSION_FIELDS)
      .eq('status', 'published'),
    'No fue posible leer las versiones del corpus jurídico.',
  );
  if (versions.length === 0) throw new Error('No hay ninguna versión publicada del corpus jurídico.');
  if (versions.length > 1) throw new Error('Hay más de una versión publicada del corpus jurídico.');

  const version = versions[0];
  if (!version || version.status !== 'published' || typeof version.id !== 'string' || !version.id
      || typeof version.corpus_version !== 'string' || !version.corpus_version
      || typeof version.published_at !== 'string' || !version.published_at
      || typeof version.published_by !== 'string' || !version.published_by) {
    throw new Error('La versión jurídica seleccionada no es una versión publicada válida.');
  }
  if (typeof version.content_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(version.content_sha256)) {
    throw new Error('La versión jurídica publicada no tiene un hash SHA-256 válido.');
  }

  const sourceRows = databaseError(
    await database.from('psi_agt002_legal_sources')
      .select(SOURCE_FIELDS)
      .eq('corpus_version_id', version.id),
    'No fue posible leer las fuentes del corpus jurídico publicado.',
  );
  if (sourceRows.length === 0) throw new Error('La versión publicada del corpus jurídico no contiene fuentes.');
  if (sourceRows.some(row => row?.corpus_version_id !== version.id)) {
    throw new Error('La consulta del corpus jurídico devolvió fuentes de otra versión.');
  }

  const sources = sourceRows.map((row) => {
    const { corpus_version_id: ignored, ...source } = normalizeSourceRowDates(row);
    return buildAgt002LegalSource({ ...source, corpus_version: version.corpus_version });
  }).sort((left, right) => left.source_id.localeCompare(right.source_id));
  const corpus = { corpus_version: version.corpus_version, sources };
  validateAgt002LegalManifest(corpus);

  const computedHash = computeAgt002LegalManifestContentHash(corpus);
  if (computedHash !== version.content_sha256) {
    throw new Error('El hash del corpus jurídico publicado no coincide con sus fuentes.');
  }

  return deepFreeze({
    legal_corpus_version_id: version.id,
    corpus_version: version.corpus_version,
    content_sha256: version.content_sha256,
    corpus,
  });
}
