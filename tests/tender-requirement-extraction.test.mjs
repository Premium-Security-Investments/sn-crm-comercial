import { strict as assert } from 'node:assert';
import {
  extractLegalRequirements,
  extractFinancialRequirements,
  extractTechnicalRequirements,
} from '../tender-requirement-extraction.js';

const legalGuaranteeComplete = {
  id: 'doc-legal-complete',
  name: 'Pliego.pdf',
  document_type: 'pliego',
  content: 'El proponente debe constituir póliza de cumplimiento por el 20% del valor del contrato con vigencia de 12 meses contados desde la firma del contrato.',
};
const legalGuaranteePartial = {
  id: 'doc-legal-partial',
  name: 'Pliego-anexo.pdf',
  document_type: 'pliego',
  content: 'Se exige póliza de cumplimiento del contrato, según lo dispuesto por la entidad contratante.',
};
const financialWorkingCapitalComplete = {
  id: 'doc-financial-complete',
  name: 'Estudios-previos.pdf',
  document_type: 'estudios_previos',
  content: 'El proponente debe acreditar un capital de trabajo no inferior a $500.000.000 al cierre del último ejercicio fiscal.',
};
const financialWorkingCapitalPartial = {
  id: 'doc-financial-partial',
  name: 'Estudios-previos-anexo.pdf',
  document_type: 'estudios_previos',
  content: 'Se debe demostrar capital de trabajo suficiente para la ejecución del contrato.',
};
const technicalCctvIndication = {
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
const emptyDocument = { id: 'doc-empty', name: 'Escaneo-ilegible.pdf', document_type: 'otro', content: '' };

// 1. Jurídico confirma póliza completa y deja parcial una mención sin cuantía/vigencia.
{
  const { requirements } = extractLegalRequirements([legalGuaranteeComplete, noSignalDocument]);
  const policy = requirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.equal(policy.status, 'confirmed');
  assert.equal(policy.severity, 'critical');
  assert.equal(policy.confidence, 'high');
  assert.equal(policy.question, null);
  assert.ok(policy.values.some(value => value.kind === 'percentage'));
  assert.ok(policy.values.some(value => value.kind === 'duration'));
  assert.ok(policy.evidence.length >= 1);
  assert.equal(policy.evidence[0].document_id, 'doc-legal-complete');

  const { requirements: partialRequirements } = extractLegalRequirements([legalGuaranteePartial]);
  const partialPolicy = partialRequirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.equal(partialPolicy.status, 'partial');
  assert.equal(partialPolicy.confidence, 'medium');
  assert.ok(typeof partialPolicy.question === 'string' && partialPolicy.question.length > 0);

  const { requirements: pendingRequirements } = extractLegalRequirements([noSignalDocument]);
  const pendingPolicy = pendingRequirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.equal(pendingPolicy.status, 'pending');
  assert.deepEqual(pendingPolicy.evidence, []);
  assert.ok(typeof pendingPolicy.question === 'string' && pendingPolicy.question.length > 0);
}

// 2. Financiero confirma indicador con operador y umbral; deja parcial el nombre aislado.
{
  const { requirements } = extractFinancialRequirements([financialWorkingCapitalComplete]);
  const workingCapital = requirements.find(requirement => requirement.id === 'financial-working-capital');
  assert.equal(workingCapital.status, 'confirmed');
  assert.equal(workingCapital.severity, 'critical');
  assert.ok(workingCapital.values.some(value => value.kind === 'money'));
  assert.equal(workingCapital.question, null);

  const { requirements: partialRequirements } = extractFinancialRequirements([financialWorkingCapitalPartial]);
  const partialWorkingCapital = partialRequirements.find(requirement => requirement.id === 'financial-working-capital');
  assert.equal(partialWorkingCapital.status, 'partial');
  assert.ok(typeof partialWorkingCapital.question === 'string' && partialWorkingCapital.question.length > 0);
}

// 3. Técnico produce indicio con confianza y no lo etiqueta como cumplimiento.
{
  const { requirements } = extractTechnicalRequirements([technicalCctvIndication]);
  const videoSurveillance = requirements.find(requirement => requirement.id === 'technical-video-surveillance-scope');
  assert.equal(videoSurveillance.status, 'indication');
  assert.notEqual(videoSurveillance.status, 'confirmed');
  assert.ok(['low', 'medium', 'high'].includes(videoSurveillance.confidence));
  assert.match(videoSurveillance.rationale, /indicio/i);

  const { requirements: pendingRequirements } = extractTechnicalRequirements([noSignalDocument]);
  const pendingVideoSurveillance = pendingRequirements.find(requirement => requirement.id === 'technical-video-surveillance-scope');
  assert.equal(pendingVideoSurveillance.status, 'pending');
}

// 4. Evidencias repetidas se deduplican.
{
  const repeatedParagraph = 'Cláusula de garantías del contrato de prestación de servicios. El proponente debe constituir póliza de cumplimiento por el 20% del valor del contrato con vigencia de 12 meses contados desde la firma del contrato.';
  const repeatedMentionDocument = {
    id: 'doc-legal-repeated',
    name: 'Pliego-repetido.pdf',
    document_type: 'pliego',
    content: `${repeatedParagraph}\n\n${repeatedParagraph}`,
  };
  const { requirements } = extractLegalRequirements([repeatedMentionDocument]);
  const policy = requirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.equal(policy.evidence.length, 1, 'coincidencias idénticas del mismo documento deben deduplicarse');
}

// 5. El resultado no cambia al reordenar documentos.
{
  const forward = extractLegalRequirements([legalGuaranteeComplete, legalGuaranteePartial, noSignalDocument]);
  const reversed = extractLegalRequirements([noSignalDocument, legalGuaranteePartial, legalGuaranteeComplete]);
  assert.deepEqual(forward, reversed);

  const financialForward = extractFinancialRequirements([financialWorkingCapitalComplete, financialWorkingCapitalPartial]);
  const financialReversed = extractFinancialRequirements([financialWorkingCapitalPartial, financialWorkingCapitalComplete]);
  assert.deepEqual(financialForward, financialReversed);
}

// 6. Documento sin texto aparece como no verificable.
{
  const legal = extractLegalRequirements([legalGuaranteeComplete, emptyDocument]);
  const financial = extractFinancialRequirements([financialWorkingCapitalComplete, emptyDocument]);
  const technical = extractTechnicalRequirements([technicalCctvIndication, emptyDocument]);
  for (const result of [legal, financial, technical]) {
    assert.deepEqual(result.unverifiable_documents, [{ document_id: 'doc-empty', name: 'Escaneo-ilegible.pdf' }]);
  }
}

// 7. Fragmentos quedan acotados.
{
  const longDocument = {
    id: 'doc-legal-long',
    name: 'Pliego-extenso.pdf',
    document_type: 'pliego',
    content: `${'Antecedente extenso del proceso licitatorio. '.repeat(40)}El proponente debe constituir póliza de cumplimiento por el 20% del valor del contrato con vigencia de 12 meses. ${'Cláusula adicional de cierre del pliego. '.repeat(40)}`,
  };
  const { requirements } = extractLegalRequirements([longDocument]);
  const policy = requirements.find(requirement => requirement.id === 'legal-guarantee-policy');
  assert.ok(policy.evidence.length >= 1);
  for (const evidence of policy.evidence) {
    assert.ok(evidence.excerpt.length <= 160, `el fragmento debe quedar acotado, longitud actual ${evidence.excerpt.length}`);
  }
  assert.ok(policy.evidence[0].excerpt.length < longDocument.content.length);
}

console.log('tender requirement extraction wave 1 passed');
