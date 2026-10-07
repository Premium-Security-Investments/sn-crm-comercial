export const AGT002_TENDER_SERVICE_TYPE: 'licitacion_publica';
type ScopedOpportunity = { service_type_code?: string | null };
export function isPublicTenderOpportunity(opportunity?: ScopedOpportunity | null): boolean;
export function isAgt003CommercialOpportunity(opportunity?: ScopedOpportunity | null): boolean;
export function splitByAgentDomain<T extends ScopedOpportunity>(opportunities?: T[]): { commercial: T[]; tenders: T[] };
