import { strict as assert } from 'node:assert';
import {
  extractLegalRequirements,
  extractFinancialRequirements,
  extractTechnicalRequirements,
  crosscheckCompanyProfile,
  buildRequirementAnalysis,
} from '../tender-requirement-extraction.js';

const financialComplete = {
  id: 'doc-financial-complete',
  name: 'Estudios-previos.pdf',
  document_type: 'estudios_previos',
  content: 'El proponente debe acreditar un capital de trabajo no inferior a $500.000.000 al cierre del último ejercicio fiscal.',
};
const legalPartialWithPercentage = {
  id: 'doc-legal-partial-pct',
  name: 'Pliego-poliza.pdf',
  document_type: 'pliego',
  content: 'Se exige póliza de cumplimiento por el 15% del valor del contrato, según la entidad contratante.',
};
const technicalIndication = {
  id: 'doc-technical-indication',
  name: 'Anexo-tecnico.pdf',
  document_type: 'anexo_tecnico',
  content: 'El alcance del servicio incluye monitoreo mediante CCTV y control de acceso en las sedes designadas por la entidad.',
};
const noSignalDocument = {
  id: 'doc-no-signal',
  name: 'Cronograma.pdf',
  document_type: 'otro',
  content: 'El cronograma del proceso contempla audiencias y plazos de traslado, sin referencias adicionales.',
};

// ---- crosscheckCompanyProfile (§13.2) ----

// 1. Valores comparables producen match.
{
  const { requirements } = extractFinancialRequirements([financialComplete]);
  const [withCrosscheck] = crosscheckCompanyProfile(requirements, { working_capital: 600000000 });
  assert.equal(withCrosscheck.company_crosscheck.status, 'match');
  assert.match(withCrosscheck.company_crosscheck.company_evidence, /600000000/);
}

// 2. Falta de vigencia/precisión produce partial (dato en ambos lados, requisito parcial).
{
  const { requirements } = extractLegalRequirements([legalPartialWithPercentage]);
  const policy = requirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.equal(policy.status, 'partial');
  const [withCrosscheck] = crosscheckCompanyProfile([policy], { guarantee_capacity_pct: 20 });
  assert.equal(withCrosscheck.company_crosscheck.status, 'partial');
}

// 2b. Sin ficha disponible produce unavailable.
{
  const { requirements } = extractFinancialRequirements([financialComplete]);
  const [withCrosscheck] = crosscheckCompanyProfile(requirements, {});
  assert.equal(withCrosscheck.company_crosscheck.status, 'unavailable');
}

// 3. Diferencia comprobable produce gap.
{
  const { requirements } = extractFinancialRequirements([financialComplete]);
  const [withCrosscheck] = crosscheckCompanyProfile(requirements, { working_capital: 300000000 });
  assert.equal(withCrosscheck.company_crosscheck.status, 'gap');
  assert.match(withCrosscheck.company_crosscheck.company_evidence, /300000000/);
}

// 4. Texto parecido sin unidad comparable no produce match.
{
  const { requirements } = extractTechnicalRequirements([technicalIndication]);
  const videoSurveillance = requirements.find(requirement => requirement.id === 'technical-video-surveillance-scope');
  const [withCrosscheck] = crosscheckCompanyProfile([videoSurveillance], {
    notes: 'Contamos con CCTV y monitoreo propio en todas nuestras sedes.',
  });
  assert.equal(withCrosscheck.company_crosscheck.status, 'unavailable');
  assert.notEqual(withCrosscheck.company_crosscheck.status, 'match');
}

// ---- buildRequirementAnalysis (§10 + regla severity→critical de §6) ----

// 5. Bloqueador crítico pendiente genera pregunta crítica; parcial no crítico no la genera igual.
{
  const analysis = buildRequirementAnalysis([legalPartialWithPercentage, noSignalDocument], { guarantee_capacity_pct: 20 });
  const financialQuestion = analysis.questions.find(question => question.id === 'financial-working-capital');
  assert.ok(financialQuestion, 'financial working capital pending must produce a question');
  assert.equal(financialQuestion.critical, true, 'critical severity + pending status must mark the question critical');
  assert.ok(analysis.blockers.some(blocker => blocker.includes('Capital de trabajo')), 'pending critical requirement must appear as a blocker');

  const legalQuestion = analysis.questions.find(question => question.id === 'legal-guarantee-policy');
  assert.ok(legalQuestion, 'partial legal requirement must still produce a question');
}

// 6. Todo confirmado y ficha que cumple: fortalezas no vacías, sin bloqueadores, next_action sin pendientes.
{
  const analysis = buildRequirementAnalysis([financialComplete], { working_capital: 600000000 });
  assert.ok(analysis.strengths.length >= 1, 'a matching crosscheck must produce at least one strength');
  const financialBlockers = analysis.blockers.filter(blocker => blocker.includes('Capital de trabajo'));
  assert.equal(financialBlockers.length, 0, 'a confirmed, matching requirement must not be a blocker');
}

// 7. coverage refleja conteos correctos.
{
  const analysis = buildRequirementAnalysis([financialComplete, legalPartialWithPercentage, technicalIndication], {});
  assert.equal(analysis.coverage.confirmed, 1, 'financial working capital is confirmed');
  assert.equal(analysis.coverage.partial, 1, 'legal guarantee policy is partial');
  assert.equal(analysis.coverage.indication, 1, 'technical video surveillance is an indication');
  assert.equal(analysis.coverage.total, 3);
}

// 8. Determinismo: reordenar documentos no cambia el resultado.
{
  const forward = buildRequirementAnalysis([financialComplete, legalPartialWithPercentage, technicalIndication], { working_capital: 600000000, guarantee_capacity_pct: 20 });
  const reversed = buildRequirementAnalysis([technicalIndication, legalPartialWithPercentage, financialComplete], { guarantee_capacity_pct: 20, working_capital: 600000000 });
  assert.deepEqual(forward, reversed);
}

// 9. No se inventa taxonomía GO/NO GO: ningún campo debe mencionar GO/NO GO/recomendación.
{
  const analysis = buildRequirementAnalysis([financialComplete, legalPartialWithPercentage, technicalIndication], {});
  const serialized = JSON.stringify(analysis);
  assert.doesNotMatch(serialized, /\bGO\b/);
  assert.doesNotMatch(serialized, /NO GO/);
  assert.doesNotMatch(serialized, /recomendaci[oó]n/i);
  assert.ok(!Object.hasOwn(analysis, 'risk'));
  assert.ok(!Object.hasOwn(analysis, 'recommendation'));
}

console.log('tender requirement analysis wave 2 passed');
