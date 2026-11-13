import { Fragment, useEffect, useState } from 'react';
import type React from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';
import { SiioPresupuesto } from './SiioPresupuesto';
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
type RubroEjecucion = { clave: string; etiqueta: string; ejecutado: number; pct: number | null; presupuesto: number | null; diferencia: number | null };
export type UnidadEjecucion = { ingresos: number; costos: number; rentabilidad: number | null; rentabilidad_presupuesto: number | null; rubros: RubroEjecucion[] };
type MesPresupuesto = {
  mes: string; estado: 'cerrado' | 'parcial' | null; presupuesto_anio: string | null; sin_mapeo: { cuenta: string; valor: number }[]; sin_mapeo_cuentas: number;
  vigilancia: UnidadEjecucion;
  tecnologia: UnidadEjecucion;
};
export type Presupuesto = { disponible: boolean; motivo?: string; sin_confirmar?: string[]; meses?: Record<string, MesPresupuesto> };
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
  presupuesto?: Presupuesto | null;
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
// Lo que muestran las cifras de un mes, venga del automático o del Excel de Finanzas.
type Resumen = { ingresos: number; costos: number; gastos: number; utilidad: number; fuente: string };

const ETIQUETA_FUENTE: Record<OpcionMes['fuente'], string> = {
  oficial: 'Cierre de Finanzas', automatico: 'Automático', proyeccion: 'Proyección', en_vivo: 'En vivo',
};

// Los datos de Avancys para toda la Torre: el pulso de arriba, las alertas y las pestañas leen de
// aquí, con un solo selector de mes (Juan, 2026-11-13: "resumen arriba y pestañas").
export function useTorreAvancys(oficial: FinancialPulse | null) {
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [torre, setTorre] = useState<Torre | null>(null);
  const [error, setError] = useState('');
  const [mesElegido, setMesElegido] = useState('');

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
      if (!porMes.has(fila.mes)) porMes.set(fila.mes, { mes: fila.mes, etiqueta: ETIQUETA_FUENTE[fuente], fuente });
    }
    return [...porMes.values()].sort((x, y) => x.mes.localeCompare(y.mes));
  })();
  // Se entra al mes en curso, en vivo (Juan, 2026-11-13); mientras Avancys no responde, al último mes que haya.
  const enVivo = opciones.find(o => o.fuente === 'en_vivo')?.mes;
  const mes = mesElegido || enVivo || opciones[opciones.length - 1]?.mes || '';
  const opcion = opciones.find(o => o.mes === mes) || null;
  const oficialDe = (m: string) => {
    const [anio, numero] = m.split('-').map(Number);
    return oficial?.months.find(x => x.year === anio && x.month === numero)?.totals || null;
  };
  const resumenDe = (m: string): Resumen | null => {
    const o = oficialDe(m);
    // El cierre oficial manda cuando existe; si no, el automático (o su proyección).
    if (o) return { ingresos: o.ingresos, costos: -Math.abs(o.costos), gastos: -Math.abs(o.gastos_operacionales), utilidad: o.utilidad_operacional, fuente: 'cierre de Finanzas' };
    const f = pyg.find(fila => fila.mes === m);
    if (!f) return null;
    const t = f.proyeccion ? f.proyeccion.totales : f.totales;
    return { ingresos: t.ingresos, costos: t.costos, gastos: t.gastos, utilidad: t.utilidad_ordinaria, fuente: f.proyeccion ? 'proyección con Avancys' : 'Avancys' };
  };
  const indice = opciones.findIndex(o => o.mes === mes);
  const mesPrevio = indice > 0 ? opciones[indice - 1].mes : null;

  const antesDeAvancys = Boolean(torre?.primera_linea && mes && mes < torre.primera_linea.slice(0, 7));
  return {
    estado, error, torre, cargar, opciones, mes, setMes: setMesElegido, opcion, resumen: resumenDe(mes), resumenDe, mesPrevio,
    previo: mesPrevio ? resumenDe(mesPrevio) : null,
    antesDeAvancys, oficial,
  };
}
export type TorreAvancys = ReturnType<typeof useTorreAvancys>;

const esEstimado = (o: OpcionMes | null) => o?.fuente === 'proyeccion' || o?.fuente === 'en_vivo';

// La franja de arriba: una frase con el resultado del mes, el selector y la tendencia del año, en una franja
// corta (Juan, 2026-11-13: «mucho espacio para decir tan poco»). Una proyección no se presenta
// como un resultado: va en gris y lo dice.
export function SiioPulsoMes({ t }: { t: TorreAvancys }) {
  const { estado, error, torre, opciones, mes, setMes, opcion, resumen, previo, mesPrevio, resumenDe } = t;
  const estimado = esEstimado(opcion);
  const tendencia = opciones.map(o => ({ ...o, r: resumenDe(o.mes) })).filter(o => o.r && o.r.ingresos);
  const maximo = Math.max(0.01, ...tendencia.map(o => Math.abs(o.r!.utilidad / o.r!.ingresos)));
  const oficiales = tendencia.filter(o => o.fuente === 'oficial');
  const deAvancys = tendencia.filter(o => o.fuente !== 'oficial');
  const tramo = (lista: typeof tendencia) => (lista.length ? `${nombreMes(lista[0].mes).split(' ')[0]}${lista.length > 1 ? `–${nombreMes(lista[lista.length - 1].mes).split(' ')[0]}` : ''}` : '');
  return <section className="panel siio-pulso" aria-label="Resultado del mes">
    <div className="siio-pulso-texto">
      <div className="siio-pulso-cabeza">
        <label className="siio-pulso-mes">Mes
          <select value={mes} onChange={evento => setMes(evento.target.value)} disabled={!opciones.length}>
            {opciones.map(o => <option key={o.mes} value={o.mes}>{nombreMes(o.mes)} · {o.etiqueta}</option>)}
          </select>
        </label>
        {torre?.medido_en ? <span className="siio-secondary">Avancys leído el {hora(torre.medido_en).replace(/\.$/, '')}{torre.desde_memoria ? ' (guardado)' : ''} · <button type="button" className="siio-link-button" onClick={() => void t.cargar(true)}>Volver a leer</button></span> : null}
      </div>
      {estado === 'cargando' && !resumen ? <p className="siio-pulso-frase siio-secondary">Leyendo la contabilidad de Avancys…</p> : null}
      {estado === 'error' ? <p className="siio-alert-text">No se pudo leer Avancys: {error}</p> : null}
      {resumen ? <>
        {estimado ? <h2 className="siio-pulso-frase siio-pulso-estimado">
          {nombreMes(mes).replace(/^./, letra => letra.toUpperCase())} va en <strong>≈ {millones(resumen.utilidad)}</strong>, {pct(resumen.utilidad, resumen.ingresos)} de los ingresos
        </h2> : <h2 className="siio-pulso-frase">
          En {nombreMes(mes)} {resumen.utilidad >= 0 ? 'ganamos' : 'perdimos'} <strong>{millones(Math.abs(resumen.utilidad))}</strong>
          {' '}<span className={resumen.utilidad >= 0 ? 'siio-pulso-ok' : 'siio-pulso-mal'}>{pct(resumen.utilidad, resumen.ingresos)} de los ingresos</span>
        </h2>}
        <p className="siio-pulso-apoyo">
          {estimado ? <><Badge tone="amber">Proyección</Badge> El mes no está completo en la contabilidad: lo registrado más lo que falta, estimado. </> : null}
          Ingresos {estimado ? '≈ ' : ''}{millones(resumen.ingresos)}{previo && mesPrevio ? <> · {nombreMes(mesPrevio).split(' ')[0]} {pct(previo.utilidad, previo.ingresos)}</> : null} · fuente: {resumen.fuente}.
        </p>
      </> : null}
    </div>
    {tendencia.length > 1 ? <div className="siio-pulso-grafico">
      <ol className="siio-pulso-tendencia" aria-label="Margen operacional de cada mes del año">
        {tendencia.map(o => {
          const valor = o.r!.utilidad / o.r!.ingresos;
          return <li key={o.mes} className={[o.mes === mes ? 'actual' : '', valor < 0 ? 'negativo' : '', esEstimado(o) ? 'estimado' : '', o.fuente === 'oficial' ? 'oficial' : ''].join(' ').trim()}>
            <button type="button" onClick={() => setMes(o.mes)} aria-pressed={o.mes === mes} title={`${nombreMes(o.mes)} · ${o.etiqueta}`}>
              <span className="barra" style={{ height: `${Math.max(4, Math.round((Math.abs(valor) / maximo) * 28))}px` }} />
              <span className="valor">{esEstimado(o) ? '≈' : ''}{pct(o.r!.utilidad, o.r!.ingresos).replace(' %', '%')}</span>
              <span className="mes">{nombreMes(o.mes).slice(0, 3)}</span>
            </button>
          </li>;
        })}
      </ol>
      <p className="siio-pulso-leyenda">
        {oficiales.length ? <><span className="muestra oficial" /> {tramo(oficiales)}: cierre de Finanzas </> : null}
        {deAvancys.length ? <><span className="muestra" /> {tramo(deAvancys)}: Avancys </> : null}
        <span className="muestra estimado" /> proyección
      </p>
    </div> : null}
  </section>;
}

// Lo que pide una decisión hoy: no depende del mes elegido arriba (Juan, 2026-11-13: «se ve una nota que va y viene»).
// Cada tarjeta es una cifra y una línea; «Ver» lleva a su pestaña.
export type AlertaTorre = { clave: string; cifra: string; texto: string; pestana: PestanaTorre };
export type PestanaTorre = 'resultados' | 'clientes' | 'cartera' | 'comercial' | 'vigia' | 'parametros' | 'fuentes';

const sinCodigo = (nombre: string) => nombre.replace(/^\[\d+\]\s*/, '').replace(/\s+(S\.?A\.?S?\.?|LTDA\.?)$/i, '');

export function alertasDeAvancys(t: TorreAvancys): AlertaTorre[] {
  const salida: AlertaTorre[] = [];
  // Lo que deja cada cliente se juzga con el último mes cerrado: un mes a medias tiene la nómina incompleta.
  const k = t.torre?.clientes;
  const enPerdida = (k?.clientes || []).filter(fila => fila.ingresos > 0 && fila.margen < 0);
  if (enPerdida.length) {
    const mayor = [...enPerdida].sort((a, b) => b.ingresos - a.ingresos)[0];
    salida.push({ clave: 'clientes', pestana: 'clientes', cifra: `${enPerdida.length} clientes`,
      texto: `pierden plata en ${nombreMes(t.torre?.mes_cerrado)} (${millones(enPerdida.reduce((s, f) => s + f.margen, 0))}); el más grande, ${sinCodigo(mayor.cliente)}.` });
  }
  const c = t.torre?.cartera;
  if (c?.total && c.vencido && c.total.saldo) {
    salida.push({ clave: 'cartera', pestana: 'cartera', cifra: millones(c.vencido.saldo), texto: `de cartera vencida, el ${pct(c.vencido.saldo, c.total.saldo)} de lo que nos deben.` });
  }
  const parcial = (t.torre?.pyg || []).find(fila => fila.estado === 'parcial' && fila.motivo !== 'Mes en curso');
  if (parcial) salida.push({ clave: 'nomina', pestana: 'resultados', cifra: nombreMes(parcial.mes).split(' ')[0].replace(/^./, letra => letra.toUpperCase()),
    texto: `sigue abierto en la contabilidad (${(parcial.motivo || '').toLowerCase()}): su resultado es una proyección.` });
  return salida;
}

export function SiioRequiereDecision({ alertas, onIr }: { alertas: AlertaTorre[]; onIr: (pestana: PestanaTorre) => void }) {
  if (!alertas.length) return null;
  return <section className="panel siio-decide" aria-label="Requiere decisión hoy">
    <h2>Requiere decisión hoy</h2>
    <ul>{alertas.map(alerta => <li key={alerta.clave}>
      <button type="button" onClick={() => onIr(alerta.pestana)}>
        <strong>{alerta.cifra}</strong>
        <span>{alerta.texto}</span>
        <small>Ver</small>
      </button>
    </li>)}</ul>
  </section>;
}

export function SiioPestanaResultados({ t }: { t: TorreAvancys }) {
  const { torre } = t;
  if (!torre?.pyg?.length || !torre.lineas_pyg) return <p className="siio-secondary">Sin datos de Avancys todavía.</p>;
  return <>
    <EstadoDeResultados lineas={torre.lineas_pyg} meses={torre.pyg} oficial={t.oficial} />
    <SiioPresupuesto presupuesto={torre.presupuesto || null} mes={t.mes} />
  </>;
}

// Clientes con su propio selector de mes y la historia de los que pierden (Juan, 2026-11-13: «una sección donde uno
// pueda entrar y cambiar de mes sobre esa parte»). Sólo meses cerrados: con la nómina a medias el costo no se sabe.
export function SiioPestanaClientes({ t }: { t: TorreAvancys }) {
  const torre = t.torre;
  const primero = torre?.primera_linea?.slice(0, 7) || '';
  const cerrados = (torre?.pyg || []).filter(fila => fila.estado === 'cerrado' && fila.mes >= primero).map(fila => fila.mes);
  const [elegido, setElegido] = useState('');
  const [porMes, setPorMes] = useState<Record<string, Clientes | 'cargando' | 'error'>>({});
  const mesClientes = elegido || torre?.mes_cerrado || cerrados[cerrados.length - 1] || '';
  const datosDe = (mes: string): Clientes | 'cargando' | 'error' | undefined => (mes === torre?.mes_cerrado && torre?.clientes ? torre.clientes : porMes[mes]);
  useEffect(() => {
    let vigente = true;
    for (const mes of cerrados) {
      if (mes === torre?.mes_cerrado || porMes[mes]) continue;
      setPorMes(actual => ({ ...actual, [mes]: 'cargando' }));
      api<Clientes>(`/api/siio/avancys/rentabilidad-aproximada?mes=${encodeURIComponent(mes)}`)
        .then(datos => { if (vigente) setPorMes(actual => ({ ...actual, [mes]: datos })); })
        .catch(() => { if (vigente) setPorMes(actual => ({ ...actual, [mes]: 'error' })); });
    }
    return () => { vigente = false; };
  }, [cerrados.join(','), torre?.mes_cerrado]);

  if (!cerrados.length) return <p className="siio-secondary">Todavía no hay un mes cerrado en Avancys para ver lo que deja cada cliente.</p>;
  // Historia: los clientes que perdieron en algún mes cerrado, con su margen en cada mes.
  const legibles = cerrados.map(mes => ({ mes, datos: datosDe(mes) })).filter((x): x is { mes: string; datos: Clientes } => typeof x.datos === 'object' && Boolean(x.datos?.legible));
  const historia = new Map<string, { nombre: string; meses: Record<string, Cliente> }>();
  for (const { mes, datos } of legibles) {
    for (const fila of datos.clientes || []) {
      const clave = nitDe(fila.cliente) || fila.cliente;
      const actual = historia.get(clave) || { nombre: fila.cliente, meses: {} };
      actual.meses[mes] = fila;
      historia.set(clave, actual);
    }
  }
  const pierdenAlguna = [...historia.values()].filter(fila => Object.values(fila.meses).some(m => m.ingresos > 0 && m.margen < 0))
    .map(fila => ({ ...fila, perdidas: Object.values(fila.meses).filter(m => m.ingresos > 0 && m.margen < 0).length, ingreso: Math.max(...Object.values(fila.meses).map(m => m.ingresos)) }))
    .sort((a, b) => b.perdidas - a.perdidas || b.ingreso - a.ingreso);
  const cargando = cerrados.some(mes => datosDe(mes) === 'cargando');
  return <>
    <div className="siio-clientes-meses" role="group" aria-label="Mes de los clientes">
      <span>Mes cerrado</span>
      {cerrados.map(mes => <button key={mes} type="button" aria-pressed={mes === mesClientes} className={mes === mesClientes ? 'active' : ''} onClick={() => setElegido(mes)}>{nombreMes(mes)}</button>)}
    </div>
    {legibles.length > 1 || pierdenAlguna.length ? <section aria-label="Clientes que pierden, mes a mes">
      <h3>Los que pierden, mes a mes</h3>
      {cargando ? <p className="siio-pulse-footnote">Calculando los otros meses…</p> : null}
      {pierdenAlguna.length ? <div className="siio-table-wrap"><table>
        <thead><tr><th>Cliente</th>{legibles.map(({ mes }) => <th key={mes}>{nombreMes(mes).split(' ')[0]}</th>)}</tr></thead>
        <tbody>{pierdenAlguna.slice(0, MAX_CLIENTES).map(fila => <tr key={fila.nombre}>
          <td>{fila.nombre.replace(/^\[\d+\]\s*/, '')}{fila.perdidas === legibles.length && legibles.length > 1 ? <> <Badge tone="danger">todos los meses</Badge></> : null}</td>
          {legibles.map(({ mes }) => {
            const m = fila.meses[mes];
            return <td key={mes} className={m && m.margen < 0 ? 'siio-celda-mal' : undefined}>{m ? <>{millones(m.margen)} · {pct(m.margen, m.ingresos)}</> : '—'}</td>;
          })}
        </tr>)}</tbody>
      </table></div> : <p className="siio-secondary">Ningún cliente pierde en los meses cerrados.</p>}
    </section> : null}
    <DetalleClientes mes={mesClientes} datos={datosDe(mesClientes)} />
  </>;
}

function DetalleClientes({ mes, datos }: { mes: string; datos: Clientes | 'cargando' | 'error' | undefined }) {
  if (datos === 'cargando' || datos === undefined) return <p className="siio-secondary">Calculando los clientes de {nombreMes(mes)}…</p>;
  if (datos === 'error' || datos.legible === false) return <p className="siio-alert-text">No se pudieron calcular los clientes de {nombreMes(mes)}{datos !== 'error' && datos.motivo ? `: ${datos.motivo}` : ''}.</p>;
  const k = datos;
  const costoHora = Math.abs(k.costo_por_hora ?? 0);
  const conIngreso = (k.clientes || []).filter(fila => fila.ingresos > 0);
  const pierden = conIngreso.filter(fila => fila.margen < 0);
  const filas = [...pierden, ...conIngreso.filter(fila => fila.margen >= 0)].slice(0, MAX_CLIENTES);
  return <section aria-label={`Clientes de ${nombreMes(mes)}`}>
    <h3>{nombreMes(mes).replace(/^./, letra => letra.toUpperCase())}, cliente por cliente</h3>
    <p className="siio-pulse-footnote">
      <strong>Aproximado</strong>: ingreso real de cada cliente; costo de vigilantes a {pesos(costoHora)} la hora por las horas de sus puestos; supervisión y administración por facturación.
      {' '}Primero los que pierden; luego los de mayor ingreso.
    </p>
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Cliente</th><th>Ingreso</th><th>Peso</th><th>Precio por hora</th><th>Margen (est.)</th></tr></thead>
      <tbody>{filas.map(fila => <tr key={fila.cliente} className={fila.margen < 0 ? 'siio-fila-alerta' : undefined}>
        <td>{fila.cliente.replace(/^\[\d+\]\s*/, '')}</td>
        <td>{millones(fila.ingresos)}</td>
        <td>{pct(fila.ingresos, k.ingresos_clientes ?? 0)}</td>
        <td>{fila.precio_hora ? <>{pesos(fila.precio_hora)}{costoHora && fila.precio_hora < costoHora ? <> <Badge tone="danger">bajo el costo</Badge></> : null}</> : <span className="siio-secondary">sin horas</span>}</td>
        <td>{millones(fila.margen)} · {pct(fila.margen, fila.ingresos)}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="siio-pulse-footnote">{conIngreso.length.toLocaleString('es-CO')} clientes con ingreso; se muestran {filas.length}. Para los que se facturan mes vencido, el ingreso de un mes corresponde al servicio del anterior.</p>
  </section>;
}

export function SiioPestanaCartera({ t }: { t: TorreAvancys }) {
  const c = t.torre?.cartera;
  if (c?.error) return <p className="siio-alert-text">No se pudo leer la cartera: {c.error}</p>;
  if (!c?.total || !c.vencido) return <p className="siio-secondary">Sin datos de cartera todavía.</p>;
  const ingresoMes = new Map((t.torre?.clientes?.clientes || []).map(fila => [nitDe(fila.cliente), fila.ingresos]));
  const cerrado = t.torre?.mes_cerrado ? t.resumenDe(t.torre.mes_cerrado) : null;
  const dias = cerrado?.ingresos ? Math.round((c.total.saldo / (cerrado.ingresos * 1.19)) * 30) : null;
  return <>
    <div className="siio-key-grid siio-key-grid-4">
      <Cifra etiqueta="Por cobrar hoy" valor={millones(c.total.saldo)} comparacion={dias ? `≈ ${dias} días de facturación` : null} />
      <Cifra etiqueta="Vencida" valor={millones(c.vencido.saldo)} alerta={c.vencido.saldo > c.total.saldo / 2} comparacion={`${pct(c.vencido.saldo, c.total.saldo)} de la cartera`} />
      {(c.tramos || []).slice(1, 3).map(tramo => <Cifra key={tramo.tramo} etiqueta={`Vencida ${tramo.tramo}`} valor={millones(tramo.saldo)} alerta={tramo.tramo.startsWith('61') && tramo.saldo > 0} />)}
    </div>
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Quién debe más (vencido)</th><th>Vencido</th><th>Equivale a</th></tr></thead>
      <tbody>{(c.deudores || []).map(fila => {
        const mensual = ingresoMes.get(nitDe(fila.cliente));
        const meses = mensual ? fila.vencido / mensual : null;
        return <tr key={fila.cliente} className={meses !== null && meses >= 2 ? 'siio-fila-alerta' : undefined}>
          <td>{fila.cliente.replace(/^(\[[^\]]+\]\s*)+/, '')}</td>
          <td>{millones(fila.vencido)}</td>
          <td>{meses !== null ? `${(Math.round(meses * 10) / 10).toLocaleString('es-CO')} meses de facturación` : <span className="siio-secondary">—</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="siio-pulse-footnote">Facturas publicadas en Avancys al {c.hoy}. La historia de Avancys empieza en agosto de 2026.</p>
  </>;
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
  // Por defecto solo los subtotales: las 17 líneas, a pedido (Juan, 2026-11-13: "miles de cifras").
  const [detalle, setDetalle] = useState(false);
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
    <div className="siio-pyg-cabeza">
      <h3>Estado de resultados · mismas líneas que el PYG de Finanzas</h3>
      <button type="button" className="siio-link-button" onClick={() => setDetalle(!detalle)} aria-expanded={detalle}>{detalle ? 'Ver solo los totales' : 'Ver las 17 líneas'}</button>
    </div>
    <div className="siio-table-wrap"><table>
      <thead><tr><th>Línea</th>{meses.map(fila => <th key={fila.mes}>{nombreMes(fila.mes)}{fila.proyeccion ? <><br /><span className="siio-secondary">{fila.motivo === 'Mes en curso' ? 'en vivo · proyección' : 'proyección'}</span></> : null}</th>)}</tr></thead>
      <tbody>{GRUPOS.map(g => <Fragment key={g.grupo}>
        {detalle ? lineas.filter(l => l.grupo === g.grupo).map(l => <tr key={l.clave}>
          <td title={`Cuentas ${l.cuentas}`}>{l.etiqueta}{l.clave === 'ing_vigilancia' ? ' (con provisión)' : ''}</td>
          {meses.map(fila => <td key={fila.mes}>{celda(fila, valores(fila)[l.clave] || 0, l.clave)}</td>)}
        </tr>) : null}
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
    <details className="siio-como">
      <summary>Cómo se calculó</summary>
      <p className="siio-pulse-footnote">Armado solo desde la contabilidad de Avancys. Los meses cerrados son automáticos; los que no están completos y el mes en curso son proyecciones (≈): lo registrado más lo que falta, estimado con el último mes cerrado y, para el mes en curso, con lo contratado en las órdenes de servicio.</p>
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
    </details>
  </>;
}
