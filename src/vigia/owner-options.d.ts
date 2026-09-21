export type CommercialOwnerOption = { id: string; full_name: string };
export type PriorityOwnerOption = { owner_id: string | null; owner_name: string | null };
export function mergeCommercialOwnerOptions(
  owners?: CommercialOwnerOption[],
  priorities?: PriorityOwnerOption[],
): Array<[string, string]>;
