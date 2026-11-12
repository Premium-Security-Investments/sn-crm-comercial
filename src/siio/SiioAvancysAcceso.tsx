import { useState } from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';

// Qué puede leer hoy el usuario de integración de Avancys.
//
// Las credenciales están marcadas como sensibles en Vercel: no se pueden descargar, ni siquiera
// para revisarlas. La única que puede preguntarle a Avancys es la aplicación desplegada, así que
// la medición se pide desde aquí. No se dispara sola: cada medición hace unas treinta consultas.

type Prueba = { modelo: string; para: string; permitido: boolean; filas?: number; motivo?: string };
type Numerico = { campo: string; etiqueta: string; tipo: string; total: number; filas_con_valor: number };
type Vinculo = { campo: string; etiqueta: string; relacion: string | null; filas_con_valor: number };
type Informe = {
  legible: boolean;
  motivo?: string;
  filas?: number;
  columnas?: number;
  numericos?: Numerico[];
  vinculos?: Vinculo[];
  fechas?: { campo: string; desde: string | null; hasta: string | null } | null;
  por_mes?: { mes: string | null; filas: number | null; sumas: Record<string, number> }[];
  trae_costos?: boolean;
  columnas_de_costo?: string[];
};
type MesPyg = { mes: string; ingresos: number; personal: number; otros_costos: number; margen: number; filas: number };
type Lineas = {
  legible: boolean;
  motivo?: string;
  total?: number;
  desde?: string;
  filas?: number;
  primera_fecha?: string | null;
  por_mes?: MesPyg[];
  por_cuenta?: { codigo: string; nombre: string; monto: number; filas: number; clase: string; personal: boolean }[];
  cuentas?: number;
  cuentas_de_balance?: number;
  costo_de_personal?: number;
  trae_nomina?: boolean;
};
type FilaCliente = { cliente: string; sin_cliente: boolean; cuentas_analiticas: number; ingresos: number; personal: number; otros_costos: number; margen: number };
type Pyg = {
  configurado?: boolean;
  autenticado?: boolean;
  legible?: boolean;
  motivo?: string;
  mes?: string | null;
  totales?: { ingresos: number; personal: number; otros_costos: number; margen: number };
  clientes_con_movimiento?: number;
  clientes?: FilaCliente[];
  sin_cliente?: FilaCliente | null;
  cuentas_con_costo?: number;
  cuentas_de_costo?: { codigo: string | null; nombre: string; grupo: string | null; cliente: string | null; ingresos: number; personal: number; otros_costos: number; margen: number }[];
};
type CampoClave = { modelo: string; campo: string; para: string; grupo: string; permitido: boolean; total?: number; diligenciados?: number; motivo?: string };
type Acceso = {
  configurado: boolean;
  autenticado?: boolean;
  origen?: string;
  medido_en?: string;
  motivo?: string;
  en_uso?: Prueba[];
  pedidos?: Prueba[];
  turnos?: Prueba[];
  campo_clave?: CampoClave;
  rentabilidad_por_cliente?: 'desbloqueada' | 'bloqueada';
  informe_rentabilidad?: Informe | null;
  lineas_analiticas?: Lineas | null;
};

const cifra = (valor: number, tipo: string) => (tipo === 'integer'
  ? Math.round(valor).toLocaleString('es-CO')
  : `${valor < 0 ? '−' : ''}$${Math.round(Math.abs(valor) / 1e6).toLocaleString('es-CO')} M`);

// Qué trae por dentro el informe de rentabilidad de Odoo, antes de construir encima.
function InformeRentabilidad({ informe }: { informe: Informe }) {
  if (!informe.legible) return <p className="siio-secondary">No se pudo mirar adentro del informe de rentabilidad: {informe.motivo}</p>;
  const filas = informe.filas ?? 0;
  return <div className="siio-pulse-block">
    <h4>Adentro del informe de rentabilidad de Odoo</h4>
    <div className={`siio-avancys-clave${informe.trae_costos ? ' siio-avancys-clave-ok' : ''}`}>
      <strong>{informe.trae_costos ? 'Trae columnas de costo con valores' : 'No trae costos llenos'}</strong>
      <span>
        {filas.toLocaleString('es-CO')} filas
        {informe.fechas?.desde ? `, del ${informe.fechas.desde} al ${informe.fechas.hasta}` : ''}.
        {informe.trae_costos ? ` Columnas de costo con valor: ${(informe.columnas_de_costo || []).join(', ')}.` : ''}
      </span>
    </div>
    {informe.vinculos?.length ? <p className="siio-pulse-footnote">
      Con qué se puede cruzar: {informe.vinculos.map(v => `${v.etiqueta} en ${v.filas_con_valor.toLocaleString('es-CO')} de ${filas.toLocaleString('es-CO')} filas`).join(' · ')}.
    </p> : null}
    {informe.numericos?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Columna</th><th>Total</th><th>Filas con valor</th></tr></thead>
      <tbody>{informe.numericos.map(col => <tr key={col.campo}>
        <td><strong>{col.etiqueta}</strong> <code>{col.campo}</code></td>
        <td>{cifra(col.total, col.tipo)}</td>
        <td>{col.filas_con_valor.toLocaleString('es-CO')}</td>
      </tr>)}</tbody>
    </table></div> : <p className="siio-secondary">El informe no tiene columnas numéricas.</p>}
    {informe.por_mes?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Mes</th><th>Filas</th>{Object.keys(informe.por_mes[0].sumas).map(c => <th key={c}><code>{c}</code></th>)}</tr></thead>
      <tbody>{informe.por_mes.map(fila => <tr key={fila.mes ?? 'sin fecha'}>
        <td>{fila.mes ?? 'sin fecha'}</td>
        <td>{(fila.filas ?? 0).toLocaleString('es-CO')}</td>
        {Object.entries(fila.sumas).map(([c, v]) => <td key={c}>{cifra(v, 'monetary')}</td>)}
      </tr>)}</tbody>
    </table></div> : null}
  </div>;
}

const millones = (valor: number) => cifra(valor, 'monetary');
const pct = (parte: number, base: number) => (base ? `${Math.round((parte / base) * 1000) / 10} %` : '—');

// De dónde saca Odoo el informe: la nómina llega a la cuenta analítica de cada contrato, así que
// el costo por cliente está aquí aunque el campo de reparto siga oculto. Solo cuentas de resultados.
function LineasAnaliticas({ lineas }: { lineas: Lineas }) {
  if (!lineas.legible) return <div className="siio-pulse-block">
    <h4>Líneas analíticas</h4>
    <p className="siio-secondary">No se pueden leer las líneas analíticas: {lineas.motivo}</p>
  </div>;
  return <div className="siio-pulse-block">
    <h4>Líneas analíticas (de donde sale el informe)</h4>
    <div className={`siio-avancys-clave${lineas.trae_nomina ? ' siio-avancys-clave-ok' : ''}`}>
      <strong>{lineas.trae_nomina ? 'La nómina sí llega a las cuentas analíticas' : 'La nómina no llega a las cuentas analíticas'}</strong>
      <span>
        Costo y gasto de personal en el último año: {millones(lineas.costo_de_personal ?? 0)}.
        {' '}{(lineas.filas ?? 0).toLocaleString('es-CO')} líneas; la primera es del {lineas.primera_fecha ?? '—'}.
        {' '}Solo cuentas de resultados (clases 4 a 7); se dejan fuera {lineas.cuentas_de_balance ?? 0} cuentas de balance que Avancys también reparte.
      </span>
    </div>
    {lineas.por_mes?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Mes</th><th>Ingresos</th><th>Personal</th><th>Otros costos</th><th>Margen</th></tr></thead>
      <tbody>{lineas.por_mes.map(fila => <tr key={fila.mes}>
        <td>{fila.mes}</td><td>{millones(fila.ingresos)}</td><td>{millones(fila.personal)}</td><td>{millones(fila.otros_costos)}</td>
        <td>{millones(fila.margen)} · {pct(fila.margen, fila.ingresos)}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {lineas.por_cuenta?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Cuenta (PUC)</th><th>Monto</th><th>Líneas</th></tr></thead>
      <tbody>{lineas.por_cuenta.map(fila => <tr key={fila.codigo}>
        <td><strong>{fila.codigo}</strong> {fila.nombre} · {fila.clase === 'ingreso' ? 'ingreso' : fila.personal ? 'personal' : 'otro costo'}</td>
        <td>{millones(fila.monto)}</td><td>{fila.filas.toLocaleString('es-CO')}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {(lineas.cuentas ?? 0) > (lineas.por_cuenta?.length ?? 0)
      ? <p className="siio-pulse-footnote">Se muestran las {lineas.por_cuenta?.length} cuentas de resultados de mayor monto de {lineas.cuentas}.</p> : null}
  </div>;
}

const mesAnterior = () => {
  const hoy = new Date();
  const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
};

// Estado de resultados de un mes por cliente. Es una medición para comprobar que cuadra con lo
// facturado antes de llevarlo a la Torre, no la vista final.
function PygPorCliente() {
  const [mes, setMes] = useState(mesAnterior);
  const [estado, setEstado] = useState<'quieto' | 'midiendo' | 'listo' | 'error'>('quieto');
  const [pyg, setPyg] = useState<Pyg | null>(null);
  const [error, setError] = useState('');

  async function medir() {
    setEstado('midiendo');
    setError('');
    try {
      setPyg(await api<Pyg>(`/api/siio/avancys/pyg-por-cliente?mes=${encodeURIComponent(mes)}`));
      setEstado('listo');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
      setEstado('error');
    }
  }

  const t = pyg?.totales;
  return <div className="siio-pulse-block">
    <h4>Resultado por cliente en un mes</h4>
    <p className="siio-pulse-footnote">Ingresos, nómina y otros costos de las líneas analíticas; el cliente es el de la cuenta analítica.</p>
    <input type="month" value={mes} onChange={evento => setMes(evento.target.value)} aria-label="Mes" />
    {' '}<button type="button" onClick={() => void medir()} disabled={estado === 'midiendo' || !mes}>
      {estado === 'midiendo' ? 'Preguntando a Avancys…' : 'Ver por cliente'}
    </button>
    {estado === 'error' ? <p className="siio-alert-text">No se pudo calcular: {error}</p> : null}
    {pyg && pyg.legible === false ? <p className="siio-alert-text">No se pudo calcular: {pyg.motivo}</p> : null}
    {pyg && pyg.autenticado === false ? <p className="siio-alert-text">Avancys no aceptó la conexión: {pyg.motivo}</p> : null}
    {pyg?.legible && t ? <>
      <p className="siio-pulse-source">
        {pyg.mes}: ingresos {millones(t.ingresos)} · personal {millones(t.personal)} · otros costos {millones(t.otros_costos)} · margen {millones(t.margen)} ({pct(t.margen, t.ingresos)}). {pyg.clientes_con_movimiento?.toLocaleString('es-CO')} clientes con movimiento.
      </p>
      <div className="siio-table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Ingresos</th><th>Personal</th><th>Otros costos</th><th>Margen</th></tr></thead>
        <tbody>{[...(pyg.clientes || []), ...(pyg.sin_cliente ? [pyg.sin_cliente] : [])].map(fila => <tr key={fila.cliente}>
          <td><strong>{fila.cliente}</strong> <span className="siio-secondary">· {fila.cuentas_analiticas} cuentas</span></td>
          <td>{millones(fila.ingresos)} · {pct(fila.ingresos, t.ingresos)}</td>
          <td>{millones(fila.personal)}</td>
          <td>{millones(fila.otros_costos)}</td>
          <td>{millones(fila.margen)} · {pct(fila.margen, fila.ingresos)}</td>
        </tr>)}</tbody>
      </table></div>
      {pyg.cuentas_de_costo?.length ? <>
        <h4>Dónde cae el costo</h4>
        <p className="siio-pulse-footnote">
          Las {pyg.cuentas_de_costo.length} cuentas analíticas con más nómina y costos, de {pyg.cuentas_con_costo?.toLocaleString('es-CO')} que tienen costo este mes.
        </p>
        <div className="siio-table-wrap"><table>
          <thead><tr><th>Cuenta analítica</th><th>Grupo</th><th>Cliente</th><th>Personal</th><th>Otros costos</th><th>Ingresos</th></tr></thead>
          <tbody>{pyg.cuentas_de_costo.map((fila, i) => <tr key={`${fila.codigo}-${i}`}>
            <td><strong>{fila.codigo ?? '—'}</strong> {fila.nombre}</td>
            <td>{fila.grupo ?? '—'}</td>
            <td>{fila.cliente ?? '—'}</td>
            <td>{millones(fila.personal)}</td><td>{millones(fila.otros_costos)}</td><td>{millones(fila.ingresos)}</td>
          </tr>)}</tbody>
        </table></div>
      </> : null}
    </> : null}
  </div>;
}

const hora = (valor?: string) => (valor
  ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(valor))
  : '');

function Lista({ titulo, filas }: { titulo: string; filas: Prueba[] }) {
  return <div className="siio-pulse-block">
    <h4>{titulo}</h4>
    <ul className="siio-avancys-lista">{filas.map(fila => <li key={fila.modelo}>
      <Badge tone={fila.permitido ? 'green' : 'amber'}>{fila.permitido ? 'Se puede leer' : 'Denegado'}</Badge>
      <span><strong>{fila.para}</strong> <code>{fila.modelo}</code>{fila.permitido && typeof fila.filas === 'number' ? ` · ${fila.filas.toLocaleString('es-CO')} registros` : ''}</span>
    </li>)}</ul>
  </div>;
}

export function SiioAvancysAcceso() {
  const [estado, setEstado] = useState<'quieto' | 'midiendo' | 'listo' | 'error'>('quieto');
  const [acceso, setAcceso] = useState<Acceso | null>(null);
  const [error, setError] = useState('');

  async function medir() {
    setEstado('midiendo');
    setError('');
    try {
      setAcceso(await api<Acceso>('/api/siio/avancys/acceso'));
      setEstado('listo');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
      setEstado('error');
    }
  }

  const clave = acceso?.campo_clave;
  return <div className="siio-pulse-block siio-avancys-acceso">
    <h4>Qué podemos leer de Avancys</h4>
    <p className="siio-pulse-footnote">
      Pregunta a Avancys, en este momento, qué deja leer al usuario de integración. Solo lectura: no cambia nada allá.
    </p>
    <button type="button" onClick={() => void medir()} disabled={estado === 'midiendo'}>
      {estado === 'midiendo' ? 'Preguntando a Avancys…' : acceso ? 'Volver a medir' : 'Medir ahora'}
    </button>

    {estado === 'error' ? <p className="siio-alert-text">No se pudo medir: {error}</p> : null}

    {acceso && !acceso.configurado ? <p className="siio-secondary">{acceso.motivo}</p> : null}
    {acceso && acceso.configurado && acceso.autenticado === false
      ? <p className="siio-alert-text">Avancys no aceptó la conexión: {acceso.motivo}</p> : null}

    {acceso?.autenticado ? <>
      <p className="siio-pulse-source">Medido el {hora(acceso.medido_en)} contra {acceso.origen}.</p>
      {clave && !clave.permitido && acceso.lineas_analiticas?.trae_nomina ? <div className="siio-avancys-clave siio-avancys-clave-ok">
        <strong>Rentabilidad por cliente: se puede calcular desde las líneas analíticas</strong>
        <span>
          La nómina ya llega a la cuenta analítica de cada contrato. El campo {clave.modelo}.{clave.campo} sigue oculto,
          pero no hace falta: Avancys no lo abre porque el grupo {clave.grupo} también escribe.
        </span>
      </div> : clave ? <div className={`siio-avancys-clave${clave.permitido ? ' siio-avancys-clave-ok' : ''}`}>
        <strong>{clave.permitido ? 'Rentabilidad por cliente: ya se puede calcular' : 'Rentabilidad por cliente: sigue bloqueada'}</strong>
        <span>
          {clave.permitido
            ? `El campo que reparte el costo de cada empleado está disponible y diligenciado en ${(clave.diligenciados ?? 0).toLocaleString('es-CO')} de ${(clave.total ?? 0).toLocaleString('es-CO')} contratos.`
            : `Falta leer ${clave.modelo}.${clave.campo} (${clave.para}). Lo habilita el grupo ${clave.grupo}.`}
        </span>
      </div> : null}
      {acceso.informe_rentabilidad ? <InformeRentabilidad informe={acceso.informe_rentabilidad} /> : null}
      {acceso.lineas_analiticas ? <LineasAnaliticas lineas={acceso.lineas_analiticas} /> : null}
      {acceso.lineas_analiticas?.trae_nomina ? <PygPorCliente /> : null}
      {acceso.turnos?.length ? <Lista titulo="Programación de turnos en Avancys (todavía no se usa; cuando tenga registros, ahí está quién cubrió cada puesto)" filas={acceso.turnos} /> : null}
      {acceso.pedidos?.length ? <Lista titulo="Lo que se pidió el 29 de octubre" filas={acceso.pedidos} /> : null}
      {acceso.en_uso?.length ? <Lista titulo="Lo que la Torre ya usa" filas={acceso.en_uso} /> : null}
    </> : null}
  </div>;
}
