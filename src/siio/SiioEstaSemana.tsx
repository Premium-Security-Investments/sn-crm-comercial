import { Badge, Panel } from './SiioUi';
import { FollowupCell } from './SiioFollowups';
import { millions, tenderFollowupDraft, type AttentionFollowups } from './SiioCommercialPanel';
import { openFollowupFor } from './followups';
import type { AsuntoDeLaSemana, EstaSemana } from './estaSemana';

function Accion({ asunto, followups, today }: { asunto: AsuntoDeLaSemana; followups?: AttentionFollowups; today: string }) {
  if (!followups) return null;
  // El seguimiento ya es el asunto: no se crea un seguimiento del seguimiento.
  if (asunto.tipo === 'seguimiento') return <span className="siio-secondary">Ver en Seguimiento gerencial</span>;
  if (!asunto.tender) return null;
  return <FollowupCell
    existing={openFollowupFor(followups.list, asunto.tender.id)}
    today={today}
    canCreate={Boolean(followups.list?.permissions.create)}
    onCreate={() => followups.onCreate(tenderFollowupDraft(asunto.tender!, today))}
  />;
}

export function SiioEstaSemana({ summary, followups, today }: { summary: EstaSemana; followups?: AttentionFollowups; today: string }) {
  if (!summary.asuntos.length) {
    return <Panel title="Decisiones con fecha">
      <p className="siio-secondary siio-quiet-empty">
        <strong>Nada vence en los próximos {summary.ventanaDias} días.</strong> Las licitaciones y los seguimientos con plazo cercano aparecen aquí cuando los haya.
      </p>
    </Panel>;
  }
  return <Panel title="Decisiones con fecha">
    <p className="siio-pulse-footnote">
      Lo que tiene plazo: licitaciones y seguimientos vencidos o que vencen dentro de {summary.ventanaDias} días.
      {summary.vencidos ? ` ${summary.vencidos} ${summary.vencidos === 1 ? 'ya venció' : 'ya vencieron'}.` : ''}
      {' '}Lo demás —el acumulado del año, el embudo y las alertas contables— está más abajo.
    </p>
    <ul className="siio-semana-list">{summary.asuntos.map(asunto => <li key={asunto.key} className={`siio-semana-item${asunto.vencido ? ' siio-semana-vencido' : ''}`}>
      <div className="siio-semana-cuando">
        {asunto.vencido ? <Badge tone="amber">Vencido</Badge> : null}
        <strong>{asunto.cuando}</strong>
      </div>
      <div className="siio-semana-que">
        <strong>{asunto.titulo}</strong>
        <span>{asunto.situacion}{asunto.valor !== null ? ` · ${millions(asunto.valor)}` : ''}</span>
      </div>
      <div className="siio-semana-accion"><Accion asunto={asunto} followups={followups} today={today} /></div>
    </li>)}</ul>
  </Panel>;
}
