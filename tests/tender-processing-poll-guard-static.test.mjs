import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// Regression: the 10-second tender processing poll used to call loadProcessingStatus
// unconditionally on every tick, even after the job reached a terminal status (completed,
// cancelled, needs_attention, awaiting_analysis_authorization, no_job). It must only keep
// polling for the initial discovery tick (processingStatusRef.current is still null) or while
// the last known status is still active per isTenderProcessingActive.
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

function extractBalanced(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === openChar) depth += 1;
    else if (source[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  throw new Error('no se pudo balancear la expresión');
}

const IMPORT_PATTERN = /import\s*\{[^}]*\bisTenderProcessingActive\b[^}]*\}\s*from\s*['"]\.\/tenders\/processingStatus['"]/;
assert.match(main, IMPORT_PATTERN, 'main.tsx debe importar isTenderProcessingActive desde ./tenders/processingStatus');

const panelStart = main.indexOf('function TenderDocumentReviewPanel(');
assert.ok(panelStart >= 0, 'debe existir TenderDocumentReviewPanel');
const panelEnd = main.indexOf('\nfunction TenderOfferPreparationPanel(', panelStart);
assert.ok(panelEnd > panelStart, 'debe poder acotarse el cuerpo de TenderDocumentReviewPanel');
const coordinator = main.slice(panelStart, panelEnd);

const setIntervalMarker = 'window.setInterval(';
const markerIndex = coordinator.indexOf(setIntervalMarker);
assert.ok(markerIndex >= 0, 'debe existir el sondeo periódico de estado de procesamiento (window.setInterval)');
const openParenIndex = markerIndex + setIntervalMarker.length - 1;
const intervalCall = extractBalanced(coordinator, openParenIndex, '(', ')');

assert.ok(
  !intervalCall.includes('() => void loadProcessingStatus().catch(() => undefined)'),
  'el sondeo de 10s ya no debe invocar loadProcessingStatus sin condicionarlo al estado conocido',
);

// La guarda puede escribirse accediendo directamente a processingStatusRef.current, o
// asignándolo primero a una variable local (p. ej. `const status = processingStatusRef.current;`)
// y usando esa variable en un `if (...) return;` de cortocircuito equivalente.
const aliasMatch = intervalCall.match(/const\s+(\w+)\s*=\s*processingStatusRef\.current\s*;/);
const ref = aliasMatch ? aliasMatch[1] : 'processingStatusRef\\.current';

assert.match(
  intervalCall,
  new RegExp(`(?:${ref}\\s*===\\s*null|!${ref}\\b|${ref}\\s*!==\\s*null\\s*&&[^;]*\\)\\s*return\\s*;)`),
  'el sondeo de 10s debe seguir descubriendo el estado inicial cuando el estado conocido es null',
);
assert.match(
  intervalCall,
  new RegExp(`isTenderProcessingActive\\(\\s*${ref}\\.status\\s*\\)`),
  'el sondeo de 10s solo debe seguir llamando a loadProcessingStatus mientras isTenderProcessingActive(...status) sea true para el estado conocido',
);
assert.match(
  intervalCall,
  /void loadProcessingStatus\(\)\.catch\(/,
  'el sondeo de 10s debe conservar la llamada (condicionada) a loadProcessingStatus',
);

console.log('tender-processing-poll-guard-static passed');
