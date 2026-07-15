import type { ReactNode } from 'react';

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });

export function fmtSiioMoney(value: number | null | undefined) {
  return money.format(Number(value || 0));
}

export function fmtSiioDate(value?: string | null) {
  return value ? dates.format(new Date(value)) : 'Pendiente';
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

export function Badge({ tone = 'blue', children }: { tone?: 'blue' | 'green' | 'amber' | 'danger' | 'purple'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div>✓</div><strong>{title}</strong><p>{text}</p></div>;
}
