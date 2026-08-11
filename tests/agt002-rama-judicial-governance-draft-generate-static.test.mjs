import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Static, source-level check (never imports the script — it requires real Supabase
// credentials and is read-only-but-network-calling; see
// tests/agt002-governance-draft-proposal-runtime-isolation-static.test.mjs for the
// runtime-isolation guarantee) that the HR-003 curated tables in
// scripts/agt002-rama-judicial-governance-draft-generate.mjs actually reflect the human
// decisions in docs/governance/2026-08-11-agt002-rama-judicial-human-review.md: the two
// closed split legal requirements replace the generic legal-guarantee-policy for this
// governed draft, working-capital stays habilitating/rup, and both CCTV abstentions
// survive untouched.
const source = readFileSync(new URL('../scripts/agt002-rama-judicial-governance-draft-generate.mjs', import.meta.url), 'utf8');

test('the generator no longer curates the generic legal-guarantee-policy requirement', () => {
  const curatedTablesSection = source.slice(source.indexOf('const CATEGORY_OVERRIDE_PROPOSALS'), source.indexOf('async function main'));
  assert.doesNotMatch(curatedTablesSection, /requirement_id:\s*'legal-guarantee-policy'/);
});

test('HR-003: legal-rce-policy is curated as habilitating, linked to the rce_policy evidence class', () => {
  const categorySection = source.slice(source.indexOf('const CATEGORY_OVERRIDE_PROPOSALS'), source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'));
  assert.match(categorySection, /requirement_id:\s*'legal-rce-policy'[\s\S]{0,200}category_value:\s*'habilitating'/);

  const evidenceLinkSection = source.slice(source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'), source.indexOf('const ABSTENTIONS'));
  assert.match(evidenceLinkSection, /requirement_id:\s*'legal-rce-policy'[\s\S]{0,200}evidence_class_id:\s*'rce_policy'/);
});

test('HR-003: legal-collective-life-policy is curated as habilitating, linked to the collective_life_policy evidence class', () => {
  const categorySection = source.slice(source.indexOf('const CATEGORY_OVERRIDE_PROPOSALS'), source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'));
  assert.match(categorySection, /requirement_id:\s*'legal-collective-life-policy'[\s\S]{0,200}category_value:\s*'habilitating'/);

  const evidenceLinkSection = source.slice(source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'), source.indexOf('const ABSTENTIONS'));
  assert.match(evidenceLinkSection, /requirement_id:\s*'legal-collective-life-policy'[\s\S]{0,200}evidence_class_id:\s*'collective_life_policy'/);
});

test('HR-002/HR-003: both split legal proposals document the post-award execution-guarantee exclusion (section 110)', () => {
  const categorySection = source.slice(source.indexOf('const CATEGORY_OVERRIDE_PROPOSALS'), source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'));
  const rceBlock = categorySection.slice(categorySection.indexOf("requirement_id: 'legal-rce-policy'"), categorySection.indexOf("requirement_id: 'legal-collective-life-policy'"));
  const lifeBlock = categorySection.slice(categorySection.indexOf("requirement_id: 'legal-collective-life-policy'"));
  for (const block of [rceBlock, lifeBlock]) {
    assert.match(block, /ejecuci[oó]n del contrato/i);
    assert.match(block, /adjudicaci[oó]n/i);
  }
});

test('HR-001: financial-working-capital stays habilitating, linked to rup', () => {
  const categorySection = source.slice(source.indexOf('const CATEGORY_OVERRIDE_PROPOSALS'), source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'));
  assert.match(categorySection, /requirement_id:\s*'financial-working-capital'[\s\S]{0,200}category_value:\s*'habilitating'/);

  const evidenceLinkSection = source.slice(source.indexOf('const EVIDENCE_CLASS_LINK_PROPOSALS'), source.indexOf('const ABSTENTIONS'));
  assert.match(evidenceLinkSection, /requirement_id:\s*'financial-working-capital'[\s\S]{0,200}evidence_class_id:\s*'rup'/);
});

test('HR-004: both technical-video-surveillance-scope abstentions (category_override and evidence_class_link) survive unchanged', () => {
  const abstentionsSection = source.slice(source.indexOf('const ABSTENTIONS'), source.indexOf('async function main'));
  const occurrences = abstentionsSection.match(/requirement_id:\s*'technical-video-surveillance-scope'/g) || [];
  assert.equal(occurrences.length, 2, 'expected exactly two technical-video-surveillance-scope abstentions (category_override + evidence_class_link)');
  assert.match(abstentionsSection, /axis:\s*'category_override'/);
  assert.match(abstentionsSection, /axis:\s*'evidence_class_link'/);
  assert.doesNotMatch(abstentionsSection, /requirement_id:\s*'legal-rce-policy'/);
  assert.doesNotMatch(abstentionsSection, /requirement_id:\s*'legal-collective-life-policy'/);
});

test('the script imports the governed extraction entry point, not the generic v2 one', () => {
  assert.match(source, /import\s*\{\s*buildGovernedRequirementAnalysis,\s*AGT002_GOVERNED_REQUIREMENT_CITATION_PATTERNS\s*\}\s*from\s*'\.\.\/tender-requirement-extraction\.js'/);
  assert.doesNotMatch(source, /\bbuildRequirementAnalysis\(documents/);
});
