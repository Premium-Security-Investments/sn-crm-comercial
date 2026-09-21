import { strict as assert } from 'node:assert';
import { safeCliError } from '../scripts/agt002-backfill-legacy-document-extractions.mjs';

const rawText = 'Contenido confidencial del pliego con palabras, espacios y puntuación.';
const error = new Error(`Supabase rechazó: ${rawText}`);
error.status = 500;
error.code = 'PGRST500';

const result = safeCliError(error);
assert.deepEqual(result, { status: 'failed', error_code: 'PGRST500', http_status: 500 });

const serialized = JSON.stringify(result);
assert.equal(serialized.includes(error.message), false, 'el mensaje crudo completo no debe viajar en la salida');
assert.equal(serialized.includes('Contenido confidencial'), false, 'el texto confidencial no debe viajar en la salida');

console.log('AGT-002 legacy backfill CLI error sanitization contract passed');
