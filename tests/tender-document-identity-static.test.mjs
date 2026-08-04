import fs from 'node:fs';
import assert from 'node:assert/strict';

const paths = ['../server/index.js', '../api/[...path].js'];

for (const path of paths) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');

  assert.match(source, /import\s*\{[^}]*deterministicDocumentFallbackId[^}]*\}\s*from\s*['"]\.\.\/tender-document-versioning\.js['"]/, `${path} must import deterministicDocumentFallbackId`);
  assert.match(source, /import\s*\{[^}]*canonicalizeTenderDocuments[^}]*\}\s*from\s*['"]\.\.\/tender-document-canonicalizer\.js['"]/, `${path} must import canonicalizeTenderDocuments`);

  // esuDocumentId must never fall back to Date.now() -- that was the source of a fresh
  // non-deterministic source_document_id (and a fresh duplicate "current" row) on
  // every refresh whenever a document had neither a matching /procesos/descargar/<id>
  // URL nor a name.
  const esuDocumentIdBody = source.match(/function esuDocumentId\(doc\)\s*\{[\s\S]*?\n\}/);
  assert.ok(esuDocumentIdBody, `${path} must still define esuDocumentId`);
  assert.doesNotMatch(esuDocumentIdBody[0], /Date\.now\(\)/, `${path} esuDocumentId must not fall back to Date.now()`);
  assert.match(esuDocumentIdBody[0], /deterministicDocumentFallbackId/, `${path} esuDocumentId must delegate its fallback to the deterministic helper`);

  // The SECOP fallback (used both in the synchronous refresh path and the durable
  // worker's discoverDocuments) must prefer the stable filename over the
  // tokenized/expiring download URL when SECOP's own id_documento is absent.
  const secopFallbackSites = source.match(/doc\.id_documento \|\| deterministicDocumentFallbackId\(\{ name: doc\.nombre_archivo, url[^}]*\}\)/g) || [];
  assert.ok(secopFallbackSites.length >= 2, `${path} must use the deterministic, filename-preferring SECOP fallback at both call sites (found ${secopFallbackSites.length})`);
  assert.doesNotMatch(source, /createHash\('sha256'\)\.update\(String\(doc\.url_descarga_documento\.url\)\)/, `${path} must no longer hash the raw tokenized SECOP URL as sole fallback`);
  assert.doesNotMatch(source, /createHash\('sha256'\)\.update\(String\(url\)\)\.digest\('hex'\)\.slice\(0, 24\)\)\s*\n\s*: esuDocumentId/, `${path} discoverDocuments must no longer hash the raw SECOP URL as sole fallback`);

  // chunkDocuments feeds AGT-002's chunker directly from "current" typed document
  // versions -- it must run through the canonicalizer barrier first so duplicate
  // current rows (same content, different source_document_id) never reach analysis.
  const chunkDocumentsBody = source.match(/chunkDocuments: async \(\{[^}]*\}\) => \{[\s\S]*?buildAgt002DocumentChunks\(documents\)/);
  assert.ok(chunkDocumentsBody, `${path} must still define chunkDocuments feeding buildAgt002DocumentChunks`);
  assert.match(chunkDocumentsBody[0], /canonicalizeTenderDocuments/, `${path} chunkDocuments must canonicalize current document versions before chunking`);
}

console.log('server/index.js and api/[...path].js use deterministic document identity and canonicalize documents before analysis');
