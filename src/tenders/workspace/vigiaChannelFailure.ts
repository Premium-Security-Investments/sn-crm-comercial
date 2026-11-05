import type { TenderDossierWorkbenchJob } from '../types';

/**
 * F15 (auditoría del piloto Fiscalía, 2026-11-05): el aviso «Vig-IA no pudo responder el último mensaje» tomaba
 * cualquier trabajo fallido del historial y no se iba nunca; «Reintentar» relanzaba ese trabajo viejo, incluso un
 * relleno cancelado a mano. El aviso sólo vale para el último pedido: si falló, es ése el que se reintenta; si
 * después hubo uno que respondió, no hay nada que avisar.
 */
export function lastFailedVigiaJob(jobs: readonly TenderDossierWorkbenchJob[] | null | undefined): TenderDossierWorkbenchJob | null {
  const latest = (jobs || [])
    .filter(job => job.status !== 'obsolete')
    .reduce<TenderDossierWorkbenchJob | null>((last, job) => (!last || Date.parse(job.created_at) > Date.parse(last.created_at) ? job : last), null);
  return latest?.status === 'failed' ? latest : null;
}
