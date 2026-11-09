// F12 (auditoría del piloto Fiscalía): en el reanálisis `fbcfbdd1` Vig-IA concluyó «no se sabe si el pliego permite
// sumar la presencia» cuando el numeral 5.3.2 lo decía: el incremental sólo leía los documentos nuevos y el análisis
// anterior, y del pliego tenía apenas el resumen. Ahora, en la síntesis de un reanálisis, cada requisito que quedó
// PENDIENTE trae el texto completo de los numerales que su evidencia citó, sacado del mismo documento, y la regla de no
// concluir «no se sabe» sin decir dónde se buscó.
import { agt002NumeralCitado, agt002SeccionDeDocumento } from './agt002-seccion-del-pliego.js';

// F12 reabierto (Fiscalía, reanálisis 856a12ae del 9-nov): el requisito de sedes estaba como BLOCKER con la duda adentro
// («no se sabe si el pliego permite sumar la presencia») y no se releyó; y con 7 pendientes y tope de 4, precio y
// experiencia gastaban el cupo antes que los habilitantes. Ahora entran BLOCKER, PENDING y cualquier requisito cuyo texto
// diga que no se sabe; primero los bloqueos, luego los habilitantes, y precio y experiencia al final.
export const AGT002_SECCIONES_PENDIENTES_MAX = 6;
export const AGT002_SECCIONES_POLICY = ' Secciones del pliego (secciones_del_pliego): traen el texto completo de los numerales que citó la evidencia de los requisitos bloqueados, pendientes o con dudas. Léalas antes de mantener un requisito como bloqueado o pendiente: si la sección resuelve la duda, actualice el requisito y cítela como {document_id, locator} con su numeral.';
export const AGT002_DONDE_BUSCO_POLICY = ' Si concluye que algo de un requisito habilitante no se sabe, falta o no está claro, diga en el texto en qué documento y numeral lo buscó; una conclusión de «no se sabe» sin decir dónde se buscó no es válida.';

const DUDA = /no se sabe|no est[aá] claro|no queda claro|no se encontr|no se pudo (?:confirmar|verificar)|por confirmar|sin confirmar/i;
// Habilitantes primero; experiencia y precio (ECONOMIC) al final.
const CATEGORY_ORDER = ['LICENSE', 'LEGAL', 'TECHNICAL', 'PERSONNEL', 'FINANCIAL', 'INSURANCE', 'TIMELINE', 'OTHER', 'EXPERIENCE', 'ECONOMIC'];
const categoryRank = category => { const index = CATEGORY_ORDER.indexOf(String(category || '')); return index === -1 ? CATEGORY_ORDER.length - 2 : index; };

/** Los numerales a leer, de los requisitos bloqueados, pendientes o con duda escrita, en orden de importancia. */
export function agt002NumeralesPendientes(prior, { max = AGT002_SECCIONES_PENDIENTES_MAX } = {}) {
  const claims = new Map((Array.isArray(prior?.claims) ? prior.claims : []).map(claim => [claim?.claim_id, claim]));
  const textOf = requirement => [requirement?.required_action, requirement?.validity_rule,
    ...[requirement?.text_claim_id, ...(Array.isArray(requirement?.evidence_claim_ids) ? requirement.evidence_claim_ids : [])]
      .map(id => claims.get(id)).flatMap(claim => [claim?.display_text, claim?.text, claim?.inference_basis])].filter(Boolean).join(' ');
  const candidates = (Array.isArray(prior?.requirements) ? prior.requirements : [])
    .map((requirement, index) => {
      const status = requirement?.company_evaluation;
      const doubt = DUDA.test(textOf(requirement));
      if (status !== 'PENDING' && status !== 'BLOCKER' && !doubt) return null;
      return { requirement, index, rank: [status === 'BLOCKER' ? 0 : doubt ? 1 : 2, categoryRank(requirement?.category)] };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index);
  const out = [];
  const seen = new Set();
  for (const { requirement } of candidates) {
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
