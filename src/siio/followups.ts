import { useCallback, useEffect, useState } from 'react';
import { api } from '../apiClient';

export type FollowupOrigin = 'licitacion' | 'oportunidad' | 'finanzas' | 'recomendacion_ia' | 'junta' | 'reunion' | 'otro';
export type FollowupAutoRule = 'tender_decision' | 'tender_status' | 'opportunity_activity';

export type Followup = {
  id: string;
  title: string;
  owner_label: string;
  due_date: string;
  origin_type: FollowupOrigin;
  origin_ref: string | null;
  origin_label: string | null;
  auto_rule: FollowupAutoRule | null;
  status: 'abierto' | 'cumplido' | 'cancelado';
  notes: Array<{ at: string; by: string; text: string }>;
  created_role: string;
  created_at: string;
  closed_at: string | null;
  close_reason: 'manual' | 'automatico' | 'cancelado' | null;
  close_evidence: string | null;
};

export type FollowupList = { followups: Followup[]; permissions: { view: boolean; create: boolean; edit: boolean }; today: string };

export type FollowupDraft = {
  title: string;
  owner_label: string;
  due_date: string;
  origin_type: FollowupOrigin;
  origin_ref?: string | null;
  origin_label?: string | null;
  auto_rule?: FollowupAutoRule | null;
};

export const ORIGIN_LABELS: Record<FollowupOrigin, string> = {
  licitacion: 'Licitación',
  oportunidad: 'Oportunidad privada',
  finanzas: 'Finanzas',
  recomendacion_ia: 'Recomendación de Vig-IA',
  junta: 'Junta',
  reunion: 'Reunión',
  otro: 'Otro',
};

export const AUTO_RULE_LABELS: Record<FollowupAutoRule, string> = {
  tender_decision: 'Se cierra solo cuando el CRM registre la decisión de presentarse o no.',
  tender_status: 'Se cierra solo cuando el CRM muestre la licitación presentada o descartada.',
  opportunity_activity: 'Se cierra solo cuando el CRM registre nueva actividad con el cliente.',
};

export function addDays(isoDay: string, days: number) {
  const date = new Date(`${isoDay}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export function isOverdue(item: Followup, today: string) {
  return item.status === 'abierto' && item.due_date < today;
}

export function dueLabel(item: Followup, today: string) {
  const days = Math.round((Date.parse(`${item.due_date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  const date = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${item.due_date}T12:00:00Z`));
  if (item.status !== 'abierto') return date;
  if (days < 0) return `${date} · vencido hace ${-days} ${days === -1 ? 'día' : 'días'}`;
  if (days === 0) return `${date} · vence hoy`;
  return `${date} · en ${days} ${days === 1 ? 'día' : 'días'}`;
}

// Shared loader so the Torre and the Seguimiento tab read the same list and refresh together.
export function useFollowups() {
  const [data, setData] = useState<FollowupList | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const reload = useCallback(async () => {
    try {
      setData(await api<FollowupList>('/api/siio/followups'));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, state, reload };
}

export async function saveFollowup(draft: FollowupDraft) {
  return api<Followup>('/api/siio/followups', { method: 'POST', body: JSON.stringify(draft) });
}

export async function changeFollowup(id: string, body: { action?: 'cumplir' | 'cancelar' | 'reabrir' | 'nota' | 'editar'; note?: string; title?: string; owner_label?: string; due_date?: string }) {
  return api<Followup>(`/api/siio/followups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function openFollowupFor(list: FollowupList | null, originRef: string) {
  return list?.followups.find(item => item.status === 'abierto' && item.origin_ref === originRef) || null;
}
