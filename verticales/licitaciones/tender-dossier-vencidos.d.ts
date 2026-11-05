export type DossierConsequence = 'no_subsanable' | 'causa_rechazo' | 'obligatorio' | 'otro';
type DossierItemLike = {
  title: string;
  instruction?: string | null;
  latest_evidence?: { text: string | null } | null;
  status: string;
  required: boolean;
  applicability?: string | null;
  item_type?: string | null;
  origin?: string | null;
  target_date?: string | null;
  assignee_name?: string | null;
};
export declare const DOSSIER_CONSEQUENCE_LABEL: Readonly<Record<DossierConsequence, string>>;
export declare function isOpenDossierItem(item: DossierItemLike): boolean;
export declare function dossierItemConsequence(item: DossierItemLike): DossierConsequence;
export declare function overdueByConsequence<T extends DossierItemLike>(items: T[], today: string): { item: T; consequence: DossierConsequence; daysLate: number }[];
export declare function openNotCurable<T extends DossierItemLike>(items: T[]): T[];
export declare function overdueSummary(items: DossierItemLike[], today: string): {
  vencidos: number;
  vencidos_que_tumban: number;
  no_subsanables_abiertos: number;
  primeros: { titulo: string; consecuencia: DossierConsequence; dias_vencido: number; responsable: string | null }[];
};
