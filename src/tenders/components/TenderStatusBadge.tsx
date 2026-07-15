export function TenderStatusBadge({ label, tone = 'neutral' }: { label?: string | null; tone?: 'success' | 'danger' | 'warning' | 'neutral' }) {
  const text = label || 'Pendiente';
  return <span className={`badge badge-${tone}`} role="status" aria-label={`Estado: ${text}`}>{text}</span>;
}
