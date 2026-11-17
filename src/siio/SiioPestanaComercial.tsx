import { CifraKit } from './SiioTorreAvancys';
import { FollowupCell } from './SiioFollowups';
import { millions, SiioPrivateDetail, tenderFollowupDraft, type AttentionFollowups } from './SiioCommercialPanel';
import { closingDateLabel, type CommercialSummary, type CommercialTender } from './commercialSummary';
import { addDays, openFollowupFor } from './followups';
import type { EstaSemana } from './estaSemana';

// Comercial y licitaciones con las reglas de la Portada (Juan, 2026-11-17): en el orden de la Portada (cómo va lo
// comercial, si el forecast está al día, qué licitaciones hay que decidir), las preguntas como títulos, el periodo de
// cada cifra y el rojo sólo para lo que está peor que su referencia. El ámbar queda para lo que puede cambiar.

// Una licitación que cierra en 15 días o menos sin decisión va en rojo: la misma ventana de la Portada.
export const PLAZO_ALTO = 15;
// Un comercial con la mitad o más de sus leads sin gestión se marca.
export const SIN_GESTION_MAL = 0.5;
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
  // Rojo sólo lo que nadie ha decidido y cierra pronto; lo que ya tiene GO lleva la fecha sin alarma.
  const urgente = !item.decision && d <= PLAZO_ALTO;
  return <span className={`siio-plazo${urgente ? ' alta' : ''}`}><strong>{d === 0 ? 'hoy' : dias(d)}</strong><small>{closingDateLabel(item.deadline_at)}</small></span>;
}

// La decisión de cada proceso, en una ficha: por decidir (rojo si cierra en la ventana), con GO y su estado, o cerrado
// sin que nadie actualizara el estado.
function Decision({ item }: { item: CommercialTender }) {
  if (item.attention === 'cierre_vencido_sin_actualizar') return <span className="siio-chip marca">cerró y nadie actualizó el estado</span>;
  if (!item.decision) {
    const urgente = item.days_to_deadline !== null && item.days_to_deadline <= PLAZO_ALTO;
    return <span className={`siio-chip${urgente ? ' marca' : ''}`}>Por decidir GO / NO-GO</span>;
  }
  return <span className="siio-chip vivo">GO · {ESTADO_OFERTA[item.offer_status || ''] || 'sin estado'}</span>;
}

// Licitaciones (Juan, 2026-11-17: «el orden es la fecha»): una sola lista por fecha de cierre, con la decisión de cada
// una a la vista. Arriba lo que cerró sin actualizar; las presentadas que ya cerraron esperan resultado en un plegado.
function Licitaciones({ summary, followups, today }: { summary: CommercialSummary; followups?: AttentionFollowups; today: string }) {
  const calendario = summary.tenders.calendar;
  const presentadas = calendario.filter(item => item.offer_status === 'presentada' && item.attention !== 'cierre_vencido_sin_actualizar' && (item.days_to_deadline ?? 1) < 0);
  const lista = calendario.filter(item => !presentadas.includes(item))
    .sort((x, y) => Number(y.attention === 'cierre_vencido_sin_actualizar') - Number(x.attention === 'cierre_vencido_sin_actualizar') || String(x.deadline_at || '9999').localeCompare(String(y.deadline_at || '9999')));
  const porDecidir = lista.filter(item => !item.decision && item.attention !== 'cierre_vencido_sin_actualizar');
  const urgentes = porDecidir.filter(item => item.days_to_deadline !== null && item.days_to_deadline <= PLAZO_ALTO).length + lista.filter(item => item.attention === 'cierre_vencido_sin_actualizar').length;
  const mayor = Math.max(1, ...lista.map(item => item.total_value));
  return <section className="siio-panel" aria-label="¿Qué licitaciones hay que decidir?">
    <div className="siio-sub" style={{ marginBottom: 2 }}>
      <h2>¿Qué licitaciones hay que decidir? {urgentes ? <span className="siio-conteo">{urgentes}</span> : null}</h2>
      <span className="siio-chip vivo">A hoy</span>
    </div>
    <p className="siio-nota" style={{ margin: '0 0 8px' }}>Todos los procesos activos por fecha de cierre. En rojo, los que nadie ha decidido y cierran en {PLAZO_ALTO} días o menos. Valor total del proceso · responsable: <strong>Licitaciones</strong>.</p>
    {lista.length ? <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Cierra</th><th>Proceso</th><th className="num total">Valor del contrato</th>{followups ? <th>Seguimiento</th> : null}</tr></thead>
      <tbody>{lista.map(item => <tr key={item.id}>
        <td><FichaPlazo item={item} /></td>
        <td><span className="nombre">{item.entity}</span><Decision item={item} /></td>
        <td className="num total"><strong>{millions(item.total_value)}</strong><span className="siio-magnitud neutra"><i style={{ width: `${Math.max(2, Math.round((item.total_value / mayor) * 100))}%` }} /></span></td>
        {followups ? <td><FollowupCell existing={openFollowupFor(followups.list, item.id)} today={today} canCreate={Boolean(followups.list?.permissions.create)} onCreate={() => followups.onCreate(tenderFollowupDraft(item, today))} /></td> : null}
      </tr>)}</tbody>
    </table></div> : <p className="siio-nota">No hay licitaciones activas.</p>}
    {presentadas.length ? <details className="siio-plegado">
      <summary>Presentadas, esperando resultado ({presentadas.length})</summary>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Proceso</th><th>Cerró</th><th className="num">Valor del contrato</th></tr></thead>
        <tbody>{presentadas.map(item => <tr key={item.id}>
          <td><span className="nombre">{item.entity}</span></td>
          <td>{closingDateLabel(item.deadline_at)}</td>
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
    <div className="siio-sub" style={{ marginBottom: 2 }}>
      <h2>¿El forecast está al día? {total.stale ? <span className="siio-conteo">{total.stale}</span> : null}</h2>
      <span className="siio-chip vivo">A hoy</span>
    </div>
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
  // El mes en curso contra su meta, como en la Portada: va a hoy, así que no se pinta de rojo.
  const mesActual = today.slice(0, 7);
  const delMes = sales.by_month.find(fila => fila.month === mesActual) || null;
  const nombreDelMes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(mesActual.slice(5, 7)) - 1] || '';
  return <section className="siio-panel" aria-label="¿Cómo va lo comercial?">
    <div className="siio-sub" style={{ marginBottom: 2 }}>
      <h2>¿Cómo va lo comercial?</h2>
      <span className="siio-chip vivo">A hoy</span>
    </div>
    <p className="siio-nota">Clientes privados, sin licitaciones; valor mensual del servicio.</p>
    <div className="siio-cifras siio-cifras-3" style={{ marginTop: 8 }}>
      <CifraKit etiqueta={`Vendido en ${nombreDelMes}, a hoy`} valor={millions(delMes?.approved_monthly_value || 0)}
        nota={delMes?.goal ? <>{porcentaje(delMes.approved_monthly_value, delMes.goal)} de la meta del mes ({millions(delMes.goal)})</> : 'sin meta cargada para el mes'} />
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
          <span className={`siio-plazo${asunto.vencido ? ' alta' : ''}`}>
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
    <ComercialPrivado summary={summary} followups={followups} today={today} />
    <ForecastAlDia summary={summary} />
    <Licitaciones summary={summary} followups={followups} today={today} />
    <SeguimientosConFecha semana={semana} abiertos={abiertos} vencidos={vencidos} onVer={onVerSeguimientos} />
  </>;
}
