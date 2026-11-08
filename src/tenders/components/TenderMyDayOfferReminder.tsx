import { useEffect, useState } from 'react';
import { loadTenderOfferIndicators } from '../api';
import type { TenderOfferIndicators, TenderRequest } from '../types';
import { formatDateOnly } from '../../dateOnly';

/**
 * Encargo del 2026-11-07, punto 4: pasó el cierre de un proceso con GO y no se registró si se presentó o no. Una línea
 * por proceso en Mi día; sin pendientes, no se muestra.
 */
export function TenderMyDayOfferReminder({ request, onOpen }: { request: TenderRequest; onOpen: (opportunityId: string) => void }) {
  const [data, setData] = useState<TenderOfferIndicators | null>(null);
  useEffect(() => {
    let active = true;
    void loadTenderOfferIndicators(request).then(payload => { if (active) setData(payload); }, () => undefined);
    return () => { active = false; };
  }, [request]);
  const rows = data?.reminders || [];
  if (!rows.length) return null;
  return <section className="notice my-day-tender-overdue" aria-label="Cierres sin registrar si se presentó la oferta">
    <strong>Cerró y falta registrar si se presentó la oferta</strong>
    <ul>{rows.map(row => <li key={row.opportunity_id}>
      <button type="button" className="tw-link" onClick={() => onOpen(row.opportunity_id)}>{row.entity || row.ref}</button>
      {' · '}cerró el {formatDateOnly(row.close_date)}
    </li>)}</ul>
  </section>;
}
