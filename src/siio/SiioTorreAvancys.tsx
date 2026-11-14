import { Fragment, useEffect, useState } from 'react';
import type React from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';
import { mesComparable, SiioPresupuesto } from './SiioPresupuesto';
import type { FinancialPulse } from './financialPulse';
import { diasDesdeFinDeMes } from './fuentesAlDia';

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
export type CreditoAvancys = { numero: string | null; banco: string | null; monto: number; saldo: number; tasa_periodo: number; meses_por_periodo: number; tasa_ea: number | null; cuotas_por_pagar: number; desembolso: string | null; fecha_final: string | null; proxima_cuota: { fecha: string; valor: number } | null };
export type Creditos = { error?: string; registradas?: CreditoAvancys[]; saldo_registrado?: number; deuda_contable?: number; sin_registrar?: { tercero: string; contable: number; registrado: number; diferencia: number }[] };
type Cartera = { error?: string; hoy?: string; total?: Saldo; vencido?: Saldo; tramos?: ({ tramo: string } & Saldo)[]; deudores?: { cliente: string; vencido: number; facturas: number }[]; heredado_yeminus?: Saldo; consignaciones_sin_identificar?: { saldo: number; partidas: number } };
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
  bloqueo_contable?: string | null;
  programaciones_avancys?: number | null;
  creditos?: Creditos | null;
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
const pct = (parte: number, base: number) => (base ? `${(Math.round((parte / base) * 1000) / 10).toLocaleString('es-CO').replace('-', '−')} %` : '—');
const hora = (valor?: string) => (valor
  ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(valor))
  : '');
const MAX_CLIENTES = 15;
const MESES_PIERDEN = 3;
const IVA = 1.19;

type OpcionMes = { mes: string; etiqueta: string; fuente: 'oficial' | 'automatico' | 'proyeccion' | 'en_vivo' };
// Lo que muestran las cifras de un mes, venga del automático o del Excel de Finanzas.
type Resumen = { ingresos: number; costos: number; gastos: number; utilidad: number; fuente: string };

const ETIQUETA_FUENTE: Record<OpcionMes['fuente'], string> = {
  oficial: 'Cierre de Finanzas', automatico: 'Cerrado', proyeccion: 'Proyección', en_vivo: 'En vivo',
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

// Lo que pide una decisión hoy (contrato de la maqueta, Fase 3): cada fila arranca con la ficha del
// plazo en el color de su urgencia, sigue la frase con lo clave en tinta, y cierra con responsable y
// Ver. No repite lo que ya dicen los bloques; el dato atrasado se señala con área y días.
export type AlertaTorre = {
  clave: string;
  prioridad: 'alta' | 'media' | 'baja';
  ficha: { valor: string; unidad: string };
  frase: React.ReactNode;
  responsable: string;
  pestana: PestanaTorre;
};
export type PestanaTorre = 'portada' | 'resultados' | 'clientes' | 'cartera' | 'comercial' | 'vigia' | 'parametros' | 'fuentes';

// Nombre de cliente para leer: sin los códigos de Avancys («[AREA ADMINISTRACION] [891411663] …»), sin la
// sociedad al final y, si viene en mayúscula sostenida, en tipo oración con las palabras cortas en minúscula.
const PALABRAS_MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en', 'para']);
const sinCodigo = (nombre: string) => {
  const limpio = nombre.replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/(\s+(S\.?\s?A\.?\s?S?\.?|LTDA\.?|E\.?S\.?P\.?))+$/i, '').trim();
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio.toLowerCase().split(/\s+/).map((palabra, i) => (i && PALABRAS_MENORES.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1))).join(' ');
};

// Señales de Avancys para la lista de decisión: el cierre contable que no llega y los clientes que
// deben dos meses o más. Clientes en pérdida y cartera vencida viven en los bloques, no aquí.
export function alertasDeAvancys(t: TorreAvancys, hoy = new Date()): AlertaTorre[] {
  const salida: AlertaTorre[] = [];
  const torre = t.torre;
  if (torre?.mes_cerrado) {
    const bloqueo = torre.bloqueo_contable || null;
    if (!bloqueo || bloqueo.slice(0, 7) < torre.mes_cerrado) {
      const dias = diasDesdeFinDeMes(torre.mes_cerrado, hoy);
      const abiertos = (torre.pyg || []).filter(fila => fila.estado === 'parcial' && fila.motivo !== 'Mes en curso').map(fila => nombreMes(fila.mes).split(' ')[0]);
      salida.push({ clave: 'bloqueo', prioridad: 'alta', pestana: 'fuentes', responsable: 'Contabilidad',
        ficha: { valor: `${dias} días`, unidad: 'sin cierre' },
        frase: <><strong>Ningún mes tiene bloqueo contable en Avancys</strong>: {nombreMes(torre.mes_cerrado).split(' ')[0]} lleva {dias} días sin cierre formal{abiertos.length ? `; ${abiertos.join(' y ')} sigue abierto` : ''}.</> });
    }
  }
  const c = torre?.cartera;
  const ingresoMes = new Map((torre?.clientes?.clientes || []).map(fila => [nitDe(fila.cliente), fila.ingresos]));
  const morosos = (c?.deudores || []).filter(fila => {
    const mensual = ingresoMes.get(nitDe(fila.cliente));
    return mensual ? fila.vencido / (mensual * IVA) >= 2 : false;
  });
  if (morosos.length) {
    salida.push({ clave: 'morosos', prioridad: 'media', pestana: 'cartera', responsable: 'Cartera',
      ficha: { valor: '2 meses', unidad: 'sin pagar' },
      frase: <><strong>{morosos.length === 1 ? '1 cliente debe dos meses o más' : `${morosos.length} clientes deben dos meses o más`}</strong> de su facturación; el mayor, {sinCodigo(morosos[0].cliente)}.</> });
  }
  return salida;
}

const ORDEN_PRIORIDAD = { alta: 0, media: 1, baja: 2 } as const;
export const MAX_DECISIONES = 5;

export function SiioRequiereDecision({ alertas, onIr }: { alertas: AlertaTorre[]; onIr: (pestana: PestanaTorre) => void }) {
  if (!alertas.length) return null;
  const ordenadas = [...alertas].sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad]).slice(0, MAX_DECISIONES);
  return <section className="siio-panel siio-panel-decision" aria-label="Requiere decisión hoy">
    <h2>Requiere decisión hoy <span className="siio-conteo">{ordenadas.length}</span></h2>
    <ol className="siio-decision">
      {ordenadas.map(alerta => <li key={alerta.clave}>
        <button type="button" aria-label={`Prioridad ${alerta.prioridad}`} onClick={() => onIr(alerta.pestana)}>
          <span className={`siio-plazo ${alerta.prioridad === 'baja' ? '' : alerta.prioridad}`}><strong>{alerta.ficha.valor}</strong><small>{alerta.ficha.unidad}</small></span>
          <span className="frase">{alerta.frase}</span>
          <span className="quien">{alerta.responsable}</span>
          <span className="ver">Ver →</span>
        </button>
      </li>)}
    </ol>
  </section>;
}

// La portada aprobada: la frase del último mes cerrado con los meses abiertos como estimados y la
// tendencia mínima a la derecha; debajo, los tres bloques de pregunta.
export function SiioPortada({ t, onIr }: { t: TorreAvancys; onIr: (pestana: PestanaTorre, mes?: string) => void }) {
  const { torre, estado, error } = t;
  const cerrado = torre?.mes_cerrado || null;
  const resumen = cerrado ? t.resumenDe(cerrado) : null;
  const abiertos = (torre?.pyg || []).filter(fila => fila.estado === 'parcial' && (!cerrado || fila.mes > cerrado)).sort((a, b) => b.mes.localeCompare(a.mes));
  const tendencia = t.opciones.map(o => ({ ...o, r: t.resumenDe(o.mes) })).filter(o => o.r && o.r.ingresos);
  const maximo = Math.max(0.01, ...tendencia.map(o => Math.abs(o.r!.utilidad / o.r!.ingresos)));
  return <>
    <section className="siio-panel siio-frase-mes" aria-label="Resultado del último mes cerrado">
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        {estado === 'cargando' && !resumen ? <p className="siio-secondary">Leyendo la contabilidad de Avancys…</p> : null}
        {estado === 'error' ? <p className="siio-alert-text">No se pudo leer Avancys: {error}</p> : null}
        {resumen && cerrado ? <h2>
          En {nombreMes(cerrado).split(' ')[0]} {resumen.utilidad >= 0 ? 'ganamos' : 'perdimos'} <strong>{millones(Math.abs(resumen.utilidad))}</strong>,
          {' '}<span className={resumen.utilidad >= 0 ? 'pct-bien' : 'pct-mal'}>{pct(resumen.utilidad, resumen.ingresos)} de los ingresos</span>
          {' '}<span className="siio-chip cerrado">Cerrado</span>
        </h2> : null}
        {abiertos.length ? <p className="encurso">{abiertos.map((fila, indice) => {
          const r = t.resumenDe(fila.mes);
          if (!r) return null;
          const nombre = nombreMes(fila.mes).split(' ')[0];
          return <Fragment key={fila.mes}>{indice ? ' · ' : ''}{fila.motivo === 'Mes en curso'
            ? <>{nombre.replace(/^./, letra => letra.toUpperCase())} va en ≈ {millones(r.utilidad)} ({pct(r.utilidad, r.ingresos)})</>
            : <><span className="plazo">{nombre} sigue abierto</span> (≈ {pct(r.utilidad, r.ingresos)})</>}</Fragment>;
        })}.</p> : null}
        {torre?.medido_en ? <p className="siio-nota">Avancys leído el {hora(torre.medido_en).replace(/\.$/, '')}{torre.desde_memoria ? ' (guardado)' : ''} · <button type="button" className="siio-enlace" onClick={() => void t.cargar(true)}>Volver a leer</button></p> : null}
      </div>
      {tendencia.length > 1 ? <ol className="siio-meses-mini" aria-label="Margen de cada mes; pulse un mes para verlo en Resultados">
        {tendencia.map(o => {
          const valor = o.r!.utilidad / o.r!.ingresos;
          return <li key={o.mes} className={[o.mes === cerrado ? 'act' : '', valor < 0 ? 'neg' : '', esEstimado(o) ? 'est' : ''].join(' ').trim()}>
            <button type="button" title={`${nombreMes(o.mes)} · ${o.etiqueta} · ${pct(o.r!.utilidad, o.r!.ingresos)}`} onClick={() => onIr('resultados', o.mes)}>
              <span className="barra" style={{ height: `${Math.max(3, Math.round((Math.abs(valor) / maximo) * 28))}px` }} />
              {nombreMes(o.mes).slice(0, 3)}
            </button>
          </li>;
        })}
      </ol> : null}
    </section>
    <div className="siio-bloques">
      <BloqueClientes t={t} onIr={onIr} />
      <BloqueCartera t={t} onIr={onIr} />
      <BloquePresupuesto t={t} onIr={onIr} />
    </div>
  </>;
}

function Bloque({ pregunta, chip, cifra, children, ver, onVer }: { pregunta: string; chip?: React.ReactNode; cifra: React.ReactNode; children: React.ReactNode; ver: string; onVer: () => void }) {
  return <section className="siio-bloque" aria-label={pregunta}>
    <h3>{pregunta}{chip ? <> {chip}</> : null}</h3>
    {cifra ? <strong>{cifra}</strong> : null}
    {children}
    <button type="button" className="siio-link-button" onClick={onVer}>{ver} →</button>
  </section>;
}

function BloqueClientes({ t, onIr }: { t: TorreAvancys; onIr: (pestana: PestanaTorre) => void }) {
  const k = t.torre?.clientes;
  const conIngreso = (k?.clientes || []).filter(fila => fila.ingresos > 0);
  const pierden = conIngreso.filter(fila => fila.margen < 0).sort((a, b) => b.ingresos - a.ingresos);
  const mes = nombreMes(t.torre?.mes_cerrado).split(' ')[0];
  if (!k?.legible) return <Bloque pregunta="¿Quién nos hace perder?" cifra="—" ver="Ver clientes" onVer={() => onIr('clientes')}><p>Sin el detalle por cliente del último mes cerrado.</p></Bloque>;
  return <Bloque pregunta="¿Quién nos hace perder?" cifra={<>{pierden.length === 1 ? '1 cliente' : `${pierden.length} clientes`} · <em style={{ fontStyle: 'normal', color: 'var(--mal)' }}>{millones(pierden.reduce((suma, fila) => suma + fila.margen, 0))}</em></>} ver="Ver clientes" onVer={() => onIr('clientes')}>
    <p>{pierden.length ? <>En {mes}. El más grande: {sinCodigo(pierden[0].cliente)} ({pct(pierden[0].ingresos, k.ingresos_clientes ?? 0)} del ingreso).</> : <>Ningún cliente pierde plata en {mes}.</>}</p>
  </Bloque>;
}


function BloqueCartera({ t, onIr }: { t: TorreAvancys; onIr: (pestana: PestanaTorre) => void }) {
  const c = t.torre?.cartera;
  if (!c?.total || !c.vencido) return <Bloque pregunta="¿Nos están pagando?" cifra="—" ver="Ver cartera" onVer={() => onIr('cartera')}><p>{c?.error ? `No se pudo leer la cartera: ${c.error}` : 'Sin datos de cartera.'}</p></Bloque>;
  const total = c.total.saldo || 1;
  return <Bloque pregunta="¿Nos están pagando?" cifra={`${millones(c.vencido.saldo)} vencidos`} ver="Ver cartera" onVer={() => onIr('cartera')}>
    <div className="siio-barra" role="img" aria-label={`Cartera por antigüedad: ${[{ tramo: 'Al día', saldo: total - c.vencido.saldo }, ...(c.tramos || [])].map(x => `${x.tramo} ${millones(x.saldo)}`).join(', ')}`}>
      <span className="al-dia" style={{ width: `${((total - c.vencido.saldo) / total) * 100}%` }} />
      {(c.tramos || []).map((tramo, indice) => <span key={tramo.tramo} className={`t${Math.min(indice + 1, 4)}`} style={{ width: `${(tramo.saldo / total) * 100}%` }} />)}
    </div>
    <p>{pct(c.vencido.saldo, c.total.saldo)} de lo que nos deben ({millones(c.total.saldo)}).{(c.tramos || []).slice(1).some(tramo => tramo.saldo > 0) ? ` Más de 30 días: ${millones((c.tramos || []).slice(1).reduce((suma, tramo) => suma + tramo.saldo, 0))}.` : ''}</p>
  </Bloque>;
}

function BloquePresupuesto({ t, onIr }: { t: TorreAvancys; onIr: (pestana: PestanaTorre) => void }) {
  const fila = mesComparable(t.torre?.presupuesto || null, t.torre?.mes_cerrado || '9999-12');
  if (!fila) return <Bloque pregunta="¿Vamos dentro del presupuesto?" cifra="—" ver="Ver presupuesto" onVer={() => onIr('resultados')}><p>{t.torre?.presupuesto?.motivo || 'Todavía no hay un mes cerrado para comparar.'}</p></Bloque>;
  const unidades = [['Vigilancia', fila.vigilancia], ['Tecnología', fila.tecnologia]] as const;
  const pasados = fila.vigilancia.rubros.filter(rubro => rubro.diferencia !== null && rubro.diferencia >= 0.5).sort((a, b) => (b.diferencia || 0) - (a.diferencia || 0)).slice(0, 4);
  return <Bloque pregunta="¿Vamos dentro del presupuesto?" chip={<span className="siio-chip confirmar">Por confirmar</span>} cifra={null} ver="Ver presupuesto" onVer={() => onIr('resultados')}>
    <div className="siio-metas">
      {unidades.map(([nombre, u]) => {
        const real = u.rentabilidad ?? 0;
        const meta = u.rentabilidad_presupuesto;
        const escala = Math.max(Math.abs(real), Math.abs(meta ?? 0), 1);
        return <Fragment key={nombre}>
          <span>{nombre}</span>
          <span className="siio-meta-linea"><b className={meta !== null && real < meta ? 'mal' : ''} style={{ width: `${Math.max(0, (real / escala) * 100)}%` }} />{meta !== null ? <u style={{ left: `${Math.min(100, (meta / escala) * 100)}%` }} /> : null}</span>
          <span className="siio-num"><strong>{u.rentabilidad === null ? '—' : `${u.rentabilidad.toLocaleString('es-CO')} %`}</strong>{meta !== null ? <span className="meta"> / {meta.toLocaleString('es-CO')} %</span> : null}</span>
        </Fragment>;
      })}
    </div>
    <p>{nombreMes(fila.mes).replace(/^./, letra => letra.toUpperCase()).split(' ')[0]}. {pasados.length ? <>Se pasan en vigilancia: {pasados.slice(0, 2).map(rubro => `${rubro.etiqueta.toLowerCase()} (+${(rubro.diferencia || 0).toLocaleString('es-CO')} pts)`).join(', ')}.</> : 'Ningún rubro de vigilancia se pasa del presupuesto.'}</p>
  </Bloque>;
}

// Resultados (contrato de la maqueta, Fase 3): el selector de mes arriba; el estado de resultados con una
// columna por mes y su estado, el mes elegido como protagonista; y el presupuesto contra ejecución.
export function SiioPestanaResultados({ t }: { t: TorreAvancys }) {
  const { torre } = t;
  if (!torre?.pyg?.length || !torre.lineas_pyg) return <p className="siio-secondary">Sin datos de Avancys todavía.</p>;
  const oficiales = t.opciones.filter(o => o.fuente === 'oficial');
  const tramo = oficiales.length ? `${nombreMes(oficiales[0].mes).split(' ')[0]}–${nombreMes(oficiales[oficiales.length - 1].mes).split(' ')[0]}: cierre de Finanzas · ` : '';
  return <>
    <div className="siio-sub">
      <label className="siio-selector">Mes
        <select value={t.mes} onChange={evento => t.setMes(evento.target.value)}>
          {[...t.opciones].reverse().map(o => <option key={o.mes} value={o.mes}>{nombreMes(o.mes)} · {o.etiqueta}</option>)}
        </select>
      </label>
      <p className="siio-nota">{tramo}desde agosto: Avancys · ≈ proyección</p>
    </div>
    <EstadoDeResultados t={t} lineas={torre.lineas_pyg} meses={torre.pyg} />
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
  // Los que pierden no dependen del mes elegido (Juan, 2026-11-13): los últimos tres meses cerrados y el acumulado del
  // año, que en Avancys empieza en agosto de 2026.
  const legibles = cerrados.map(mes => ({ mes, datos: datosDe(mes) })).filter((x): x is { mes: string; datos: Clientes } => typeof x.datos === 'object' && Boolean(x.datos?.legible));
  const ultimos = legibles.slice(-MESES_PIERDEN);
  const anio = cerrados[cerrados.length - 1].slice(0, 4);
  const historia = new Map<string, { nombre: string; meses: Record<string, Cliente>; ingresos: number; margen: number }>();
  for (const { mes, datos } of legibles) {
    for (const fila of datos.clientes || []) {
      const clave = nitDe(fila.cliente) || fila.cliente;
      const actual = historia.get(clave) || { nombre: fila.cliente, meses: {}, ingresos: 0, margen: 0 };
      actual.meses[mes] = fila;
      if (mes.startsWith(anio)) { actual.ingresos += fila.ingresos; actual.margen += fila.margen; }
      historia.set(clave, actual);
    }
  }
  const pierde = (m?: Cliente) => Boolean(m && m.ingresos > 0 && m.margen < 0);
  const pierden = [...historia.values()]
    .filter(fila => ultimos.some(({ mes }) => pierde(fila.meses[mes])) || (fila.ingresos > 0 && fila.margen < 0))
    .map(fila => ({ ...fila, todos: ultimos.length > 1 && ultimos.every(({ mes }) => pierde(fila.meses[mes])) }))
    .sort((a, b) => a.margen - b.margen);
  const cargando = cerrados.some(mes => datosDe(mes) === 'cargando');
  // Avancys empieza con su primer mes completo (la carga del 31 de julio no es un mes de operación).
  const primerCerrado = cerrados.find(mes => mes.startsWith(anio));
  const desde = primerCerrado ? nombreMes(primerCerrado).split(' ')[0] : '';
  const mostrados = pierden.slice(0, MAX_CLIENTES);
  const peorAnio = Math.max(1, ...mostrados.map(fila => Math.abs(Math.min(0, fila.margen))));
  // El precio por hora bajo el costo se marca con el último mes cerrado que tenga dato.
  const costoHora = Math.abs(datosDe(torre?.mes_cerrado || '') && typeof datosDe(torre?.mes_cerrado || '') === 'object' ? (datosDe(torre?.mes_cerrado || '') as Clientes).costo_por_hora ?? 0 : 0);
  const bajoCosto = (fila: { meses: Record<string, Cliente> }) => {
    const ultimo = [...ultimos].reverse().map(({ mes }) => fila.meses[mes]).find(Boolean);
    return Boolean(costoHora && ultimo?.precio_hora && ultimo.precio_hora < costoHora);
  };
  return <>
    <section className="siio-panel" aria-label="Clientes que pierden">
      <h2>Los que pierden</h2>
      <p className="siio-nota" style={{ margin: '4px 0 8px' }}>{ultimos.length === 1 ? 'Último mes cerrado' : `Últimos ${ultimos.length} meses cerrados`} y lo acumulado en {anio}{desde ? ` desde ${desde}, cuando empieza Avancys` : ''}. Primero los que más pierden en el año.</p>
      {cargando ? <p className="siio-nota">Calculando los otros meses…</p> : null}
      {mostrados.length ? <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Cliente</th>{ultimos.map(({ mes }) => <th key={mes} className="num">{nombreMes(mes).split(' ')[0]}</th>)}<th className="num total">Acumulado {anio}</th></tr></thead>
        <tbody>{mostrados.map(fila => <tr key={fila.nombre}>
          <td><span className="nombre">{sinCodigo(fila.nombre)}</span>{fila.todos ? <span className="siio-chip marca">pierde todos los meses</span> : bajoCosto(fila) ? <span className="siio-chip marca">precio bajo el costo</span> : null}</td>
          {ultimos.map(({ mes }) => {
            const m = fila.meses[mes];
            return <td key={mes} className={`num${pierde(m) ? ' mal' : ''}`}>{m ? <><strong>{millones(m.margen)}</strong><small>{pct(m.margen, m.ingresos)}</small></> : <strong>—</strong>}</td>;
          })}
          <td className={`num total${fila.margen < 0 ? ' mal' : ''}`}>{fila.ingresos ? <><strong>{millones(fila.margen)}</strong>{fila.margen < 0 ? <span className="siio-magnitud"><i style={{ width: `${Math.round((Math.abs(fila.margen) / peorAnio) * 100)}%` }} /></span> : null}</> : <strong>—</strong>}</td>
        </tr>)}</tbody>
        <tfoot><tr><th>Total de los que se muestran</th>{ultimos.map(({ mes }) => <th key={mes} className="num" />)}<th className="num total mal">{millones(mostrados.reduce((suma, fila) => suma + fila.margen, 0))}</th></tr></tfoot>
      </table></div> : <p className="siio-secondary">Ningún cliente pierde en los meses cerrados.</p>}
    </section>
    <section className="siio-panel" aria-label="Cliente por cliente">
      <div className="siio-sub" style={{ marginBottom: 8 }}>
        <h2>Cliente por cliente</h2>
        <label className="siio-selector">Mes cerrado
          <select value={mesClientes} onChange={evento => setElegido(evento.target.value)}>
            {[...cerrados].reverse().map(mes => <option key={mes} value={mes}>{nombreMes(mes)} · Cerrado</option>)}
          </select>
        </label>
      </div>
      <DetalleClientes mes={mesClientes} datos={datosDe(mesClientes)} />
    </section>
  </>;
}

const CLIENTES_A_LA_VISTA = 12;

function DetalleClientes({ mes, datos }: { mes: string; datos: Clientes | 'cargando' | 'error' | undefined }) {
  const [todos, setTodos] = useState(false);
  if (datos === 'cargando' || datos === undefined) return <p className="siio-secondary">Calculando los clientes de {nombreMes(mes)}…</p>;
  if (datos === 'error' || datos.legible === false) return <p className="siio-alert-text">No se pudieron calcular los clientes de {nombreMes(mes)}{datos !== 'error' && datos.motivo ? `: ${datos.motivo}` : ''}.</p>;
  const k = datos;
  const costoHora = Math.abs(k.costo_por_hora ?? 0);
  const conIngreso = (k.clientes || []).filter(fila => fila.ingresos > 0);
  const pierden = conIngreso.filter(fila => fila.margen < 0);
  const ordenados = [...pierden, ...conIngreso.filter(fila => fila.margen >= 0)];
  const filas = todos ? ordenados : ordenados.slice(0, CLIENTES_A_LA_VISTA);
  const total = k.ingresos_clientes ?? conIngreso.reduce((suma, fila) => suma + fila.ingresos, 0);
  const cinco = [...conIngreso].sort((a, b) => b.ingresos - a.ingresos).slice(0, 5).reduce((suma, fila) => suma + fila.ingresos, 0);
  return <>
    <p className="siio-nota" style={{ marginBottom: 8 }}>
      Aproximado: ingreso real por cliente; costo de vigilantes a {pesos(costoHora)} la hora por las horas de sus puestos; supervisión y administración repartidas por facturación.
      {' '}Los 5 mayores concentran el {pct(cinco, total)} del ingreso. Primero los que pierden.
    </p>
    <div className="siio-tabla-wrap"><table className="siio-tabla">
      <thead><tr><th>Cliente</th><th className="num">Ingreso</th><th className="num">Peso</th><th className="num">Precio por hora</th><th className="num total">Margen (est.)</th></tr></thead>
      <tbody>{filas.map(fila => {
        const bajo = Boolean(costoHora && fila.precio_hora && fila.precio_hora < costoHora);
        return <tr key={fila.cliente}>
          <td><span className="nombre">{sinCodigo(fila.cliente)}</span>{bajo ? <span className="siio-chip marca">bajo el costo</span> : null}</td>
          <td className="num"><strong>{millones(fila.ingresos)}</strong></td>
          <td className="num"><strong>{pct(fila.ingresos, total)}</strong></td>
          <td className={`num${bajo ? ' mal' : ''}`}>{fila.precio_hora ? <strong>{pesos(fila.precio_hora)}</strong> : <small>sin horas</small>}</td>
          <td className={`num total${fila.margen < 0 ? ' mal' : ''}`}><strong>{millones(fila.margen)}</strong><small>{pct(fila.margen, fila.ingresos)}</small></td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="siio-nota" style={{ marginTop: 6 }}>
      {conIngreso.length.toLocaleString('es-CO')} clientes con ingreso{filas.length < ordenados.length ? `; se muestran los que pierden y los mayores (${filas.length})` : ''}.
      {' '}{ordenados.length > CLIENTES_A_LA_VISTA ? <button type="button" className="siio-enlace" onClick={() => setTodos(!todos)}>{todos ? 'Ver menos' : 'Ver todos'}</button> : null}
      {' '}Para los que se facturan mes vencido, el ingreso de un mes corresponde al servicio del anterior.
    </p>
  </>;
}

// Una cifra del kit: etiqueta, valor tabular y nota; en rojo cuando es pérdida o vencido; atenuada sin dato.
export function CifraKit({ etiqueta, valor, nota, tono, chip }: { etiqueta: string; valor: string; nota?: React.ReactNode; tono?: 'mal' | 'vacia'; chip?: React.ReactNode }) {
  return <div className={`siio-cifra${tono ? ` ${tono}` : ''}`}>
    <span>{etiqueta}{chip}</span>
    <strong>{valor}</strong>
    {nota ? <small>{nota}</small> : null}
  </div>;
}

// Cartera (contrato de la maqueta, Fase 3). La cartera sale de la contabilidad (cuentas 1305), con la que vino de
// Yeminus; lo heredado y la plata recibida sin identificar se dicen con su responsable.
export function SiioPestanaCartera({ t }: { t: TorreAvancys }) {
  const c = t.torre?.cartera;
  if (c?.error) return <p className="siio-alert-text">No se pudo leer la cartera: {c.error}</p>;
  if (!c?.total || !c.vencido) return <p className="siio-secondary">Sin datos de cartera todavía.</p>;
  const clientesMes = t.torre?.clientes?.clientes || [];
  // El cruce es por NIT; un nombre sin NIT no se empareja con nada (si no, todos los «sin NIT» serían el mismo).
  const ingresoMes = new Map(clientesMes.filter(fila => nitDe(fila.cliente)).map(fila => [nitDe(fila.cliente), fila.ingresos]));
  const pierdePlata = new Set(clientesMes.filter(fila => fila.ingresos > 0 && fila.margen < 0).map(fila => nitDe(fila.cliente)).filter(Boolean));
  const nitDeudor = (nombre: string) => nitDe(nombre) || `sin-nit:${nombre}`;
  const cerrado = t.torre?.mes_cerrado ? t.resumenDe(t.torre.mes_cerrado) : null;
  const dias = cerrado?.ingresos ? Math.round((c.total.saldo / (cerrado.ingresos * IVA)) * 30) : null;
  // La deuda viene con IVA y el ingreso del cliente sin IVA: se lleva el ingreso a valor facturado (con IVA).
  const deudores = (c.deudores || []).map(fila => {
    const mensual = ingresoMes.get(nitDeudor(fila.cliente));
    return { ...fila, meses: mensual ? fila.vencido / (mensual * IVA) : null };
  });
  const masMeses = Math.max(1, ...deudores.map(fila => fila.meses || 0));
  const viejos = (c.tramos || []).filter(tramo => tramo.tramo.startsWith('61') || tramo.tramo.startsWith('Más'));
  return <>
    {/* Lo vencido y todos sus tramos, para que se vea que suman (Juan, 2026-11-13). Vencida = pasó la fecha de
        vencimiento, aunque sea por un día; los tramos se cuentan desde esa fecha. */}
    <div className="siio-cifras siio-cifras-3">
      <CifraKit etiqueta="Por cobrar hoy" valor={millones(c.total.saldo)} nota={dias ? `≈ ${dias} días de facturación` : null} />
      <CifraKit etiqueta="Sin vencer" valor={millones(c.total.saldo - c.vencido.saldo)} nota="todavía no llega a su fecha de pago" />
      <CifraKit etiqueta="Vencida" valor={millones(c.vencido.saldo)} tono="mal" nota={`${pct(c.vencido.saldo, c.total.saldo)} de la cartera, aunque sea por un día`} />
    </div>
    <div className="siio-cifras siio-cifras-4">
      {(c.tramos || []).map(tramo => <CifraKit key={tramo.tramo} etiqueta={`Vencida ${tramo.tramo.toLowerCase()}`} valor={millones(tramo.saldo)}
        tono={viejos.includes(tramo) && tramo.saldo > 0 ? 'mal' : undefined} nota={c.vencido?.saldo ? `${pct(tramo.saldo, c.vencido.saldo)} de lo vencido` : null} />)}
    </div>
    {c.heredado_yeminus?.saldo || c.consignaciones_sin_identificar?.saldo ? <div className="siio-cifras siio-cifras-2">
      {c.heredado_yeminus?.saldo ? <CifraKit etiqueta="Viene de antes de agosto (Yeminus)" valor={millones(c.heredado_yeminus.saldo)} tono="mal"
        nota={<>{c.heredado_yeminus.facturas.toLocaleString('es-CO')} facturas cargadas como saldo inicial y sin cobrar · <strong>Cartera</strong></>} /> : null}
      {c.consignaciones_sin_identificar?.saldo ? <CifraKit etiqueta="Consignaciones sin identificar" valor={millones(c.consignaciones_sin_identificar.saldo)} tono="mal"
        nota={<>{c.consignaciones_sin_identificar.partidas.toLocaleString('es-CO')} pagos recibidos sin aplicar a ningún cliente · <strong>Tesorería y Cartera</strong></>} /> : null}
    </div> : null}
    <section className="siio-panel" aria-label="Quién debe más">
      <h2>Quién debe más (vencido)</h2>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Cliente</th><th className="num">Vencido</th><th className="num total">Equivale a</th></tr></thead>
        <tbody>{deudores.map(fila => {
          const enRojo = fila.meses !== null && fila.meses >= 2;
          return <tr key={fila.cliente}>
            <td><span className="nombre">{sinCodigo(fila.cliente)}</span>{pierdePlata.has(nitDeudor(fila.cliente)) ? <span className="siio-chip marca">además pierde plata</span> : null}</td>
            <td className="num mal"><strong>{millones(fila.vencido)}</strong></td>
            <td className={`num total${enRojo ? ' mal' : ''}`}>{fila.meses !== null
              ? <><strong>{(Math.round(fila.meses * 10) / 10).toLocaleString('es-CO')} {fila.meses >= 0.95 && fila.meses < 1.05 ? 'mes' : 'meses'}</strong><span className="siio-magnitud"><i style={{ width: `${Math.round((fila.meses / masMeses) * 100)}%` }} /></span></>
              : <><strong>—</strong><small>sin facturación en el último mes cerrado</small></>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="siio-nota" style={{ marginTop: 6 }}>«Equivale a»: la deuda vencida sobre lo que se le factura al mes a ese cliente, ambas con IVA; en rojo, dos meses o más. Partidas abiertas de las cuentas de clientes en la contabilidad de Avancys al {c.hoy ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${c.hoy}T12:00:00Z`)) : '—'}, incluida la cartera que vino de Yeminus con su vencimiento original.</p>
    </section>
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
function EstadoDeResultados({ t, lineas, meses }: { t: TorreAvancys; lineas: LineaPyg[]; meses: MesPyg[] }) {
  const ultimoCerrado = [...meses].reverse().find(fila => fila.estado === 'cerrado');
  const prov = ultimoCerrado?.provision;
  const sinClasificar = meses.flatMap(fila => fila.sin_clasificar.map(c => ({ ...c, mes: fila.mes })));
  const valores = (fila: MesPyg) => fila.proyeccion ? fila.proyeccion.lineas : fila.lineas;
  const totalesDe = (fila: MesPyg) => fila.proyeccion ? fila.proyeccion.totales : fila.totales;
  const oficialDe = (mes: string) => {
    const [anio, numero] = mes.split('-').map(Number);
    return t.oficial?.months.find(m => m.year === anio && m.month === numero)?.totals || null;
  };
  const conOficial = meses.some(fila => oficialDe(fila.mes));
  const celda = (fila: MesPyg, valor: number, clave?: string) => {
    const estimada = fila.proyeccion && (!clave || fila.proyeccion.estimadas.includes(clave));
    return <span className={estimada ? 'siio-secondary' : undefined}>{fila.proyeccion ? '≈ ' : ''}{millones(valor)}</span>;
  };
  // El estado de cada columna, con el vocabulario único del kit.
  const chip = (fila: MesPyg) => oficialDe(fila.mes) ? <span className="siio-chip finanzas">Cierre de Finanzas</span>
    : fila.estado === 'cerrado' ? <span className="siio-chip cerrado">Cerrado</span>
      : fila.motivo === 'Mes en curso' ? <span className="siio-chip vivo">En vivo</span> : <span className="siio-chip proyeccion">≈</span>;
  // Lo que se muestra por mes manda el cierre de Finanzas donde existe (igual que la Portada).
  const resumen = (fila: MesPyg) => t.resumenDe(fila.mes);
  const protagonista = (fila: MesPyg) => (fila.mes === t.mes ? 'num total' : 'num');
  // Los meses que la contabilidad no ha cerrado, con los días que llevan (Juan, 2026-11-14: «la Torre muestra quién no está al día»).
  const hoy = new Date();
  const abiertos = meses.filter(fila => fila.estado === 'parcial' && fila.motivo !== 'Mes en curso')
    .map(fila => ({ mes: fila.mes, dias: diasDesdeFinDeMes(fila.mes, hoy), motivo: fila.motivo }));
  return <section className="siio-panel" aria-label="Estado de resultados">
    <h2>Estado de resultados</h2>
    <div className="siio-tabla-wrap"><table className="siio-tabla">
      <thead><tr><th>Línea</th>{meses.map(fila => <th key={fila.mes} className={protagonista(fila)}>{nombreMes(fila.mes).split(' ')[0]} {chip(fila)}</th>)}</tr></thead>
      <tbody>
        <tr><td><span className="nombre">Ingresos</span></td>{meses.map(fila => { const r = resumen(fila); return <td key={fila.mes} className={protagonista(fila)}><strong>{fila.proyeccion && !oficialDe(fila.mes) ? '≈ ' : ''}{r ? millones(r.ingresos) : '—'}</strong></td>; })}</tr>
        <tr><td><span className="nombre">Utilidad operacional</span></td>{meses.map(fila => { const r = resumen(fila); const estimado = fila.proyeccion && !oficialDe(fila.mes); return <td key={fila.mes} className={`${protagonista(fila)}${r && r.utilidad < 0 ? ' mal' : ''}`}><strong>{estimado ? '≈ ' : ''}{r ? millones(r.utilidad) : '—'}</strong><small>{estimado ? '≈ ' : ''}{r ? pct(r.utilidad, r.ingresos) : ''}</small></td>; })}</tr>
      </tbody>
    </table></div>
    {abiertos.length ? <p className="siio-nota" style={{ marginTop: 6 }}>
      {abiertos.map(a => <Fragment key={a.mes}>La proyección de {nombreMes(a.mes).split(' ')[0]} no es una cifra cerrada ({(a.motivo || '').toLowerCase()}): <strong>Contabilidad lleva {a.dias} días sin cerrar {nombreMes(a.mes).split(' ')[0]}</strong>. </Fragment>)}
    </p> : null}
    <details className="siio-plegado">
      <summary>Las 17 líneas del PYG, con las cuentas que suma cada una y el cierre oficial debajo</summary>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Línea</th>{meses.map(fila => <th key={fila.mes} className="num">{nombreMes(fila.mes).split(' ')[0]}</th>)}</tr></thead>
        <tbody>{GRUPOS.map(g => <Fragment key={g.grupo}>
          {lineas.filter(l => l.grupo === g.grupo).map(l => <tr key={l.clave}>
            <td title={`Cuentas ${l.cuentas}`}>{l.etiqueta}{l.clave === 'ing_vigilancia' ? ' (con provisión)' : ''}<small className="siio-nota" style={{ display: 'block' }}>cuentas {l.cuentas}</small></td>
            {meses.map(fila => <td key={fila.mes} className="num">{celda(fila, valores(fila)[l.clave] || 0, l.clave)}</td>)}
          </tr>)}
          <tr><td><strong>{g.totalEtiqueta}</strong></td>{meses.map(fila => <td key={fila.mes} className="num"><strong>{celda(fila, totalesDe(fila)[g.total])}</strong>
            {g.total !== 'ingresos' ? <small>{pct(totalesDe(fila)[g.total], totalesDe(fila).ingresos)}</small> : null}</td>)}</tr>
        </Fragment>)}
        {conOficial ? <>
          <tr><td colSpan={meses.length + 1}><strong>Cierre oficial de Finanzas (Excel cargado)</strong></td></tr>
          <tr><td>Ingresos</td>{meses.map(fila => <td key={fila.mes} className="num">{oficialDe(fila.mes) ? millones(oficialDe(fila.mes)!.ingresos) : <span className="siio-secondary">sin cierre</span>}</td>)}</tr>
          <tr><td>Utilidad operacional</td>{meses.map(fila => { const o = oficialDe(fila.mes); return <td key={fila.mes} className="num">{o ? <>{millones(o.utilidad_operacional)}<small>{pct(o.utilidad_operacional, o.ingresos)}</small></> : <span className="siio-secondary">—</span>}</td>; })}</tr>
          <tr><td>Antes de impuestos</td>{meses.map(fila => { const o = oficialDe(fila.mes); return <td key={fila.mes} className="num">{o ? millones(o.utilidad_operacional + o.resultado_no_operacional) : <span className="siio-secondary">—</span>}</td>; })}</tr>
        </> : null}</tbody>
      </table></div>
      <p className="siio-nota">Cómo se calculó: armado solo desde la contabilidad de Avancys. Los meses cerrados son automáticos; los que no están completos y el mes en curso son proyecciones (≈): lo registrado más lo que falta, estimado con el último mes cerrado y, para el mes en curso, con lo contratado en las órdenes de servicio.</p>
      {prov ? <p className="siio-nota">
        <strong>Provisión de ingresos mes vencido ({nombreMes(ultimoCerrado?.mes)}):</strong> se suma el servicio prestado y no facturado ({millones(prov.del_mes)}) y se resta el del mes anterior, que se facturó en este ({millones(prov.del_mes_anterior)}): ajuste de {millones(prov.ajuste)}.
        {' '}Por cliente: {prov.clientes.map(k => `${sinCodigo(k.nombre)} ${millones(k.devengado)}`).join(' · ') || '—'}.
        {prov.error ? ` No se pudo calcular completa: ${prov.error}.` : ''}
      </p> : null}
      <p className="siio-nota">
        {meses.filter(fila => fila.proyeccion).map(fila => `${nombreMes(fila.mes)}: ${fila.proyeccion!.estimadas.length} líneas estimadas con ${nombreMes(fila.proyeccion!.base_mes)}${fila.proyeccion!.ingresos_ordenes !== null ? `; ingresos por lo contratado en órdenes de servicio (${millones(fila.proyeccion!.ingresos_ordenes)})` : ''}`).join('. ')}.
        {' '}{sinClasificar.length ? `Cuentas de resultados que no caen en ninguna línea: ${sinClasificar.map(c => `${c.cuenta} (${nombreMes(c.mes)}) ${millones(c.valor)}`).join(' · ')}.` : 'Todas las cuentas de resultados quedaron clasificadas.'}
      </p>
    </details>
  </section>;
}
