#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAgt002LegalSource, AGT002_LEGAL_RESOLUTION_STATUSES } from '../agt002-legal-corpus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'data', 'agt002', 'legal-corpus-v1.1.json');

const MANIFEST_KEYS = ['corpus_version', 'sources'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalizeValue(value[key])]),
  );
}

/** Stable JSON used to bind an imported manifest to its published DB version. */
export function canonicalizeAgt002LegalManifest(manifest) {
  if (!isRecord(manifest)) throw new Error('El manifiesto jurídico debe ser un objeto.');
  const normalized = {
    ...manifest,
    ...(Array.isArray(manifest.sources)
      ? { sources: [...manifest.sources].sort((left, right) => String(left?.source_id ?? '').localeCompare(String(right?.source_id ?? ''))) }
      : {}),
  };
  return JSON.stringify(canonicalizeValue(normalized));
}

export function computeAgt002LegalManifestContentHash(manifest) {
  const normalizedSources = validateAgt002LegalManifest(manifest);
  const normalizedManifest = {
    corpus_version: manifest.corpus_version,
    sources: normalizedSources,
  };
  return createHash('sha256').update(canonicalizeAgt002LegalManifest(normalizedManifest)).digest('hex');
}

/**
 * Network-independent, offline validator for the curated AGT-002 legal corpus manifest. Reuses
 * Task29's contract (buildAgt002LegalSource) instead of duplicating field-level validation, and
 * additionally enforces manifest-level invariants: closed top-level shape, single corpus_version
 * shared by the manifest and every source, unique source_id, and no source that mixes an
 * unverified/uncertain state with an otherwise "fully certain" combination of the other two axes.
 */
export function validateAgt002LegalManifest(manifest) {
  if (!isRecord(manifest)) throw new Error('El manifiesto debe ser un objeto.');
  const unknown = Object.keys(manifest).filter(key => !MANIFEST_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(`El manifiesto contiene una clave no permitida o desconocida: ${unknown.sort().join(', ')}.`);
  }

  if (typeof manifest.corpus_version !== 'string' || !manifest.corpus_version.trim()) {
    throw new Error('corpus_version del manifiesto debe ser texto no vacío.');
  }

  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('sources debe ser una lista no vacía de fuentes normativas.');
  }

  const seenSourceIds = new Set();
  const normalized = manifest.sources.map((raw, index) => {
    const built = buildAgt002LegalSource(raw);

    for (const modification of raw.modifications ?? []) {
      if (!AGT002_LEGAL_RESOLUTION_STATUSES.includes(modification.resolution_status)) {
        throw new Error(
          `sources[${index}] (${built.source_id}) tiene una modificación con resolution_status desconocido: ${String(modification.resolution_status)}.`,
        );
      }
    }

    if (seenSourceIds.has(built.source_id)) {
      throw new Error(`source_id duplicado en el manifiesto: ${built.source_id}.`);
    }
    seenSourceIds.add(built.source_id);

    if (built.corpus_version !== manifest.corpus_version) {
      throw new Error(
        `sources[${index}] (${built.source_id}) tiene corpus_version «${built.corpus_version}» que no coincide con la del manifiesto «${manifest.corpus_version}».`,
      );
    }

    // Una fuente no verificada no puede simultáneamente presentarse con vigencia y aplicabilidad
    // ya confirmadas/aplicables: eso maquillaría incertidumbre real como certeza. La verificación
    // (verification_status) es el eje que sustenta que la lectura de vigencia/aplicabilidad es
    // fiable; sin ella, ambas quedan obligadas a degradarse a un estado no definitivo.
    if (built.verification_status !== 'verified'
      && built.validity_status === 'confirmed'
      && built.applicability_status === 'applicable') {
      throw new Error(
        `sources[${index}] (${built.source_id}) declara validity_status=confirmed y applicability_status=applicable sin verification_status=verified; la incertidumbre no puede presentarse como derecho verificado.`,
      );
    }

    return built;
  });

  const corpusVersions = new Set(normalized.map(source => source.corpus_version));
  if (corpusVersions.size > 1) {
    throw new Error(`El manifiesto mezcla corpus_version distintas entre fuentes: ${[...corpusVersions].sort().join(', ')}.`);
  }

  return normalized;
}

export function loadAgt002LegalManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateAgt002LegalManifest(raw);
  return raw;
}

function runCli() {
  const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST_PATH;
  try {
    const manifest = loadAgt002LegalManifest(manifestPath);
    console.log(`OK: ${manifestPath} válido — ${manifest.sources.length} fuente(s), corpus_version=${manifest.corpus_version}.`);
    process.exit(0);
  } catch (error) {
    console.error(`INVÁLIDO: ${manifestPath}`);
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
