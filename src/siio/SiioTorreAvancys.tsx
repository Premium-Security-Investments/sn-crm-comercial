import { Fragment, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';
import type { FinancialPulse } from './financialPulse';

// Las dos preguntas de plata de la Torre (plan del 2026-11-12), en vivo desde Avancys:
// ¿ganamos plata el mes pasado? y ¿qué clientes dejan y cuáles quitan?
// Calcularlo contra Odoo tarda medio minuto; el servidor lo guarda 30 minutos.

type Mes = { mes: string; ingresos: number; personal: number; otros_costos: number; margen: number; estado: 'cerrado' | 'parcial'; motivo: string | null };
type Cliente = { cliente: string; ingresos: number; horas: number; costo_vigilantes: number; costo_indirecto: number; costo_directo: number; margen: number; precio_hora: number | null };
type Clientes = { legible: boolean; motivo?: string; costo_por_hora?: number; horas?: number; clientes_con_ingreso?: number; ingresos_clientes?: number; fondo?: { ingresos_sin_cliente: number }; clientes?: Cliente[] };
type LineaPyg = { clave: string; etiqueta: string; grupo: string; cuentas: string };
type Totales = { ingresos: number; costos: number; margen_bruto: number; gastos: number; utilidad_ordinaria: number; no_operacional: number; antes_de_impuestos: number; impuestos: number; utilidad_neta: number };
type MesPyg = {
  mes: string;
  estado: 'cerrado' | 'parcial';
  motivo: string | null;
  lineas: Record<string, number>;
  facturado_vigilancia: number;
  provision: { del_mes: number; del_mes_anterior: number; ajuste: number; clientes: { nombre: string; devengado: number }[]; error: string | null };
  totales: Totales;
  sin_clasificar: { cuenta: string; valor: number }[];
  proyeccion: { lineas: Record<string, number>; totales: Totales; estimadas: string[]; base_mes: string; ingresos_ordenes: number | null } | null;
};
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
  primera_linea?: string | null;
  clientes?: Clientes | null;
  cartera?: Cartera | null;
  lineas_pyg?: LineaPyg[];
  pyg?: MesPyg[];
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

type OpcionMes = { mes: string; etiqueta: string; fuente: 'oficial' | 'automatico' | 'proyeccion' | 'en_vivo' };
// Lo que muestran las cuatro cifras de un mes, venga del automático o del Excel de Finanzas.
type Resumen = { ingresos: number; costos: number; gastos: number; utilidad: number; utilidadEtiqueta: string; fuente: string };

const ETIQUETA_FUENTE: Record<OpcionMes['fuente'], string> = {
  oficial: 'Cierre Finanzas', automatico: 'Automático', proyeccion: 'Proyección', en_vivo: 'En vivo',
};

export function SiioTorreAvancys({ oficial = null }: { oficial?: FinancialPulse | null }) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [torre, setTorre] = useState<Torre | null>(null);
  const [error, setError] = useState('');
  const [mesElegido, setMesElegido] = useState('');
  const [clientesDelMes, setClientesDelMes] = useState<{ mes: string; datos: Clientes | null; estado: 'cargando' | 'listo' | 'error' } | null>(null);

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

  // Un solo selector de mes para todo el bloque (plan del 2026-11-13). Cada mes dice de dónde sale:
  // el cierre oficial de Finanzas (Excel cargado), el automático de Avancys, una proyección o en vivo.
  const pyg = torre?.pyg || [];
  const opciones: OpcionMes[] = (() => {
    const porMes = new Map<string, OpcionMes>();
    for (const m of oficial?.months || []) {
      if (m.year !== oficial?.year) continue;
      const mes = `${m.year}-${String(m.month).padStart(2, '0')}`;
      porMes.set(mes, { mes, etiqueta: ETIQUETA_FUENTE.oficial, fuente: 'oficial' });
    }
    for (const fila of pyg) {
      const fuente: OpcionMes['fuente'] = fila.estado === 'cerrado' ? 'automatico' : fila.motivo === 'Mes en curso' ? 'en_vivo' : 'proyeccion';
      const previa = porMes.get(fila.mes);
      porMes.set(fila.mes, previa ? { ...previa, etiqueta: `${ETIQUETA_FUENTE.oficial} · también automático` } : { mes: fila.mes, etiqueta: ETIQUETA_FUENTE[fuente], fuente });
    }
    return [...porMes.values()].sort((x, y) => x.mes.localeCompare(y.mes));
  })();
  const mes = mesElegido || torre?.mes_cerrado || opciones[opciones.length - 1]?.mes || '';
  const opcion = opciones.find(o => o.mes === mes);
  const filaPyg = pyg.find(fila => fila.mes === mes);
  const oficialDe = (m: string) => {
    const [anio, numero] = m.split('-').map(Number);
    return oficial?.months.find(x => x.year === anio && x.month === numero)?.totals || null;
  };
  const resumenDe = (m: string): Resumen | null => {
    const f = pyg.find(fila => fila.mes === m);
    const o = oficialDe(m);
    // El cierre oficial manda cuando existe; si no, el automático (o su proyección).
    if (o) return { ingresos: o.ingresos, costos: -Math.abs(o.costos), gastos: -Math.abs(o.gastos_operacionales), utilidad: o.utilidad_operacional, utilidadEtiqueta: 'Utilidad operacional', fuente: 'Cierre de Finanzas (Excel cargado)' };
    if (f) {
      const t = f.proyeccion ? f.proyeccion.totales : f.totales;
      return { ingresos: t.ingresos, costos: t.costos, gastos: t.gastos, utilidad: t.utilidad_ordinaria, utilidadEtiqueta: 'Utilidad operacional', fuente: f.proyeccion ? 'Proyección con Avancys' : 'Automático desde Avancys' };
    }
    return null;
  };
  const indice = opciones.findIndex(o => o.mes === mes);
  const mesPrevio = indice > 0 ? opciones[indice - 1].mes : null;
  const resumen = resumenDe(mes);
  const previo = mesPrevio ? resumenDe(mesPrevio) : null;
  const aprox = opcion?.fuente === 'proyeccion' || opcion?.fuente === 'en_vivo' ? '≈ ' : '';

  // Clientes del mes elegido: el último mes cerrado viene con la Torre; los demás se piden aparte.
  useEffect(() => {
    if (!mes || !torre?.primera_linea || mes === torre.mes_cerrado) { setClientesDelMes(null); return; }
    if (mes < torre.primera_linea.slice(0, 7)) { setClientesDelMes(null); return; }
    let vigente = true;
    setClientesDelMes({ mes, datos: null, estado: 'cargando' });
    api<Clientes>(`/api/siio/avancys/rentabilidad-aproximada?mes=${encodeURIComponent(mes)}`)
      .then(datos => { if (vigente) setClientesDelMes({ mes, datos, estado: 'listo' }); })
      .catch(() => { if (vigente) setClientesDelMes({ mes, datos: null, estado: 'error' }); });
    return () => { vigente = false; };
  }, [mes, torre?.mes_cerrado, torre?.primera_linea]);

  const k = mes === torre?.mes_cerrado ? torre?.clientes : clientesDelMes?.datos;
  const antesDeAvancys = Boolean(torre?.primera_linea && mes && mes < torre.primera_linea.slice(0, 7));
  const costoHora = Math.abs(k?.costo_por_hora ?? 0);
  const filas = (k?.clientes || []).filter(fila => fila.ingresos > 0).slice(0, MAX_CLIENTES);
  const enPerdida = (k?.clientes || []).filter(fila => fila.ingresos > 0 && fila.margen < 0);
  const ingresoCerrado = torre?.clientes?.clientes || [];

  // Tendencia del año: margen operacional de cada mes, oficial donde hay cierre y automático donde no.
  const tendencia = opciones.map(o => ({ ...o, resumen: resumenDe(o.mes) })).filter(o => o.resumen);

  return <section className="panel" aria-label="Resultado y clientes en vivo">
    <h2>¿Ganamos plata? · Avancys en vivo</h2>
    {estado === 'cargando' ? <p className="siio-secondary">Calculando con la contabilidad de Avancys. La primera vez del día tarda cerca de medio minuto…</p> : null}
    {estado === 'error' ? <p className="siio-alert-text">No se pudo leer Avancys: {error}</p> : null}
    {torre && torre.configurado === false ? <p className="siio-secondary">{torre.motivo}</p> : null}
    {torre && torre.autenticado === false ? <p className="siio-alert-text">Avancys no aceptó la conexión: {torre.motivo}</p> : null}

    {estado === 'listo' && opciones.length ? <>
      <section className="siio-view-filters" aria-label="Mes de la Torre">
        <label>Mes
          <select value={mes} onChange={evento => setMesElegido(evento.target.value)}>
            {opciones.map(o => <option key={o.mes} value={o.mes}>{nombreMes(o.mes)} · {o.etiqueta}</option>)}
          </select>
        </label>
        {opcion ? <Badge tone={opcion.fuente === 'oficial' ? 'green' : opcion.fuente === 'automatico' ? 'blue' : 'amber'}>{opcion.etiqueta}</Badge> : null}
        <span className="siio-pulse-footnote">
          Leído de Avancys el {hora(torre?.medido_en).replace(/\.$/, '')}{torre?.desde_memoria ? ' (guardado)' : ''}.
          {' '}<button type="button" className="siio-link-button" onClick={() => void cargar(true)}>Volver a leer</button>
        </span>
      </section>

      {resumen ? <>
        <div className="siio-key-grid siio-key-grid-4">
          <Cifra etiqueta={`Ingresos ${nombreMes(mes)}`} valor={`${aprox}${millones(resumen.ingresos)}`} comparacion={previo ? cambio(resumen.ingresos, previo.ingresos, nombreMes(mesPrevio)) : null} />
          <Cifra etiqueta="Costos de operación" valor={`${aprox}${millones(resumen.costos)}`} comparacion={`${pct(Math.abs(resumen.costos), resumen.ingresos)} de los ingresos`} />
          <Cifra etiqueta="Gastos operativos" valor={`${aprox}${millones(resumen.gastos)}`} comparacion={`${pct(Math.abs(resumen.gastos), resumen.ingresos)} de los ingresos`} />
          <Cifra etiqueta={resumen.utilidadEtiqueta} valor={`${aprox}${millones(resumen.utilidad)} · ${pct(resumen.utilidad, resumen.ingresos)}`} alerta={resumen.utilidad < 0}
            comparacion={previo ? `${nombreMes(mesPrevio)}: ${pct(previo.utilidad, previo.ingresos)}` : null} />
        </div>
        <p className="siio-pulse-footnote">Fuente de {nombreMes(mes)}: {resumen.fuente}.{filaPyg && oficialDe(mes) ? ` El automático de Avancys para este mes da ${millones(filaPyg.totales.utilidad_ordinaria)} de utilidad operacional; la diferencia son los ajustes de cierre de Finanzas.` : ''}</p>
      </> : null}

      {tendencia.length > 1 ? <div className="siio-table-wrap"><table>
        <thead><tr><th>Margen operacional</th>{tendencia.map(o => <th key={o.mes}>{nombreMes(o.mes).split(' ')[0].slice(0, 3)}</th>)}</tr></thead>
        <tbody>
          <tr><td>{oficial?.year ?? ''}</td>{tendencia.map(o => <td key={o.mes} className={o.mes === mes ? 'siio-cell-selected' : undefined}>
            {o.fuente === 'proyeccion' || o.fuente === 'en_vivo' ? '≈ ' : ''}{pct(o.resumen!.utilidad, o.resumen!.ingresos)}</td>)}</tr>
          <tr><td className="siio-secondary">Fuente</td>{tendencia.map(o => <td key={o.mes} className="siio-secondary">{o.fuente === 'oficial' ? 'Finanzas' : o.fuente === 'automatico' ? 'Avancys' : o.fuente === 'en_vivo' ? 'en vivo' : 'proyección'}</td>)}</tr>
        </tbody>
      </table></div> : null}

      <h3>¿Qué clientes dejan y cuáles quitan plata? · {nombreMes(mes)}</h3>
      {antesDeAvancys ? <p className="siio-secondary">Antes de agosto de 2026 la contabilidad estaba en Yeminus: no hay detalle por cliente para {nombreMes(mes)}.</p> : null}
      {clientesDelMes?.estado === 'cargando' ? <p className="siio-secondary">Calculando los clientes de {nombreMes(mes)}…</p> : null}
      {clientesDelMes?.estado === 'error' ? <p className="siio-alert-text">No se pudieron calcular los clientes de {nombreMes(mes)}.</p> : null}
      {k && k.legible === false ? <p className="siio-alert-text">No se pudo calcular por cliente: {k.motivo}</p> : null}
      {k?.legible && !antesDeAvancys ? <>
        <p className="siio-pulse-footnote">
          <strong>Aproximado.</strong> Ingreso real de cada cliente. Costo de vigilantes: {pesos(costoHora)} por hora (promedio de la empresa) por las horas de sus puestos de vigilancia física;
          {' '}supervisión, operaciones y administración repartidas por facturación.
          {opcion && opcion.fuente !== 'automatico' && opcion.fuente !== 'oficial' ? ' El mes no está completo en la contabilidad: los márgenes se van a mover.' : ''}
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
          {' '}Para los que se facturan mes vencido, el ingreso de un mes corresponde al servicio del anterior.
        </p>
      </> : null}

      {pyg.length && torre?.lineas_pyg ? <EstadoDeResultados lineas={torre.lineas_pyg} meses={pyg} oficial={oficial} /> : null}

      <h3>¿Nos están pagando? · hoy</h3>
      {torre?.cartera?.error ? <p className="siio-alert-text">No se pudo leer la cartera: {torre.cartera.error}</p> : null}
      {torre?.cartera?.total && torre.cartera.vencido ? (() => {
        const c = torre.cartera;
        const total = c.total!;
        const vencido = c.vencido!;
        const ingresoMes = new Map(ingresoCerrado.map(fila => [nitDe(fila.cliente), fila.ingresos]));
        const cerrado = torre.mes_cerrado ? resumenDe(torre.mes_cerrado) : null;
        // Días de cartera: saldo por cobrar sobre la facturación de un mes (con IVA del 19 % aprox.).
        const dias = cerrado?.ingresos ? Math.round((total.saldo / (cerrado.ingresos * 1.19)) * 30) : null;
        return <>
          <div className="siio-key-grid siio-key-grid-4">
            <Cifra etiqueta="Cartera por cobrar" valor={millones(total.saldo)} comparacion={`${total.facturas.toLocaleString('es-CO')} facturas con saldo (con IVA)${dias ? ` · ≈ ${dias} días de facturación` : ''}`} />
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
            Facturas de cliente publicadas en Avancys, por fecha de vencimiento al {c.hoy}; la cartera es siempre la de hoy, no la del mes elegido. Más de 90 días: {millones(c.tramos?.find(t => t.tramo.startsWith('Más'))?.saldo ?? 0)}.
            {' '}La historia de Avancys empieza en agosto de 2026: la cartera anterior no está aquí. "Meses de facturación" compara con el ingreso del cliente en {nombreMes(torre.mes_cerrado)}.
          </p>
        </>;
      })() : null}
    </> : null}
    {estado === 'listo' && torre?.autenticado && !opciones.length ? <p className="siio-secondary">Todavía no hay meses con datos en Avancys ni cierres de Finanzas cargados.</p> : null}
  </section>;
}

const GRUPOS: { grupo: string; titulo: string; total: keyof Totales; totalEtiqueta: string }[] = [
  { grupo: 'ingresos', titulo: 'Ingresos', total: 'ingresos', totalEtiqueta: 'Total ingresos' },
  { grupo: 'costos', titulo: 'Costos de operación', total: 'margen_bruto', totalEtiqueta: 'Margen bruto' },
  { grupo: 'gastos', titulo: 'Gastos operativos', total: 'utilidad_ordinaria', totalEtiqueta: 'Utilidad por actividades ordinarias' },
  { grupo: 'no_operacional', titulo: 'No operacionales', total: 'antes_de_impuestos', totalEtiqueta: 'Utilidad antes de impuestos' },
  { grupo: 'impuestos', titulo: 'Impuestos', total: 'utilidad_neta', totalEtiqueta: 'Utilidad del ejercicio' },
];

// El estado de resultados con las líneas del PYG de Finanzas, mes a mes, en vivo desde Avancys.
// Modelo para afinar con las áreas (Juan, 2026-11-13): cada línea dice qué cuentas suma. Los meses
// cerrados son automáticos; los incompletos y el mes en curso, proyectados (≈); el cierre oficial de
// Finanzas (el Excel cargado) se muestra debajo para los meses que lo tienen.
function EstadoDeResultados({ lineas, meses, oficial }: { lineas: LineaPyg[]; meses: MesPyg[]; oficial: FinancialPulse | null }) {
  const ultimoCerrado = [...meses].reverse().find(fila => fila.estado === 'cerrado');
  const prov = ultimoCerrado?.provision;
  const sinClasificar = meses.flatMap(fila => fila.sin_clasificar.map(c => ({ ...c, mes: fila.mes })));
  const valores = (fila: MesPyg) => fila.proyeccion ? fila.proyeccion.lineas : fila.lineas;
  const totalesDe = (fila: MesPyg) => fila.proyeccion ? fila.proyeccion.totales : fila.totales;
  const oficialDe = (mes: string) => {
    const [anio, numero] = mes.split('-').map(Number);
    return oficial?.months.find(m => m.year === anio && m.month === numero)?.totals || null;
  };
  const conOficial = meses.some(fila => oficialDe(fila.mes));
  const celda = (fila: MesPyg, valor: number, clave?: string) => {
    const estimada = fila.proyeccion && (!clave || fila.proyeccion.estimadas.includes(clave));
    return <span className={estimada ? 'siio-secondary' : undefined}>{fila.proyeccion ? '≈ ' : ''}{millones(valor)}</span>;
  };
  return <>
    <h3>Estado de resultados automático · como el PYG de Finanzas</h3>
    <p className="siio-pulse-footnote">
      Mismas líneas y cuentas que el Excel de Finanzas, armadas solas desde la contabilidad de Avancys. Los meses cerrados son automáticos;
      los que todavía no están completos y el mes en curso son <strong>proyecciones (≈)</strong>: lo registrado más lo que falta, estimado con el último mes cerrado
      y, para el mes en curso, con lo contratado en las órdenes de servicio. Es un modelo en afinación: se vuelve más preciso a medida que las áreas registran completo en Avancys.
    </p>
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Línea</th>{meses.map(fila => <th key={fila.mes}>{nombreMes(fila.mes)}{fila.proyeccion ? <><br /><span className="siio-secondary">{fila.motivo === 'Mes en curso' ? 'en vivo · proyección' : 'proyección'}</span></> : null}</th>)}</tr></thead>
      <tbody>{GRUPOS.map(g => <Fragment key={g.grupo}>
        {lineas.filter(l => l.grupo === g.grupo).map(l => <tr key={l.clave}>
          <td title={`Cuentas ${l.cuentas}`}>{l.etiqueta}{l.clave === 'ing_vigilancia' ? ' (con provisión)' : ''}</td>
          {meses.map(fila => <td key={fila.mes}>{celda(fila, valores(fila)[l.clave] || 0, l.clave)}</td>)}
        </tr>)}
        <tr><td><strong>{g.totalEtiqueta}</strong></td>{meses.map(fila => <td key={fila.mes}><strong>{celda(fila, totalesDe(fila)[g.total])}</strong>
          {g.total !== 'ingresos' ? <span className="siio-secondary"> · {pct(totalesDe(fila)[g.total], totalesDe(fila).ingresos)}</span> : null}</td>)}</tr>
      </Fragment>)}
      {conOficial ? <>
        <tr><td colSpan={meses.length + 1}><strong>Cierre oficial de Finanzas (Excel cargado)</strong></td></tr>
        <tr><td>Ingresos</td>{meses.map(fila => <td key={fila.mes}>{oficialDe(fila.mes) ? millones(oficialDe(fila.mes)!.ingresos) : <span className="siio-secondary">sin cierre</span>}</td>)}</tr>
        <tr><td>Utilidad operacional</td>{meses.map(fila => { const o = oficialDe(fila.mes); return <td key={fila.mes}>{o ? <>{millones(o.utilidad_operacional)} <span className="siio-secondary">· {pct(o.utilidad_operacional, o.ingresos)}</span></> : <span className="siio-secondary">—</span>}</td>; })}</tr>
        <tr><td>Antes de impuestos</td>{meses.map(fila => { const o = oficialDe(fila.mes); return <td key={fila.mes}>{o ? millones(o.utilidad_operacional + o.resultado_no_operacional) : <span className="siio-secondary">—</span>}</td>; })}</tr>
      </> : null}</tbody>
    </table></div>
    {prov ? <p className="siio-pulse-footnote">
      <strong>Provisión de ingresos mes vencido ({nombreMes(ultimoCerrado?.mes)}):</strong> se suma el servicio prestado y no facturado ({millones(prov.del_mes)}) y se resta el del mes anterior, que se facturó en este ({millones(prov.del_mes_anterior)}): ajuste de {millones(prov.ajuste)}.
      {' '}Por cliente: {prov.clientes.map(k => `${k.nombre} ${millones(k.devengado)}`).join(' · ') || '—'}.
      {prov.error ? ` No se pudo calcular completa: ${prov.error}.` : ''}
    </p> : null}
    <p className="siio-pulse-footnote">
      {meses.filter(fila => fila.proyeccion).map(fila => `${nombreMes(fila.mes)}: ${fila.proyeccion!.estimadas.length} líneas estimadas con ${nombreMes(fila.proyeccion!.base_mes)}${fila.proyeccion!.ingresos_ordenes !== null ? `; ingresos por lo contratado en órdenes de servicio (${millones(fila.proyeccion!.ingresos_ordenes)})` : ''}`).join('. ')}.
      {' '}{sinClasificar.length ? `Cuentas de resultados que no caen en ninguna línea: ${sinClasificar.map(c => `${c.cuenta} (${nombreMes(c.mes)}) ${millones(c.valor)}`).join(' · ')}.` : 'Todas las cuentas de resultados quedaron clasificadas.'}
      {' '}En gris, lo estimado. Pasa el cursor sobre cada línea para ver qué cuentas suma.
    </p>
  </>;
}
