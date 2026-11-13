import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import { Badge } from './SiioUi';

// La pestaña «Parámetros» de la Torre (Juan, 2026-11-13): lo que Avancys no tiene y debe ingresar una persona, cada
// cosa con su encargado y su historial. El catálogo de los 11 puntos viene del servidor
// (verticales/gerencial/siio-parametros.js); aquí sólo se muestra y se edita.

type Campo = { clave: string; etiqueta: string; tipo: 'pct' | 'pesos' | 'numero' | 'texto' | 'texto_largo' | 'fecha' | 'opcion'; opciones?: [string, string][]; requerido?: boolean };
type Parametro = {
  numero: number; clave: string; grupo: 'persona' | 'temporal' | 'mantenimiento'; nombre: string; encargado: string; frecuencia: string;
  periodo: 'anio' | 'mes' | 'ninguno'; para: string; forma: 'campos' | 'filas' | 'tabla' | 'externo'; campos?: Campo[]; filas?: [string, string][]; donde?: string;
};
type Version = { id: string; clave: string; periodo: string; valor?: unknown; nota: string | null; estado: 'confirmado' | 'sin_confirmar'; creado_por_nombre: string | null; creado_at: string; reemplazado_at?: string | null };
type Respuesta = { catalogo: Parametro[]; vigentes: Version[]; cambios: Version[]; disponible: boolean; puede_editar: boolean; clientes_mes_vencido: number | null };
type Fila = Record<string, string | number | null>;

const GRUPOS: [Parametro['grupo'], string][] = [['persona', 'Lo ingresa una persona'], ['temporal', 'Temporales, hasta que Avancys los tenga'], ['mantenimiento', 'Mantenimiento']];
const fecha = (valor: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(valor));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombrePeriodo = (periodo: string) => (/^\d{4}-\d{2}$/.test(periodo) ? `${MESES[Number(periodo.slice(5)) - 1]} ${periodo.slice(0, 4)}` : periodo);

function periodoInicial(parametro: Parametro) {
  const hoy = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'America/Bogota' }).format(new Date()).slice(0, 7);
  return parametro.periodo === 'anio' ? hoy.slice(0, 4) : parametro.periodo === 'mes' ? hoy : '';
}

function vacio(parametro: Parametro): unknown {
  if (parametro.forma === 'filas') return [];
  if (parametro.forma === 'tabla') return Object.fromEntries((parametro.filas || []).map(([clave]) => [clave, {}]));
  return {};
}

function Entrada({ campo, valor, onCambio, soloLectura }: { campo: Campo; valor: unknown; onCambio: (valor: string) => void; soloLectura: boolean }) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  if (campo.tipo === 'opcion') return <select aria-label={campo.etiqueta} value={texto} disabled={soloLectura} onChange={event => onCambio(event.target.value)}>
    <option value="">—</option>
    {(campo.opciones || []).map(([clave, etiqueta]) => <option key={clave} value={clave}>{etiqueta}</option>)}
  </select>;
  if (campo.tipo === 'texto_largo') return <textarea aria-label={campo.etiqueta} rows={3} value={texto} readOnly={soloLectura} onChange={event => onCambio(event.target.value)} />;
  const tipo = campo.tipo === 'fecha' ? 'date' : campo.tipo === 'texto' ? 'text' : 'number';
  return <span className="siio-parametro-entrada">
    <input aria-label={campo.etiqueta} type={tipo} step="any" value={texto} readOnly={soloLectura} onChange={event => onCambio(event.target.value)} />
    {campo.tipo === 'pct' ? <small>%</small> : null}
  </span>;
}

function Editor({ parametro, vigentes, puedeEditar, onGuardado }: { parametro: Parametro; vigentes: Version[]; puedeEditar: boolean; onGuardado: () => void }) {
  const [periodo, setPeriodo] = useState(() => periodoInicial(parametro));
  const actual = vigentes.find(item => item.clave === parametro.clave && item.periodo === periodo) || null;
  const [borrador, setBorrador] = useState<unknown>(() => actual?.valor ?? vacio(parametro));
  const [nota, setNota] = useState('');
  const [estado, setEstado] = useState<'' | 'guardando' | 'guardado'>('');
  const [error, setError] = useState('');
  useEffect(() => { setBorrador(actual?.valor ?? vacio(parametro)); setError(''); setEstado(''); }, [periodo, actual?.id]);
  const soloLectura = !puedeEditar;
  const campos = parametro.campos || [];

  async function guardar() {
    setEstado('guardando');
    setError('');
    try {
      await api(`/api/siio/parametros/${parametro.clave}`, { method: 'PUT', body: JSON.stringify({ periodo, valor: borrador, nota }) });
      setEstado('guardado');
      setNota('');
      onGuardado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
      setEstado('');
    }
  }

  const objeto = (borrador && typeof borrador === 'object' && !Array.isArray(borrador) ? borrador : {}) as Record<string, unknown>;
  const filas = (Array.isArray(borrador) ? borrador : []) as Fila[];
  return <div className="siio-parametro-editor">
    {parametro.periodo !== 'ninguno' ? <label className="siio-parametro-periodo">{parametro.periodo === 'anio' ? 'Año' : 'Mes'}
      <input type={parametro.periodo === 'anio' ? 'number' : 'month'} value={periodo} onChange={event => setPeriodo(event.target.value)} />
    </label> : null}
    {actual ? <p className="siio-pulse-footnote">
      Vigente desde el {fecha(actual.creado_at)}{actual.creado_por_nombre ? `, por ${actual.creado_por_nombre}` : ''}.
      {actual.estado === 'sin_confirmar' ? ' Sembrado desde el Excel: falta que el encargado lo confirme.' : ''}
      {actual.nota ? ` Nota: ${actual.nota}` : ''}
    </p> : <p className="siio-pulse-footnote">Sin dato{parametro.periodo !== 'ninguno' ? ` para ${nombrePeriodo(periodo)}` : ''}.</p>}

    {parametro.forma === 'campos' ? <div className="siio-parametro-campos">
      {campos.map(campo => <label key={campo.clave}>{campo.etiqueta}
        <Entrada campo={campo} valor={objeto[campo.clave]} soloLectura={soloLectura} onCambio={valor => setBorrador({ ...objeto, [campo.clave]: valor })} />
      </label>)}
    </div> : null}

    {parametro.forma === 'tabla' ? <div className="siio-table-wrap"><table>
      <thead><tr><th>Rubro</th>{campos.map(campo => <th key={campo.clave}>{campo.etiqueta}</th>)}</tr></thead>
      <tbody>{(parametro.filas || []).map(([clave, etiqueta]) => {
        const fila = (objeto[clave] || {}) as Fila;
        return <tr key={clave}><td>{etiqueta}</td>{campos.map(campo => <td key={campo.clave}>
          <Entrada campo={campo} valor={fila[campo.clave]} soloLectura={soloLectura} onCambio={valor => setBorrador({ ...objeto, [clave]: { ...fila, [campo.clave]: valor } })} />
        </td>)}</tr>;
      })}</tbody>
      <tfoot><tr><th>Total</th>{campos.map(campo => <th key={campo.clave}>
        {(Math.round((parametro.filas || []).reduce((suma, [clave]) => suma + (Number(((objeto[clave] || {}) as Fila)[campo.clave]) || 0), 0) * 100) / 100).toLocaleString('es-CO')} %
      </th>)}</tr></tfoot>
    </table></div> : null}

    {parametro.forma === 'filas' ? <>
      <div className="siio-table-wrap"><table>
        <thead><tr>{campos.map(campo => <th key={campo.clave}>{campo.etiqueta}</th>)}{soloLectura ? null : <th aria-label="Quitar" />}</tr></thead>
        <tbody>{filas.map((fila, indice) => <tr key={indice}>
          {campos.map(campo => <td key={campo.clave}>
            <Entrada campo={campo} valor={fila[campo.clave]} soloLectura={soloLectura} onCambio={valor => setBorrador(filas.map((item, i) => (i === indice ? { ...item, [campo.clave]: valor } : item)))} />
          </td>)}
          {soloLectura ? null : <td><button type="button" className="siio-link-button" onClick={() => setBorrador(filas.filter((_, i) => i !== indice))}>Quitar</button></td>}
        </tr>)}</tbody>
      </table></div>
      {!filas.length ? <p className="siio-pulse-footnote">Sin filas.</p> : null}
      {soloLectura ? null : <button type="button" className="secondary" onClick={() => setBorrador([...filas, {}])}>Agregar fila</button>}
    </> : null}

    {soloLectura ? <p className="siio-pulse-footnote">Tu perfil puede ver los parámetros; los cambian Gerencia y los administradores.</p> : <div className="siio-parametro-guardar">
      <label>Nota del cambio (opcional)<input type="text" maxLength={500} value={nota} onChange={event => setNota(event.target.value)} /></label>
      <button type="button" disabled={estado === 'guardando'} onClick={() => void guardar()}>{estado === 'guardando' ? 'Guardando…' : 'Guardar'}</button>
      {estado === 'guardado' ? <span role="status">Guardado. La versión anterior queda en el historial.</span> : null}
      {error ? <span className="siio-followup-error" role="alert">{error}</span> : null}
    </div>}
  </div>;
}

function estadoDe(parametro: Parametro, datos: Respuesta) {
  if (parametro.clave === 'clientes_mes_vencido') {
    const total = datos.clientes_mes_vencido;
    return total ? <Badge tone="green">{total === 1 ? '1 cliente marcado' : `${total} clientes marcados`}</Badge> : <Badge tone="amber">Ninguno marcado</Badge>;
  }
  if (parametro.forma === 'externo') return <Badge tone="blue">En otra pantalla</Badge>;
  const versiones = datos.vigentes.filter(item => item.clave === parametro.clave);
  if (!versiones.length) return <Badge tone="amber">Sin dato</Badge>;
  const ultima = versiones[0];
  const cuando = ultima.periodo ? nombrePeriodo(ultima.periodo) : `desde el ${fecha(ultima.creado_at)}`;
  return ultima.estado === 'sin_confirmar' ? <Badge tone="amber">Sin confirmar · {cuando}</Badge> : <Badge tone="green">Vigente · {cuando}</Badge>;
}

export function SiioPestanaParametros() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  async function cargar() {
    try {
      setDatos(await api<Respuesta>('/api/siio/parametros'));
      setError('');
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : String(fallo));
    }
  }
  useEffect(() => { void cargar(); }, []);

  if (error) return <p className="siio-followup-error" role="alert">No fue posible leer los parámetros: {error}</p>;
  if (!datos) return <p className="siio-pulse-footnote">Cargando los parámetros…</p>;
  const nombres = new Map(datos.catalogo.map(parametro => [parametro.clave, parametro.nombre]));

  return <div className="siio-parametros">
    <p className="siio-pulse-footnote">La Torre sale de Avancys. Aquí va sólo lo que Avancys no tiene, cada cosa con su encargado. Cada cambio queda en el historial.</p>
    {!datos.disponible ? <div className="notice" role="status">La tabla de parámetros todavía no existe en la base: se pueden ver los puntos, pero no guardar.</div> : null}
    {GRUPOS.map(([grupo, titulo]) => <section key={grupo} aria-label={titulo}>
      <h3>{titulo}</h3>
      <ul className="siio-parametro-lista">
        {datos.catalogo.filter(parametro => parametro.grupo === grupo).map(parametro => <li key={parametro.clave}>
          <div className="siio-parametro-fila">
            <div>
              <strong>{parametro.numero}. {parametro.nombre}</strong>
              <small>{parametro.encargado} · {parametro.frecuencia}</small>
              <span>{parametro.para}</span>
            </div>
            {estadoDe(parametro, datos)}
            {parametro.forma === 'externo' ? null : <button type="button" className="siio-link-button" aria-expanded={abierto === parametro.clave}
              onClick={() => setAbierto(abierto === parametro.clave ? null : parametro.clave)}>{abierto === parametro.clave ? 'Cerrar' : datos.puede_editar ? 'Ver y editar' : 'Ver'}</button>}
          </div>
          {parametro.forma === 'externo' ? <p className="siio-pulse-footnote">{parametro.donde}</p> : null}
          {abierto === parametro.clave ? <Editor parametro={parametro} vigentes={datos.vigentes} puedeEditar={datos.puede_editar && datos.disponible} onGuardado={() => void cargar()} /> : null}
        </li>)}
      </ul>
    </section>)}
    {datos.cambios.length ? <details className="siio-parametro-cambios">
      <summary>Últimos cambios</summary>
      <ul>{datos.cambios.map(cambio => <li key={cambio.id}>
        {fecha(cambio.creado_at)} · {nombres.get(cambio.clave) || cambio.clave}{cambio.periodo ? ` (${nombrePeriodo(cambio.periodo)})` : ''}
        {cambio.creado_por_nombre ? ` · ${cambio.creado_por_nombre}` : ''}{cambio.reemplazado_at ? ' · reemplazado' : ' · vigente'}{cambio.nota ? ` · ${cambio.nota}` : ''}
      </li>)}</ul>
    </details> : null}
  </div>;
}
