import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AGT002_SECTION_PROPOSALS_ARTIFACT_TYPE,
  AGT002_SECTION_PROPOSALS_STATUS,
  AGT002_SECTION_PROPOSAL_REFS,
  AGT002_REQUIREMENT_KINDS,
  AGT002_OFFER_STAGES,
  AGT002_EVIDENCE_NEEDS,
  AGT002_PROPOSAL_SUBSANABILITY,
  AGT002_SECTION_PROPOSALS,
  buildAgt002PreGoSectionProposals,
  validateAgt002PreGoSectionProposals,
  buildAgt002SectionProposalOverlayIndex,
  iterateProposalRequirements,
} from '../agt002-pre-go-section-proposals.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

const GENERATED_AT = '2026-08-12T00:00:00.000Z';
const REGISTRY_PATH = resolve(process.cwd(), 'docs/governance/registro/manizales-sa-24-2026.registry.json');
const PLIEGO_TXT = '/tmp/agt002-rama-originals/db9752a1-e9ee-49af-b321-883d0c23cf0a.full.txt';

const TARGET_REFS = ['2.3', '2.4', '2.4.1', '2.5', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6'];

function loadRegistry() {
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}
function build() {
  return buildAgt002PreGoSectionProposals({ registry: loadRegistry(), generatedAt: GENERATED_AT });
}

test('the ten target refs are declared exactly (no more, no less)', () => {
  assert.deepEqual([...AGT002_SECTION_PROPOSAL_REFS].sort(), [...TARGET_REFS].sort());
  assert.equal(AGT002_SECTION_PROPOSAL_REFS.length, 10);
});

test('artifact covers exactly the ten pre-GO sections with no governed requirement', () => {
  const artifact = build();
  const refs = artifact.sections.map(s => s.item_ref).sort();
  assert.deepEqual(refs, [...TARGET_REFS].sort());
  // Every covered ref must be a real registry section AND currently carry no governed requirement.
  const registry = loadRegistry();
  const byRef = new Map(registry.items.map(i => [i.ref, i]));
  for (const s of artifact.sections) {
    const item = byRef.get(s.item_ref);
    assert.ok(item, `${s.item_ref} existe en el registro`);
    assert.equal((item.governed_requirement_ids || []).length, 0, `${s.item_ref} no tiene requisito gobernado`);
    assert.ok(s.requirements.length >= 1, `${s.item_ref} atomiza al menos un requisito`);
  }
});

test('requirement ids are unique, deterministic (semantic proposal:<ref>:<slug>) and encode their ref', () => {
  const artifact = build();
  const ids = [];
  for (const { section, requirement } of iterateProposalRequirements(artifact)) {
    ids.push(requirement.requirement_id);
    assert.match(requirement.requirement_id, /^proposal:[0-9.]+:[a-z0-9-]+$/, requirement.requirement_id);
    assert.ok(requirement.requirement_id.startsWith(`proposal:${section.item_ref}:`),
      `${requirement.requirement_id} codifica su ref ${section.item_ref}`);
    assert.equal(requirement.item_ref, section.item_ref);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  // Determinismo: reconstruir produce exactamente los mismos ids en el mismo orden.
  const again = build();
  const ids2 = [...iterateProposalRequirements(again)].map(x => x.requirement.requirement_id);
  assert.deepEqual(ids2, ids);
});

test('every requirement uses only closed controlled vocabularies', () => {
  const artifact = build();
  for (const { requirement: r } of iterateProposalRequirements(artifact)) {
    assert.ok(AGT002_REQUIREMENT_KINDS.includes(r.requirement_kind), r.requirement_kind);
    assert.ok(AGT002_OFFER_STAGES.includes(r.offer_stage), r.offer_stage);
    assert.ok(AGT002_EVIDENCE_NEEDS.includes(r.evidence_need), r.evidence_need);
    assert.ok(AGT002_PROPOSAL_SUBSANABILITY.includes(r.subsanability.candidate), r.subsanability.candidate);
    assert.equal(r.status, AGT002_SECTION_PROPOSALS_STATUS);
  }
});

test('candidate evidence class is null or one of the 17 governed classes; never invented', () => {
  const artifact = build();
  for (const { requirement: r } of iterateProposalRequirements(artifact)) {
    if (r.candidate_evidence_class_id !== null) {
      assert.ok(AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(r.candidate_evidence_class_id),
        `${r.requirement_id} -> ${r.candidate_evidence_class_id} debe estar en el catálogo de 17`);
    }
  }
});

test('no arbitrary mapping: entity rules and rule-only evidence needs carry NO company evidence class; CCTV never forced', () => {
  const artifact = build();
  for (const { requirement: r } of iterateProposalRequirements(artifact)) {
    if (r.requirement_kind === 'regla_entidad') {
      assert.equal(r.candidate_evidence_class_id, null, `${r.requirement_id} regla_entidad sin clase`);
    }
    if (r.evidence_need === 'regla_sin_evidencia_empresarial') {
      assert.equal(r.candidate_evidence_class_id, null, `${r.requirement_id} regla_sin_evidencia sin clase`);
    }
    // No se reutiliza la clase inexistente de videovigilancia (Pereira sólo es patrón/lección).
    assert.ok(!/video|cctv|surveillance/i.test(String(r.candidate_evidence_class_id)), r.requirement_id);
  }
});

test('the differential/discapacidad/mujeres/mipyme sections are modelled distinctly (not collapsed)', () => {
  const artifact = build();
  const kindsByRef = Object.fromEntries(artifact.sections.map(s => [s.item_ref, s.requirements.map(r => r.requirement_kind)]));
  // capacidad organizacional -> habilitante presente
  assert.ok(kindsByRef['2.3'].includes('habilitante'));
  // experiencia -> tiene una regla de sumatoria/plural separada (condicional/regla), no sólo el habilitante
  assert.ok(artifact.sections.find(s => s.item_ref === '2.4').requirements.some(r => r.requirement_kind !== 'habilitante'));
  // criterios diferenciales de experiencia -> condicionales (mujeres/mipyme/discapacidad) separados
  assert.ok(artifact.sections.find(s => s.item_ref === '2.4.1').requirements.filter(r => r.requirement_kind === 'condicional').length >= 3);
  // subsanabilidad y factor económico método -> regla_entidad
  assert.ok(artifact.sections.find(s => s.item_ref === '2.5').requirements.every(r => r.requirement_kind === 'regla_entidad'));
  assert.ok(artifact.sections.find(s => s.item_ref === '3.6').requirements.some(r => r.requirement_kind === 'regla_entidad'));
  // oferta económica -> puntuable con anexo económico
  assert.ok(artifact.sections.find(s => s.item_ref === '3.6').requirements.some(r => r.evidence_need === 'oferta_economica_anexo'));
});

test('citations are corporeal (within the registry body span, not the TOC) and internally consistent', () => {
  const artifact = build();
  const registry = loadRegistry();
  const byRef = new Map(registry.items.map(i => [i.ref, i]));
  for (const { section, requirement: r } of iterateProposalRequirements(artifact)) {
    const item = byRef.get(section.item_ref);
    const c = r.source_citation;
    assert.equal(c.document_id, registry.vigente_pliego.document_id);
    assert.ok(Number.isInteger(c.char_start) && Number.isInteger(c.char_end));
    assert.ok(c.char_end > c.char_start, 'rango positivo');
    // Corporeal: dentro del span del cuerpo de la sección en el pliego vigente (el TOC vive en offsets bajos).
    assert.ok(c.char_start >= item.cite.char_start, `${r.requirement_id} cita >= inicio de sección`);
    assert.ok(c.char_end <= item.cite.char_end, `${r.requirement_id} cita <= fin de sección`);
    // Consistencia interna: la longitud de la cita coincide con el rango declarado.
    assert.equal(typeof c.quote, 'string');
    assert.equal(c.quote.length, c.char_end - c.char_start, `${r.requirement_id} quote length == rango`);
    assert.ok(c.quote.trim().length > 0);
  }
});

test('(real) every citation matches the real pliego body verbatim when the offline text is present', () => {
  if (!existsSync(PLIEGO_TXT)) return; // el cuerpo del pliego es un insumo offline; sin él, se omite
  const raw = readFileSync(PLIEGO_TXT, 'utf8');
  const artifact = build();
  for (const { requirement: r } of iterateProposalRequirements(artifact)) {
    const c = r.source_citation;
    assert.equal(raw.slice(c.char_start, c.char_end), c.quote, `${r.requirement_id} cita verbatim del cuerpo`);
  }
});

test('every requirement is a proposal pending human approval, never an approved override', () => {
  const artifact = build();
  assert.equal(artifact.status, AGT002_SECTION_PROPOSALS_STATUS);
  assert.equal(artifact.status, 'proposed_for_human_review');
  assert.equal(artifact.human_approval_required, true);
  assert.equal(artifact.is_approved, false);
  for (const { requirement: r } of iterateProposalRequirements(artifact)) {
    assert.equal(r.status, 'proposed_for_human_review');
    assert.notEqual(r.status, 'approved');
    // Compuertas humanas de aplicabilidad y suficiencia presentes y sin decidir.
    assert.equal(r.applicability_gate.decision, 'human_required');
    assert.equal(r.sufficiency_gate.decision, 'human_required');
  }
});

test('artifact is PII-clean and revalidates fail-closed', () => {
  const artifact = build();
  assertNoOpenPii(artifact);
  assert.equal(validateAgt002PreGoSectionProposals(artifact), artifact);
  assert.equal(artifact.artifact_type, AGT002_SECTION_PROPOSALS_ARTIFACT_TYPE);
});

test('validation rejects a class outside the 17-catalog (fail-closed)', () => {
  const poisoned = {
    ...build(),
    sections: [{
      item_ref: '2.3', titulo: 'x', fase: 'habilitante',
      requirements: [{
        ...AGT002_SECTION_PROPOSALS.find(s => s.item_ref === '2.3').requirements[0],
        candidate_evidence_class_id: 'not-a-real-class',
      }],
    }],
  };
  assert.throws(() => validateAgt002PreGoSectionProposals(poisoned), /17|catálogo/i);
});

test('overlay index maps each covered ref to its proposed requirement ids (for the pre-GO block)', () => {
  const artifact = build();
  const overlay = buildAgt002SectionProposalOverlayIndex(artifact);
  assert.deepEqual([...overlay.keys()].sort(), [...TARGET_REFS].sort());
  for (const ref of TARGET_REFS) {
    const entry = overlay.get(ref);
    assert.equal(entry.status, 'proposed_for_human_review');
    assert.ok(entry.requirement_ids.length >= 1);
    assert.equal(entry.requirement_count, entry.requirement_ids.length);
  }
});

test('generatedAt is required and must be a valid ISO timestamp (deterministic, no clock)', () => {
  const registry = loadRegistry();
  assert.throws(() => buildAgt002PreGoSectionProposals({ registry }), /generatedAt/);
  assert.throws(() => buildAgt002PreGoSectionProposals({ registry, generatedAt: 'nope' }), /generatedAt/);
});

test('build fails closed if a declared ref is missing from the registry', () => {
  const registry = loadRegistry();
  const trimmed = { ...registry, items: registry.items.filter(i => i.ref !== '3.6') };
  assert.throws(() => buildAgt002PreGoSectionProposals({ registry: trimmed, generatedAt: GENERATED_AT }), /3\.6/);
});
