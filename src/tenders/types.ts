import type { ReactNode } from 'react';

export type TenderModuleView = 'radar' | 'seguimiento' | 'expedientes' | 'perfiles';

export type TenderRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export type TenderModuleData = {
  currentProfile: {
    id: string;
    full_name: string;
    role: string;
    microsoft_email?: string | null;
  };
  profiles: Array<{
    id: string;
    full_name: string;
    role: string;
  }>;
};

export type TendersModuleProps = {
  view: TenderModuleView;
  data: TenderModuleData;
  refresh: () => Promise<void>;
  request: TenderRequest;
  navigate: (hash: string) => void;
  /**
   * Transitional adapter for the established tender board. It keeps its state,
   * API calls, and interactions intact until each isolated view owns them.
   */
  renderLegacy: () => ReactNode;
};
