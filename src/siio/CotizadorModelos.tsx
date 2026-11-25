// Gerencia › Cotizador de modelos de servicio (Juan, 2026-11-25). Maqueta aprobada (OneDrive de Juan, carpeta del caso):
// SIIO_cotizador_modelo_hibrido_maqueta_2026-11-25.html. El cálculo es src/siio/modelo-hibrido.js; los datos del cliente
// y los supuestos llegan de la base (GET /api/siio/cotizador-modelos), nunca del código.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../apiClient';
import { calcularModelo, type SupuestosModelo, type TiendaModelo, type Nivel } from './modelo-hibrido.js';
import './cotizador-modelos.css';

type Escenario = { id: string; name: string; params: SupuestosModelo; is_baseline: boolean; created_at: string };
type Datos = { disponible: boolean; clientes: string[]; cliente: string | null; corte: string | null; tiendas: TiendaModelo[]; escenarios: Escenario[] };

const OPCIONES = [{ codigo: 'A', analitica: 2 }, { codigo: 'B', analitica: 1.5 }, { codigo: 'C', analitica: 1.25 }, { codigo: 'D', analitica: 1 }, { codigo: 'E' }];
const VACIO: SupuestosModelo = {
  zonas: {}, precioUnidad: 0, analitica: 0,
  proporciones: { A: { dia: 10, noche: 10 }, B: { dia: 5, noche: 10 }, C: { dia: 10, noche: 20 } },
  personasPorTurno: 2, costoPersona: 0, costoAnalitica: 0, valorGuardaNuevo: 0, reduccionMerma: 0.1,
  opcionE: { analitica: 0, parteMerma: 0.5 }, opciones: OPCIONES,
};

const entero = (n: number) => Math.round(n).toLocaleString('es-CO');
const conSigno = (n: number) => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + entero(Math.abs(n));
const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')} %`;
const tono = (n: number) => (Math.round(n) <= 0 ? 'cm-bien' : 'cm-mal');

function Numero({ valor, onChange, paso = 1, sufijo }: { valor: number; onChange: (n: number) => void; paso?: number; sufijo?: string }) {
  return <span className="cm-campo"><input type="number" step={paso} min={0} value={Number.isFinite(valor) ? valor : 0} onChange={e => onChange(Number(e.target.value))} />{sufijo && <small>{sufijo}</small>}</span>;
}

export function CotizadorModelos() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState('');
  const [s, setS] = useState<SupuestosModelo>(VACIO);
  const [opcion, setOpcion] = useState('A');
  const [vistaCliente, setVistaCliente] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = (cliente?: string) => {
    setError('');
    api<Datos>(`/api/siio/cotizador-modelos${cliente ? `?cliente=${encodeURIComponent(cliente)}` : ''}`)
      .then(d => {
        setDatos(d);
        const base = d.escenarios.find(e => e.is_baseline) || d.escenarios[0];
        const zonas = Object.fromEntries([...new Set(d.tiendas.map(t => t.zona))].map(z => [z, { enModelo: false, margen: 0, supervisoresHoy: 0 }]));
        setS(base ? { ...VACIO, ...base.params, zonas: { ...zonas, ...(base.params.zonas || {}) } } : { ...VACIO, zonas });
      })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar el cotizador.'));
  };
  useEffect(() => { cargar(); }, []);

  const supuestos = useMemo(() => {
    const op = OPCIONES.find(o => o.codigo === opcion);
    const analitica = opcion === 'E' ? s.opcionE.analitica : opcion === 'A' ? s.analitica : op?.analitica ?? s.analitica;
    return { ...s, analitica, opciones: OPCIONES.map(o => (o.codigo === 'A' ? { ...o, analitica: s.analitica } : o)) };
  }, [s, opcion]);
  const r = useMemo(() => (datos ? calcularModelo(datos.tiendas, supuestos) : null), [datos, supuestos]);

  const cambiar = (parcial: Partial<SupuestosModelo>) => setS(prev => ({ ...prev, ...parcial }));
  const proporcion = (nivel: Nivel, turno: 'dia' | 'noche', n: number) => setS(prev => ({ ...prev, proporciones: { ...prev.proporciones, [nivel]: { ...prev.proporciones[nivel], [turno]: n } } }));
  const zona = (nombre: string, parcial: Partial<SupuestosModelo['zonas'][string]>) => setS(prev => ({ ...prev, zonas: { ...prev.zonas, [nombre]: { ...prev.zonas[nombre], ...parcial } } }));

  const guardar = async () => {
    if (!datos?.cliente) return;
    const nombre = window.prompt('Nombre del escenario', `Escenario ${new Date().toLocaleDateString('es-CO')}`);
    if (!nombre) return;
    try {
      const nuevo = await api<Escenario>('/api/siio/cotizador-modelos/escenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: datos.cliente, nombre, params: s }) });
      setDatos(d => (d ? { ...d, escenarios: [nuevo, ...d.escenarios] } : d));
      setAviso(`Escenario «${nuevo.name}» guardado.`);
    } catch (e) { setAviso(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  };
  const abrir = (id: string) => {
    const e = datos?.escenarios.find(x => x.id === id);
    if (e) setS(prev => ({ ...VACIO, ...e.params, zonas: { ...prev.zonas, ...(e.params.zonas || {}) } }));
  };

  if (error) return <div className="notice error">{error}</div>;
  if (!datos || !r) return <div className="notice">Cargando el cotizador…</div>;
  if (!datos.disponible || !datos.tiendas.length) return <div className="notice">Todavía no hay datos de clientes cargados para el cotizador.</div>;

  const t = r.total;
  const zonasOrdenadas = [...r.zonas].sort((a, b) => Number(b.enModelo) - Number(a.enModelo) || b.valor - a.valor);
  return <div className={`cm ${vistaCliente ? 'cm-vista-cliente' : ''}`}>
    <div className="cm-barra">
      <div><strong>Modelo híbrido · {datos.cliente}</strong><small>Datos al {datos.corte} · millones de pesos al mes, antes de IVA</small></div>
      <div className="cm-acciones">
        {datos.escenarios.length > 0 && <select aria-label="Abrir escenario" defaultValue="" onChange={e => abrir(e.target.value)}><option value="" disabled>Abrir escenario…</option>{datos.escenarios.map(e => <option key={e.id} value={e.id}>{e.name}{e.is_baseline ? ' (base)' : ''}</option>)}</select>}
        <div className="cm-seg" role="group" aria-label="Vista"><button type="button" className={!vistaCliente ? 'on' : ''} onClick={() => setVistaCliente(false)}>Vista interna</button><button type="button" className={vistaCliente ? 'on' : ''} onClick={() => setVistaCliente(true)}>Vista cliente</button></div>
        <button type="button" className="cm-principal" onClick={() => void guardar()}>Guardar escenario</button>
      </div>
    </div>
    {aviso && <div className="notice">{aviso}</div>}
    <div className="cm-grilla">
      <aside>
        <section className="cm-hoja"><h2>Ciudades en el modelo<small>Las que no entran conservan su guarda</small></h2>
          {zonasOrdenadas.map(z => <label key={z.zona} className="cm-chk"><span><input type="checkbox" checked={s.zonas[z.zona]?.enModelo === true} onChange={e => zona(z.zona, { enModelo: e.target.checked })} /> {z.zona}</span><small>{z.tiendas} tiendas</small></label>)}
        </section>
        <section className="cm-hoja"><h2>Precios al cliente</h2>
          <label>Unidad de reacción (turno de 12 h)</label><Numero valor={s.precioUnidad} paso={0.5} sufijo="M al mes" onChange={n => cambiar({ precioUnidad: n })} />
          <label>Opción de analítica</label>
          <div className="cm-ops">{OPCIONES.map(o => <button type="button" key={o.codigo} className={o.codigo === opcion ? 'on' : ''} onClick={() => setOpcion(o.codigo)}>{o.codigo}</button>)}</div>
          {opcion === 'A' && <><label>Analítica por tienda (opción A)</label><Numero valor={s.analitica} paso={0.25} sufijo="M al mes" onChange={n => cambiar({ analitica: n })} /></>}
          {opcion === 'E' && <><label>Opción E: analítica por tienda</label><Numero valor={s.opcionE.analitica} paso={0.25} sufijo="M al mes" onChange={n => cambiar({ opcionE: { ...s.opcionE, analitica: n } })} />
            <label>Opción E: parte de la merma evitada</label><Numero valor={Math.round(s.opcionE.parteMerma * 100)} sufijo="%" onChange={n => cambiar({ opcionE: { ...s.opcionE, parteMerma: n / 100 } })} /></>}
        </section>
        <section className="cm-hoja"><h2>Cobertura<small>Tiendas por unidad de reacción · día / noche</small></h2>
          {(['A', 'B', 'C'] as Nivel[]).map(n => <div key={n}><label>Nivel {n}{n === 'A' ? ', con guarda' : ''}</label><span className="cm-par"><Numero valor={s.proporciones[n].dia} onChange={v => proporcion(n, 'dia', v)} /><Numero valor={s.proporciones[n].noche} onChange={v => proporcion(n, 'noche', v)} /></span></div>)}
        </section>
        <section className="cm-hoja"><h2>Merma</h2>
          <label>Reducción de la merma desconocida: <b>{Math.round(s.reduccionMerma * 100)} %</b></label>
          <input type="range" min={0} max={30} step={5} value={Math.round(s.reduccionMerma * 100)} onChange={e => cambiar({ reduccionMerma: Number(e.target.value) / 100 })} />
          <small className="cm-nota">Escenario, no compromiso.</small>
        </section>
        <section className="cm-hoja cm-interna"><h2>Costos nuestros <span className="cm-insignia">INTERNO</span></h2>
          <label>Personas por turno de 12 h</label><Numero valor={s.personasPorTurno} paso={0.1} onChange={n => cambiar({ personasPorTurno: n })} />
          <label>Costo por persona</label><Numero valor={s.costoPersona} paso={0.1} sufijo="M al mes" onChange={n => cambiar({ costoPersona: n })} />
          <label>Costo de la analítica por tienda</label><Numero valor={s.costoAnalitica} paso={0.1} sufijo="M al mes" onChange={n => cambiar({ costoAnalitica: n })} />
          <label>Guarda nuevo en tienda A sin guarda</label><Numero valor={s.valorGuardaNuevo} paso={0.5} sufijo="M al mes" onChange={n => cambiar({ valorGuardaNuevo: n })} />
        </section>
      </aside>
      <section>
        <div className="cm-kpis">
          <div className="cm-k"><small>El cliente paga hoy</small><b>${entero(t.valor)} M</b><span>guardas en tienda, al mes</span></div>
          <div className="cm-k cm-dest"><small>Paga con el modelo</small><b>${entero(t.totalModelo)} M</b><span>{r.zonas.filter(z => z.enModelo).length} ciudades · {t.tiendas} tiendas</span></div>
          <div className="cm-k"><small>Frente a hoy</small><b className={tono(t.frenteAHoy)}>{conSigno(t.frenteAHoy)} M</b><span>{pct(t.frenteAHoyPct)} · {conSigno(t.frenteAHoy * 12)} M al año</span></div>
          <div className="cm-k"><small>Guardas fijos</small><b>{entero(t.puestos)} → {entero(t.guardasModelo)}</b><span>hoy → con el modelo</span></div>
          <div className="cm-k"><small>Unidades de reacción</small><b>{entero(t.unidades)}</b><span>{entero(t.unidadesDia)} de día · {entero(t.unidadesNoche)} de noche</span></div>
        </div>
        <section className="cm-hoja"><h2>Hoy frente al modelo, por ciudad<small>Personal hoy = valor contratado de los puestos de guarda en tiendas</small></h2>
          <div className="cm-tabla"><table><thead><tr><th>Ciudad</th><th>Tiendas</th><th>Tiendas A / B / C</th><th>Guardas hoy → modelo</th><th>Unidades de reacción</th><th>Personal hoy</th><th>Personal modelo</th><th>Analítica</th><th>Total modelo</th><th>Frente a hoy</th></tr></thead>
            <tbody>{zonasOrdenadas.map(z => <tr key={z.zona} className={z.enModelo ? '' : 'cm-fuera'}><td>{z.zona}</td><td>{z.tiendas}</td><td>{z.A} / {z.B} / {z.C}</td><td>{z.puestos} → {z.guardasModelo}</td><td>{z.unidades}</td><td>{entero(z.valor)}</td><td>{entero(z.personalModelo)}</td><td>{entero(z.valorAnalitica)}</td><td>{entero(z.totalModelo)}</td><td className={z.enModelo ? tono(z.frenteAHoy) : ''}>{z.enModelo ? conSigno(z.frenteAHoy) : 'sin cambio'}</td></tr>)}</tbody>
            <tfoot><tr><td>Total en el modelo</td><td>{t.tiendas}</td><td>{t.A} / {t.B} / {t.C}</td><td>{t.puestos} → {t.guardasModelo}</td><td>{t.unidades}</td><td>{entero(t.valor)}</td><td>{entero(t.personalModelo)}</td><td>{entero(t.valorAnalitica)}</td><td>{entero(t.totalModelo)}</td><td className={tono(t.frenteAHoy)}>{conSigno(t.frenteAHoy)}</td></tr></tfoot>
          </table></div>
          {r.zonas.some(z => z.proporcionInvalida) && <div className="notice error">Hay una proporción en cero: cada nivel necesita al menos 1 tienda por unidad.</div>}
        </section>
        <div className="cm-dos">
          <section className="cm-hoja"><h2>Opciones de precio<small>Lo que paga el cliente frente a hoy</small></h2>
            <div className="cm-tabla"><table><thead><tr><th>Opción</th><th>Analítica</th><th>Paga</th><th>Frente a hoy</th><th className="cm-solo-interna">Nuestro margen</th></tr></thead>
              <tbody>{r.opciones.map(o => <tr key={o.codigo} className={o.codigo === opcion ? 'cm-sel' : ''}><td>{o.codigo}{o.codigo === 'E' ? ' (6 meses)' : ''}</td><td>{entero(o.valorAnalitica)}</td><td>{entero(o.paga - o.parteMerma)}{o.parteMerma ? ` + ${entero(o.parteMerma)}` : ''}</td><td className={tono(o.frenteAHoy)}>{conSigno(o.frenteAHoy)}</td><td className="cm-solo-interna">{entero(o.margen)} ({Math.round(o.margenPct * 100)} %)</td></tr>)}</tbody></table></div>
          </section>
          <section className="cm-hoja"><h2>Si la merma baja<small>Beneficio para el cliente con la opción elegida</small></h2>
            <div className="cm-tabla"><table><thead><tr><th>Merma baja</th><th>Merma evitada</th><th>Ahorro del modelo</th><th>Beneficio al mes</th><th>Al año</th></tr></thead>
              <tbody>{r.escenariosMerma.map(m => {
                const parte = opcion === 'E' ? m.evitada * s.opcionE.parteMerma : 0;
                const beneficio = m.beneficio - parte;
                return <tr key={m.reduccion} className={Math.abs(m.reduccion - s.reduccionMerma) < 1e-9 ? 'cm-sel' : ''}><td>{Math.round(m.reduccion * 100)} %</td><td>{entero(m.evitada)}</td><td>{entero(m.ahorroModelo)}</td><td className="cm-bien">{entero(beneficio)}</td><td>{entero(beneficio * 12)}</td></tr>;
              })}</tbody></table></div>
          </section>
        </div>
        <section className="cm-hoja cm-interna"><h2>Nuestro lado <span className="cm-insignia">INTERNO · no se muestra al cliente</span></h2>
          <table><thead><tr><th></th><th>Hoy</th><th>Con el modelo (opción {opcion})</th></tr></thead>
            <tbody><tr><td>Ingreso</td><td>{entero(t.valor)}</td><td>{entero(t.totalModelo)}</td></tr><tr><td>Costo</td><td>{entero(t.costoHoy)}</td><td>{entero(t.costoModelo)}</td></tr></tbody>
            <tfoot><tr><td>Margen</td><td>{entero(t.margenHoy)} ({t.valor ? Math.round((t.margenHoy / t.valor) * 100) : 0} %)</td><td>{entero(t.margenModelo)} ({t.totalModelo ? Math.round((t.margenModelo / t.totalModelo) * 100) : 0} %)</td></tr></tfoot></table>
          {r.unidad.pierde
            ? <div className="notice error">Cada unidad de reacción cuesta {r.unidad.costo.toFixed(1).replace('.', ',')} M y se cobra a {r.unidad.precio} M: pierde plata.</div>
            : <small className="cm-nota">Cada unidad de reacción cuesta {r.unidad.costo.toFixed(1).replace('.', ',')} M y se cobra a {r.unidad.precio} M (margen {Math.round(r.unidad.margenPct * 100)} %).</small>}
          <h3>Supuestos por ciudad</h3>
          <table><thead><tr><th>Ciudad</th><th>Margen del guarda hoy</th><th>Supervisores hoy (estimado)</th></tr></thead>
            <tbody>{zonasOrdenadas.map(z => <tr key={z.zona}><td>{z.zona}</td><td><Numero valor={Math.round((s.zonas[z.zona]?.margen ?? 0) * 1000) / 10} paso={0.1} sufijo="%" onChange={n => zona(z.zona, { margen: n / 100 })} /></td><td><Numero valor={s.zonas[z.zona]?.supervisoresHoy ?? 0} paso={0.1} onChange={n => zona(z.zona, { supervisoresHoy: n })} /></td></tr>)}</tbody></table>
        </section>
      </section>
    </div>
  </div>;
}
