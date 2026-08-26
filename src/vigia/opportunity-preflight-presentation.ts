import type { FichaCardState } from './opportunity-ficha-presentation';

export type CommercialAlertCategory = 'next_action' | 'close_date' | 'decision_maker';

export type PreflightAction = {
  issue_code: string;
  title: string;
  description: string;
  evidence_refs: string[];
};

export type ConsolidatedPreflightAction = {
  issue_code: string;
  title: string;
  description: string;
  evidence_refs: string[];
};

export type CommercialAlert = {
  key: string;
  category: CommercialAlertCategory;
  risk_text: string;
  action_text: string;
  contextualAction: ConsolidatedPreflightAction | null;
};

type BaseCommercialAlert = Omit<CommercialAlert, 'contextualAction'>;

export type CommercialPreflightInput = {
  nextAction: FichaCardState;
  expectedClose: FichaCardState;
  decisionMaker: FichaCardState;
};

export type PreflightMergeResult = {
  alerts: CommercialAlert[];
  standaloneActions: ConsolidatedPreflightAction[];
};

export const COMMERCIAL_PREFLIGHT_EXPLANATION =
  'Estos datos requieren actualización en el CRM antes de generar una propuesta.';

export const KNOWN_PREFLIGHT_ISSUE_CODES: readonly CommercialAlertCategory[] = Object.freeze([
  'next_action',
  'close_date',
  'decision_maker',
]);

export const PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE =
  'El análisis no está disponible temporalmente. Puede reintentar.';

const TECHNICAL_PREFLIGHT_ERROR_PATTERNS = [
  /\bis not defined\b/i,
  /\b(ReferenceError|TypeError|SyntaxError|RangeError|EvalError|URIError)\b/,
  /^\s*at\s+\S+\s*\(/m,
  /\.(js|ts|tsx|jsx|mjs):\d+:\d+/,
  /\bundefined is not a function\b/i,
];

export function normalizePreflightErrorMessage(message: string | null | undefined): string {
  const text = String(message ?? '').trim();
  if (!text) return PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE;
  return TECHNICAL_PREFLIGHT_ERROR_PATTERNS.some(pattern => pattern.test(text))
    ? PREFLIGHT_ANALYSIS_UNAVAILABLE_MESSAGE
    : text;
}

function nextActionAlert(state: FichaCardState): BaseCommercialAlert | null {
  const mapped: Record<string, { risk_text: string; action_text: string }> = {
    missing: {
      risk_text: 'No hay una próxima gestión agendada.',
      action_text: 'Agende la próxima gestión en el CRM antes de generar la propuesta.',
    },
    overdue: {
      risk_text: `La próxima gestión está ${state.detail.toLowerCase()}.`,
      action_text: 'Actualice la próxima gestión en el CRM antes de generar la propuesta.',
    },
    today: {
      risk_text: 'La próxima gestión está programada para hoy.',
      action_text: 'Realice o reprograme la gestión de hoy antes de generar la propuesta.',
    },
    soon: {
      risk_text: `La próxima gestión es ${state.detail.toLowerCase()}.`,
      action_text: 'Prepare la gestión próxima antes de generar la propuesta.',
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `next_action:${state.code}`, category: 'next_action', ...copy } : null;
}

function expectedCloseAlert(state: FichaCardState): BaseCommercialAlert | null {
  const mapped: Record<string, { risk_text: string; action_text: string }> = {
    missing: {
      risk_text: 'No hay fecha de cierre estimada registrada.',
      action_text: 'Registre la fecha de cierre estimada en el CRM.',
    },
    overdue: {
      risk_text: 'La fecha de cierre estimada ya venció.',
      action_text: 'Actualice la fecha de cierre estimada en el CRM antes de generar la propuesta.',
    },
    today: {
      risk_text: 'La fecha de cierre estimada es hoy.',
      action_text: 'Confirme el estado de cierre antes de generar la propuesta.',
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `close_date:${state.code}`, category: 'close_date', ...copy } : null;
}

function decisionMakerAlert(state: FichaCardState): BaseCommercialAlert | null {
  const mapped: Record<string, { risk_text: string; action_text: string }> = {
    pending: {
      risk_text: 'No hay datos de contacto del decisor registrados.',
      action_text: 'Registre el nombre, correo o teléfono del decisor en el CRM.',
    },
    partial: {
      risk_text: `El contacto del decisor está incompleto (${state.detail.toLowerCase()}).`,
      action_text: 'Complete el dato faltante del decisor en el CRM antes de generar la propuesta.',
    },
  };
  const copy = mapped[state.code];
  return copy ? { key: `decision_maker:${state.code}`, category: 'decision_maker', ...copy } : null;
}

export function buildCommercialAlerts(input: CommercialPreflightInput): BaseCommercialAlert[] {
  return [
    nextActionAlert(input.nextAction),
    expectedCloseAlert(input.expectedClose),
    decisionMakerAlert(input.decisionMaker),
  ].filter((alert): alert is BaseCommercialAlert => alert !== null);
}

export function consolidatePreflightActions(actions: PreflightAction[]): ConsolidatedPreflightAction[] {
  const grouped = new Map<string, {
    title: string;
    descriptions: string[];
    descriptionSet: Set<string>;
    evidence_refs: string[];
    evidenceSet: Set<string>;
  }>();

  for (const action of actions) {
    let group = grouped.get(action.issue_code);
    if (!group) {
      group = {
        title: action.title,
        descriptions: [],
        descriptionSet: new Set<string>(),
        evidence_refs: [],
        evidenceSet: new Set<string>(),
      };
      grouped.set(action.issue_code, group);
    }
    if (!group.descriptionSet.has(action.description)) {
      group.descriptionSet.add(action.description);
      group.descriptions.push(action.description);
    }
    for (const evidenceRef of action.evidence_refs) {
      if (group.evidenceSet.has(evidenceRef)) continue;
      group.evidenceSet.add(evidenceRef);
      group.evidence_refs.push(evidenceRef);
    }
  }

  return Array.from(grouped, ([issue_code, group]) => ({
    issue_code,
    title: group.title,
    description: group.descriptions.join('\n'),
    evidence_refs: group.evidence_refs,
  }));
}

export function mergeCommercialAlertsWithPreflight(
  alerts: BaseCommercialAlert[],
  preflightActions: PreflightAction[],
): PreflightMergeResult {
  const activeCategories = new Set(alerts.map(alert => alert.category));
  const contextualByCategory = new Map<CommercialAlertCategory, ConsolidatedPreflightAction>();
  const standaloneActions: ConsolidatedPreflightAction[] = [];
  const knownCategories = new Set<string>(KNOWN_PREFLIGHT_ISSUE_CODES);

  for (const action of consolidatePreflightActions(preflightActions)) {
    if (knownCategories.has(action.issue_code)) {
      const category = action.issue_code as CommercialAlertCategory;
      if (activeCategories.has(category)) contextualByCategory.set(category, action);
      continue;
    }
    standaloneActions.push(action);
  }

  return {
    alerts: alerts.map(alert => ({
      ...alert,
      contextualAction: contextualByCategory.get(alert.category) ?? null,
    })),
    standaloneActions,
  };
}
