// Reglas legales con vigencia, reglas de nómina por ciudad o resto del país (con su historial) y
// departamentos donde opera la empresa. Comparar no cambia cálculos; registrar una regla nueva
// solo afecta los periodos que se abran desde su fecha de inicio.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { Modal } from './ui.tsx';
import {
  compararConLey, fechaCorta, NOMBRE_TEMA, parametrosAplicables, proximoCambio, reglaVigente,
  type Comparacion, type ParametrosCiudad, type ReglaLegal, type TemaRegla,
} from '../motor/reglas-legales.ts';

interface Ciudad { id: string; nombre: string; departamento_id: string | null }
interface Departamento { id: string; nombre: string; activo: boolean }
interface FilaParametros extends ParametrosCiudad {
  id: number; ciudad_id: string | null; inicio_diurno: string; smlv: number | string; auxilio_transporte: number | string;
  regla_domingos: Record<string, number> | null; max_horas_semana: number | string; descanso_minimo_horas: number | string;
  nota: string | null; fuente: string | null; aprobado_por: string | null; soporte: string | null; creado_en: string;
}

const RESTO = '__resto__';
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const dec = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 4 });
const pesos = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function valorRegla(r: ReglaLegal) {
  const v = Number(r.valor);
  if (r.unidad === 'horas') return `${dec(v)} h`;
  if (r.unidad === 'hora_del_dia') return `${String(v).padStart(2, '0')}:00`;
  if (r.unidad === 'fraccion') return `${Math.round(v * 100)} %`;
  return `${dec(v)} días`;
}
function valorComparacion(c: Comparacion, v: number | null) {
  if (v === null) return '—';
  if (c.clave.startsWith('jornada')) return `${dec(v)} h`;
  if (c.clave === 'inicio_nocturno') return `${String(Math.floor(v)).padStart(2, '0')}:00`;
  if (c.clave === 'recargo_dof') return `${Math.round(v * 100)} %`;
  return dec(v);
}

const ORDEN: TemaRegla[] = ['jornada_semanal', 'jornada_diaria_ordinaria', 'inicio_nocturno', 'fin_nocturno', 'recargo_descanso_obligatorio',
  'habitualidad_dias_mes', 'vigilancia_acuerdo_max_dia', 'vigilancia_acuerdo_max_semana', 'extras_max_dia', 'extras_max_semana'];

const NOMBRE_FACTOR: Record<string, string> = {
  hed: 'Extra diurna', hen: 'Extra nocturna', rn: 'Recargo nocturno',
  dof_con_compensatorio: 'Domingo o festivo con compensatorio', dof_sin_compensatorio: 'Domingo o festivo sin compensatorio',
  rdf: 'Recargo domingo o festivo diurno', rnf: 'Recargo domingo o festivo nocturno',
  hed_dof: 'Extra diurna en domingo o festivo', hen_dof: 'Extra nocturna en domingo o festivo',
};
const NOMBRE_DOMINGOS: Record<string, string> = { habitualidad_domingos: 'Domingos para ser habitual', primeras_horas_festivo: 'Primeras horas del festivo' };

export function ReglasLegales({ ciudad, acceso }: { ciudad: string; acceso: Acceso }) {
  const esAdmin = acceso.rol === 'admin';
  const [reglas, setReglas] = useState<ReglaLegal[] | null>(null);
  const [ciudades, setCiudades] = useState<Ciudad[]>([]);
  const [deptos, setDeptos] = useState<Departamento[]>([]);
  const [filas, setFilas] = useState<FilaParametros[] | null>(null);
  const [error, setError] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [ambito, setAmbito] = useState<string>(ciudad);
  const [nueva, setNueva] = useState(false);

  const cargarFilas = useCallback(() => {
    db().from('parametros_nomina').select('*').order('vigente_desde').then(({ data }) => setFilas((data as FilaParametros[]) ?? []));
  }, []);
  useEffect(() => {
    db().from('reglas_legales').select('tema, vigente_desde, valor, unidad, fuente, estado, nota').order('vigente_desde')
      .then(({ data, error: e }) => { if (e) setError(e.message); setReglas((data as ReglaLegal[]) ?? []); });
    db().from('ciudades').select('id, nombre, departamento_id').order('nombre').then(({ data }) => setCiudades((data as Ciudad[]) ?? []));
    db().from('departamentos').select('id, nombre, activo').order('nombre').then(({ data }) => setDeptos((data as Departamento[]) ?? []));
    cargarFilas();
  }, [cargarFilas]);

  const idAmbito = ambito === RESTO ? null : ambito;
  const nombreAmbito = ambito === RESTO ? 'Resto del país' : (ciudades.find((c) => c.id === ambito)?.nombre ?? ambito);
  const aplicable = useMemo(() => (filas ? parametrosAplicables(filas, idAmbito, fecha) : null), [filas, idAmbito, fecha]);
  const heredada = aplicable !== null && aplicable.ciudad_id === null && idAmbito !== null;
  const comparacion = useMemo(() => (reglas && aplicable ? compararConLey(reglas, aplicable, fecha) : []), [reglas, aplicable, fecha]);
  const distintas = comparacion.filter((c) => c.coincide === false);
  const proximo = reglas ? proximoCambio(reglas, 'recargo_descanso_obligatorio', fecha) : null;
  const historial = (filas ?? []).filter((f) => f.ciudad_id === idAmbito).slice().reverse();

  if (error) return <div className="aviso-caja error">No se pudieron leer las reglas legales: {error}</div>;
  if (!reglas || !filas) return <p className="texto-suave">Cargando…</p>;
  if (reglas.length === 0) return <div className="vacio">La tabla de reglas legales aún no está cargada en la base.</div>;

  return (
    <>
      <div className="aviso-caja">
        Arriba, lo que fija la ley con su fecha y su fuente. Abajo, las reglas que usa cada ciudad o el resto del país, comparadas con la ley.
        Comparar <strong>no cambia ningún cálculo ni pago</strong>. Lo marcado "por confirmar" depende de Jurídica o Nómina. No es un concepto jurídico.
      </div>

      <div className="barra-filtros">
        <label className="campo">Regla de
          <select value={ambito} onChange={(e) => setAmbito(e.target.value)}>
            {ciudades.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            <option value={RESTO}>Resto del país</option>
          </select>
        </label>
        <label className="campo">Comparar en la fecha<input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></label>
        {esAdmin && <button onClick={() => setNueva(true)}>Registrar cambio de regla</button>}
      </div>

      <h3 className="titulo-seccion">{nombreAmbito} frente a la ley</h3>
      {!aplicable && <div className="vacio">{nombreAmbito} no tiene reglas de nómina vigentes en esa fecha{idAmbito ? ' ni hay una del resto del país' : ''}.</div>}
      {aplicable && (
        <>
          {heredada && <div className="aviso-caja alerta">{nombreAmbito} no tiene regla propia en esa fecha: usa la del resto del país.</div>}
          <div className="kpis">
            <div className={`kpi${distintas.length > 0 ? ' alerta' : ''}`}><small>Valores distintos de la ley</small><strong>{distintas.length}</strong></div>
            <div className="kpi"><small>Regla vigente desde</small><strong style={{ fontSize: 18 }}>{fechaCorta(aplicable.vigente_desde)}</strong></div>
            {proximo && <div className="kpi aviso"><small>Próximo cambio del recargo dominical</small><strong style={{ fontSize: 18 }}>{valorRegla(proximo)} · {fechaCorta(proximo.vigente_desde)}</strong></div>}
          </div>
          <TablaComparacion comparacion={comparacion} nombre={nombreAmbito} />
        </>
      )}

      <h3 className="titulo-seccion">Historial de reglas de {nombreAmbito}</h3>
      {historial.length === 0 ? <div className="vacio">Sin reglas registradas{idAmbito ? '; usa la del resto del país si existe' : ''}.</div> : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Desde</th><th>Jornada</th><th>Noche desde</th><th>Domingo</th><th>Divisor</th><th>Fuente y aprobación</th></tr></thead>
            <tbody>
              {historial.map((f) => (
                <tr key={f.id}>
                  <td className="num"><strong>{fechaCorta(f.vigente_desde)}</strong></td>
                  <td className="num">{dec(Number(f.jornada_semanal))} h{f.jornada_diaria_macro ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>macro {dec(Number(f.jornada_diaria_macro) * 6)} h</div> : null}</td>
                  <td className="num">{f.fin_diurno.slice(0, 5)}</td>
                  <td className="num">{(f.factores.dof_con_compensatorio ?? f.factores.rdf) !== undefined ? `${Math.round(Number(f.factores.dof_con_compensatorio ?? f.factores.rdf) * 100)} %` : '—'}</td>
                  <td className="num">{dec(Number(f.divisor_valor_hora))}</td>
                  <td>
                    {f.fuente ?? '—'}
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Aprobó: {f.aprobado_por ?? '—'}{f.soporte ? ` · Soporte: ${f.soporte}` : ''}{f.nota ? ` · ${f.nota}` : ''}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="titulo-seccion">Calendario legal</h3>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Tema</th><th>Desde</th><th>Valor</th><th>Fuente</th></tr></thead>
          <tbody>
            {ORDEN.flatMap((tema) => {
              const delTema = reglas.filter((r) => r.tema === tema);
              const vigente = reglaVigente(reglas, tema, fecha);
              return delTema.map((r, i) => (
                <tr key={`${tema}-${r.vigente_desde}`} style={r === vigente ? { background: '#f0f7ff' } : undefined}>
                  <td>{i === 0 ? <strong>{NOMBRE_TEMA[tema]}</strong> : null}</td>
                  <td className="num">{r.vigente_desde <= '1990-01-01' ? 'Antes' : fechaCorta(r.vigente_desde)}</td>
                  <td className="num">
                    {valorRegla(r)}
                    {r === vigente && <span className="badge" style={{ marginLeft: 6 }}>Vigente</span>}
                    {r.vigente_desde > fecha && <span className="badge morado" style={{ marginLeft: 6 }}>Futuro</span>}
                  </td>
                  <td>
                    {r.fuente}
                    {r.estado === 'por_confirmar' && <span className="badge gris" style={{ marginLeft: 6 }}>Por confirmar</span>}
                    {r.nota && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.nota}</div>}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>

      <h3 className="titulo-seccion">Departamentos donde operamos</h3>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Departamento</th><th>Ciudades con programación</th><th>Reglas que aplican</th></tr></thead>
          <tbody>
            {deptos.map((d) => {
              const cs = ciudades.filter((c) => c.departamento_id === d.id);
              return (
                <tr key={d.id}>
                  <td><strong>{d.nombre}</strong></td>
                  <td>{cs.length ? cs.map((c) => c.nombre).join(', ') : <span className="texto-suave">Ninguna todavía</span>}</td>
                  <td>{cs.length ? cs.map((c) => <span key={c.id} className="badge" style={{ marginRight: 4 }}>{c.nombre}</span>) : <span className="badge gris">Resto del país</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nueva && (
        <Modal onCerrar={() => setNueva(false)} ancho={760}>
          <NuevaRegla
            ambito={ambito} nombre={nombreAmbito} reglas={reglas}
            base={(filas.filter((f) => f.ciudad_id === idAmbito).slice(-1)[0]) ?? aplicable ?? filas.slice(-1)[0] ?? null}
            ultima={filas.filter((f) => f.ciudad_id === idAmbito).slice(-1)[0]?.vigente_desde ?? null}
            onListo={() => { setNueva(false); cargarFilas(); }} onCancelar={() => setNueva(false)}
          />
        </Modal>
      )}
    </>
  );
}

function TablaComparacion({ comparacion, nombre }: { comparacion: Comparacion[]; nombre: string }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 10 }}>
      <table>
        <thead><tr><th>Qué</th><th>Ley</th><th>{nombre}</th><th>Estado</th></tr></thead>
        <tbody>
          {comparacion.map((c) => (
            <tr key={c.clave}>
              <td><strong>{c.que}</strong><div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.explicacion} Fuente: {c.fuente}.</div></td>
              <td className="num">{valorComparacion(c, c.legal)}</td>
              <td className="num">{valorComparacion(c, c.ciudad)}</td>
              <td>
                {c.coincide === true && <span className="badge verde">Coincide</span>}
                {c.coincide === false && <span className="badge ambar">Distinto</span>}
                {c.estado === 'por_confirmar' && <span className="badge gris" style={{ marginLeft: 4 }}>Por confirmar</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const diaSiguiente = (f: string) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

export function NuevaRegla({ ambito, nombre, reglas, base, ultima, onListo, onCancelar }: {
  ambito: string; nombre: string; reglas: ReglaLegal[]; base: FilaParametros | null; ultima: string | null;
  onListo: () => void; onCancelar: () => void;
}) {
  const [desde, setDesde] = useState(ultima ? (diaSiguiente(ultima) > hoy() ? diaSiguiente(ultima) : hoy()) : hoy());
  const [v, setV] = useState({
    jornada_semanal: base ? Number(base.jornada_semanal) : 42,
    jornada_diaria_macro: base?.jornada_diaria_macro ? Number(base.jornada_diaria_macro) : null as number | null,
    inicio_diurno: base?.inicio_diurno.slice(0, 5) ?? '06:00',
    fin_diurno: base?.fin_diurno.slice(0, 5) ?? '19:00',
    divisor_valor_hora: base ? Number(base.divisor_valor_hora) : 210,
    smlv: base ? Number(base.smlv) : 0,
    auxilio_transporte: base ? Number(base.auxilio_transporte) : 0,
    max_horas_semana: base ? Number(base.max_horas_semana) : 60,
    descanso_minimo_horas: base ? Number(base.descanso_minimo_horas) : 8,
  });
  const [factores, setFactores] = useState<Record<string, number>>(base?.factores ?? { hed: 1.25, hen: 1.75, rn: 0.35, dof_con_compensatorio: 0.9, dof_sin_compensatorio: 1.9, hed_dof: 2.15, hen_dof: 2.65 });
  const [domingos, setDomingos] = useState<Record<string, number> | null>(base?.regla_domingos ?? null);
  const [fuente, setFuente] = useState('');
  const [aprobado, setAprobado] = useState('');
  const [soporte, setSoporte] = useState('');
  const [nota, setNota] = useState('');
  const [aceptaDiferencias, setAceptaDiferencias] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const borrador: ParametrosCiudad = { vigente_desde: desde, jornada_semanal: v.jornada_semanal, jornada_diaria_macro: v.jornada_diaria_macro, fin_diurno: v.fin_diurno, divisor_valor_hora: v.divisor_valor_hora, factores };
  const comparacion = compararConLey(reglas, borrador, desde);
  const distintas = comparacion.filter((c) => c.coincide === false);
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((a) => ({ ...a, [k]: e.target.value === '' ? null : Number(e.target.value) }));

  const guardar = async () => {
    setError('');
    if (!fuente.trim()) return setError('Indique la fuente: norma, acta o decisión que respalda la regla.');
    if (!aprobado.trim()) return setError('Indique quién aprobó la regla.');
    if (ultima && desde <= ultima) return setError(`La fecha de inicio debe ser posterior a la regla vigente (${fechaCorta(ultima)}).`);
    if (distintas.length > 0 && !aceptaDiferencias) return setError('Hay valores distintos de la ley: confirme que esa diferencia está aprobada.');
    setGuardando(true);
    const { error: e } = await db().rpc('registrar_parametros', {
      p_ciudad: ambito === RESTO ? null : ambito, p_vigente_desde: desde,
      p_valores: { ...v, factores, regla_domingos: domingos }, p_fuente: fuente, p_aprobado_por: aprobado,
      p_soporte: soporte || null, p_nota: nota || null,
    });
    setGuardando(false);
    if (e) return setError(e.message);
    onListo();
  };

  const campoNum = (etiqueta: string, k: keyof typeof v, paso = '0.01') => (
    <label className="campo">{etiqueta}<input type="number" step={paso} value={v[k] === null ? '' : String(v[k])} onChange={num(k)} /></label>
  );
  const rejilla = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 } as const;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Nueva regla de nómina · {nombre}</h3>
      <div className="aviso-caja" style={{ margin: 0 }}>
        La regla actual no se borra: queda en el historial. La nueva aplica a los periodos que se abran desde la fecha de inicio;
        los periodos ya abiertos o cerrados conservan sus reglas.
      </div>
      <div style={rejilla}>
        <label className="campo">Rige desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        {campoNum('Jornada semanal (h)', 'jornada_semanal')}
        {campoNum('Jornada diaria de la macro (h, opcional)', 'jornada_diaria_macro', '0.0001')}
        {campoNum('Divisor del valor hora', 'divisor_valor_hora', '1')}
        <label className="campo">Inicio del día<input type="time" value={v.inicio_diurno} onChange={(e) => setV((a) => ({ ...a, inicio_diurno: e.target.value }))} /></label>
        <label className="campo">Inicio de la noche<input type="time" value={v.fin_diurno} onChange={(e) => setV((a) => ({ ...a, fin_diurno: e.target.value }))} /></label>
        {campoNum('Salario mínimo', 'smlv', '1')}
        {campoNum('Auxilio de transporte', 'auxilio_transporte', '1')}
        {campoNum('Aviso de horas en 7 días', 'max_horas_semana', '0.5')}
        {campoNum('Descanso mínimo entre turnos (h)', 'descanso_minimo_horas', '0.5')}
      </div>
      <p className="texto-suave" style={{ margin: 0 }}>Salario mínimo {pesos(v.smlv ?? 0)} · auxilio {pesos(v.auxilio_transporte ?? 0)}</p>
      <strong style={{ fontSize: 14 }}>Factores</strong>
      <div style={rejilla}>
        {Object.entries(factores).map(([k, x]) => (
          <label key={k} className="campo">{NOMBRE_FACTOR[k] ?? k}
            <input type="number" step="0.01" value={String(x)} onChange={(e) => setFactores((a) => ({ ...a, [k]: Number(e.target.value) }))} />
          </label>
        ))}
        {domingos && Object.entries(domingos).map(([k, x]) => (
          <label key={k} className="campo">{NOMBRE_DOMINGOS[k] ?? k}
            <input type="number" step="1" value={String(x)} onChange={(e) => setDomingos((a) => ({ ...(a ?? {}), [k]: Number(e.target.value) }))} />
          </label>
        ))}
      </div>

      <strong style={{ fontSize: 14 }}>Así queda frente a la ley ({fechaCorta(desde)})</strong>
      <TablaComparacion comparacion={comparacion} nombre="Nueva regla" />

      <div style={rejilla}>
        <label className="campo">Fuente (obligatoria)<input value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Ley, acta de Nómina, concepto de Jurídica…" /></label>
        <label className="campo">Aprobado por (obligatorio)<input value={aprobado} onChange={(e) => setAprobado(e.target.value)} placeholder="Persona o área" /></label>
        <label className="campo">Soporte<input value={soporte} onChange={(e) => setSoporte(e.target.value)} placeholder="Enlace o nombre del documento" /></label>
        <label className="campo">Nota<input value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      </div>
      {distintas.length > 0 && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={aceptaDiferencias} onChange={(e) => setAceptaDiferencias(e.target.checked)} />
          Hay {distintas.length} valor{distintas.length === 1 ? '' : 'es'} distinto{distintas.length === 1 ? '' : 's'} de la ley; la diferencia está aprobada por quien se indica.
        </label>
      )}
      {error && <div className="aviso-caja error" style={{ margin: 0 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Registrar regla'}</button>
        <button className="secundario" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
