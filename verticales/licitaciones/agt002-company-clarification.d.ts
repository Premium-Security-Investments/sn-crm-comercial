export type Agt002CompanyClarificationInput = {
  content?: string | null; aclaracion?: string | null;
  author_name?: string | null; autor?: string | null;
  created_at?: string | null; fecha?: string | null;
  target_label?: string | null; punto?: string | null;
};
export type Agt002CompanyClarificationSuggestion = {
  company: boolean;
  topic: string | null;
  topicLabel: string | null;
  reason: string;
  line: string;
};
export const AGT002_COMPANY_CLARIFICATION_LINE_MAX: number;
export function agt002CompanyClarificationLine(clarification: Agt002CompanyClarificationInput, options?: { tenderLabel?: string }): string;
export function agt002CompanyClarificationSuggestion(clarification: Agt002CompanyClarificationInput, options?: { tenderLabel?: string }): Agt002CompanyClarificationSuggestion;
