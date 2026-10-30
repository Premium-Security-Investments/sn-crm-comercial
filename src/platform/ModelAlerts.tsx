// IT → Agentes — avisos de fallas de la IA (puerta única de modelos, Paso 3). Agrupados por categoría, con la última
// vez y cuántas veces en 24 h. Un aviso queda activo mientras no haya un uso exitoso posterior. Lenguaje común.
import { Badge, Panel } from '../siio/SiioUi';
import { alertCountText, alertStateText, type ModelAlert } from './agentsPresentation';
import { fmtDateTime } from './ConfigurationViews';

export const MODEL_ALERTS_PLAN_B_TEXT = 'Si Claude no responde, la función se pausa y la persona ve un mensaje de "no disponible por ahora". No se cambia a otro modelo ni a otro proveedor.';

export function ModelAlertsPanel({ alerts, agentNames, title = 'Fallas recientes de la IA' }: { alerts: ModelAlert[]; agentNames?: Record<string, string>; title?: string }) {
  if (!alerts.length) return null;
  return <Panel title={title}>
    <p className="platform-muted">{MODEL_ALERTS_PLAN_B_TEXT}</p>
    <ul className="platform-alerts">
      {alerts.map(alert => <li key={`${alert.agent_id}-${alert.category}`} className="platform-alert" data-active={alert.active ? 'true' : 'false'}>
        <div className="platform-alert-head">
          <strong>{agentNames?.[alert.agent_id] ? `${agentNames[alert.agent_id]}: ` : ''}{alert.title}</strong>
          <Badge tone={alert.active ? 'danger' : 'green'}>{alert.active ? 'Activo' : 'Resuelto'}</Badge>
        </div>
        <p>{alert.help}</p>
        <p className="platform-muted">Última vez: {fmtDateTime(alert.last_at)} · {alertCountText(alert.count_24h)} · Funciones: {alert.functions.join(', ')}</p>
        <small className="platform-sub">{alertStateText(alert)}{alert.last_success_at ? ` (último uso exitoso: ${fmtDateTime(alert.last_success_at)})` : ''}.</small>
      </li>)}
    </ul>
  </Panel>;
}
