import { Fragment, useEffect, useState } from 'react';
import { api } from '../apiClient';
import { deudaSinRegistrar } from './fuentesAlDia';
import type { Creditos } from './SiioTorreAvancys';

// La pestaña «Parámetros» de la Torre (Juan, 2026-11-13): lo que Avancys no tiene y debe ingresar una persona, cada
// cosa con su encargado y su historial. El catálogo de los 11 puntos viene del servidor
// (verticales/gerencial/siio-parametros.js); aquí sólo se muestra y se edita.

type Campo = { clave: string; etiqueta: string; tipo: 'pct' | 'pesos' | 'numero' | 'texto' | 'texto_largo' | 'fecha' | 'opcion'; opciones?: [string, string][]; requerido?: boolean };
type Parametro = {
  numero: number; clave: string; grupo: 'persona' | 'temporal' | 'mantenimiento'; nombre: string; encargado: string; frecuencia: string;
  periodo: 'anio' | 'mes' | 'ninguno'; para: string; forma: 'campos' | 'filas' | 'secciones' | 'externo'; campos?: Campo[]; secciones?: Seccion[]; donde?: string;
};
type Seccion = { clave: string; etiqueta: string; filas: [string, string][] };
type Version = { id: string; clave: string; periodo: string; valor?: unknown; nota: string | null; estado: 'confirmado' | 'sin_confirmar'; creado_por_nombre: string | null; creado_at: string; reemplazado_at?: string | null };
type Respuesta = { catalogo: Parametro[]; vigentes: Version[]; cambios: Version[]; disponible: boolean; puede_editar: boolean; clientes_mes_vencido: number | null; historico: { cargado: string | null; falta: string | null } | null };
type Fila = Record<string, string | number | null>;

const millones = (valor: number) => `$${Math.round(valor / 1e6).toLocaleString('es-CO')} M`;
const pct = (valor: number | null) => (valor === null ? '—' : `${valor.toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`);
const fechaCorta = (valor: string | null) => (valor ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${valor}T12:00:00Z`)) : '—');
const fecha = (valor: string) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(valor));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombrePeriodo = (periodo: string) => (/^\d{4}-\d{2}$/.test(periodo) ? `${MESES[Number(periodo.slice(5)) - 1]} ${periodo.slice(0, 4)}` : periodo);

function periodoInicial(parametro: Parametro) {
  const hoy = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'America/Bogota' }).format(new Date()).slice(0, 7);
  return parametro.periodo === 'anio' ? hoy.slice(0, 4) : parametro.periodo === 'mes' ? hoy : '';
}

function vacio(parametro: Parametro): unknown {
  if (parametro.forma === 'filas') return [];
  if (parametro.forma === 'secciones') return Object.fromEntries((parametro.secciones || []).map(seccion => [seccion.clave, {}]));
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

function Editor({ parametro, vigentes, puedeEditar, onGuardado, creditos }: { parametro: Parametro; vigentes: Version[]; puedeEditar: boolean; onGuardado: () => void; creditos: Creditos | null }) {
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

    {parametro.forma === 'secciones' ? <div className="siio-parametro-secciones">{(parametro.secciones || []).map(seccion => {
      const datos = (objeto[seccion.clave] || {}) as Fila;
      const total = Math.round(seccion.filas.reduce((suma, [clave]) => suma + (Number(datos[clave]) || 0), 0) * 100) / 100;
      const pctCampo: Campo = { clave: 'pct', etiqueta: seccion.etiqueta, tipo: 'pct' };
      return <div key={seccion.clave} className="siio-table-wrap"><table>
        <thead><tr><th>{seccion.etiqueta}</th><th>% del ingreso</th></tr></thead>
        <tbody>{seccion.filas.map(([clave, etiqueta]) => <tr key={clave}><td>{etiqueta}</td><td>
          <Entrada campo={{ ...pctCampo, etiqueta: `${seccion.etiqueta}: ${etiqueta}` }} valor={datos[clave]} soloLectura={soloLectura} onCambio={valor => setBorrador({ ...objeto, [seccion.clave]: { ...datos, [clave]: valor } })} />
        </td></tr>)}</tbody>
        <tfoot>
          <tr><th>Total costos y gastos</th><th>{total.toLocaleString('es-CO')} %</th></tr>
          <tr><th>Rentabilidad presupuestada</th><th>{(Math.round((100 - total) * 100) / 100).toLocaleString('es-CO')} %</th></tr>
        </tfoot>
      </table></div>;
    })}</div> : null}

    {parametro.clave === 'creditos' ? <CreditosDeAvancys creditos={creditos} manuales={filas} /> : null}
    {parametro.forma === 'filas' ? <>
      {parametro.clave === 'creditos' ? <h4 className="siio-parametro-subtitulo">Lo que no está en Avancys (lo deja aquí Tesorería)</h4> : null}
      <div className="siio-table-wrap"><table>
        <thead><tr>{campos.map(campo => <th key={campo.clave}>{campo.etiqueta}</th>)}{soloLectura ? null : <th aria-label="Quitar" />}</tr></thead>
        <tbody>{filas.map((fila, indice) => <tr key={indice}>
          {campos.map(campo => <td key={campo.clave}>
            <Entrada campo={campo} valor={fila[campo.clave]} soloLectura={soloLectura} onCambio={valor => setBorrador(filas.map((item, i) => (i === indice ? { ...item, [campo.clave]: valor } : item)))} />
          </td>)}
          {soloLectura ? null : <td><button type="button" className="siio-enlace" onClick={() => setBorrador(filas.filter((_, i) => i !== indice))}>Quitar</button></td>}
        </tr>)}</tbody>
      </table></div>
      {!filas.length ? <p className="siio-pulse-footnote">Sin filas.</p> : null}
      {soloLectura ? null : <button type="button" className="siio-enlace" onClick={() => setBorrador([...filas, {}])}>+ Agregar fila</button>}
    </> : null}

    {soloLectura ? <p className="siio-pulse-footnote">Tu perfil puede ver los parámetros; los cambian Gerencia y los administradores.</p> : <div className="siio-parametro-guardar">
      <label>Nota del cambio (opcional)<input type="text" maxLength={500} value={nota} onChange={event => setNota(event.target.value)} /></label>
      <button type="button" className="siio-boton-primario" disabled={estado === 'guardando'} onClick={() => void guardar()}>{estado === 'guardando' ? 'Guardando…' : 'Guardar'}</button>
      {estado === 'guardado' ? <span role="status">Guardado. La versión anterior queda en el historial.</span> : null}
      {error ? <span className="siio-followup-error" role="alert">{error}</span> : null}
    </div>}
  </div>;
}

// Créditos (Juan, 2026-11-14): lo registrado en Avancys se lee de allá; lo que la contabilidad tiene como deuda y no
// como obligación se pide a Tesorería, que lo registra en Avancys o lo deja abajo.
function CreditosDeAvancys({ creditos, manuales }: { creditos: Creditos | null; manuales: Fila[] }) {
  if (!creditos) return <p className="siio-nota">Avancys todavía no respondió con los créditos.</p>;
  if (creditos.error) return <p className="siio-alert-text">No se pudieron leer los créditos de Avancys: {creditos.error}</p>;
  const registradas = creditos.registradas || [];
  const pendientes = deudaSinRegistrar(creditos.sin_registrar, manuales);
  return <div className="siio-parametro-creditos">
    <h4 className="siio-parametro-subtitulo">Registrados en Avancys <span className="siio-chip cerrado">automático</span></h4>
    {registradas.length ? <div className="siio-tabla-wrap"><table className="siio-tabla apilable">
      <thead><tr><th>Banco · obligación</th><th className="num total">Saldo</th><th className="num">Tasa</th><th className="num">Próxima cuota</th><th className="num">Vence</th></tr></thead>
      <tbody>{registradas.map(fila => <tr key={fila.numero || `${fila.banco}-${fila.desembolso}`}>
        <td><span className="nombre">{fila.banco || 'Sin banco'}</span><small className="siio-nota">obligación {fila.numero || '—'} · desembolso {fechaCorta(fila.desembolso)} · {millones(fila.monto)}</small></td>
        <td className="num total"><strong>{millones(fila.saldo)}</strong><small>{fila.cuotas_por_pagar} cuotas por pagar</small></td>
        <td className="num" data-etiqueta="Tasa"><strong>{pct(fila.tasa_periodo)} {fila.meses_por_periodo === 1 ? 'mes' : `cada ${fila.meses_por_periodo} meses`}</strong><small>≈ {pct(fila.tasa_ea)} E.A.</small></td>
        <td className="num" data-etiqueta="Próxima cuota">{fila.proxima_cuota ? <><strong>{millones(fila.proxima_cuota.valor)}</strong><small>{fechaCorta(fila.proxima_cuota.fecha)}</small></> : <strong>—</strong>}</td>
        <td className="num" data-etiqueta="Vence"><strong>{fechaCorta(fila.fecha_final)}</strong></td>
      </tr>)}</tbody>
    </table></div> : <p className="siio-nota">Ninguna obligación financiera registrada en Avancys.</p>}
    {pendientes.length ? <div className="siio-parametro-pendiente" role="status">
      <strong>En la contabilidad hay deuda que no está registrada como obligación:</strong>{' '}
      {pendientes.map(fila => `${fila.tercero} ${millones(fila.diferencia)}`).join(', ')}.{' '}
      <strong>Tesorería</strong>: regístrela en Avancys (así salen tasa, cuotas y vencimiento solos) o déjela abajo.
    </div> : null}
  </div>;
}

type Chip = { tono: 'cerrado' | 'confirmar' | 'marca' | 'nota'; texto: string };
function estadoDe(parametro: Parametro, datos: Respuesta, creditos: Creditos | null): Chip[] {
  if (parametro.clave === 'clientes_mes_vencido') {
    const total = datos.clientes_mes_vencido;
    return [total ? { tono: 'cerrado', texto: total === 1 ? '1 cliente marcado' : `${total} clientes marcados` } : { tono: 'marca', texto: 'Ninguno marcado' }];
  }
  if (parametro.clave === 'historico' && datos.historico) {
    return [datos.historico.falta ? { tono: 'confirmar', texto: `Falta ${datos.historico.falta}` } : { tono: 'cerrado', texto: 'Completo' }];
  }
  if (parametro.forma === 'externo') return [{ tono: 'nota', texto: 'En otra pantalla' }];
  const versiones = datos.vigentes.filter(item => item.clave === parametro.clave);
  const chips: Chip[] = [];
  if (parametro.clave === 'creditos' && creditos?.registradas?.length) {
    chips.push({ tono: 'cerrado', texto: `${creditos.registradas.length} en Avancys` });
    const manuales = versiones[0]?.valor;
    const pendientes = deudaSinRegistrar(creditos.sin_registrar, Array.isArray(manuales) ? manuales : []);
    if (pendientes.length) chips.push({ tono: 'marca', texto: `${millones(pendientes.reduce((suma, fila) => suma + fila.diferencia, 0))} sin registrar` });
    return chips;
  }
  if (!versiones.length) return [{ tono: 'marca', texto: 'Sin dato' }];
  const ultima = versiones[0];
  const cuando = ultima.periodo ? nombrePeriodo(ultima.periodo) : `desde el ${fecha(ultima.creado_at)}`;
  return [ultima.estado === 'sin_confirmar' ? { tono: 'confirmar', texto: `Sin confirmar · ${cuando}` } : { tono: 'cerrado', texto: `Vigente · ${cuando}` }];
}

// Parámetros (contrato de la maqueta, Fase 3): una tabla del kit con encargado y estado; el editor se abre en su fila.
export function SiioPestanaParametros({ creditos = null }: { creditos?: Creditos | null }) {
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

  if (error) return <p className="siio-alert-text" role="alert">No fue posible leer los parámetros: {error}</p>;
  if (!datos) return <p className="siio-nota">Cargando los parámetros…</p>;
  const nombres = new Map(datos.catalogo.map(parametro => [parametro.clave, parametro.nombre]));
  const catalogo = [...datos.catalogo].sort((a, b) => a.numero - b.numero);

  return <section className="siio-panel" aria-label="Parámetros">
    <h2>Parámetros · lo que Avancys no tiene y una persona mantiene</h2>
    <p className="siio-nota" style={{ margin: '4px 0 8px' }}>La Torre sale de Avancys; aquí va solo lo que Avancys no tiene, cada cosa con su encargado. Cada cambio guarda versión e historial. Ven todos; cambian Gerencia y administración.</p>
    {!datos.disponible ? <p className="siio-alert-text" role="status">La tabla de parámetros todavía no existe en la base: se pueden ver los puntos, pero no guardar.</p> : null}
    <div className="siio-tabla-wrap"><table className="siio-tabla apilable siio-tabla-parametros">
      <thead><tr><th>Parámetro</th><th>Encargado</th><th>Estado</th><th aria-label="Acción" /></tr></thead>
      <tbody>{catalogo.map(parametro => <Fragment key={parametro.clave}>
        <tr>
          <td><span className="nombre">{parametro.numero} · {parametro.nombre}</span><small className="siio-nota">{parametro.para}</small></td>
          <td data-etiqueta="Encargado"><strong>{parametro.encargado}</strong><small className="siio-nota"> · {parametro.frecuencia}</small></td>
          <td data-etiqueta="Estado">{estadoDe(parametro, datos, creditos).map(chip => (chip.tono === 'nota'
            ? <span key={chip.texto} className="siio-nota">{chip.texto}</span>
            : <span key={chip.texto} className={`siio-chip ${chip.tono}`}>{chip.texto}</span>))}</td>
          <td>{parametro.forma === 'externo'
            ? <small className="siio-nota">{parametro.donde}{parametro.clave === 'historico' && datos.historico?.cargado ? ` Ya está cargado: ${datos.historico.cargado}.` : ''}</small>
            : <button type="button" className="siio-enlace" aria-expanded={abierto === parametro.clave}
              onClick={() => setAbierto(abierto === parametro.clave ? null : parametro.clave)}>{abierto === parametro.clave ? 'Cerrar' : datos.puede_editar ? 'Ver y editar' : 'Ver'}</button>}</td>
        </tr>
        {abierto === parametro.clave ? <tr className="siio-parametro-abierto"><td colSpan={4}>
          <Editor parametro={parametro} vigentes={datos.vigentes} puedeEditar={datos.puede_editar && datos.disponible} onGuardado={() => void cargar()} creditos={creditos} />
        </td></tr> : null}
      </Fragment>)}</tbody>
    </table></div>
    {datos.cambios.length ? <details className="siio-plegado">
      <summary>Últimos cambios</summary>
      <ul className="siio-lista">{datos.cambios.map(cambio => <li key={cambio.id}>
        {fecha(cambio.creado_at)} · {nombres.get(cambio.clave) || cambio.clave}{cambio.periodo ? ` (${nombrePeriodo(cambio.periodo)})` : ''}
        {cambio.creado_por_nombre ? ` · ${cambio.creado_por_nombre}` : ''}{cambio.reemplazado_at ? ' · reemplazado' : ' · vigente'}{cambio.nota ? ` · ${cambio.nota}` : ''}
      </li>)}</ul>
    </details> : null}
  </section>;
}
