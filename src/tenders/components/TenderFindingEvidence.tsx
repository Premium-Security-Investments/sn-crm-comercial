import { resolveFindingEvidence } from '../tenderDecisionBriefModel';
import type { TenderDecisionReview, TenderDecisionReviewFinding } from '../types';

export function TenderFindingEvidence({ finding, review, preview = false }: { finding: TenderDecisionReviewFinding; review: TenderDecisionReview; preview?: boolean }) {
  const evidence = resolveFindingEvidence(finding, review.review_findings);
  if (!evidence.length) return null;
  const primary = evidence.find(item => item.kind === 'review_finding') || evidence[0];
  return <>
    {preview && primary?.summary && <blockquote className="tender-decision-brief-quote"><strong>{primary.title}</strong><p>{primary.summary}</p></blockquote>}
    <details className="tender-decision-brief-evidence">
      <summary>Ver evidencia</summary>
      <ul>{evidence.map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.locator}</span><p>{item.summary}</p></li>)}</ul>
    </details>
  </>;
}
