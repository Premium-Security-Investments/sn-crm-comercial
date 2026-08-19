import { resolveFindingEvidence } from '../tenderDecisionBriefModel';
import type { TenderDecisionReview, TenderDecisionReviewFinding } from '../types';

export function TenderFindingEvidence({ finding, review }: { finding: TenderDecisionReviewFinding; review: TenderDecisionReview }) {
  const evidence = resolveFindingEvidence(finding, review.review_findings);
  if (!evidence.length) return null;
  return <details className="tender-decision-brief-evidence">
    <summary>Ver evidencia</summary>
    <ul>{evidence.map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.locator}</span><p>{item.summary}</p></li>)}</ul>
  </details>;
}
