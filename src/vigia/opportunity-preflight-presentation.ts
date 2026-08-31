import type { FichaCardState } from './opportunity-ficha-presentation';

export type CommercialAlertCategory = 'next_action' | 'close_date' | 'decision_maker';

export type CommercialAlert = {
  key: string;
  category: CommercialAlertCategory;
  risk_text: string;
};

export type CommercialPreflightInput = {
  nextAction: FichaCardState;
  expectedClose: FichaCardState;
  decisionMaker: FichaCardState;
};

export const COMMERCIAL_PREFLIGHT_EXPLANATION =
  'Señales para tener en cuenta durante el seguimiento. No impiden continuar.';

function nextActionAlert(state: FichaCardState): CommercialAlert | null {
  const mapped: Record<string, { risk_text: string }> = {
    missing: {
      risk_text: 'No hay una próxima gestión agendada.',
    },
    overdue: {
      risk_text: `La próxima gestión está ${state.detail.toLowerCase()}.`,
    },
    today: {
      risk_text: 'La próxima gestión está programada para hoy.',
    },
    soon: {
      risk_text: `La próxima gestión es ${state.detail.toLowerCase()}.`,
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `next_action:${state.code}`, category: 'next_action', ...copy } : null;
}

function expectedCloseAlert(state: FichaCardState): CommercialAlert | null {
  const mapped: Record<string, { risk_text: string }> = {
    missing: {
      risk_text: 'No hay fecha de cierre estimada registrada.',
    },
    overdue: {
      risk_text: 'La fecha de cierre estimada ya venció.',
    },
    today: {
      risk_text: 'La fecha de cierre estimada es hoy.',
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `close_date:${state.code}`, category: 'close_date', ...copy } : null;
}

function decisionMakerAlert(state: FichaCardState): CommercialAlert | null {
  const mapped: Record<string, { risk_text: string }> = {
    pending: {
      risk_text: 'No hay datos de contacto del decisor registrados.',
    },
    partial: {
      risk_text: `El contacto del decisor está incompleto (${state.detail.toLowerCase()}).`,
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `decision_maker:${state.code}`, category: 'decision_maker', ...copy } : null;
}

export function buildCommercialAlerts(input: CommercialPreflightInput): CommercialAlert[] {
  return [
    nextActionAlert(input.nextAction),
    expectedCloseAlert(input.expectedClose),
    decisionMakerAlert(input.decisionMaker),
  ].filter((alert): alert is CommercialAlert => alert !== null);
}
