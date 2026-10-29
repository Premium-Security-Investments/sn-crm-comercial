// Un documento del que no se puede extraer texto vuelve a entrar al expediente (2026-10-29).
// La 065 fijó el contrato: `extracted_text` es NULL cuando hay hueco y no vacío cuando hay texto. La 150 lo revirtió
// sin querer al reescribir la función para agregar el origen, y desde el 23-oct todo documento `gap` fallaba
// terminal. Este test fija la 164 y el contrato, para que la próxima reescritura de la función no lo pierda otra vez.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractTenderDocumentText } from '../verticales/licitaciones/tender-document-text-extraction.js';

const migration = readFileSync(new URL('../supabase/migrations/164_documento_sin_texto_vuelve_a_entrar.sql', import.meta.url), 'utf8');
const migration065 = readFileSync(new URL('../supabase/migrations/065_tender_document_extraction_integrity.sql', import.meta.url), 'utf8');
const versioning = readFileSync(new URL('../verticales/licitaciones/tender-document-versioning.js', import.meta.url), 'utf8');

// La regla restaurada es, palabra por palabra, la de la 065.
const CONTRATO = 'El texto extraído debe ser NULL (gap) o no vacío (ok).';
assert.ok(migration065.includes(CONTRATO), 'la 065 es la fuente de la regla');
assert.ok(migration.includes(CONTRATO), 'la 164 restaura la misma regla');
assert.ok(
  migration.includes('if p_extracted_text is not null and octet_length(p_extracted_text) > 10 * 1024 * 1024 then'),
  'el límite de 10 MB deja de evaluarse sobre un NULL',
);

// Reescribe desde la definición viva y falla cerrado.
assert.match(migration, /pg_get_functiondef/);
assert.match(migration, /se esperaba 1\); revisión manual requerida/);
assert.match(migration, /La función sigue exigiendo texto extraído/);

// No toca nada de lo que agregó la 150.
assert.ok(!/alter table/i.test(migration), 'la 164 no cambia tablas');
assert.ok(!/p_origin\s+text/.test(migration), 'la 164 no redefine la firma de la 150');

// El pipeline ya manda NULL para un hueco: ése es el lado que la base tenía que aceptar.
assert.ok(
  versioning.includes("typedExtraction?.status === 'ok'"),
  'tender-document-versioning sólo manda texto cuando la extracción es ok',
);

// Un `.doc` viejo —el caso de la Fiscalía— es justamente un hueco tipado, no un error.
const doc = await extractTenderDocumentText(Buffer.from('contenido binario de un .doc'), 'APENDICE Nº 1 Procedimiento Subasta Electronica en el SECOP II.doc', 'application/msword');
assert.equal(doc.status, 'gap');
assert.equal(doc.metadata.gap_reason, 'unsupported_type');

console.log('documento-sin-texto-vuelve-a-entrar: ok');
