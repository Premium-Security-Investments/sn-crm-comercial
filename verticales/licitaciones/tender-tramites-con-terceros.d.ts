export declare const TRAMITE_ITEM_KEY_PREFIX: string;
export declare const TRAMITES_CON_TERCEROS: Readonly<Record<string, { tercero: string; dias_habiles: number }>>;
export declare function fechaLimiteParaPedir(closeDate: string | null, diasHabiles: number, today?: string | null): { fecha: string | null; alcanza: boolean | null };
export declare function tramitesConTercerosSeedItems(input?: {
  matrix?: unknown; bridge?: unknown; requirementRows?: unknown[]; closeDate?: string | null; today?: string | null;
}): { item_key: string; title: string; required: boolean; target_date: string | null; instruction: string }[];
