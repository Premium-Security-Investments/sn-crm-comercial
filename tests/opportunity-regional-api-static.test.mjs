import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const api = readFileSync('api/[...path].js', 'utf8');
const server = readFileSync('server/index.js', 'utf8');

for (const [name, code] of [['api/[...path].js', api], ['server/index.js', server]]) {
  assert.match(
    code,
    /import\s*\{[^}]*\bregionalForOpportunityWrite\b[^}]*\}\s*from\s*['"][^'"]*regional-options(?:\.js)?['"];/,
    `${name} should import regionalForOpportunityWrite from regional-options`
  );

  const ensureMatch = code.match(/async function ensureOpportunityAccess\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(ensureMatch, `${name} should define ensureOpportunityAccess`);
  assert.match(
    ensureMatch[0],
    /\.select\((['"`])[^'"`]*\bregional_nombre\b[^'"`]*\1\)/,
    `${name} ensureOpportunityAccess should select regional_nombre`
  );

  const cleanMatch = code.match(/function cleanOpportunity\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(cleanMatch, `${name} should define cleanOpportunity`);
  assert.match(
    cleanMatch[0].match(/function cleanOpportunity\(([^)]*)\)/)[1],
    /existingRegional/,
    `${name} cleanOpportunity should accept an existingRegional parameter`
  );
  assert.match(
    cleanMatch[0],
    /regionalForOpportunityWrite\(/,
    `${name} cleanOpportunity should call regionalForOpportunityWrite`
  );

  assert.match(
    code,
    /app\.post\(['"]\/api\/opportunities['"][\s\S]*?cleanOpportunity\(req\.body\)/,
    `${name} POST /api/opportunities should call cleanOpportunity(req.body)`
  );
  assert.match(
    code,
    /app\.put\(['"]\/api\/opportunities\/:id['"][\s\S]*?cleanOpportunity\(req\.body,\s*existing\.regional_nombre\)/,
    `${name} PUT /api/opportunities/:id should call cleanOpportunity(req.body, existing.regional_nombre)`
  );
}

console.log('opportunity regional api static checks passed');
