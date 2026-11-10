export type CertificateStatus = 'falta' | 'pedido' | 'recibido' | 'incompleto' | 'completo';
export const CERTIFICATE_STATUSES: Readonly<Record<CertificateStatus, string>>;
export function clientKey(name: string | null | undefined): string;
export type CertificateRequestClient = {
  key: string;
  name: string;
  contracts: Array<{ id: string; consecutive: string | null; smmlv: number; status: CertificateStatus; note: string | null }>;
  smmlv: number;
  share: number;
  accumulated_share: number;
};
export function certificateRequestPlan(
  experience: Array<{ id: string; contracting_party: string; rup_consecutive?: string | null; rup_number?: number | null; value_smmlv?: number | string | null; certificate_status?: string | null; certificate_note?: string | null }>,
  options?: { limit?: number },
): { total_contracts: number; total_smmlv: number; counts: Record<CertificateStatus, number>; clients_to_request: number; top: CertificateRequestClient[] };
