// F12 (auditoría del piloto Fiscalía): en el reanálisis `fbcfbdd1` Vig-IA concluyó «no se sabe si el pliego permite
// sumar la presencia» cuando el numeral 5.3.2 lo decía: el incremental sólo leía los documentos nuevos y el análisis
// anterior, y del pliego tenía apenas el resumen. Ahora, en la síntesis de un reanálisis, cada requisito que quedó
// PENDIENTE trae el texto completo de los numerales que su evidencia citó, sacado del mismo documento, y la regla de no
// concluir «no se sabe» sin decir dónde se buscó.
import { agt002NumeralCitado, agt002SeccionDeDocumento } from './agt002-seccion-del-pliego.js';

export const AGT002_SECCIONES_PENDIENTES_MAX = 4;
export const AGT002_SECCIONES_POLICY = ' Secciones del pliego (secciones_del_pliego): traen el texto completo de los numerales que citó la evidencia de los requisitos que quedaron pendientes. Léalas antes de mantener un requisito como pendiente: si la sección resuelve la duda, actualice el requisito y cítela como {document_id, locator} con su numeral.';
export const AGT002_DONDE_BUSCO_POLICY = ' Si concluye que algo de un requisito habilitante no se sabe, falta o no está claro, diga en el texto en qué documento y numeral lo buscó; una conclusión de «no se sabe» sin decir dónde se buscó no es válida.';

/** Los numerales a leer: los que citan las afirmaciones de los requisitos PENDING del análisis anterior, sin repetir. */
export function agt002NumeralesPendientes(prior, { max = AGT002_SECCIONES_PENDIENTES_MAX } = {}) {
  const claims = new Map((Array.isArray(prior?.claims) ? prior.claims : []).map(claim => [claim?.claim_id, claim]));
  const out = [];
  const seen = new Set();
  for (const requirement of Array.isArray(prior?.requirements) ? prior.requirements : []) {
    if (requirement?.company_evaluation !== 'PENDING') continue;
    const ids = [requirement.text_claim_id, ...(Array.isArray(requirement.evidence_claim_ids) ? requirement.evidence_claim_ids : [])];
    for (const id of ids) {
      for (const ref of Array.isArray(claims.get(id)?.source_refs) ? claims.get(id).source_refs : []) {
        const numeral = agt002NumeralCitado(ref?.locator);
        const key = `${ref?.document_id}#${numeral}`;
        if (!numeral || !ref?.document_id || seen.has(key)) continue;
        seen.add(key);
        out.push({ document_id: ref.document_id, numeral, requirement_id: requirement.requirement_id || null });
        if (out.length === max) return out;
      }
    }
  }
  return out;
}

/** Las secciones de esos numerales, del mismo documento. `documents`: [{ id, name, extracted_text }]. */
export function agt002SeccionesPendientes(prior, documents, options = {}) {
  const byId = new Map((documents || []).map(document => [document.id, document]));
  return agt002NumeralesPendientes(prior, options).flatMap(({ document_id, numeral, requirement_id }) => {
    const found = agt002SeccionDeDocumento({ document: byId.get(document_id), numeral });
    return found ? [{ requirement_id, numeral: found.numeral, titulo: found.titulo, document_id, documento: found.documento, recortado: found.recortado, texto: found.texto }] : [];
  });
}
