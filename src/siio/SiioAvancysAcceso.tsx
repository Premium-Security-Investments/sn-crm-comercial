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
type Lineas = {
  legible: boolean;
  motivo?: string;
  total?: number;
  desde?: string;
  filas?: number;
  con_cliente?: number;
  primera_fecha?: string | null;
  por_mes?: { mes: string; ingresos: number; costos: number; filas: number }[];
  por_cuenta?: { codigo: string; nombre: string; monto: number; filas: number; personal: boolean }[];
  cuentas?: number;
  costo_de_personal?: number;
  trae_nomina?: boolean;
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

// De dónde saca Odoo el informe: si la nómina ya llega a la cuenta analítica de cada contrato,
// el costo por cliente está aquí aunque el campo de reparto siga oculto.
function LineasAnaliticas({ lineas }: { lineas: Lineas }) {
  if (!lineas.legible) return <div className="siio-pulse-block">
    <h4>Líneas analíticas</h4>
    <p className="siio-secondary">No se pueden leer las líneas analíticas: {lineas.motivo}</p>
  </div>;
  const filas = lineas.filas ?? 0;
  return <div className="siio-pulse-block">
    <h4>Líneas analíticas (de donde sale el informe)</h4>
    <div className={`siio-avancys-clave${lineas.trae_nomina ? ' siio-avancys-clave-ok' : ''}`}>
      <strong>{lineas.trae_nomina ? 'La nómina sí llega a las cuentas analíticas' : 'La nómina no llega a las cuentas analíticas'}</strong>
      <span>
        Gastos y costos de personal (PUC 5105, 7205…) en el último año: {cifra(lineas.costo_de_personal ?? 0, 'monetary')}.
        {' '}{filas.toLocaleString('es-CO')} líneas desde el {lineas.desde} ({(lineas.total ?? 0).toLocaleString('es-CO')} en total, la primera del {lineas.primera_fecha ?? '—'});
        {' '}con cliente: {(lineas.con_cliente ?? 0).toLocaleString('es-CO')}.
      </span>
    </div>
    {lineas.por_mes?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Mes</th><th>Ingresos</th><th>Costos</th><th>Líneas</th></tr></thead>
      <tbody>{lineas.por_mes.map(fila => <tr key={fila.mes}>
        <td>{fila.mes}</td><td>{cifra(fila.ingresos, 'monetary')}</td><td>{cifra(fila.costos, 'monetary')}</td><td>{fila.filas.toLocaleString('es-CO')}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {lineas.por_cuenta?.length ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Cuenta (PUC)</th><th>Monto</th><th>Líneas</th></tr></thead>
      <tbody>{lineas.por_cuenta.map(fila => <tr key={fila.codigo}>
        <td><strong>{fila.codigo}</strong> {fila.nombre}{fila.personal ? ' · personal' : ''}</td>
        <td>{cifra(fila.monto, 'monetary')}</td><td>{fila.filas.toLocaleString('es-CO')}</td>
      </tr>)}</tbody>
    </table></div> : null}
    {(lineas.cuentas ?? 0) > (lineas.por_cuenta?.length ?? 0)
      ? <p className="siio-pulse-footnote">Se muestran las {lineas.por_cuenta?.length} cuentas de mayor monto de {lineas.cuentas}.</p> : null}
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
      {clave ? <div className={`siio-avancys-clave${clave.permitido ? ' siio-avancys-clave-ok' : ''}`}>
        <strong>{clave.permitido ? 'Rentabilidad por cliente: ya se puede calcular' : 'Rentabilidad por cliente: sigue bloqueada'}</strong>
        <span>
          {clave.permitido
            ? `El campo que reparte el costo de cada empleado está disponible y diligenciado en ${(clave.diligenciados ?? 0).toLocaleString('es-CO')} de ${(clave.total ?? 0).toLocaleString('es-CO')} contratos.`
            : `Falta leer ${clave.modelo}.${clave.campo} (${clave.para}). Lo habilita el grupo ${clave.grupo}.`}
        </span>
      </div> : null}
      {acceso.informe_rentabilidad ? <InformeRentabilidad informe={acceso.informe_rentabilidad} /> : null}
      {acceso.lineas_analiticas ? <LineasAnaliticas lineas={acceso.lineas_analiticas} /> : null}
      {acceso.pedidos?.length ? <Lista titulo="Lo que se pidió el 29 de octubre" filas={acceso.pedidos} /> : null}
      {acceso.en_uso?.length ? <Lista titulo="Lo que la Torre ya usa" filas={acceso.en_uso} /> : null}
    </> : null}
  </div>;
}
