import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  buildRequirementRows, decisiveRequirementRows, otherRiskNotes, requirementSeedItems, requirementTargetDate, REQUIREMENT_ITEM_KEY_PREFIX,
  REQUIREMENT_STATUS_LABEL,
} from '../agt002-requirements-model.js';

const claim = (id, text, locator = 'Numeral 1') => ({ id, type: 'cited_fact', text, materiality: 'MATERIAL', evidenceStatus: 'SUPPORTED', inferenceBasis: null, sources: [{ documentId: 'd1', documentName: 'pliego.pdf', locator }] });
const report = {
  runId: 'run', cutoffAt: '', createdAt: '', modelProfile: '', processStatus: '', checksExecuted: true,
  recommendation: { kind: 'CONTINUE_CONDITIONAL_RECOMMENDED', label: 'Seguir con condiciones.', confidence: 'MEDIUM', limitations: [], basisClaimIds: [] },
  companyFitAuthorized: true, documents: [], deadlines: [], coverage: [],
  claims: [
    claim('CLM-GAR', 'La garantía de seriedad es obligatoria con la oferta: 10 % del presupuesto. No entregarla causa rechazo y no se puede subsanar.', 'Numeral 3.1.1.7'),
    claim('CLM-EMP-GAR', 'El perfil no registra póliza de seriedad (CLM-EMP-GAR).'),
    claim('CLM-RUP', 'El pliego exige RUP vigente y en firme, con expedición de máximo 30 días.'),
    claim('CLM-TECHOS', 'Los techos son: arrendamiento tecnológico por ítem unitario.'),
    claim('CLM-OTRO', 'Dato suelto'),
  ],
  requirements: [
    { id: 'REQ-GAR', category: 'INSURANCE', textClaimId: 'CLM-GAR', applicability: 'APPLICABLE', companyEvaluation: 'PENDING', blocker: false, requiredAction: 'Tramitar la póliza.', evidenceClaimIds: ['CLM-EMP-GAR'] },
    { id: 'REQ-RUP', category: 'LEGAL', textClaimId: 'CLM-RUP', applicability: 'APPLICABLE', companyEvaluation: 'AVAILABLE', blocker: false, requiredAction: 'Pedir un RUP nuevo.', evidenceClaimIds: [] },
    { id: 'REQ-RUP-2', category: 'LEGAL', textClaimId: 'CLM-RUP', applicability: 'APPLICABLE', companyEvaluation: 'VERIFIED', blocker: false, requiredAction: 'Nada.', evidenceClaimIds: [] },
    { id: 'REQ-TECHOS', category: 'ECONOMIC', textClaimId: 'CLM-TECHOS', applicability: 'APPLICABLE', companyEvaluation: 'PENDING', blocker: false, requiredAction: 'Armar la oferta.', evidenceClaimIds: [] },
  ],
  findings: [
    { id: 'FND-GAR', severity: 'HIGH', category: 'Jurídico', title: 'No hay garantía de seriedad', impact: 'Rechazo.', blocker: false, claimIds: ['CLM-GAR', 'CLM-EMP-GAR'] },
    { id: 'FND-MARGEN', severity: 'MEDIUM', category: 'Económico', title: 'El margen está en los servicios no regulados', impact: 'Precio.', blocker: false, claimIds: ['CLM-TECHOS'] },
    { id: 'FND-SUELTO', severity: 'MEDIUM', category: 'Otro', title: 'Hay dos versiones del anexo técnico', impact: 'Cotizar con la de octubre.', blocker: false, claimIds: ['CLM-OTRO'] },
    { id: 'FND-INFO', severity: 'INFO', category: 'Otro', title: 'Informativo', impact: '', blocker: false, claimIds: ['CLM-OTRO'] },
  ],
  openItems: [{ id: 'OI-1', kind: 'ACTION', description: 'Tramitar la garantía.', critical: true, status: 'OPEN', ownerRole: 'Financiero', dueAt: '2026-10-15T00:00:00-05:00', claimIds: ['CLM-GAR'] }],
  contradictions: [{ id: 'CTR-1', topic: 'Dos versiones del anexo técnico', impact: 'PRICE', status: 'OPEN', requiredAction: 'Pedir aclaración.', claimIds: [] }],
};

test('una fila por texto exigido: los puntos sobre el mismo requisito no se repiten', () => {
  const rows = buildRequirementRows(report);
  assert.equal(rows.length, 3);
  const rup = rows.find(row => row.key === 'CLM-RUP');
  assert.deepEqual(rup.requirementIds, ['REQ-RUP', 'REQ-RUP-2']);
  assert.equal(rup.status, 'declarado', 'la empresa dice tenerlo y falta el soporte: no es lo mismo que no saber');
  assert.equal(rup.title, 'RUP vigente y en firme');
  assert.deepEqual(rup.actions, ['Pedir un RUP nuevo.'], 'lo verificado no genera acción');
});

test('estado: lo que la empresa declara se separa de lo que no se sabe', () => {
  const rows = buildRequirementRows(report);
  assert.equal(rows.find(row => row.key === 'CLM-RUP').status, 'declarado', 'AVAILABLE = cumple, falta el soporte');
  assert.equal(rows.find(row => row.key === 'CLM-GAR').status, 'por_confirmar', 'PENDING = no se sabe');
  assert.equal(REQUIREMENT_STATUS_LABEL.declarado, 'Cumple, falta el soporte');
});

// Caso real (ESU 2026-5, Juan 2026-10-21): "el hecho de que solo se puedan presentar personas jurídicas no
// es una causal de rechazo debido a que Seguridad Nacional es una persona jurídica". El pliego habla de
// cualquier oferente; la marca es sobre nosotros.
test('lo que el pliego rechaza de otros no se marca como causa de rechazo nuestra', () => {
  const base = {
    ...report,
    claims: [claim('CLM-NO-UT', 'Solo pueden presentarse personas jurídicas. El pliego no admite uniones temporales, y la oferta conjunta es causal de rechazo.')],
    requirements: [{ id: 'REQ-NO-UT', category: 'LEGAL', textClaimId: 'CLM-NO-UT', applicability: 'APPLICABLE', companyEvaluation: 'AVAILABLE', blocker: false, requiredAction: 'Confirmar que se presenta sola.', evidenceClaimIds: [] }],
    findings: [], openItems: [], contradictions: [],
  };
  const declarado = buildRequirementRows(base)[0];
  assert.equal(declarado.status, 'declarado');
  assert.equal(declarado.rejection, false, 'nos presentamos solos: ese rechazo no nos aplica');
  assert.deepEqual(decisiveRequirementRows(buildRequirementRows(base)), [], 'y no entra en lo que puede tumbar la oferta');
  // Mientras siga abierto, la advertencia del pliego sí vale.
  const abierto = buildRequirementRows({ ...base, requirements: [{ ...base.requirements[0], companyEvaluation: 'PENDING' }] })[0];
  assert.equal(abierto.rejection, true);
  // Y un bloqueo explícito del análisis manda siempre, aunque la empresa diga que lo tiene.
  const bloqueado = buildRequirementRows({ ...base, requirements: [{ ...base.requirements[0], blocker: true }] })[0];
  assert.equal(bloqueado.rejection, true, 'el bloqueo que marca el análisis no se descarta por el estado');
});

test('causa rechazo sale del texto del pliego aunque el análisis no marque blocker', () => {
  const rows = buildRequirementRows(report);
  const garantia = rows.find(row => row.key === 'CLM-GAR');
  assert.equal(garantia.rejection, true);
  assert.equal(garantia.severity, 'HIGH');
  assert.equal(garantia.area, 'Financiero');
  assert.equal(rows[0].key, 'CLM-GAR', 'lo que causa rechazo va primero');
  assert.deepEqual(garantia.company, ['El perfil no registra póliza de seriedad.'], 'sin códigos internos');
  assert.equal(garantia.notes[0].title, 'No hay garantía de seriedad');
  assert.equal(garantia.openItems[0].text, 'Tramitar la garantía.');
});

test('un nombre que arranca a mitad de frase cede el título al hallazgo exclusivo', () => {
  const techos = buildRequirementRows(report).find(row => row.key === 'CLM-TECHOS');
  assert.equal(techos.title, 'El margen está en los servicios no regulados');
});

test('lo decisivo excluye lo cumplido; otros riesgos solo trae lo que no cuelga de un requisito, sin repetir', () => {
  const rows = buildRequirementRows(report);
  assert.deepEqual(decisiveRequirementRows(rows).map(row => row.key), ['CLM-GAR']);
  const others = otherRiskNotes(report, rows);
  assert.deepEqual(others.map(note => note.title), ['Hay dos versiones del anexo técnico'], 'la contradicción repetida y lo informativo no entran');
});

test('siembra: un ítem por requisito, con clave estable, título con área y fecha hacia atrás desde el cierre', () => {
  const rows = buildRequirementRows(report);
  const items = requirementSeedItems(rows, '2026-10-19', '2026-10-13');
  assert.equal(items.length, 3);
  const garantia = items.find(item => item.item_key === `${REQUIREMENT_ITEM_KEY_PREFIX}CLM-GAR`);
  assert.match(garantia.title, /^Financiero · .* — CAUSA RECHAZO$/);
  assert.equal(garantia.target_date, '2026-10-14', 'causa rechazo: cinco días antes del cierre');
  assert.match(garantia.instruction, /^Qué hacer: Tramitar la póliza\./);
  assert.match(garantia.instruction, /Dónde: pliego\.pdf · Numeral 3\.1\.1\.7/);
  assert.ok(items.every(item => item.required === true && !('initial_status' in item)), 'nada entra como listo sin soporte');
});

test('la fecha objetivo nunca queda antes de hoy y respeta una fecha propia anterior', () => {
  const row = { rejection: false, category: 'LEGAL', dueAt: '2026-10-15' };
  assert.equal(requirementTargetDate(row, '2026-10-19', '2026-10-13'), '2026-10-15');
  assert.equal(requirementTargetDate({ ...row, dueAt: null }, '2026-10-14', '2026-10-13'), '2026-10-13');
  assert.equal(requirementTargetDate({ ...row, dueAt: null }, null, '2026-10-13'), null);
});

test('migración 125: función solo para service_role y siembra append-only por item_key', () => {
  const sql = readFileSync(new URL('../supabase/migrations/125_tender_dossier_requirement_seed.sql', import.meta.url), 'utf8');
  for (const role of ['public', 'anon', 'authenticated']) assert.match(sql, new RegExp(`revoke all on function public\\.psi_seed_tender_dossier_requirements\\(uuid, uuid, jsonb\\) from ${role};`));
  assert.match(sql, /grant execute on function public\.psi_seed_tender_dossier_requirements\(uuid, uuid, jsonb\) to service_role;/);
  assert.match(sql, /psi_assert_tender_dossier_go\(p_opportunity_id\)/, 'solo con GO vigente');
  assert.match(sql, /on conflict \(opportunity_id, item_key\) do nothing/);
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b/i);
});

test('la instrucción de cada requisito cabe en la nota de la base (2000): un requisito largo no tumba la siembra', async () => {
  const { requirementSeedItems, REQUIREMENT_SEED_INSTRUCTION_MAX } = await import('../agt002-requirements-model.js');
  assert.equal(REQUIREMENT_SEED_INSTRUCTION_MAX, 2000);
  const long = 'x'.repeat(1500);
  const [item] = requirementSeedItems([{ key: 'r1', area: 'Jurídico', title: 'Garantía', rejection: true, status: 'por_confirmar', actions: [long], demand: long, sources: [] }], '2026-10-23', '2026-10-21');
  assert.equal(item.instruction.length, 2000);
  assert.ok(item.instruction.endsWith('…'));
});
