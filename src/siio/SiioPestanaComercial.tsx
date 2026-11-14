import { CifraKit } from './SiioTorreAvancys';
import { FollowupCell } from './SiioFollowups';
import { millions, SiioPrivateDetail, tenderFollowupDraft, type AttentionFollowups } from './SiioCommercialPanel';
import { closingDateLabel, type CommercialSummary, type CommercialTender } from './commercialSummary';
import { addDays, openFollowupFor } from './followups';
import type { EstaSemana } from './estaSemana';

// Comercial y licitaciones (contrato de la maqueta, Fase 3): las licitaciones que esperan decisión con la ficha de su
// plazo; si el forecast está al día, por comercial y con nombre; lo privado y los seguimientos con fecha.

// Una licitación que cierra en 12 días o menos va en rojo, aquí y en la Portada.
export const PLAZO_ALTO = 12;
// Un comercial con la mitad o más de sus leads sin gestión se marca.
const SIN_GESTION_MAL = 0.5;
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const porcentaje = (parte: number, base: number) => (base ? `${Math.round((parte / base) * 100)} %` : '—');
const dias = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

const ESTADO_OFERTA: Record<string, string> = {
  pendiente_decision: 'Pendiente de decisión',
  en_preparacion: 'En preparación',
  lista_para_presentar: 'Lista para presentar',
  presentada: 'Presentada',
};

function FichaPlazo({ item }: { item: CommercialTender }) {
  const d = item.days_to_deadline;
  if (item.attention === 'cierre_vencido_sin_actualizar') {
    return <span className="siio-plazo alta"><strong>{d === null ? '—' : `hace ${dias(-d)}`}</strong><small>cerró</small></span>;
  }
  if (d === null) return <span className="siio-plazo"><strong>—</strong><small>sin fecha</small></span>;
  return <span className={`siio-plazo ${d <= PLAZO_ALTO ? 'alta' : 'media'}`}><strong>{d === 0 ? 'hoy' : dias(d)}</strong><small>{closingDateLabel(item.deadline_at)}</small></span>;
}

function Licitaciones({ summary, followups, today }: { summary: CommercialSummary; followups?: AttentionFollowups; today: string }) {
  const piden = summary.tenders.calendar.filter(item => item.attention);
  const resto = summary.tenders.calendar.filter(item => !item.attention);
  const mayor = Math.max(1, ...piden.map(item => item.total_value));
  const pronto = resto.filter(item => item.days_to_deadline !== null && item.days_to_deadline >= 0 && item.days_to_deadline <= 14);
  return <section className="siio-panel" aria-label="Licitaciones que esperan una decisión">
    <h2>Licitaciones que esperan una decisión {piden.length ? <span className="siio-conteo">{piden.length}</span> : null}</h2>
    {piden.length ? <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Cierra</th><th>Proceso</th><th className="num total">Valor del contrato</th>{followups ? <th>Seguimiento</th> : null}</tr></thead>
      <tbody>{piden.map(item => <tr key={item.id}>
        <td><FichaPlazo item={item} /></td>
        <td><span className="nombre">{item.entity}</span>{item.attention === 'cierre_vencido_sin_actualizar'
          ? <span className="siio-chip marca">cerró y nadie actualizó el estado</span>
          : <small className="siio-nota">sin decisión de presentarse</small>}</td>
        <td className="num total"><strong>{millions(item.total_value)}</strong><span className="siio-magnitud neutra"><i style={{ width: `${Math.max(2, Math.round((item.total_value / mayor) * 100))}%` }} /></span></td>
        {followups ? <td><FollowupCell existing={openFollowupFor(followups.list, item.id)} today={today} canCreate={Boolean(followups.list?.permissions.create)} onCreate={() => followups.onCreate(tenderFollowupDraft(item, today))} /></td> : null}
      </tr>)}</tbody>
    </table></div> : <p className="siio-nota">Ninguna licitación espera decisión de presentarse en los próximos {summary.tenders.decision_window_days} días.</p>}
    {resto.length ? <p className="siio-nota" style={{ marginTop: 6 }}>
      Además hay {resto.length === 1 ? '1 proceso en curso' : `${resto.length} procesos en curso`} por {millions(resto.reduce((suma, item) => suma + item.total_value, 0))}
      {pronto.length ? <>; {pronto.map(item => `${item.entity} (${millions(item.total_value)})`).join(', ')} {pronto.length === 1 ? 'cierra' : 'cierran'} en {pronto.map(item => item.days_to_deadline).join(', ')} días</> : null}.
      {' '}Valor total del proceso · responsable: <strong>Licitaciones</strong>.
    </p> : null}
    {resto.length ? <details className="siio-plegado">
      <summary>Las demás licitaciones activas ({resto.length})</summary>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Proceso</th><th>Cierra</th><th>Decisión</th><th>Estado</th><th className="num">Valor del contrato</th></tr></thead>
        <tbody>{resto.map(item => <tr key={item.id}>
          <td><span className="nombre">{item.entity}</span></td>
          <td>{closingDateLabel(item.deadline_at)}</td>
          <td>{item.decision === 'go' ? 'Presentarse' : 'Pendiente'}</td>
          <td>{ESTADO_OFERTA[item.offer_status || ''] || '—'}</td>
          <td className="num"><strong>{millions(item.total_value)}</strong></td>
        </tr>)}</tbody>
      </table></div>
    </details> : null}
  </section>;
}

// Si un lead con potencial aparece desactualizado, la decisión se toma con lo que muestra el sistema (Juan, 2026-11-14).
function ForecastAlDia({ summary }: { summary: CommercialSummary }) {
  const filas = summary.pipeline.by_owner || [];
  if (!filas.length) return null;
  const total = filas.reduce((suma, fila) => ({ open: suma.open + fila.open, stale: suma.stale + fila.stale, monthly_value: suma.monthly_value + fila.monthly_value }), { open: 0, stale: 0, monthly_value: 0 });
  const mayor = Math.max(1, ...filas.map(fila => fila.stale));
  return <section className="siio-panel" aria-label="¿El forecast está al día?">
    <h2>¿El forecast está al día? {total.stale ? <span className="siio-conteo">{total.stale}</span> : null}</h2>
    <p className="siio-nota" style={{ margin: '4px 0 8px' }}>Leads abiertos de clientes privados (sin licitaciones), medidos hoy en el CRM. Sin gestión: más de {summary.pipeline.stale_days} días sin una interacción registrada. Lo que no se actualiza en el CRM es lo que la Torre ve.</p>
    <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Comercial</th><th className="num">Abiertas</th><th className="num total">Sin gestión en {summary.pipeline.stale_days} días</th><th className="num">Valor al mes</th></tr></thead>
      <tbody>{filas.map(fila => {
        const mal = fila.open > 0 && fila.stale / fila.open >= SIN_GESTION_MAL;
        return <tr key={fila.owner_id || 'sin-comercial'}>
          <td><span className="nombre">{fila.owner_name || 'Sin comercial asignado'}</span>{fila.open > 0 && fila.stale === fila.open ? <span className="siio-chip marca">ningún lead al día</span> : null}</td>
          <td className="num" data-etiqueta="Abiertas"><strong>{fila.open}</strong></td>
          <td className={`num total${mal ? ' mal' : ''}`}><strong>{fila.stale}</strong>{fila.stale ? <><small>{porcentaje(fila.stale, fila.open)}</small><span className="siio-magnitud"><i style={{ width: `${Math.round((fila.stale / mayor) * 100)}%` }} /></span></> : null}</td>
          <td className="num" data-etiqueta="Valor al mes"><strong>{millions(fila.monthly_value)}</strong>{fila.stale_monthly_value ? <small>{millions(fila.stale_monthly_value)} sin gestión</small> : null}</td>
        </tr>;
      })}</tbody>
      <tfoot><tr><th>Total</th><th className="num" data-etiqueta="Abiertas">{total.open}</th><th className={`num total${total.open && total.stale / total.open >= SIN_GESTION_MAL ? ' mal' : ''}`}>{total.stale} · {porcentaje(total.stale, total.open)}</th><th className="num" data-etiqueta="Valor al mes">{millions(total.monthly_value)}</th></tr></tfoot>
    </table></div>
  </section>;
}

function ComercialPrivado({ summary, followups, today }: { summary: CommercialSummary; followups?: AttentionFollowups; today: string }) {
  const { sales, pipeline } = summary;
  const cumplimiento = sales.ytd_attainment;
  const hasta = sales.closed_months ? `ene–${MESES_CORTOS[sales.closed_months - 1]}` : String(sales.year);
  const paradas = pipeline.stale_large;
  return <section className="siio-panel" aria-label="Comercial privado">
    <h2>Comercial privado</h2>
    <div className="siio-cifras siio-cifras-2" style={{ marginTop: 8 }}>
      <CifraKit etiqueta={`Ventas nuevas ${hasta}`} valor={millions(sales.ytd_monthly_value)} tono={cumplimiento !== null && cumplimiento < 0.9 ? 'mal' : undefined}
        nota={cumplimiento === null ? 'valor mensual del servicio · sin meta cargada' : <><strong>{Math.round(cumplimiento * 100)} %</strong> de la meta ({millions(sales.ytd_goal)}) · valor mensual del servicio</>} />
      <CifraKit etiqueta="Pipeline ponderado" valor={millions(pipeline.weighted_monthly_value)}
        nota={pipeline.coverage_of_remaining_goal === null ? `${pipeline.open_count} oportunidades abiertas` : <>cubre <strong>{pipeline.coverage_of_remaining_goal.toLocaleString('es-CO', { maximumFractionDigits: 1 })}×</strong> lo que falta para la meta del año</>} />
    </div>
    {paradas.length ? <>
      <p style={{ margin: '10px 0 0', fontSize: 13.5 }}><strong>{paradas.length === 1 ? '1 oferta grande parada' : `${paradas.length} ofertas grandes paradas`}</strong> más de {pipeline.stale_days} días: {millions(paradas.reduce((suma, item) => suma + item.monthly_value, 0))} al mes en juego.</p>
      <details className="siio-plegado">
        <summary>Las ofertas paradas, una por una</summary>
        <div className="siio-tabla-wrap"><table className="siio-tabla">
          <thead><tr><th>Cliente</th><th className="num">Valor al mes</th><th className="num">Sin actividad</th><th>Etapa · comercial</th>{followups ? <th>Seguimiento</th> : null}</tr></thead>
          <tbody>{paradas.map(item => <tr key={item.id}>
            <td><span className="nombre">{item.company_name}</span></td>
            <td className="num"><strong>{millions(item.monthly_value)}</strong></td>
            <td className="num mal"><strong>{dias(item.days_without_activity)}</strong></td>
            <td>{item.stage}{item.owner_name ? ` · ${item.owner_name}` : ''}</td>
            {followups ? <td><FollowupCell existing={openFollowupFor(followups.list, item.id)} today={today} canCreate={Boolean(followups.list?.permissions.create)} onCreate={() => followups.onCreate({ title: `Retomar contacto con ${item.company_name}`, owner_label: item.owner_name || 'Comercial', due_date: addDays(today, 7), origin_type: 'oportunidad', origin_ref: item.id, origin_label: item.company_name, auto_rule: 'opportunity_activity' })} /></td> : null}
          </tr>)}</tbody>
        </table></div>
      </details>
    </> : null}
    <details className="siio-plegado">
      <summary>Pipeline por etapa y calidad del dato del CRM</summary>
      <SiioPrivateDetail summary={summary} state="ready" />
    </details>
  </section>;
}

function SeguimientosConFecha({ semana, abiertos, vencidos, onVer }: { semana: EstaSemana; abiertos: number; vencidos: number; onVer: () => void }) {
  // Las licitaciones con plazo ya están arriba, en su tabla: aquí solo los seguimientos.
  const asuntos = semana.asuntos.filter(asunto => asunto.tipo === 'seguimiento');
  const atrasados = asuntos.filter(asunto => asunto.vencido).length;
  return <section className="siio-panel siio-seguimientos" aria-label="Seguimientos con fecha">
    <h2>Seguimientos con fecha {atrasados ? <span className="siio-conteo">{atrasados}</span> : null}</h2>
    {asuntos.length ? <ol className="siio-decision" style={{ marginTop: 6 }}>
      {asuntos.map(asunto => <li key={asunto.key}>
        <button type="button" onClick={onVer} aria-label={asunto.vencido ? 'Vencido' : 'Por vencer'}>
          <span className={`siio-plazo ${asunto.vencido ? 'alta' : 'media'}`}>
            <strong>{asunto.dias === null ? '—' : asunto.dias < 0 ? `hace ${dias(-asunto.dias)}` : asunto.dias === 0 ? 'hoy' : dias(asunto.dias)}</strong>
            <small>{asunto.vencido ? 'vencido' : 'vence'}</small>
          </span>
          <span className="frase"><strong>{asunto.titulo}</strong></span>
          <span className="quien">{asunto.followup?.owner_label}</span>
          <span className="ver">Ver →</span>
        </button>
      </li>)}
    </ol> : <p className="siio-nota" style={{ marginTop: 6 }}>Nada vence en los próximos {semana.ventanaDias} días.</p>}
    <p className="siio-nota" style={{ marginTop: 8 }}><button type="button" className="siio-enlace" onClick={onVer}>Ver los seguimientos abiertos{abiertos ? ` (${abiertos}${vencidos ? `, ${vencidos} ${vencidos === 1 ? 'vencido' : 'vencidos'}` : ''})` : ''} →</button></p>
  </section>;
}

export function SiioPestanaComercial({ summary, state, semana, followups, today, abiertos, vencidos, onVerSeguimientos }: {
  summary: CommercialSummary | null; state: 'loading' | 'ready' | 'error'; semana: EstaSemana; followups?: AttentionFollowups; today: string;
  abiertos: number; vencidos: number; onVerSeguimientos: () => void;
}) {
  if (state === 'loading') return <p className="siio-nota">Cargando datos del CRM…</p>;
  if (state === 'error' || !summary) return <p className="siio-alert-text">No se pudieron cargar los datos del CRM. El resto de la Torre sigue disponible.</p>;
  return <>
    <Licitaciones summary={summary} followups={followups} today={today} />
    <ForecastAlDia summary={summary} />
    <div className="siio-dos-col">
      <ComercialPrivado summary={summary} followups={followups} today={today} />
      <SeguimientosConFecha semana={semana} abiertos={abiertos} vencidos={vencidos} onVer={onVerSeguimientos} />
    </div>
  </>;
}
