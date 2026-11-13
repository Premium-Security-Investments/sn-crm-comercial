import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';

// Las dos preguntas de plata de la Torre (plan del 2026-11-12), en vivo desde Avancys:
// ¿ganamos plata el mes pasado? y ¿qué clientes dejan y cuáles quitan?
// Calcularlo contra Odoo tarda medio minuto; el servidor lo guarda 30 minutos.

type Mes = { mes: string; ingresos: number; personal: number; otros_costos: number; margen: number; estado: 'cerrado' | 'parcial'; motivo: string | null };
type Cliente = { cliente: string; ingresos: number; horas: number; costo_vigilantes: number; costo_indirecto: number; costo_directo: number; margen: number; precio_hora: number | null };
type Clientes = { legible: boolean; motivo?: string; costo_por_hora?: number; horas?: number; clientes_con_ingreso?: number; ingresos_clientes?: number; fondo?: { ingresos_sin_cliente: number }; clientes?: Cliente[] };
type Saldo = { saldo: number; facturas: number };
type Cartera = { error?: string; hoy?: string; total?: Saldo; vencido?: Saldo; tramos?: ({ tramo: string } & Saldo)[]; deudores?: { cliente: string; vencido: number; facturas: number }[] };
type Torre = {
  configurado?: boolean;
  autenticado?: boolean;
  motivo?: string;
  medido_en?: string;
  desde_memoria?: boolean;
  meses?: Mes[];
  mes_cerrado?: string | null;
  mes_anterior?: string | null;
  clientes?: Clientes | null;
  cartera?: Cartera | null;
};

// El mismo tercero sale con nombres distintos en la factura y en la cuenta analítica
// ("[COMFAMILIAR] [891480000] CAJA…" y "[891480000] CAJA…"): se emparejan por el NIT entre corchetes.
const nitDe = (nombre: string) => (nombre.match(/\[(\d{6,})\]/) || [])[1] || null;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes?: string | null) => {
  if (!mes) return '—';
  const [anio, numero] = mes.split('-').map(Number);
  return `${MESES[numero - 1]} ${anio}`;
};
const millones = (valor: number) => `${valor < 0 ? '−' : ''}$${Math.round(Math.abs(valor) / 1e6).toLocaleString('es-CO')} M`;
const pesos = (valor: number) => `$${Math.round(Math.abs(valor)).toLocaleString('es-CO')}`;
const pct = (parte: number, base: number) => (base ? `${(Math.round((parte / base) * 1000) / 10).toLocaleString('es-CO')} %` : '—');
const hora = (valor?: string) => (valor
  ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(valor))
  : '');
const MAX_CLIENTES = 15;

function Cifra({ etiqueta, valor, comparacion, alerta }: { etiqueta: string; valor: string; comparacion?: string | null; alerta?: boolean }) {
  return <div className={`siio-key-figure${alerta ? ' siio-card-alert' : ''}`}>
    <small>{etiqueta}</small>
    <strong>{valor}</strong>
    {comparacion ? <span className="siio-key-comparison">{comparacion}</span> : null}
  </div>;
}

function cambio(actual: number, anterior: number | undefined, etiqueta: string) {
  if (anterior === undefined) return null;
  const diferencia = actual - anterior;
  return `${diferencia >= 0 ? 'Sube' : 'Baja'} ${millones(Math.abs(diferencia))} frente a ${etiqueta} (${millones(anterior)})`;
}

export function SiioTorreAvancys() {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [torre, setTorre] = useState<Torre | null>(null);
  const [error, setError] = useState('');

  async function cargar(refrescar = false) {
    setEstado('cargando');
    setError('');
    try {
      setTorre(await api<Torre>(`/api/siio/avancys/torre${refrescar ? '?refrescar=1' : ''}`));
      setEstado('listo');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
      setEstado('error');
    }
  }

  useEffect(() => { void cargar(); }, []);

  const meses = torre?.meses || [];
  const actual = meses.find(fila => fila.mes === torre?.mes_cerrado);
  const anterior = meses.find(fila => fila.mes === torre?.mes_anterior);
  const k = torre?.clientes;
  const costoHora = Math.abs(k?.costo_por_hora ?? 0);
  const filas = (k?.clientes || []).filter(fila => fila.ingresos > 0).slice(0, MAX_CLIENTES);
  const enPerdida = (k?.clientes || []).filter(fila => fila.ingresos > 0 && fila.margen < 0);

  return <section className="panel" aria-label="Resultado y clientes en vivo">
    <h2>¿Ganamos plata? · Avancys en vivo</h2>
    {estado === 'cargando' ? <p className="siio-secondary">Calculando con la contabilidad de Avancys. La primera vez del día tarda cerca de medio minuto…</p> : null}
    {estado === 'error' ? <p className="siio-alert-text">No se pudo leer Avancys: {error}</p> : null}
    {torre && torre.configurado === false ? <p className="siio-secondary">{torre.motivo}</p> : null}
    {torre && torre.autenticado === false ? <p className="siio-alert-text">Avancys no aceptó la conexión: {torre.motivo}</p> : null}

    {estado === 'listo' && actual ? <>
      <p className="siio-pulse-footnote">
        Último mes cerrado: <strong>{nombreMes(actual.mes)}</strong>. Fuente: líneas analíticas de Avancys, solo cuentas de resultados.
        {' '}Leído el {hora(torre?.medido_en).replace(/\.$/, '')}{torre?.desde_memoria ? ' (guardado)' : ''}.
        {' '}<button type="button" className="siio-link-button" onClick={() => void cargar(true)}>Volver a leer</button>
      </p>
      <div className="siio-key-grid siio-key-grid-4">
        <Cifra etiqueta={`Ingresos ${nombreMes(actual.mes)}`} valor={millones(actual.ingresos)} comparacion={cambio(actual.ingresos, anterior?.ingresos, nombreMes(anterior?.mes))} />
        <Cifra etiqueta="Nómina y costo de personal" valor={millones(actual.personal)} comparacion={`${pct(Math.abs(actual.personal), actual.ingresos)} de los ingresos`} />
        <Cifra etiqueta="Otros costos y gastos" valor={millones(actual.otros_costos)} comparacion={`${pct(Math.abs(actual.otros_costos), actual.ingresos)} de los ingresos`} />
        <Cifra etiqueta="Margen" valor={`${millones(actual.margen)} · ${pct(actual.margen, actual.ingresos)}`} alerta={actual.margen < 0}
          comparacion={anterior ? `${nombreMes(anterior.mes)}: ${pct(anterior.margen, anterior.ingresos)}` : null} />
      </div>
      <div className="siio-table-wrap"><table>
        <thead><tr><th>Mes</th><th>Ingresos</th><th>Personal</th><th>Otros costos</th><th>Margen</th><th>Estado</th></tr></thead>
        <tbody>{meses.map(fila => <tr key={fila.mes}>
          <td>{nombreMes(fila.mes)}</td>
          <td>{millones(fila.ingresos)}</td>
          <td>{millones(fila.personal)}</td>
          <td>{millones(fila.otros_costos)}</td>
          <td>{fila.estado === 'cerrado' ? `${millones(fila.margen)} · ${pct(fila.margen, fila.ingresos)}` : '—'}</td>
          <td>{fila.estado === 'cerrado' ? <Badge tone="green">Cerrado</Badge> : <Badge tone="amber">{fila.motivo === 'Mes en curso' ? 'En curso' : 'Nómina incompleta'}</Badge>}</td>
        </tr>)}</tbody>
      </table></div>

      <h3>¿Qué clientes dejan y cuáles quitan plata? · {nombreMes(actual.mes)}</h3>
      {k && k.legible === false ? <p className="siio-alert-text">No se pudo calcular por cliente: {k.motivo}</p> : null}
      {k?.legible ? <>
        <p className="siio-pulse-footnote">
          <strong>Aproximado.</strong> Ingreso real de cada cliente. Costo de vigilantes: {pesos(costoHora)} por hora (promedio de la empresa) por las horas de sus puestos de vigilancia física;
          {' '}supervisión, operaciones y administración repartidas por facturación.
          {enPerdida.length ? <> <strong>{enPerdida.length} clientes con ingreso quedan en pérdida</strong> ({millones(enPerdida.reduce((suma, fila) => suma + fila.margen, 0))}).</> : null}
        </p>
        <div className="siio-table-wrap"><table>
          <thead><tr><th>Cliente</th><th>Ingreso</th><th>Peso</th><th>Precio por hora</th><th>Margen (est.)</th></tr></thead>
          <tbody>{filas.map(fila => <tr key={fila.cliente}>
            <td><strong>{fila.cliente}</strong></td>
            <td>{millones(fila.ingresos)}</td>
            <td>{pct(fila.ingresos, k.ingresos_clientes ?? 0)}</td>
            <td>{fila.precio_hora ? <>{pesos(fila.precio_hora)}{costoHora && fila.precio_hora < costoHora ? <> <Badge tone="danger">bajo el costo</Badge></> : null}</> : <span className="siio-secondary">sin horas</span>}</td>
            <td>{millones(fila.margen)} · {pct(fila.margen, fila.ingresos)} {fila.margen < 0 ? <Badge tone="danger">pierde</Badge> : null}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="siio-pulse-footnote">
          Los {filas.length} clientes de mayor ingreso de {(k.clientes_con_ingreso ?? 0).toLocaleString('es-CO')}. Ingresos en cuentas de la empresa, sin cliente: {millones(k.fondo?.ingresos_sin_cliente ?? 0)}.
          {' '}El detalle y cómo se calcula están en "Lo que falta para completar la Torre".
        </p>
      </> : null}

      <h3>¿Nos están pagando?</h3>
      {torre?.cartera?.error ? <p className="siio-alert-text">No se pudo leer la cartera: {torre.cartera.error}</p> : null}
      {torre?.cartera?.total && torre.cartera.vencido ? (() => {
        const c = torre.cartera;
        const total = c.total!;
        const vencido = c.vencido!;
        const ingresoMes = new Map((k?.clientes || []).map(fila => [nitDe(fila.cliente), fila.ingresos]));
        return <>
          <div className="siio-key-grid siio-key-grid-4">
            <Cifra etiqueta="Cartera por cobrar" valor={millones(total.saldo)} comparacion={`${total.facturas.toLocaleString('es-CO')} facturas con saldo (con IVA)`} />
            <Cifra etiqueta="Vencida" valor={millones(vencido.saldo)} alerta={vencido.saldo > total.saldo / 2}
              comparacion={`${pct(vencido.saldo, total.saldo)} de la cartera · ${vencido.facturas.toLocaleString('es-CO')} facturas`} />
            {(c.tramos || []).slice(1).map(tramo => <Cifra key={tramo.tramo} etiqueta={`Vencida ${tramo.tramo}`} valor={millones(tramo.saldo)} alerta={tramo.tramo.startsWith('61') && tramo.saldo > 0}
              comparacion={`${tramo.facturas.toLocaleString('es-CO')} facturas`} />).slice(0, 2)}
          </div>
          <div className="siio-table-wrap"><table>
            <thead><tr><th>Quién debe más (vencido)</th><th>Vencido</th><th>Facturas</th><th>Equivale a</th></tr></thead>
            <tbody>{(c.deudores || []).map(fila => {
              const mensual = ingresoMes.get(nitDe(fila.cliente));
              return <tr key={fila.cliente}>
                <td><strong>{fila.cliente}</strong></td>
                <td>{millones(fila.vencido)}</td>
                <td>{fila.facturas}</td>
                <td>{mensual ? <>{(Math.round((fila.vencido / mensual) * 10) / 10).toLocaleString('es-CO')} meses de facturación{fila.vencido / mensual >= 2 ? <> <Badge tone="danger">alto</Badge></> : null}</> : <span className="siio-secondary">—</span>}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <p className="siio-pulse-footnote">
            Facturas de cliente publicadas en Avancys, por fecha de vencimiento al {c.hoy}. Más de 90 días: {millones(c.tramos?.find(t => t.tramo.startsWith('Más'))?.saldo ?? 0)}.
            {' '}La historia de Avancys empieza en agosto de 2026: la cartera anterior no está aquí. "Meses de facturación" compara con el ingreso del cliente en {nombreMes(actual.mes)}.
          </p>
        </>;
      })() : null}
    </> : null}
    {estado === 'listo' && torre?.autenticado && !actual ? <p className="siio-secondary">Avancys todavía no tiene un mes cerrado con la nómina completa.</p> : null}
  </section>;
}
