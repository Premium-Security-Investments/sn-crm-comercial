import { Fragment, useEffect, useState } from 'react';
import type React from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';
import { mesComparable, SiioPresupuesto } from './SiioPresupuesto';
import type { FinancialPulse } from './financialPulse';
import { diasDesdeFinDeMes, ultimoDia } from './fuentesAlDia';
import type { CommercialSummary } from './commercialSummary';

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
type MotivoNotas = { valor: number; notas: number };
export type NotasCredito = { error?: string; desde?: string; meses?: Record<string, { no_prestado: MotivoNotas; correccion: MotivoNotas; otro: MotivoNotas; sin_motivo: MotivoNotas; clientes: { cliente: string; no_prestado: number; sin_motivo: number }[] }> };
type FotoCartera = { fecha: string; total: number; vencido: number; mas_30: number };
type Cartera = { error?: string; hoy?: string; hace_un_mes?: FotoCartera | null; total?: Saldo; vencido?: Saldo; tramos?: ({ tramo: string } & Saldo)[]; deudores?: { cliente: string; vencido: number; facturas: number }[]; heredado_yeminus?: Saldo; consignaciones_sin_identificar?: { saldo: number; partidas: number } };
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
  notas_credito?: NotasCredito | null;
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
// Lo que redondea a cero millones se escribe $0 M, sin el signo menos.
export const millones = (valor: number) => `${Math.round(valor / 1e6) < 0 ? '−' : ''}$${Math.round(Math.abs(valor) / 1e6).toLocaleString('es-CO')} M`;
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
  // Se entra al mes anterior, igual que la Portada (Juan, 2026-11-15); si Avancys no lo tiene, al mes en curso o al
  // último que haya.
  const enVivo = opciones.find(o => o.fuente === 'en_vivo')?.mes;
  const anterior = mesAnterior(new Date().toISOString().slice(0, 7));
  const mes = mesElegido || (opciones.some(o => o.mes === anterior) ? anterior : enVivo) || opciones[opciones.length - 1]?.mes || '';
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
  // Lo que el sistema tiene hoy del mes, sin proyección (Juan, 2026-11-15: la Portada muestra el mes anterior con sus
  // cifras de hoy y dice si Contabilidad lo cerró).
  // Una sola cifra por mes: la de Avancys donde existe; antes de Avancys, el cierre de Finanzas (Juan, 2026-11-15).
  const realDe = (m: string): Resumen | null => {
    const f = pyg.find(fila => fila.mes === m);
    if (f) return { ingresos: f.totales.ingresos, costos: f.totales.costos, gastos: f.totales.gastos, utilidad: f.totales.utilidad_ordinaria, fuente: 'Avancys' };
    return oficialDe(m) ? resumenDe(m) : null;
  };
  const indice = opciones.findIndex(o => o.mes === mes);
  const mesPrevio = indice > 0 ? opciones[indice - 1].mes : null;

  const antesDeAvancys = Boolean(torre?.primera_linea && mes && mes < torre.primera_linea.slice(0, 7));
  return {
    estado, error, torre, cargar, opciones, mes, setMes: setMesElegido, opcion, resumen: resumenDe(mes), resumenDe, realDe, oficialDe, mesPrevio,
    previo: mesPrevio ? resumenDe(mesPrevio) : null,
    antesDeAvancys, oficial,
  };
}
export type TorreAvancys = ReturnType<typeof useTorreAvancys>;


export type PestanaTorre = 'portada' | 'resultados' | 'clientes' | 'cartera' | 'comercial' | 'operacion' | 'vigia' | 'parametros' | 'fuentes';

// Nombre de cliente para leer: sin los códigos de Avancys («[AREA ADMINISTRACION] [891411663] …»), sin la
// sociedad al final y, si viene en mayúscula sostenida, en tipo oración con las palabras cortas en minúscula.
const PALABRAS_MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en', 'para']);
export const sinCodigo = (nombre: string) => {
  const limpio = nombre.replace(/^(\s*\[[^\]]*\]\s*)+/, '').replace(/(\s+(S\.?\s?A\.?\s?S?\.?|LTDA\.?|E\.?S\.?P\.?))+$/i, '').trim();
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio.toLowerCase().split(/\s+/).map((palabra, i) => (i && PALABRAS_MENORES.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1))).join(' ');
};

// Cómo está cerrado un mes: lo bloqueó Contabilidad en Avancys, lo cerró Finanzas con su Excel, o no tiene cierre formal
// (y cuántos días lleva). Juan, 2026-11-15: «Sin cierre formal · 46 días», no «Cerrado» por una regla de la Torre.
// Sin cierre va en ámbar por largo que sea (puede cambiar); el rojo queda para lo que está peor que su referencia.
export function cierreDe(t: TorreAvancys, mes: string, hoy = new Date()): { tono: 'cerrado' | 'finanzas' | 'confirmar'; texto: string } {
  const bloqueo = t.torre?.bloqueo_contable || null;
  if (bloqueo && bloqueo >= ultimoDia(mes)) return { tono: 'cerrado', texto: 'Cerrado' };
  if (t.oficialDe(mes)) return { tono: 'finanzas', texto: 'Cierre de Finanzas' };
  const dias = diasDesdeFinDeMes(mes, hoy);
  return { tono: 'confirmar', texto: `Sin cierre formal · ${dias} ${dias === 1 ? 'día' : 'días'}` };
}
function mesAnterior(mes: string) {
  const [anio, numero] = mes.split('-').map(Number);
  return numero === 1 ? `${anio - 1}-12` : `${anio}-${String(numero - 1).padStart(2, '0')}`;
}

// El mes del que habla la Portada: el mes anterior si Avancys ya lo tiene; si no, el último cerrado.
export function mesPrincipal(t: TorreAvancys, hoy = new Date()) {
  const anterior = mesAnterior(hoy.toISOString().slice(0, 7));
  return t.realDe(anterior) ? anterior : t.torre?.mes_cerrado || null;
}

// La cartera vencida pesa «mal» desde esta parte de lo que nos deben.
const CARTERA_VENCIDA_MAL = 0.3;
// Licitaciones en la Portada: las que cierran en esta ventana y nadie ha dicho GO o NO-GO (contrato del 15-nov).
export const VENTANA_LICITACIONES = 15;
const A_LA_VISTA = 5;

// La rentabilidad por cliente de un mes: la del último cerrado viene con la Torre; la de otro mes se pide con la ruta
// de la pestaña Clientes.
function useClientesDe(t: TorreAvancys, mes: string | null): Clientes | 'cargando' | 'error' | null {
  const cerrado = t.torre?.mes_cerrado || null;
  const [otro, setOtro] = useState<Clientes | 'cargando' | 'error' | null>(null);
  useEffect(() => {
    if (!mes || mes === cerrado) return;
    let vivo = true;
    setOtro('cargando');
    api<Clientes>(`/api/siio/avancys/rentabilidad-aproximada?mes=${encodeURIComponent(mes)}`)
      .then(datos => { if (vivo) setOtro(datos); })
      .catch(() => { if (vivo) setOtro('error'); });
    return () => { vivo = false; };
  }, [mes, cerrado]);
  if (!mes) return null;
  return mes === cerrado ? t.torre?.clientes || null : otro;
}

const quienPierde = (k: Clientes | null) => {
  const conIngreso = (k?.clientes || []).filter(fila => fila.ingresos > 0);
  const pierden = conIngreso.filter(fila => fila.margen < 0).sort((a, b) => a.margen - b.margen);
  return { pierden, suma: pierden.reduce((total, fila) => total + fila.margen, 0) };
};

const mayuscula = (texto: string) => texto.replace(/^./, letra => letra.toUpperCase());
// Nombre corto de la entidad, como en Mi día de Licitaciones: «Rama Judicial · Seccional Pereira»; lo de SECOP en
// mayúscula sostenida, en tipo título y sin la sociedad («METRO DE BOGOTA SA» → «Metro de Bogota»), y la sigla sola
// cuando el nombre arranca con ella («SIC SUPERINTENDENCIA DE …» → «SIC»).
const entidad = (nombre: string) => {
  const base = nombre.replace(/[\u0080-\u009f]/g, ' - ').replace(/\s+/g, ' ').trim()
    .replace(/^Rama Judicial\s*[-–]?\s*Dirección Seccional de Administración Judicial de (.+)$/i, 'Rama Judicial · Seccional $1')
    .replace(/^Rama Judicial\s*[-–]?\s*Dirección Ejecutiva de Administración Judicial$/i, 'Rama Judicial · Dirección Ejecutiva');
  if (base !== base.toUpperCase()) return base;
  const palabras = base.replace(/(\s+(S\.?\s?A\.?\s?S?\.?|LTDA\.?|E\.?S\.?P\.?))+$/i, '').split(/\s+/);
  if (/^[A-ZÁÉÍÓÚÑ]{2,4}$/.test(palabras[0]) && palabras.length !== 2) return palabras[0];
  return palabras.map((palabra, i) => (i && PALABRAS_MENORES.has(palabra.toLowerCase()) ? palabra.toLowerCase() : palabra.charAt(0) + palabra.slice(1).toLowerCase())).join(' ');
};
const fechaCorta = (valor: string | null) => {
  if (!valor) return 'sin fecha';
  const fecha = new Date(valor);
  // Un cierre guardado como fecha sola llega a medianoche UTC: es esa fecha, no la noche anterior en Colombia.
  const soloFecha = fecha.getUTCHours() === 0 && fecha.getUTCMinutes() === 0;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: soloFecha ? 'UTC' : 'America/Bogota' }).format(fecha).replace('.', '');
};

type Tono = 'bien' | 'mal' | 'ojo' | 'info';
type Periodo = { texto: string; tono: 'cerrar' | 'hoy' };
// Un renglón de la Portada: la pregunta con su periodo, la respuesta con su cifra y contra qué se compara.
function Renglon({ pregunta, periodo, tono, ir, respuesta, comparacion }: { pregunta: string; periodo: Periodo; tono: Tono; ir: () => void; respuesta: React.ReactNode; comparacion: React.ReactNode }) {
  return <li className={`siio-renglon ${tono}`}>
    <button type="button" onClick={ir}>
      <span className="p"><span className="pregunta">{pregunta}</span><span className={`siio-periodo ${periodo.tono}`}>{periodo.texto}</span></span>
      <span className="r">{respuesta}</span>
      <span className="c">{comparacion}</span>
    </button>
  </li>;
}

function Lista({ filas }: { filas: { nombre: string; valor: string; mal?: boolean }[] }) {
  return <span className="siio-lista-corta">{filas.map((fila, i) => <span key={`${i}-${fila.nombre}`} className={fila.mal ? 'mal' : ''}><span>{fila.nombre}</span><b>{fila.valor}</b></span>)}</span>;
}

// La Portada (contrato aprobado por Juan el 2026-11-15): una pantalla con siete preguntas. Cada renglón dice de qué
// periodo habla (el mes anterior con su cierre, o a hoy), la respuesta con su cifra, contra qué se compara y lleva a su
// pestaña. Rojo solo para lo que está peor que su referencia; ámbar para lo que todavía puede cambiar.
export function SiioPortada({ t, onIr, comercial = null }: { t: TorreAvancys; onIr: (pestana: PestanaTorre, mes?: string) => void; comercial?: CommercialSummary | null }) {
  const { torre, estado, error } = t;
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  const principal = mesPrincipal(t, hoy);
  const previo = principal ? mesAnterior(principal) : null;
  const r = principal ? t.realDe(principal) : null;
  const rPrevio = previo ? t.realDe(previo) : null;
  const cierre = principal ? cierreDe(t, principal, hoy) : null;
  const enCurso = (torre?.pyg || []).find(fila => fila.mes === mesActual) || null;
  const clientes = useClientesDe(t, principal);
  const clientesPrevio = useClientesDe(t, previo);
  const nombre = (mes: string | null) => nombreMes(mes).split(' ')[0];
  if (estado === 'error') return <p className="siio-alert-text">No se pudo leer Avancys: {error}</p>;
  if (!r || !principal) return <p className="siio-secondary">Leyendo la contabilidad de Avancys…</p>;

  const periodoMes: Periodo = { texto: `${mayuscula(nombre(principal))} · ${cierre?.texto.toLowerCase() || ''}`, tono: cierre?.tono === 'cerrado' || cierre?.tono === 'finanzas' ? 'hoy' : 'cerrar' };
  const aHoy = (texto: string): Periodo => ({ texto, tono: 'hoy' });
  const renglones: React.ReactNode[] = [];

  // 1. ¿Ganamos plata el mes pasado?
  const margen = r.ingresos ? r.utilidad / r.ingresos : 0;
  const puntos = rPrevio?.ingresos ? (margen - rPrevio.utilidad / rPrevio.ingresos) * 100 : null;
  const ppto = torre?.presupuesto?.meses?.[principal]?.vigilancia?.rentabilidad_presupuesto ?? null;
  const ganamos = r.utilidad >= 0;
  renglones.push(<Renglon key="plata" pregunta="¿Ganamos plata el mes pasado?" periodo={periodoMes} tono={!ganamos || (puntos !== null && puntos < 0) ? 'mal' : 'bien'} ir={() => onIr('resultados', principal)}
    respuesta={<><span className="valor">{millones(r.utilidad)}</span><span className="frase">{ganamos ? 'Sí.' : 'No.'} Utilidad operacional de <b>{pct(r.utilidad, r.ingresos)}</b> sobre {millones(r.ingresos)} de ingresos.</span></>}
    comparacion={<>{rPrevio && puntos !== null ? <span className={`ref ${puntos >= 0 ? 'bien' : 'mal'}`}>{puntos >= 0 ? '▲' : '▼'} {Math.abs(Math.round(puntos * 10) / 10).toLocaleString('es-CO')} puntos frente a {nombre(previo)} ({millones(rPrevio.utilidad)} · {pct(rPrevio.utilidad, rPrevio.ingresos)})</span> : null}
      <span>{ppto !== null ? `Presupuesto de vigilancia: ${ppto.toLocaleString('es-CO')} % de rentabilidad.` : 'Presupuesto de margen de la empresa: por confirmar con Finanzas.'}</span><span className="ver">Ver Resultados →</span></>} />);

  // 2. ¿Cuánto llevamos facturado este mes? Contra el mes anterior completo: la facturación llega en lotes y la
  // comparación día contra día engaña.
  if (enCurso) {
    const parte = r.ingresos ? enCurso.totales.ingresos / r.ingresos : null;
    renglones.push(<Renglon key="facturado" pregunta="¿Cuánto llevamos facturado este mes?" periodo={aHoy(`${mayuscula(nombre(mesActual))} · a hoy`)} tono="info" ir={() => onIr('resultados', mesActual)}
      respuesta={<><span className="valor">{millones(enCurso.totales.ingresos)}</span>{parte !== null ? <><span className="frase">El <b>{pct(enCurso.totales.ingresos, r.ingresos)}</b> de lo facturado en todo {nombre(principal)}.</span>
        <span className="siio-barra-portada" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(parte * 100))}%` }} /></span></> : null}</>}
      comparacion={<><span className="ref">{mayuscula(nombre(principal))} completo: {millones(r.ingresos)}</span><span>Se compara contra el mes completo: la facturación llega en lotes y la comparación día contra día engañaría.</span></>} />);
  }

  // 3. ¿Nos están pagando?
  const c = torre?.cartera;
  if (c?.vencido && c.total) {
    const parteVencida = c.total.saldo ? c.vencido.saldo / c.total.saldo : 0;
    const mas30 = (c.tramos || []).slice(1).reduce((suma, tramo) => suma + tramo.saldo, 0);
    renglones.push(<Renglon key="cartera" pregunta="¿Nos están pagando?" periodo={aHoy('A hoy')} tono={parteVencida >= CARTERA_VENCIDA_MAL ? 'mal' : 'bien'} ir={() => onIr('cartera')}
      respuesta={<><span className="valor">{millones(c.vencido.saldo)} <small>vencidos</small></span><span className="frase">El <b>{pct(c.vencido.saldo, c.total.saldo)}</b> de los {millones(c.total.saldo)} que nos deben ya pasó su fecha de pago; <b>{millones(mas30)}</b> llevan más de 30 días.</span>
        {c.heredado_yeminus?.saldo ? <span className="frase">{millones(c.heredado_yeminus.saldo)} vienen del sistema anterior (Yeminus).</span> : null}</>}
      comparacion={<><span className="ref">Los que más deben, vencido</span><Lista filas={(c.deudores || []).slice(0, A_LA_VISTA).map(fila => ({ nombre: sinCodigo(fila.cliente), valor: millones(fila.vencido), mal: true }))} />
        <ContraHaceUnMes c={c} /><span className="ver">Ver Cartera →</span></>} />);
  } else {
    renglones.push(<Renglon key="cartera" pregunta="¿Nos están pagando?" periodo={aHoy('A hoy')} tono="info" ir={() => onIr('cartera')}
      respuesta={<span className="frase">{c?.error ? `No se pudo leer la cartera: ${c.error}` : 'Sin datos de cartera.'}</span>} comparacion={null} />);
  }

  // 4. ¿Qué clientes nos hacen perder? Aproximado: el costo se lleva por sede, no por cliente.
  const k = typeof clientes === 'object' && clientes?.legible ? clientes : null;
  const kPrevio = typeof clientesPrevio === 'object' && clientesPrevio?.legible ? clientesPrevio : null;
  const { pierden, suma } = quienPierde(k);
  const antes = kPrevio ? quienPierde(kPrevio) : null;
  const cuantos = (n: number) => (n === 1 ? '1 cliente' : `${n} clientes`);
  renglones.push(<Renglon key="clientes" pregunta="¿Qué clientes nos hacen perder?" periodo={{ texto: `${mayuscula(nombre(principal))} · aproximado`, tono: 'cerrar' }}
    tono={k && pierden.length ? 'mal' : k ? 'bien' : 'info'} ir={() => onIr('clientes')}
    respuesta={clientes === 'cargando' ? <span className="frase">Leyendo los clientes de {nombre(principal)} en Avancys…</span>
      : !k ? <span className="frase">Sin el detalle por cliente de {nombre(principal)}.</span>
      : <><span className="valor">{pierden.length ? `${cuantos(pierden.length)} · ${millones(suma)}` : 'Ninguno'}</span><span className="frase">Aproximado: el costo se lleva por sede, no por cliente.</span></>}
    comparacion={k ? <>{antes ? <span className={`ref ${antes.suma > suma ? 'mal' : 'bien'}`}>{antes.suma > suma ? '▼' : '▲'} {mayuscula(nombre(previo))}: {cuantos(antes.pierden.length)}, {millones(antes.suma)}</span> : null}
      <Lista filas={pierden.slice(0, A_LA_VISTA).map(fila => ({ nombre: sinCodigo(fila.cliente), valor: millones(fila.margen), mal: true }))} /><span className="ver">Ver Clientes →</span></> : null} />);

  // 5. ¿Cómo va lo comercial? Lo vendido en el mes contra su meta (valor mensual del servicio) y los leads sin gestión.
  if (comercial) {
    const delMes = comercial.sales.by_month.find(fila => fila.month === mesActual) || null;
    const delPrevio = comercial.sales.by_month.find(fila => fila.month === principal) || null;
    const p = comercial.pipeline;
    const atrasados = (p.by_owner || []).filter(fila => fila.owner_name && fila.stale > 0).sort((a, b) => b.stale - a.stale).slice(0, A_LA_VISTA - 1);
    const cumplimiento = delMes?.goal ? delMes.approved_monthly_value / delMes.goal : null;
    renglones.push(<Renglon key="comercial" pregunta="¿Cómo va lo comercial?" periodo={aHoy(`${mayuscula(nombre(mesActual))} · a hoy`)}
      // El mes va en curso: lo vendido contra la meta todavía puede cambiar; rojo solo por los leads sin gestión.
      tono={p.open_count && p.stale_count / p.open_count >= 0.5 ? 'mal' : 'info'} ir={() => onIr('comercial')}
      respuesta={<><span className="valor">{millones(delMes?.approved_monthly_value || 0)} {delMes?.goal ? <small>de {millones(delMes.goal)} de meta</small> : <small>sin meta cargada</small>}</span>
        <span className="frase">Vendido en el mes, en valor mensual del servicio{cumplimiento !== null ? <>: el <b>{Math.round(cumplimiento * 100)} %</b> de la meta</> : null}.</span>
        {cumplimiento !== null ? <span className="siio-barra-portada" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(cumplimiento * 100))}%` }} /></span> : null}</>}
      comparacion={<>{p.open_count ? <span className={`ref ${p.stale_count / p.open_count >= 0.5 ? 'mal' : ''}`}>{p.stale_count} de {p.open_count} leads sin gestión en {p.stale_days} días</span> : null}
        <Lista filas={atrasados.map(fila => ({ nombre: fila.owner_name as string, valor: `${fila.stale} de ${fila.open}`, mal: fila.stale / fila.open >= 0.5 }))} />
        {delPrevio?.goal ? <span>{mayuscula(nombre(principal))} cerró en {millones(delPrevio.approved_monthly_value)} de {millones(delPrevio.goal)} ({Math.round((delPrevio.approved_monthly_value / delPrevio.goal) * 100)} %).</span> : null}
        <span className="ver">Ver Comercial →</span></>} />);

    // 6. ¿Qué licitaciones hay que decidir?
    const enVentana = comercial.tenders.calendar.filter(item => item.days_to_deadline !== null && item.days_to_deadline >= 0 && item.days_to_deadline <= VENTANA_LICITACIONES);
    // Sin GO ni NO-GO y sin estado de oferta: lo que el servidor marca «pendiente_decision».
    const porDecidir = enVentana.filter(item => item.offer_status === 'pendiente_decision');
    const conGo = enVentana.filter(item => item.decision === 'go');
    renglones.push(<Renglon key="licitaciones" pregunta="¿Qué licitaciones hay que decidir?" periodo={aHoy(`Cierran en ${VENTANA_LICITACIONES} días o menos`)} tono={porDecidir.length ? 'mal' : 'bien'} ir={() => onIr('comercial')}
      respuesta={<><span className="valor">{porDecidir.length || 'Ninguna'} {porDecidir.length ? <small>sin decidir si nos presentamos</small> : null}</span>
        <span className="frase">{porDecidir.length ? 'Hay que decir GO o NO-GO antes del cierre.' : `Todas las que cierran en ${VENTANA_LICITACIONES} días ya tienen decisión.`}</span></>}
      comparacion={<><Lista filas={porDecidir.slice(0, A_LA_VISTA).map(item => ({ nombre: `${entidad(item.entity)} · ${fechaCorta(item.deadline_at)} (${item.days_to_deadline} ${item.days_to_deadline === 1 ? 'día' : 'días'})`, valor: millones(item.total_value), mal: true }))} />
        {conGo.length ? <span>Con GO y en preparación: {conGo.map(item => `${entidad(item.entity)} (${fechaCorta(item.deadline_at)})`).join('; ')}.</span> : null}
        <span className="ver">Ver Licitaciones →</span></>} />);
  } else {
    const leyendo = <span className="frase">Leyendo el CRM…</span>;
    renglones.push(<Renglon key="comercial" pregunta="¿Cómo va lo comercial?" periodo={aHoy(`${mayuscula(nombre(mesActual))} · a hoy`)} tono="info" ir={() => onIr('comercial')} respuesta={leyendo} comparacion={null} />);
    renglones.push(<Renglon key="licitaciones" pregunta="¿Qué licitaciones hay que decidir?" periodo={aHoy(`Cierran en ${VENTANA_LICITACIONES} días o menos`)} tono="info" ir={() => onIr('comercial')} respuesta={leyendo} comparacion={null} />);
  }

  // 7. ¿Las fuentes están al día? Los meses que Contabilidad no ha cerrado, con sus días.
  const abiertos = (torre?.pyg || []).filter(fila => fila.mes < mesActual).map(fila => ({ mes: fila.mes, cierre: cierreDe(t, fila.mes, hoy) }))
    // Un mes con el cierre de Finanzas (Excel) tampoco está bloqueado en Avancys: cuenta como abierto.
    .filter(fila => fila.cierre.tono !== 'cerrado');
  renglones.push(<Renglon key="fuentes" pregunta="¿Las fuentes están al día?" periodo={aHoy('A hoy')} tono={abiertos.length ? 'ojo' : 'bien'} ir={() => onIr('fuentes')}
    respuesta={abiertos.length ? <><span className="valor">{abiertos.length === 1 ? '1 mes' : `${abiertos.length} meses`} <small>sin cerrar en Avancys</small></span>
      <span className="frase">Contabilidad no ha cerrado {abiertos.map((fila, i) => <Fragment key={fila.mes}>{i ? (i === abiertos.length - 1 ? ' ni ' : ', ') : ''}<b>{nombre(fila.mes)} ({diasDesdeFinDeMes(fila.mes, hoy)} días)</b></Fragment>)}.</span></>
      : <><span className="valor">Al día</span><span className="frase">Los meses anteriores están cerrados.</span></>}
    comparacion={<>{abiertos.some(fila => fila.mes === principal) ? <span>Por eso las cifras de {nombre(principal)} todavía pueden cambiar.</span> : null}
      <span>Facturación, cartera y CRM: leídos hoy.</span><span className="ver">Ver Fuentes →</span></>} />);

  return <>
    <p className="siio-portada-cabeza siio-nota">Avancys y CRM{torre?.medido_en ? ` leídos el ${hora(torre.medido_en).replace(/\.$/, '')}` : ''}<button type="button" className="siio-enlace" onClick={() => void t.cargar(true)}>Volver a leer</button></p>
    <section className="siio-panel siio-portada" aria-label="Portada: siete preguntas">
      <ol>{renglones}</ol>
    </section>
  </>;
}

// Resultados (contrato de la maqueta, Fase 3): el selector de mes arriba; el estado de resultados con una
// columna por mes y su estado, el mes elegido como protagonista; y el presupuesto contra ejecución.
export function SiioPestanaResultados({ t }: { t: TorreAvancys }) {
  const { torre } = t;
  if (!torre?.pyg?.length || !torre.lineas_pyg) return <p className="siio-secondary">Sin datos de Avancys todavía.</p>;
  // Antes de Avancys, el cierre de Finanzas; desde Avancys, una sola cifra por mes: la de Avancys.
  const primeroAvancys = torre.pyg[0]?.mes || '';
  const oficiales = t.opciones.filter(o => o.fuente === 'oficial' && o.mes < primeroAvancys);
  const tramo = oficiales.length ? `${nombreMes(oficiales[0].mes).split(' ')[0]}–${nombreMes(oficiales[oficiales.length - 1].mes).split(' ')[0]}: cierre de Finanzas (Excel) · ` : '';
  const mesActual = new Date().toISOString().slice(0, 7);
  return <>
    <div className="siio-sub">
      <label className="siio-selector">Mes
        <select value={t.mes} onChange={evento => t.setMes(evento.target.value)}>
          {[...t.opciones].reverse().map(o => <option key={o.mes} value={o.mes}>{nombreMes(o.mes)} · {o.mes === mesActual ? 'a hoy' : cierreDe(t, o.mes).texto}</option>)}
        </select>
      </label>
      <p className="siio-nota">{tramo}desde {primeroAvancys ? nombreMes(primeroAvancys).split(' ')[0] : 'agosto'}: Avancys, con lo que tiene registrado hoy</p>
    </div>
    <AvisoDelMes t={t} meses={torre.pyg} />
    <HistoriaDelMes t={t} lineas={torre.lineas_pyg} meses={torre.pyg} />
    <EstadoDeResultados t={t} lineas={torre.lineas_pyg} meses={torre.pyg} />
  </>;
}

// Lo que hay que saber antes de creerle al mes elegido, arriba y no en letra chica: sin cierre y con líneas que parecen
// incompletas, o Avancys y el cierre de Finanzas que no coinciden. Ámbar: son cifras que todavía pueden cambiar.
function AvisoDelMes({ t, meses }: { t: TorreAvancys; meses: MesPyg[] }) {
  const hoy = new Date();
  const fila = meses.find(m => m.mes === t.mes) || null;
  if (!fila || fila.mes >= hoy.toISOString().slice(0, 7)) return null;
  const nombre = (mes: string) => nombreMes(mes).split(' ')[0];
  const cierre = cierreDe(t, fila.mes, hoy);
  const incompletas = fila.proyeccion && fila.estado === 'parcial' ? fila.proyeccion.estimadas.length : 0;
  const o = t.oficialDe(fila.mes);
  const difiere = o && (Math.abs(fila.totales.ingresos - o.ingresos) >= 1e6 || Math.abs(fila.totales.utilidad_ordinaria - o.utilidad_operacional) >= 1e6);
  const frases: React.ReactNode[] = [];
  if (cierre.tono === 'confirmar') frases.push(<Fragment key="cierre"><strong>Contabilidad lleva {diasDesdeFinDeMes(fila.mes, hoy)} días sin cerrar {nombre(fila.mes)}.</strong> Las cifras son las que Avancys tiene hoy{incompletas ? <> y <strong>{incompletas === 1 ? '1 línea parece incompleta' : `${incompletas} líneas parecen incompletas`}</strong> frente a {nombre(fila.proyeccion!.base_mes)} (marcadas en «Mes a mes»)</> : null}.</Fragment>);
  if (difiere && o) frases.push(<Fragment key="finanzas"><strong>Avancys y el cierre de Finanzas (Excel) no coinciden:</strong> ingresos {millones(fila.totales.ingresos)} contra {millones(o.ingresos)}; utilidad operacional {millones(fila.totales.utilidad_ordinaria)} contra {millones(o.utilidad_operacional)}. La Torre muestra la de Avancys; Finanzas explica la diferencia.</Fragment>);
  if (!frases.length) return null;
  return <div className="siio-aviso-mes" role="note">{frases.map((frase, i) => <p key={i}>{frase}</p>)}</div>;
}

// Resultados con fuerza (Juan, 2026-11-15: «a este le falta mucha fuerza»; maqueta aprobada): cuatro cifras del mes
// contra el anterior, a dónde se va cada $100 que facturamos con la frase que explica el mes, qué cambió y el
// presupuesto. Las cifras son las que Avancys tiene hoy; el chip del selector dice si el mes está cerrado.
const TRAMOS_100: { clave: string; etiqueta: string; lineas: string[] }[] = [
  { clave: 'mod', etiqueta: 'mano de obra directa', lineas: ['mod_vigilancia'] },
  { clave: 'indirecta', etiqueta: 'indirecta y costos de operación', lineas: ['moi_vigilancia', 'cif_vigilancia'] },
  { clave: 'tecnologia', etiqueta: 'medios tecnológicos', lineas: ['equipos', 'mod_tecnicos', 'cif_mt'] },
  { clave: 'personal', etiqueta: 'gastos de personal', lineas: ['personal_vigilancia', 'personal_mt'] },
  { clave: 'generales', etiqueta: 'gastos generales', lineas: ['generales_vigilancia', 'generales_mt'] },
];
const CAMBIOS_A_LA_VISTA = 5;
const PUNTOS_SIN_CAMBIO = 0.5;
const variacion = (actual: number, antes: number) => (antes ? (actual - antes) / Math.abs(antes) : null);
const pctFirmado = (valor: number | null) => (valor === null ? '' : `${valor >= 0 ? '+' : '−'}${Math.abs(Math.round(valor * 1000) / 10).toLocaleString('es-CO')} %`);
const millonesFirmado = (valor: number) => `${valor >= 0 ? '+' : '−'}${millones(Math.abs(valor))}`;
const pesos100 = (valor: number) => `$${(Math.round(valor * 10) / 10).toLocaleString('es-CO')}`;

function HistoriaDelMes({ t, lineas, meses }: { t: TorreAvancys; lineas: LineaPyg[]; meses: MesPyg[] }) {
  const mesActual = new Date().toISOString().slice(0, 7);
  const fila = meses.find(m => m.mes === t.mes) || null;
  const previo = fila ? meses.find(m => m.mes === mesAnterior(fila.mes)) || null : null;
  const nombre = (mes: string) => nombreMes(mes).split(' ')[0];
  if (!fila) return null;
  // El mes en curso con la misma forma que un mes terminado (Juan, 16-nov: «noviembre se ve muy diferente»): el aviso
  // arriba, las mismas cuatro cifras; lo que se lee al cierre lo dice en su lugar, con la referencia del mes anterior.
  if (fila.mes >= mesActual) {
    const p = previo?.totales || null;
    const Mes = (mes: string) => nombre(mes).replace(/^./, letra => letra.toUpperCase());
    const alCierre = (etiqueta: string, valorPrevio: number | null) => <div className="siio-cifra-portada">
      <span className="pregunta">{etiqueta}</span>
      <span className="valor pendiente">Al cierre</span>
      <span className="referencia">Se lee cuando se cause la nómina</span>
      {p && valorPrevio !== null ? <span className="detalle">{Mes(previo!.mes)}: {millones(valorPrevio)}, el {pct(valorPrevio, p.ingresos)} del ingreso.</span> : null}
    </div>;
    return <>
      <div className="siio-aviso-mes" role="note"><p><strong>{Mes(fila.mes)} va a hoy.</strong> Lo facturado se ve desde ya; los costos, los gastos y la utilidad se leen al cierre, cuando Contabilidad cause la nómina.</p></div>
      <section className="siio-panel siio-cifras-portada siio-cifras-resultados" aria-label={`Resultados de ${nombre(fila.mes)} a hoy`}>
        <div className="siio-cifra-portada">
          <span className="pregunta">Ingresos a hoy</span>
          <span className="valor">{millones(fila.totales.ingresos)}</span>
          {p ? <span className="referencia">{pct(fila.totales.ingresos, p.ingresos)} de {nombre(previo!.mes)} completo</span> : null}
          {p ? <span className="detalle">{Mes(previo!.mes)} completo: {millones(p.ingresos)}.</span> : null}
        </div>
        {alCierre('Costo de operación', p ? -p.costos : null)}
        {alCierre('Gastos operativos', p ? -p.gastos : null)}
        {alCierre('Utilidad operacional', p ? p.utilidad_ordinaria : null)}
      </section>
    </>;
  }
  const tt = fila.totales;
  const tp = previo?.totales || null;
  const costo = -tt.costos, gasto = -tt.gastos;
  const parte = (valor: number, base: number) => (base ? (valor / base) * 100 : 0);
  const puntosDe = (valor: number, base: number, valorAntes?: number, baseAntes?: number) =>
    (valorAntes !== undefined && baseAntes ? Math.round((parte(valor, base) - parte(valorAntes, baseAntes)) * 10) / 10 : null);
  const flecha = (puntos: number | null) => (puntos === null ? '' : ` ${puntos >= 0 ? '▲' : '▼'} ${Math.abs(puntos).toLocaleString('es-CO')} pts`);
  // Bien o mal según el efecto: en costos y gastos subir es malo, en la utilidad bajar. Menos de medio punto no pinta.
  const tonoPuntos = (puntos: number | null, subirEsMalo: boolean) => (puntos === null || Math.abs(puntos) < PUNTOS_SIN_CAMBIO ? '' : (puntos > 0) === subirEsMalo ? 'mal' : 'bien');
  const suma = (f: MesPyg, claves: string[]) => -claves.reduce((total, clave) => total + (f.lineas[clave] || 0), 0);
  const tramos = (f: MesPyg) => [...TRAMOS_100.map(tramo => ({ ...tramo, valor: parte(suma(f, tramo.lineas), f.totales.ingresos) })),
    { clave: 'utilidad', etiqueta: 'utilidad operacional', lineas: [], valor: parte(f.totales.utilidad_ordinaria, f.totales.ingresos) }];
  const actual = tramos(fila);
  const antes = previo ? tramos(previo) : null;
  // La frase del mes: el tramo de costo que más se movió por cada $100, con el crecimiento del ingreso y de ese costo.
  const mayor = antes ? actual.slice(0, -1).map((tramo, i) => ({ tramo, antes: antes[i], dif: tramo.valor - antes[i].valor }))
    .sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif))[0] : null;
  const utilidad = actual[actual.length - 1].valor;
  const frase = antes && mayor ? <>En {nombre(fila.mes)} nos quedaron <strong className={utilidad >= 0 ? 'bien' : 'mal'}>{pesos100(utilidad)}</strong> de cada $100, contra {pesos100(antes[antes.length - 1].valor)} en {nombre(previo!.mes)}: {mayor.tramo.etiqueta} {mayor.dif < 0 ? 'bajó' : 'subió'} de {pesos100(mayor.antes.valor)} a {pesos100(mayor.tramo.valor)} (el ingreso {pctFirmado(variacion(tt.ingresos, tp!.ingresos))}; {mayor.tramo.etiqueta}, {pctFirmado(variacion(suma(fila, mayor.tramo.lineas), suma(previo!, mayor.tramo.lineas)))}).</>
    : <>En {nombre(fila.mes)} nos quedaron <strong className={utilidad >= 0 ? 'bien' : 'mal'}>{pesos100(utilidad)}</strong> de cada $100.</>;
  // Qué cambió: las líneas que más se movieron frente al mes anterior; en costos y gastos, subir es malo.
  const cambios = previo ? lineas.filter(l => ['ingresos', 'costos', 'gastos'].includes(l.grupo)).map(l => {
    const a = fila.lineas[l.clave] || 0, b = previo.lineas[l.clave] || 0;
    const ingreso = l.grupo === 'ingresos';
    const cambio = ingreso ? a - b : -(a - b);
    return { l, ingreso, cambio, variacion: variacion(Math.abs(a), Math.abs(b)) };
  }).filter(c => Math.abs(c.cambio) >= 1e6).sort((a, b) => Math.abs(b.cambio) - Math.abs(a.cambio)).slice(0, CAMBIOS_A_LA_VISTA) : [];
  const crecimiento = tp ? variacion(tt.ingresos, tp.ingresos) : null;
  const tono = (c: (typeof cambios)[number]) => {
    if (c.ingreso) return c.cambio >= 0 ? 'bien' : 'mal';
    if (c.cambio <= 0) return 'bien';
    return crecimiento !== null && c.variacion !== null && c.variacion < crecimiento ? 'igual' : 'mal';
  };
  const lectura = (c: (typeof cambios)[number]) => {
    if (c.ingreso) return c.cambio >= 0 ? 'más ingreso' : 'menos ingreso';
    if (c.cambio <= 0) return 'bajó';
    return tono(c) === 'igual' ? 'subió menos que el ingreso' : 'subió';
  };
  const mod = suma(fila, ['mod_vigilancia']);
  const mayorGasto = previo ? cambios.find(c => c.l.grupo === 'gastos') : null;
  const ppCosto = puntosDe(costo, tt.ingresos, tp ? -tp.costos : undefined, tp?.ingresos);
  const ppGasto = puntosDe(gasto, tt.ingresos, tp ? -tp.gastos : undefined, tp?.ingresos);
  const ppUtil = puntosDe(tt.utilidad_ordinaria, tt.ingresos, tp?.utilidad_ordinaria, tp?.ingresos);
  const antesDe = previo ? `${nombre(previo.mes).replace(/^./, letra => letra.toUpperCase())}: ` : '';
  return <>
    <section className="siio-panel siio-cifras-portada siio-cifras-resultados" aria-label={`Resultados de ${nombre(fila.mes)}`}>
      <div className="siio-cifra-portada">
        <span className="pregunta">Ingresos</span>
        <span className="valor">{millones(tt.ingresos)}</span>
        {tp ? <span className={`referencia ${tt.ingresos >= tp.ingresos ? 'bien' : 'mal'}`}>{tt.ingresos >= tp.ingresos ? '▲' : '▼'} {pctFirmado(crecimiento).replace(/^[+−]/, '')} frente a {nombre(previo!.mes)}</span> : null}
        {tp ? <span className="detalle">{antesDe}{millones(tp.ingresos)}.</span> : null}
      </div>
      <div className="siio-cifra-portada">
        <span className="pregunta">Costo de operación</span>
        <span className="valor">{millones(costo)}</span>
        <span className={`referencia ${tonoPuntos(ppCosto, true)}`}>{pct(costo, tt.ingresos)} del ingreso{flecha(ppCosto)}</span>
        <span className="detalle">{tp ? `${antesDe}${pct(-tp.costos, tp.ingresos)} del ingreso. ` : ''}Mano de obra directa: {millones(mod)}.</span>
      </div>
      <div className="siio-cifra-portada">
        <span className="pregunta">Gastos operativos</span>
        <span className="valor">{millones(gasto)}</span>
        <span className={`referencia ${tonoPuntos(ppGasto, true)}`}>{pct(gasto, tt.ingresos)} del ingreso{flecha(ppGasto)}</span>
        <span className="detalle">{tp ? `${antesDe}${pct(-tp.gastos, tp.ingresos)} del ingreso.` : ''}{mayorGasto ? ` El que más se movió: ${mayorGasto.l.etiqueta.toLowerCase()}, ${mayorGasto.cambio > 0 ? 'subió' : 'bajó'} ${millones(Math.abs(mayorGasto.cambio))}.` : ''}</span>
      </div>
      <div className="siio-cifra-portada">
        <span className="pregunta">Utilidad operacional</span>
        <span className={`valor${tt.utilidad_ordinaria < 0 ? ' mal' : ''}`}>{millones(tt.utilidad_ordinaria)}</span>
        <span className={`referencia ${tt.utilidad_ordinaria < 0 ? 'mal' : tonoPuntos(ppUtil, false)}`}>{pct(tt.utilidad_ordinaria, tt.ingresos)} del ingreso{flecha(ppUtil)}</span>
        {tp ? <span className="detalle">{antesDe}{millones(tp.utilidad_ordinaria)}, el {pct(tp.utilidad_ordinaria, tp.ingresos)} del ingreso.</span> : null}
      </div>
    </section>
    <section className="siio-panel siio-cada-100" aria-label="A dónde se va cada $100 que facturamos">
      <h2>¿A dónde se va cada $100 que facturamos?</h2>
      <p className="lead">{frase}</p>
      {[{ f: fila, tr: actual, principal: true }, ...(previo && antes ? [{ f: previo, tr: antes, principal: false }] : [])].map(({ f, tr, principal }) => <div key={f.mes} className={`fila${principal ? '' : ' antes'}`}>
        <span className="mes">{nombre(f.mes).replace(/^./, letra => letra.toUpperCase())}</span>
        <div className="barra" role="img" aria-label={`${nombre(f.mes)}: ${tr.map(x => `${x.etiqueta} ${pesos100(x.valor)}`).join(', ')}`}>
          {tr.filter(x => x.valor > 0).map(x => <span key={x.clave} className={`t-${x.clave}`} style={{ width: `${x.valor}%` }} title={`${x.etiqueta}: ${pesos100(x.valor)} de cada $100`}>
            {x.valor >= 4 ? <>{pesos100(x.valor)}{principal && (x.clave === 'mod' || x.clave === 'utilidad') ? <small>{x.etiqueta === 'utilidad operacional' ? 'utilidad' : x.etiqueta}</small> : null}</> : null}
          </span>)}
        </div>
      </div>)}
      {utilidad < 0 ? <p className="siio-nota mal">Los costos y gastos pasan de $100: el mes deja pérdida de {pesos100(-utilidad)} por cada $100.</p> : null}
      {/* La leyenda lleva las cifras: las franjas delgadas no caben con su número (Juan, 16-nov: «no se ve el valor de
          medios tecnológicos»). Cada tramo con lo de este mes y lo del anterior. */}
      <ul className="leyenda">{actual.map((x, i) => <li key={x.clave}>
        <i className={`t-${x.clave}`} />
        <span className="nombre">{x.etiqueta.replace(/^./, letra => letra.toUpperCase())}</span>
        <strong>{pesos100(x.valor)}</strong>
        {antes ? <small>{nombre(previo!.mes).slice(0, 3)}: {pesos100(antes[i].valor)}</small> : null}
      </li>)}</ul>
    </section>
    <div className="siio-dos-col">
      {cambios.length ? <section className="siio-panel" aria-label={`Qué cambió frente a ${nombre(previo!.mes)}`}>
        <h2>Qué cambió frente a {nombre(previo!.mes)}</h2>
        <ul className="siio-cambios">{cambios.map(c => <li key={c.l.clave}>
          <span><strong>{c.l.etiqueta}</strong> · {lectura(c)}</span>
          <span className={`valor ${tono(c)}`}>{millonesFirmado(c.ingreso ? c.cambio : c.cambio)}</span>
          <span className="var">{pctFirmado(c.variacion)}</span>
        </li>)}</ul>
      </section> : <section className="siio-panel"><h2>Qué cambió</h2><p className="siio-nota">{previo ? `Ninguna línea se movió más de un millón frente a ${nombre(previo.mes)}.` : 'No hay un mes anterior en Avancys para comparar.'}</p></section>}
      <SiioPresupuesto presupuesto={t.torre?.presupuesto || null} mes={t.mes} cierreDe={mes => cierreDe(t, mes)} />
    </div>
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
  // Con las reglas de la Portada (Juan, 2026-11-16): las preguntas como en la Portada, el periodo de cada columna con su
  // cierre, lo que hay que saber antes de creerle arriba en ámbar y cada margen contra el mes anterior.
  const hoy = new Date();
  const indice = cerrados.indexOf(mesClientes);
  const mesAntes = indice > 0 ? cerrados[indice - 1] : null;
  const datosElegido = datosDe(mesClientes);
  const costoElegido = typeof datosElegido === 'object' ? Math.abs(datosElegido.costo_por_hora ?? 0) : 0;
  const cierreElegido = mesClientes ? cierreDe(t, mesClientes, hoy) : null;
  const chipCierre = (mes: string) => {
    const c = cierreDe(t, mes, hoy);
    return <span className={`siio-chip ${c.tono}`}>{c.tono === 'finanzas' ? 'Finanzas cerró · cifras de Avancys' : c.texto}</span>;
  };
  return <>
    <div className="siio-aviso-mes" role="note">
      <p><strong>Cifras aproximadas.</strong> El ingreso de cada cliente es el real; el costo de vigilantes se calcula{costoElegido ? ` a ${pesos(costoElegido)} la hora` : ''} por las horas de sus puestos, y la supervisión y la administración se reparten por facturación. El costo exacto por cliente llega cuando Avancys programe los turnos.</p>
      {cierreElegido && cierreElegido.tono === 'confirmar' ? <p><strong>Contabilidad lleva {diasDesdeFinDeMes(mesClientes, hoy)} días sin cerrar {nombreMes(mesClientes).split(' ')[0]}.</strong> Las cifras pueden cambiar.</p> : null}
    </div>
    <section className="siio-panel" aria-label="Clientes que nos hacen perder">
      <h2>¿Qué clientes nos hacen perder?</h2>
      <p className="siio-nota" style={{ margin: '4px 0 8px' }}>{ultimos.length === 1 ? 'El último mes' : `Los últimos ${ultimos.length} meses`} con datos en Avancys y lo acumulado en {anio}{desde ? ` desde ${desde}, cuando empieza Avancys` : ''}. Primero los que más pierden en el año.</p>
      {cargando ? <p className="siio-nota">Calculando los otros meses…</p> : null}
      {mostrados.length ? <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
        <thead><tr><th>Cliente</th>{ultimos.map(({ mes }) => <th key={mes} className="num">{nombreMes(mes).split(' ')[0]} {chipCierre(mes)}</th>)}<th className="num total">Acumulado {anio}</th></tr></thead>
        <tbody>{mostrados.map(fila => <tr key={fila.nombre}>
          <td><span className="nombre">{sinCodigo(fila.nombre)}</span>{fila.todos ? <span className="siio-chip marca">pierde todos los meses</span> : bajoCosto(fila) ? <span className="siio-chip marca">precio bajo el costo</span> : null}</td>
          {ultimos.map(({ mes }) => {
            const m = fila.meses[mes];
            return <td key={mes} data-etiqueta={nombreMes(mes).split(' ')[0]} className={`num${pierde(m) ? ' mal' : ''}`}>{m ? <><strong>{millones(m.margen)}</strong><small>{pct(m.margen, m.ingresos)}</small></> : <strong>—</strong>}</td>;
          })}
          <td className={`num total${fila.margen < 0 ? ' mal' : ''}`}>{fila.ingresos ? <><strong>{millones(fila.margen)}</strong>{fila.margen < 0 ? <span className="siio-magnitud"><i style={{ width: `${Math.round((Math.abs(fila.margen) / peorAnio) * 100)}%` }} /></span> : null}</> : <strong>—</strong>}</td>
        </tr>)}</tbody>
        <tfoot><tr><th>Total de los que se muestran</th>{ultimos.map(({ mes }) => <th key={mes} className="num" />)}<th className="num total mal">{millones(mostrados.reduce((suma, fila) => suma + fila.margen, 0))}</th></tr></tfoot>
      </table></div> : <p className="siio-secondary">Ningún cliente pierde en los meses cerrados.</p>}
    </section>
    <section className="siio-panel" aria-label="Cuánto deja cada cliente">
      <div className="siio-sub" style={{ marginBottom: 8 }}>
        <h2>¿Cuánto deja cada cliente?</h2>
        <label className="siio-selector">Mes
          <select value={mesClientes} onChange={evento => setElegido(evento.target.value)}>
            {[...cerrados].reverse().map(mes => <option key={mes} value={mes}>{nombreMes(mes)} · {cierreDe(t, mes, hoy).texto}</option>)}
          </select>
        </label>
      </div>
      <DetalleClientes mes={mesClientes} datos={datosElegido} mesAntes={mesAntes} antes={mesAntes ? datosDe(mesAntes) : undefined} />
    </section>
  </>;
}

const CLIENTES_A_LA_VISTA = 12;

function DetalleClientes({ mes, datos, mesAntes = null, antes }: { mes: string; datos: Clientes | 'cargando' | 'error' | undefined; mesAntes?: string | null; antes?: Clientes | 'cargando' | 'error' }) {
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
  // El margen de cada cliente contra el mes anterior, emparejado por NIT.
  const previo = typeof antes === 'object' && antes.legible ? new Map((antes.clientes || []).map(fila => [nitDe(fila.cliente) || fila.cliente, fila])) : null;
  const abrev = mesAntes ? nombreMes(mesAntes).slice(0, 3) : '';
  return <>
    <p className="siio-nota" style={{ marginBottom: 8 }}>
      Los 5 mayores concentran el {pct(cinco, total)} del ingreso. Primero los que pierden.{previo ? ` Debajo de cada margen, el de ${nombreMes(mesAntes).split(' ')[0]}.` : ''}
    </p>
    <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Cliente</th><th className="num">Ingreso</th><th className="num">Peso</th><th className="num">Precio por hora{costoHora ? <small>costo: {pesos(costoHora)}</small> : null}</th><th className="num total">Margen (est.)</th></tr></thead>
      <tbody>{filas.map(fila => {
        const bajo = Boolean(costoHora && fila.precio_hora && fila.precio_hora < costoHora);
        return <tr key={fila.cliente}>
          <td><span className="nombre">{sinCodigo(fila.cliente)}</span>{bajo ? <span className="siio-chip marca">bajo el costo</span> : null}</td>
          <td className="num" data-etiqueta="Ingreso"><strong>{millones(fila.ingresos)}</strong></td>
          <td className="num" data-etiqueta="Peso"><strong>{pct(fila.ingresos, total)}</strong></td>
          <td className={`num${bajo ? ' mal' : ''}`} data-etiqueta="Precio por hora">{fila.precio_hora ? <strong>{pesos(fila.precio_hora)}</strong> : <small>sin horas</small>}</td>
          <td className={`num total${fila.margen < 0 ? ' mal' : ''}`}><strong>{millones(fila.margen)}</strong><small>{pct(fila.margen, fila.ingresos)}</small>
            {previo ? <small className="siio-antes">{abrev}: {(() => { const a = previo.get(nitDe(fila.cliente) || fila.cliente); return a ? millones(a.margen) : '—'; })()}</small> : null}</td>
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

// Contra hace un mes, con la foto diaria que guarda la Torre (migración 226): menos vencido es bueno.
function ContraHaceUnMes({ c }: { c: Cartera }) {
  const f = c.hace_un_mes;
  if (!f || !c.vencido) return <span>Contra hace un mes: todavía no hay registro; la Torre guarda la foto de la cartera cada día.</span>;
  const dif = c.vencido.saldo - f.vencido;
  const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${f.fecha}T12:00:00Z`)).replace('.', '');
  return <span className={`ref ${Math.abs(dif) < 1e6 ? '' : dif > 0 ? 'mal' : 'bien'}`}>{dif > 0 ? '▲' : '▼'} {millones(Math.abs(dif))} {dif > 0 ? 'más' : 'menos'} vencido que el {fecha} ({millones(f.vencido)})</span>;
}

// Cartera con las reglas de la Portada (Juan, 2026-11-16). Sale de la contabilidad (cuentas 1305), con la que vino de
// Yeminus. La pregunta y su periodo (a hoy), la comparación contra hace
// un mes, lo que puede cambiar la cifra arriba en ámbar y el rojo sólo para lo que pasa su umbral.
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
  const parteVencida = c.total.saldo ? c.vencido.saldo / c.total.saldo : 0;
  const mas30 = (c.tramos || []).slice(1).reduce((suma, tramo) => suma + tramo.saldo, 0);
  const fecha = c.hoy ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${c.hoy}T12:00:00Z`)) : null;
  const consignaciones = c.consignaciones_sin_identificar?.saldo || 0;
  return <>
    {/* Lo que puede mover la cifra, arriba: las consignaciones sin aplicar bajan la cartera cuando se identifican, y lo de
        Yeminus es deuda vieja cargada como saldo inicial. */}
    {consignaciones || c.heredado_yeminus?.saldo ? <div className="siio-aviso-mes" role="note">
      {consignaciones ? <p><strong>{millones(consignaciones)} en consignaciones sin identificar.</strong> Son {c.consignaciones_sin_identificar!.partidas.toLocaleString('es-CO')} pagos recibidos que nadie ha aplicado a un cliente: cuando Tesorería y Cartera los apliquen, la cartera baja.</p> : null}
      {c.heredado_yeminus?.saldo ? <p><strong>{millones(c.heredado_yeminus.saldo)} vienen del sistema anterior (Yeminus).</strong> {c.heredado_yeminus.facturas.toLocaleString('es-CO')} facturas cargadas como saldo inicial y sin cobrar.</p> : null}
    </div> : null}
    <section className="siio-panel" aria-label="¿Nos están pagando?">
      <div className="siio-sub" style={{ marginBottom: 8 }}>
        <h2>¿Nos están pagando?</h2>
        <span className="siio-chip vivo">A hoy{fecha ? ` · ${fecha}` : ''}</span>
      </div>
      <div className="siio-cifras siio-cifras-3">
        <CifraKit etiqueta="Vencida" valor={millones(c.vencido.saldo)} tono={parteVencida >= CARTERA_VENCIDA_MAL ? 'mal' : undefined}
          nota={<>{pct(c.vencido.saldo, c.total.saldo)} de lo que nos deben, aunque sea por un día. <ContraHaceUnMes c={c} /></>} />
        <CifraKit etiqueta="Vencida hace más de 30 días" valor={millones(mas30)} nota={`${pct(mas30, c.vencido.saldo)} de lo vencido`} />
        <CifraKit etiqueta="Por cobrar en total" valor={millones(c.total.saldo)} nota={<>{dias ? `≈ ${dias} días de facturación. ` : ''}Sin vencer: {millones(c.total.saldo - c.vencido.saldo)}.</>} />
      </div>
      <div className="siio-tramos" aria-label="Lo vencido por antigüedad">
        {(c.tramos || []).map(tramo => <div key={tramo.tramo}>
          <span className="etiqueta">{tramo.tramo}</span>
          <strong>{millones(tramo.saldo)}</strong>
          <span className="siio-magnitud neutra"><i style={{ width: `${c.vencido!.saldo ? Math.round((tramo.saldo / c.vencido!.saldo) * 100) : 0}%` }} /></span>
          <small>{c.vencido?.saldo ? `${pct(tramo.saldo, c.vencido.saldo)} de lo vencido` : ''}</small>
        </div>)}
      </div>
    </section>
    <section className="siio-panel" aria-label="Quién debe más">
      <h2>¿Quién debe más?</h2>
      <p className="siio-nota" style={{ margin: '4px 0 8px' }}>Lo vencido de cada cliente y a cuántos meses de su facturación equivale; en rojo, dos meses o más.</p>
      <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
        <thead><tr><th>Cliente</th><th className="num">Vencido</th><th className="num total">Equivale a</th></tr></thead>
        <tbody>{deudores.map(fila => {
          const enRojo = fila.meses !== null && fila.meses >= 2;
          return <tr key={fila.cliente}>
            <td><span className="nombre">{sinCodigo(fila.cliente)}</span>{pierdePlata.has(nitDeudor(fila.cliente)) ? <span className="siio-chip marca">además pierde plata</span> : null}</td>
            <td className="num" data-etiqueta="Vencido"><strong>{millones(fila.vencido)}</strong></td>
            <td className={`num total${enRojo ? ' mal' : ''}`}>{fila.meses !== null
              ? <><strong>{(Math.round(fila.meses * 10) / 10).toLocaleString('es-CO')} {fila.meses >= 0.95 && fila.meses < 1.05 ? 'mes' : 'meses'}</strong><span className="siio-magnitud"><i style={{ width: `${Math.round((fila.meses / masMeses) * 100)}%` }} /></span></>
              : <><strong>—</strong><small>sin facturación en el último mes</small></>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="siio-nota" style={{ marginTop: 6 }}>«Equivale a»: la deuda vencida sobre lo que se le factura al mes a ese cliente, ambas con IVA. Partidas abiertas de las cuentas de clientes en la contabilidad de Avancys{fecha ? ` al ${fecha}` : ''}, incluida la cartera que vino de Yeminus con su vencimiento original.</p>
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

// El estado de resultados con las líneas del PYG de Finanzas, mes a mes, desde Avancys (revisado con Juan el
// 2026-11-15): lo que el sistema tiene hoy, sin proyecciones; el estado de cierre de cada mes; las líneas que parecen
// incompletas con su referencia del último mes cerrado; el mes en curso a hoy, con sus totales al cierre; y una sola
// cifra por mes, con la diferencia frente al cierre de Finanzas dicha y con responsable.
function EstadoDeResultados({ t, lineas, meses }: { t: TorreAvancys; lineas: LineaPyg[]; meses: MesPyg[] }) {
  const hoy = new Date();
  const mesActual = hoy.toISOString().slice(0, 7);
  const ultimoCerrado = [...meses].reverse().find(fila => fila.estado === 'cerrado');
  const prov = ultimoCerrado?.provision;
  const sinClasificar = meses.flatMap(fila => fila.sin_clasificar.map(c => ({ ...c, mes: fila.mes })));
  const enCurso = (fila: MesPyg) => fila.mes >= mesActual;
  const conOficial = meses.some(fila => t.oficialDe(fila.mes));
  // Lo que no se ha registrado del mes: las líneas que la contabilidad todavía no completa frente al último cerrado.
  const base = (fila: MesPyg) => (fila.proyeccion && !enCurso(fila) ? meses.find(m => m.mes === fila.proyeccion!.base_mes) || null : null);
  const incompleta = (fila: MesPyg, clave: string) => Boolean(base(fila) && fila.proyeccion!.estimadas.includes(clave));
  const chip = (fila: MesPyg) => {
    if (enCurso(fila)) return <span className="siio-chip vivo">A hoy</span>;
    const c = cierreDe(t, fila.mes, hoy);
    // Desde agosto las cifras son de Avancys aunque Finanzas haya cerrado el mes en su Excel: el chip no lo esconde.
    if (c.tono === 'finanzas') return <span className="siio-chip finanzas">Finanzas cerró · cifras de Avancys</span>;
    return <span className={`siio-chip ${c.tono}`}>{c.texto}</span>;
  };
  const protagonista = (fila: MesPyg) => (fila.mes === t.mes ? 'num total' : 'num');
  const sinRenta = (fila: MesPyg) => !enCurso(fila) && !fila.totales.impuestos;
  const celdaLinea = (fila: MesPyg, clave: string) => {
    const valor = fila.lineas[clave] || 0;
    const ref = incompleta(fila, clave) ? base(fila)!.lineas[clave] || 0 : null;
    if (clave === 'renta' && sinRenta(fila)) return <span className="siio-secondary">no registrado</span>;
    return <>{<span className={enCurso(fila) ? 'siio-secondary' : undefined}>{millones(valor)}</span>}
      {ref !== null ? <small className="siio-incompleta" title="Parece incompleta: todavía no está registrada como en el último mes cerrado">{nombreMes(base(fila)!.mes).slice(0, 3)}: {millones(ref)}</small> : null}</>;
  };
  const celdaTotal = (fila: MesPyg, total: keyof Totales) => {
    if (enCurso(fila) && total !== 'ingresos') return <span className="siio-secondary">al cierre</span>;
    if (total === 'utilidad_neta' && sinRenta(fila)) return <span className="siio-secondary">—</span>;
    const t2 = fila.totales;
    return <><strong>{millones(t2[total])}</strong>{total !== 'ingresos' ? <small>{pct(t2[total], t2.ingresos)}</small> : null}</>;
  };
  return <section className="siio-panel" aria-label="Estado de resultados">
    <h2>Mes a mes</h2>
    <p className="siio-nota">Las {lineas.length} líneas del estado de resultados, con lo que Avancys tiene registrado hoy. Una línea que parece incompleta lleva debajo su valor del último mes cerrado.</p>
    <div className="siio-tabla-wrap"><table className="siio-tabla siio-pyg">
      <thead><tr><th>Línea</th>{meses.map(fila => <th key={fila.mes} className={protagonista(fila)}>{nombreMes(fila.mes).split(' ')[0]} {chip(fila)}</th>)}</tr></thead>
      <tbody>{GRUPOS.map(g => <Fragment key={g.grupo}>
        {lineas.filter(l => l.grupo === g.grupo).map(l => <tr key={l.clave}>
          <td title={`Cuentas ${l.cuentas}`}>{l.etiqueta}{l.clave === 'ing_vigilancia' ? ' (con provisión)' : ''}</td>
          {meses.map(fila => <td key={fila.mes} className={protagonista(fila)}>{celdaLinea(fila, l.clave)}</td>)}
        </tr>)}
        <tr className="total"><td><strong>{g.totalEtiqueta}</strong></td>{meses.map(fila => <td key={fila.mes} className={`${protagonista(fila)}${g.total === 'utilidad_ordinaria' && !enCurso(fila) && fila.totales.utilidad_ordinaria < 0 ? ' mal' : ''}`}>{celdaTotal(fila, g.total)}</td>)}</tr>
      </Fragment>)}</tbody>
    </table></div>
    <details className="siio-plegado">
      <summary>Cómo se calculó: las cuentas de cada línea y el cierre oficial de Finanzas</summary>
      <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Línea</th><th>Cuentas de Avancys que suma</th></tr></thead>
        <tbody>{lineas.map(l => <tr key={l.clave}><td>{l.etiqueta}</td><td className="siio-nota">{l.cuentas}</td></tr>)}</tbody>
      </table></div>
      {conOficial ? <div className="siio-tabla-wrap"><table className="siio-tabla">
        <thead><tr><th>Cierre oficial de Finanzas (Excel cargado)</th>{meses.map(fila => <th key={fila.mes} className="num">{nombreMes(fila.mes).split(' ')[0]}</th>)}</tr></thead>
        <tbody>{conOficial ? <>
          <tr><td>Ingresos</td>{meses.map(fila => { const o = t.oficialDe(fila.mes); return <td key={fila.mes} className="num">{o ? millones(o.ingresos) : <span className="siio-secondary">sin cierre</span>}</td>; })}</tr>
          <tr><td>Utilidad operacional</td>{meses.map(fila => { const o = t.oficialDe(fila.mes); return <td key={fila.mes} className="num">{o ? <>{millones(o.utilidad_operacional)}<small>{pct(o.utilidad_operacional, o.ingresos)}</small></> : <span className="siio-secondary">—</span>}</td>; })}</tr>
          <tr><td>Antes de impuestos</td>{meses.map(fila => { const o = t.oficialDe(fila.mes); return <td key={fila.mes} className="num">{o ? millones(o.utilidad_operacional + o.resultado_no_operacional) : <span className="siio-secondary">—</span>}</td>; })}</tr>
        </> : null}</tbody>
      </table></div> : null}
      <p className="siio-nota">Cómo se calculó: armado desde la contabilidad de Avancys con lo que tiene registrado hoy, sin proyecciones. Un mes sin cierre formal puede cambiar mientras Contabilidad registra; las líneas que parecen incompletas llevan debajo su valor del último mes cerrado como referencia. El mes en curso muestra lo registrado a hoy y sus totales se leen al cierre, cuando se cause la nómina.</p>
      {meses.some(sinRenta) ? <p className="siio-nota">El impuesto de renta no lo registra Contabilidad cada mes en Avancys: la utilidad del ejercicio queda sin calcular hasta que lo registre o se llene la provisión de renta en Parámetros (punto 4) · <strong>Contabilidad</strong>.</p> : null}
      {prov ? <p className="siio-nota">
        <strong>Provisión de ingresos mes vencido ({nombreMes(ultimoCerrado?.mes)}):</strong> se suma el servicio prestado y no facturado ({millones(prov.del_mes)}) y se resta el del mes anterior, que se facturó en este ({millones(prov.del_mes_anterior)}): ajuste de {millones(prov.ajuste)}.
        {' '}Por cliente: {prov.clientes.map(k => `${sinCodigo(k.nombre)} ${millones(k.devengado)}`).join(' · ') || '—'}.
        {prov.error ? ` No se pudo calcular completa: ${prov.error}.` : ''}
      </p> : null}
      <p className="siio-nota">{sinClasificar.length ? `Cuentas de resultados que no caen en ninguna línea: ${sinClasificar.map(c => `${c.cuenta} (${nombreMes(c.mes)}) ${millones(c.valor)}`).join(' · ')}.` : 'Todas las cuentas de resultados quedaron clasificadas.'}</p>
    </details>
  </section>;
}
