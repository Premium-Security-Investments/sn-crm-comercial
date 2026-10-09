// Formulario "Funciones, modelos y cupos": convierte entre la configuración de la plataforma y el estado editable del
// formulario, y arma el JSON que se propone. Lógica pura (sin React) para poder probarla. La validación definitiva
// está en el servidor (platform-agent-configuration.js); aquí sólo se avisa antes de enviar.
import type { AgentConfiguration, AiFunction, CapPeriod, CapabilityConfiguration } from './agentsPresentation';

export const FORM_CAP_MAX = 1000;
export const DEFAULT_SAFETY_MAX = 200;

export type ProfileCapForm = { profileId: string; mode: 'cap' | 'unlimited'; max: string; per: CapPeriod; safetyMax: string };
export type ExceptionForm = { key: string; person: string; extra: string; per: CapPeriod; expires: string };
export type CapabilityForm = {
  capability: string;
  label: string;
  enabled: boolean;
  model: string;
  fallback: string;
  teamMax: string;
  teamPer: CapPeriod;
  profiles: ProfileCapForm[];
  exceptions: ExceptionForm[];
};

let exceptionCounter = 0;
export function newExceptionKey() { exceptionCounter += 1; return `exc-${exceptionCounter}`; }

/** Estado del formulario a partir de la configuración vigente (o de los valores del código si no hay vigente). */
export function formFromConfiguration(configuration: AgentConfiguration | null, functions: AiFunction[], defaults: AgentConfiguration | null): CapabilityForm[] {
  return functions.map(item => {
    const value: Partial<CapabilityConfiguration> = configuration?.capabilities?.[item.capability] || defaults?.capabilities?.[item.capability] || {};
    const fallbackDefaults: Partial<CapabilityConfiguration> = defaults?.capabilities?.[item.capability] || {};
    const team = value.team_cap || fallbackDefaults.team_cap || { per: 'day' as CapPeriod, max: 0 };
    return {
      capability: item.capability,
      label: item.label,
      enabled: value.enabled ?? true,
      model: value.model || fallbackDefaults.model || 'sonnet',
      fallback: value.fallback || fallbackDefaults.fallback || 'notify',
      teamMax: String(team.max),
      teamPer: team.per,
      profiles: Object.entries(value.profile_caps || {}).map(([profileId, cap]) => ('unlimited' in cap && cap.unlimited
        ? { profileId, mode: 'unlimited' as const, max: '', per: 'day' as CapPeriod, safetyMax: String(cap.safety_max) }
        : { profileId, mode: 'cap' as const, max: String((cap as { max: number }).max), per: (cap as { per: CapPeriod }).per, safetyMax: String(DEFAULT_SAFETY_MAX) })),
      exceptions: (value.exceptions || []).map(exception => ({ key: newExceptionKey(), person: exception.person, extra: String(exception.extra), per: exception.per, expires: exception.expires })),
    };
  });
}

function toInt(value: string) {
  const text = String(value ?? '').trim();
  return /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
}

/** JSON de configuración a proponer (sólo las claves admitidas por la plataforma). */
export function buildConfiguration(forms: CapabilityForm[]): AgentConfiguration {
  const capabilities: Record<string, CapabilityConfiguration> = {};
  for (const form of forms) {
    const entry: CapabilityConfiguration = {
      enabled: form.enabled,
      model: form.model,
      fallback: form.fallback,
      team_cap: { per: form.teamPer, max: toInt(form.teamMax) },
    };
    if (form.profiles.length) {
      entry.profile_caps = Object.fromEntries(form.profiles.map(profile => [profile.profileId, profile.mode === 'unlimited'
        ? { unlimited: true as const, safety_max: toInt(profile.safetyMax) }
        : { per: profile.per, max: toInt(profile.max) }]));
    }
    if (form.exceptions.length) {
      entry.exceptions = form.exceptions.map(exception => ({ person: exception.person, extra: toInt(exception.extra), per: exception.per, expires: exception.expires }));
    }
    capabilities[form.capability] = entry;
  }
  return { timezone: 'America/Bogota', capabilities };
}

function okInt(value: string) {
  const number = toInt(value);
  return Number.isInteger(number) && number >= 0 && number <= FORM_CAP_MAX;
}

/** Avisos antes de enviar (el servidor vuelve a validar todo). `today` = YYYY-MM-DD en Bogotá. */
export function validateForms(forms: CapabilityForm[], today: string): string[] {
  const problems: string[] = [];
  for (const form of forms) {
    if (!okInt(form.teamMax)) problems.push(`"${form.label}": el cupo del equipo debe ser un entero entre 0 y ${FORM_CAP_MAX}.`);
    const seenProfiles = new Set<string>();
    for (const profile of form.profiles) {
      if (!profile.profileId) problems.push(`"${form.label}": elija el perfil.`);
      else if (seenProfiles.has(profile.profileId)) problems.push(`"${form.label}": un perfil aparece dos veces.`);
      seenProfiles.add(profile.profileId);
      if (profile.mode === 'cap' && !okInt(profile.max)) problems.push(`"${form.label}": el cupo de cada perfil debe ser un entero entre 0 y ${FORM_CAP_MAX}.`);
      if (profile.mode === 'unlimited' && !okInt(profile.safetyMax)) problems.push(`"${form.label}": el techo de seguridad debe ser un entero entre 0 y ${FORM_CAP_MAX}.`);
    }
    const seenPeople = new Set<string>();
    for (const exception of form.exceptions) {
      if (!exception.person) problems.push(`"${form.label}": elija la persona de cada excepción.`);
      else if (seenPeople.has(exception.person)) problems.push(`"${form.label}": la misma persona tiene dos excepciones.`);
      seenPeople.add(exception.person);
      if (!okInt(exception.extra)) problems.push(`"${form.label}": el cupo extra debe ser un entero entre 0 y ${FORM_CAP_MAX}.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires)) problems.push(`"${form.label}": cada excepción necesita fecha de vencimiento.`);
      else if (exception.expires < today) problems.push(`"${form.label}": una excepción vence en el pasado.`);
    }
  }
  return [...new Set(problems)];
}

/** Slug sugerido para un perfil nuevo (el mismo criterio que el servidor). */
export function profileSlug(name: string) {
  const base = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/g, '')
    .slice(0, 41).replace(/_+$/g, '');
  return base.length >= 2 ? base : '';
}
