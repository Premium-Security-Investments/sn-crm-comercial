import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { buildTenderDocumentExtractionRpcParams } from '../tender-document-extraction-persistence.js';

const ids = {
  opportunity: '77777777-7777-4777-8777-777777777777',
  tender: '88888888-8888-4888-8888-888888888888',
  version: '99999999-9999-4999-8999-999999999999',
  actor: '11111111-1111-4111-8111-111111111111',
};

const text = 'A🙂B';
const textHash = createHash('sha256').update(text, 'utf8').digest('hex');

// UTF-16 code units vs. Unicode code points diverge for this text: the emoji
// is a surrogate pair, so .length (16) and the spread (code points) disagree.
assert.equal(text.length, 4, 'UTF-16 code unit length should be 4');
assert.equal([...text].length, 3, 'Unicode code point count should be 3');

await (async function charCountReflectsUnicodeCodePointsNotUtf16Units() {
  const extraction = {
    status: 'ok',
    text,
    extractor_version: 'tender-document-text-extraction@2',
    parser: 'pdf-parse',
    text_hash: textHash,
    metadata: {},
  };
  const params = buildTenderDocumentExtractionRpcParams(extraction, {
    opportunityId: ids.opportunity, tenderId: ids.tender, documentVersionId: ids.version, actorId: ids.actor,
  });
  assert.equal(params.p_char_count, 3, 'p_char_count debe contar puntos de código Unicode, no unidades UTF-16');
  assert.equal(params.p_text_byte_count, Buffer.byteLength(text, 'utf8'), 'p_text_byte_count debe ser el conteo de bytes UTF-8');
})();

console.log('AGT-002 unicode char count contract passed');
