import { useEffect, useState } from 'react';
import { parseAgt002InitialReportResponse, type Agt002InitialReport } from './agt002InitialReportProjection';
import type { TenderRequest } from './types';

/** Reads the INITIAL review report once per opportunity (no polling). Null until it is ready or if it cannot be read. */
export function useAgt002InitialReport(opportunityId: string, request: TenderRequest, enabled = true): Agt002InitialReport | null {
  const [report, setReport] = useState<Agt002InitialReport | null>(null);
  useEffect(() => {
    let active = true;
    setReport(null);
    if (!enabled) return () => { active = false; };
    request<unknown>(`/api/agt002-initial-analysis-report?opportunity_id=${encodeURIComponent(opportunityId)}`)
      .then(value => { if (active) setReport(parseAgt002InitialReportResponse(value).report); })
      .catch(() => { if (active) setReport(null); });
    return () => { active = false; };
  }, [opportunityId, request, enabled]);
  return report;
}
