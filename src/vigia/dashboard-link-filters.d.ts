export type VigiaDashboardFilters = {
  owner: string;
  stage: string;
  service: string;
  onlyActive: boolean;
  invalid: boolean;
};

export type VigiaDashboardFilterValues = {
  owners?: string[];
  stages?: string[];
  services?: string[];
};

export const VIGIA_DASHBOARD_FILTER_KEYS: readonly string[];
export function parseVigiaDashboardFilters(hash: string, validValues?: VigiaDashboardFilterValues): VigiaDashboardFilters;
