// AGT-001 / Vig-IA Gerencia: lo que exige una decisión con fecha.
//
// La Torre mostraba primero el cierre contable de hace dos meses y más abajo la licitación que
// cierra mañana, con el mismo peso visual. Un dueño que entra treinta segundos se llevaba la foto
// financiera y no la decisión que se le vence.
//
// Aquí solo entra lo que tiene reloj: licitaciones vencidas o que cierran dentro de la ventana, y
// seguimientos vencidos o que vencen dentro de ella. Lo demás —el acumulado del año, el embudo
// quieto, las alertas contables— no tiene fecha y se queda donde estaba.

import { closingDateLabel, isUrgentTender, URGENT_DAYS, type CommercialSummary, type CommercialTender } from './commercialSummary';
import { isOverdue, type Followup, type FollowupList } from './followups';

export type AsuntoDeLaSemana = {
  key: string;
  tipo: 'licitacion' | 'seguimiento';
  titulo: string;
  situacion: string;
  cuando: string;
  dias: number | null;
  vencido: boolean;
  valor: number | null;
  tender?: CommercialTender;
  followup?: Followup;
};

export type EstaSemana = {
  asuntos: AsuntoDeLaSemana[];
  vencidos: number;
  ventanaDias: number;
};

const diasHasta = (dia: string, hoy: string) =>
  Math.round((Date.parse(`${dia}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);

const plazo = (dias: number | null) => {
  if (dias === null) return 'sin fecha';
  if (dias < 0) return `hace ${-dias} ${dias === -1 ? 'día' : 'días'}`;
  if (dias === 0) return 'hoy';
  return `en ${dias} ${dias === 1 ? 'día' : 'días'}`;
};

export function deriveEstaSemana(
  { commercial, followups, today }: { commercial: CommercialSummary | null; followups: FollowupList | null; today: string },
): EstaSemana {
  const asuntos: AsuntoDeLaSemana[] = [];

  for (const tender of (commercial?.tenders.calendar || []).filter(isUrgentTender)) {
    const vencido = tender.attention === 'cierre_vencido_sin_actualizar';
    asuntos.push({
      key: `licitacion:${tender.id}`,
      tipo: 'licitacion',
      titulo: tender.entity,
      situacion: vencido ? 'Cerró y el estado no se ha actualizado' : 'Sin decisión de presentarse',
      cuando: `${closingDateLabel(tender.deadline_at)} · ${plazo(tender.days_to_deadline)}`,
      dias: tender.days_to_deadline,
      vencido,
      valor: tender.total_value,
      tender,
    });
  }

  for (const followup of followups?.followups || []) {
    if (followup.status !== 'abierto') continue;
    const dias = diasHasta(followup.due_date, today);
    if (dias > URGENT_DAYS) continue;
    asuntos.push({
      key: `seguimiento:${followup.id}`,
      tipo: 'seguimiento',
      titulo: followup.title,
      situacion: `Seguimiento de ${followup.owner_label}`,
      cuando: `${closingDateLabel(`${followup.due_date}T12:00:00Z`)} · ${plazo(dias)}`,
      dias,
      vencido: isOverdue(followup, today),
      valor: null,
      followup,
    });
  }

  // Primero lo vencido, y dentro de cada grupo lo que vence antes. Sin fecha, al final.
  asuntos.sort((izq, der) => {
    if (izq.vencido !== der.vencido) return izq.vencido ? -1 : 1;
    if (izq.dias === null) return 1;
    if (der.dias === null) return -1;
    return izq.dias - der.dias;
  });

  return { asuntos, vencidos: asuntos.filter(item => item.vencido).length, ventanaDias: URGENT_DAYS };
}

// El resto de las licitaciones, para que lo que ya está arriba no se repita abajo.
export function sinLoUrgente(summary: CommercialSummary): CommercialSummary {
  return { ...summary, tenders: { ...summary.tenders, calendar: summary.tenders.calendar.filter(item => !isUrgentTender(item)) } };
}
