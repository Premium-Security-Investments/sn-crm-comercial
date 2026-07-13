import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/main.tsx', 'utf8');

assert.match(source, /const SIIO_BOARD_DRAFT_CONFIRMATION = /, 'SIIO board draft confirmation text must be centralized');
assert.match(source, /window\.confirm\(SIIO_BOARD_DRAFT_CONFIRMATION\)/, 'Generate board draft must ask for explicit browser confirmation');
assert.match(source, /if \(!confirmed\) return;/, 'Generate board draft must stop when user cancels');
assert.match(source, /Esto creará o actualizará un borrador de junta mensual/, 'Confirmation copy must explain that it creates or updates a monthly board draft');
assert.match(source, /requiere validación humana/, 'Confirmation copy must state that the draft requires human validation');
assert.match(source, /api\('\/api\/siio\/board-reports\/generate-draft'/, 'Generate board draft endpoint must remain wired');

console.log('sensitive action confirmations OK');
