// Datos maestros: clientes, puestos, empleados, turnos tipo y reglas legales. Edita el administrador; los demás consultan.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, type Acceso } from './supabase.ts';
import { Plus } from 'lucide-react';
import { Formulario, Modal, type Campo } from './ui.tsx';
import { CargarDatos } from './CargarDatos.tsx';
import { TurnosTipo } from './TurnosTipo.tsx';
import { HabilitacionesGuarda } from './Habilitaciones.tsx';
import { ReglasLegales } from './ReglasLegales.tsx';

type Seccion = 'clientes' | 'puestos' | 'empleados' | 'turnos' | 'reglas' | 'cargar';
interface Cliente { id: number; nit: string; razon_social: string; sector: string | null; riesgo: string | null; ejecutivo: string | null; activo: boolean; notas: string | null }
interface Puesto { id: number; nombre: string; cliente_id: number | null; direccion: string | null; municipio: string | null; cobertura: string | null; requiere_arma: boolean; requiere_moto: boolean; requiere_canino: boolean; centro_costo: string | null; activo: boolean; notas: string | null }
interface Empleado { id: number; tipo_documento: string; documento: string; nombre: string; cargo: string; fecha_ingreso: string | null; fecha_retiro: string | null; estado: string }

// Etiquetas de los cargos que escribió la plataforma antes de traer el personal de Avancys. Ya no son
// la lista: Avancys trae los cargos reales de la empresa ('vigilante operador de medios tecnológicos',
// 'coordinador de seguridad'…), así que las opciones del selector salen de los empleados que hay.
const CARGOS_HEREDADOS: [string, string][] = [['vigilante', 'Vigilante'], ['supervisor', 'Supervisor'], ['radioperador', 'Radioperador'], ['operador_medios', 'Operador de medios tecnológicos'], ['tecnico', 'Técnico'], ['escolta', 'Escolta'], ['sin_clasificar', 'Sin clasificar']];
const etiquetaCargo = (c: string | undefined | null) =>
  CARGOS_HEREDADOS.find(([k]) => k === c)?.[1] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1) : '—');
const ESTADOS: [string, string][] = [['activo', 'Activo'], ['disponible', 'Disponible (reserva)'], ['retirado', 'Retirado']];

async function todo<T>(q: (a: number, b: number) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await q(i, i + 999);
    const f = (data as T[]) ?? [];
    out.push(...f);
    if (f.length < 1000) return out;
  }
}

export function Maestros({ acceso, ciudad }: { acceso: Acceso; ciudad: string }) {
  const [seccion, setSeccion] = useState<Seccion>('clientes');
  const esAdmin = acceso.rol === 'admin';
  return (
    <section>
      <nav className="pestanas">
        {(([['clientes', 'Clientes'], ['puestos', 'Puestos'], ['empleados', 'Empleados'], ['turnos', 'Turnos tipo'], ['reglas', 'Reglas legales']] as [Seccion, string][]).concat(esAdmin ? [['cargar', 'Cargar datos de Avancys']] : [])).map(([k, t]) => (
          <button key={k} className={seccion === k ? 'activa' : ''} onClick={() => setSeccion(k)}>{t}</button>
        ))}
      </nav>
      {!esAdmin && <div className="aviso-caja" style={{ marginTop: 0 }}>Solo consulta: los datos maestros los edita un administrador.</div>}
      {seccion === 'clientes' && <ClientesMaestro esAdmin={esAdmin} />}
      {seccion === 'puestos' && <PuestosMaestro esAdmin={esAdmin} ciudad={ciudad} />}
      {seccion === 'empleados' && <EmpleadosMaestro esAdmin={esAdmin} ciudad={ciudad} editaHabilitaciones={esAdmin || acceso.rol === 'coordinador'} />}
      {seccion === 'turnos' && <TurnosTipo ciudad={ciudad} esAdmin={esAdmin} />}
      {seccion === 'reglas' && <ReglasLegales ciudad={ciudad} acceso={acceso} />}
      {seccion === 'cargar' && esAdmin && <CargarDatos ciudad={ciudad} />}
    </section>
  );
}

function Buscador({ valor, onCambio, placeholder, children }: { valor: string; onCambio: (v: string) => void; placeholder: string; children?: React.ReactNode }) {
  return (
    <div className="barra-filtros">
      <label className="campo">Buscar<input value={valor} onChange={(e) => onCambio(e.target.value)} placeholder={placeholder} /></label>
      {children}
    </div>
  );
}

// Conteo bajo el buscador (o "Cargando…" mientras llega la lista).
function Conteo({ lista, n, texto }: { lista: unknown[] | null; n: number; texto: string }) {
  return lista === null ? <p className="texto-suave">Cargando…</p> : <p className="texto-suave" style={{ margin: '0 0 8px' }}><span className="num">{n.toLocaleString('es-CO')}</span> {texto}</p>;
}
const mas = <Plus size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />;

function ClientesMaestro({ esAdmin }: { esAdmin: boolean }) {
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Cliente> | null>(null);
  const cargar = useCallback(() => { todo<Cliente>((a, b) => db().from('clientes').select('*').order('razon_social').range(a, b)).then(setLista); }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const vis = useMemo(() => (lista ?? []).filter((c) => !q || c.razon_social.toLowerCase().includes(q.toLowerCase()) || c.nit.includes(q)), [lista, q]);
  const campos: Campo[] = [
    { clave: 'nit', etiqueta: 'NIT', tipo: 'texto', requerido: true }, { clave: 'razon_social', etiqueta: 'Razón social', tipo: 'texto', requerido: true },
    { clave: 'sector', etiqueta: 'Sector', tipo: 'texto' }, { clave: 'riesgo', etiqueta: 'Categoría de riesgo', tipo: 'texto' },
    { clave: 'ejecutivo', etiqueta: 'Ejecutivo de cuenta', tipo: 'texto' }, { clave: 'activo', etiqueta: 'Cliente activo', tipo: 'si_no' },
    { clave: 'notas', etiqueta: 'Notas', tipo: 'texto' },
  ];
  return (
    <>
      <Buscador valor={q} onCambio={setQ} placeholder="Cliente o NIT">
        {esAdmin && <button onClick={() => setEdit({ activo: true })}>{mas}Nuevo cliente</button>}
      </Buscador>
      <Conteo lista={lista} n={vis.length} texto="clientes" />
      {lista && vis.length === 0 ? <div className="vacio">No hay clientes con esa búsqueda.</div> : (
        <div className="lista">
          {vis.slice(0, 300).map((c) => (
            <div key={c.id} className="fila" style={{ opacity: c.activo ? 1 : 0.65 }}>
              <div style={{ minWidth: 0 }}><b style={{ overflowWrap: 'anywhere' }}>{c.razon_social}</b>{!c.activo && <span className="badge gris" style={{ marginLeft: 6 }}>Retirado</span>}
                <div className="sub">NIT {c.nit}{c.ejecutivo ? ` · ${c.ejecutivo}` : ''}{c.sector ? ` · ${c.sector}` : ''}</div></div>
              {esAdmin && <div className="acciones"><button className="secundario chico" onClick={() => setEdit(c)}>Editar</button></div>}
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal onCerrar={() => setEdit(null)}>
          <Formulario titulo={edit.id ? "Editar cliente" : "Nuevo cliente"} campos={campos} inicial={edit as Record<string, unknown>} onCancelar={() => setEdit(null)}
            onGuardar={async (v) => {
              const f = { nit: String(v.nit).trim(), razon_social: String(v.razon_social).trim(), sector: v.sector || null, riesgo: v.riesgo || null, ejecutivo: v.ejecutivo || null, activo: Boolean(v.activo), notas: v.notas || null, actualizado_en: new Date().toISOString() };
              const { error } = edit.id ? await db().from('clientes').update(f).eq('id', edit.id) : await db().from('clientes').insert(f);
              if (error) return error.message.includes('duplicate') ? 'Ya existe un cliente con ese NIT.' : error.message;
              setEdit(null); cargar(); return null;
            }} />
        </Modal>
      )}
    </>
  );
}

function PuestosMaestro({ esAdmin, ciudad }: { esAdmin: boolean; ciudad: string }) {
  const [lista, setLista] = useState<Puesto[] | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState('');
  const [sinCliente, setSinCliente] = useState(false);
  const [edit, setEdit] = useState<Partial<Puesto> | null>(null);
  const cargar = useCallback(() => {
    todo<Puesto>((a, b) => db().from('puestos').select('*').eq('ciudad_id', ciudad).order('nombre').range(a, b)).then(setLista);
    todo<Cliente>((a, b) => db().from('clientes').select('id, nit, razon_social, activo').order('razon_social').range(a, b)).then(setClientes);
  }, [ciudad]);
  useEffect(() => { cargar(); }, [cargar]);
  const nombreCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.razon_social])), [clientes]);
  const vis = useMemo(() => (lista ?? []).filter((p) => (!sinCliente || !p.cliente_id) && (!q || p.nombre.toLowerCase().includes(q.toLowerCase()) || (nombreCliente.get(p.cliente_id ?? -1) ?? '').toLowerCase().includes(q.toLowerCase()))), [lista, q, sinCliente, nombreCliente]);
  const campos: Campo[] = [
    { clave: 'nombre', etiqueta: 'Nombre del puesto', tipo: 'texto', requerido: true },
    { clave: 'cliente_id', etiqueta: 'Cliente', tipo: 'opciones', opciones: clientes.filter((c) => c.activo).map((c) => [c.id, `${c.razon_social} (${c.nit})`]) },
    { clave: 'direccion', etiqueta: 'Dirección', tipo: 'texto' }, { clave: 'municipio', etiqueta: 'Municipio', tipo: 'texto' },
    { clave: 'centro_costo', etiqueta: 'Centro de costo', tipo: 'texto' },
    { clave: 'requiere_arma', etiqueta: 'Requiere arma', tipo: 'si_no' }, { clave: 'requiere_moto', etiqueta: 'Requiere moto', tipo: 'si_no' },
    { clave: 'requiere_canino', etiqueta: 'Requiere canino', tipo: 'si_no' }, { clave: 'activo', etiqueta: 'Puesto activo', tipo: 'si_no' },
    { clave: 'notas', etiqueta: 'Notas', tipo: 'texto' },
  ];
  const nSin = (lista ?? []).filter((p) => !p.cliente_id).length;
  return (
    <>
      <Buscador valor={q} onCambio={setQ} placeholder="Puesto o cliente">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 40 }}><input type="checkbox" checked={sinCliente} onChange={(e) => setSinCliente(e.target.checked)} /> Sin cliente <span className={`badge ${nSin > 0 ? 'ambar' : 'gris'}`}>{nSin}</span></label>
        {esAdmin && <button onClick={() => setEdit({ activo: true })}>{mas}Nuevo puesto</button>}
      </Buscador>
      <Conteo lista={lista} n={vis.length} texto="puestos" />
      {lista && vis.length === 0 ? <div className="vacio">No hay puestos con ese filtro.</div> : (
        <div className="lista">
          {vis.slice(0, 300).map((p) => (
            <div key={p.id} className="fila" style={{ opacity: p.activo ? 1 : 0.65 }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ overflowWrap: 'anywhere' }}>{p.nombre}</b>
                <div className="sub">{p.cliente_id ? nombreCliente.get(p.cliente_id) : <span className="badge ambar">Sin cliente</span>}{p.municipio ? ` · ${p.municipio}` : ''}</div>
                {(!p.activo || p.requiere_arma || p.requiere_moto || p.requiere_canino) && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {!p.activo && <span className="badge gris">Inactivo</span>}
                    {p.requiere_arma && <span className="badge rojo">Arma</span>}
                    {p.requiere_moto && <span className="badge morado">Moto</span>}
                    {p.requiere_canino && <span className="badge ambar">Canino</span>}
                  </div>
                )}
              </div>
              {esAdmin && <div className="acciones"><button className="secundario chico" onClick={() => setEdit(p)}>Editar</button></div>}
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal onCerrar={() => setEdit(null)}>
          <Formulario titulo={edit.id ? "Editar puesto" : "Nuevo puesto"} campos={campos} inicial={edit as Record<string, unknown>} onCancelar={() => setEdit(null)}
            onGuardar={async (v) => {
              const f = { ciudad_id: ciudad, nombre: String(v.nombre).trim(), cliente_id: v.cliente_id ?? null, direccion: v.direccion || null, municipio: v.municipio || null,
                centro_costo: v.centro_costo || null, requiere_arma: Boolean(v.requiere_arma), requiere_moto: Boolean(v.requiere_moto), requiere_canino: Boolean(v.requiere_canino),
                activo: Boolean(v.activo), notas: v.notas || null, actualizado_en: new Date().toISOString() };
              const { error } = edit.id ? await db().from('puestos').update(f).eq('id', edit.id) : await db().from('puestos').insert(f);
              if (error) return error.message;
              setEdit(null); cargar(); return null;
            }} />
        </Modal>
      )}
    </>
  );
}

function EmpleadosMaestro({ esAdmin, ciudad, editaHabilitaciones }: { esAdmin: boolean; ciudad: string; editaHabilitaciones: boolean }) {
  const [habil, setHabil] = useState<Empleado | null>(null);
  const [lista, setLista] = useState<Empleado[] | null>(null);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('activo');
  const [edit, setEdit] = useState<Partial<Empleado> | null>(null);
  const cargar = useCallback(() => { todo<Empleado>((a, b) => db().from('empleados').select('id, tipo_documento, documento, nombre, cargo, fecha_ingreso, fecha_retiro, estado').eq('ciudad_id', ciudad).order('nombre').range(a, b)).then(setLista); }, [ciudad]);
  useEffect(() => { cargar(); }, [cargar]);
  const vis = useMemo(() => (lista ?? []).filter((e) => (!estado || e.estado === estado) && (!q || e.nombre.toLowerCase().includes(q.toLowerCase()) || e.documento.includes(q))), [lista, q, estado]);
  const conteo = useMemo(() => { const c: Record<string, number> = {}; (lista ?? []).forEach((e) => (c[e.estado] = (c[e.estado] ?? 0) + 1)); return c; }, [lista]);
  // Los cargos que ofrece el selector son los que de verdad existen, más los heredados y el del
  // empleado que se está editando: si no estuviera el suyo, guardarlo se lo cambiaría sin avisar.
  const cargos = useMemo<[string, string][]>(() => {
    const veces = new Map<string, number>();
    (lista ?? []).forEach((e) => e.cargo && veces.set(e.cargo, (veces.get(e.cargo) ?? 0) + 1));
    CARGOS_HEREDADOS.forEach(([k]) => veces.has(k) || veces.set(k, 0));
    if (edit?.cargo) veces.has(edit.cargo) || veces.set(edit.cargo, 0);
    return [...veces.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
      .map(([k, n]) => [k, n > 0 ? `${etiquetaCargo(k)} (${n})` : etiquetaCargo(k)]);
  }, [lista, edit?.cargo]);
  const campos: Campo[] = [
    { clave: 'tipo_documento', etiqueta: 'Tipo de documento', tipo: 'opciones', opciones: [['CC', 'Cédula'], ['CE', 'Cédula de extranjería'], ['PPT', 'PPT'], ['NA', 'Sin documento']], requerido: true },
    { clave: 'documento', etiqueta: 'Número de documento', tipo: 'texto', requerido: true }, { clave: 'nombre', etiqueta: 'Nombre completo', tipo: 'texto', requerido: true },
    { clave: 'cargo', etiqueta: 'Cargo', tipo: 'opciones', opciones: cargos, requerido: true },
    { clave: 'fecha_ingreso', etiqueta: 'Fecha de ingreso', tipo: 'fecha' }, { clave: 'fecha_retiro', etiqueta: 'Fecha de retiro', tipo: 'fecha' },
    { clave: 'estado', etiqueta: 'Estado', tipo: 'opciones', opciones: ESTADOS, requerido: true },
  ];
  return (
    <>
      <Buscador valor={q} onCambio={setQ} placeholder="Nombre o documento">
        <label className="campo" style={{ flex: '0 1 220px' }}>Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos ({(lista ?? []).length})</option>
            {ESTADOS.map(([k, t]) => <option key={k} value={k}>{t} ({conteo[k] ?? 0})</option>)}
          </select>
        </label>
        {esAdmin && <button onClick={() => setEdit({ tipo_documento: 'CC', cargo: 'vigilante', estado: 'activo' })}>{mas}Nuevo empleado</button>}
      </Buscador>
      <Conteo lista={lista} n={vis.length} texto={`empleados${vis.length > 300 ? ' (mostrando 300; use la búsqueda)' : ''}`} />
      {lista && vis.length === 0 ? <div className="vacio">No hay empleados con ese filtro.</div> : (
        <div className="lista">
          {vis.slice(0, 300).map((e) => (
            <div key={e.id} className="fila" style={{ opacity: e.estado === 'retirado' ? 0.65 : 1 }}>
              <div style={{ minWidth: 0 }}>
                <b style={{ overflowWrap: 'anywhere' }}>{e.nombre}</b>{' '}
                <span className={`badge ${e.estado === 'activo' ? 'verde' : e.estado === 'disponible' ? '' : 'gris'}`} style={{ marginLeft: 4 }}>{ESTADOS.find(([k]) => k === e.estado)?.[1] ?? e.estado}</span>
                <div className="sub">{e.tipo_documento} {e.documento} · {etiquetaCargo(e.cargo)}
                  {e.fecha_ingreso ? ` · ingresó ${e.fecha_ingreso}` : ''}{e.fecha_retiro ? ` · retiro ${e.fecha_retiro}` : ''}</div></div>
              <div className="acciones">
                <button className="secundario chico" onClick={() => setHabil(e)}>Habilitaciones</button>
                {esAdmin && <button className="secundario chico" onClick={() => setEdit(e)}>Editar</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {habil && (
        <Modal onCerrar={() => setHabil(null)}>
          <HabilitacionesGuarda empleado={habil} puedeEditar={editaHabilitaciones} onCerrar={() => setHabil(null)} />
        </Modal>
      )}
      {edit && (
        <Modal onCerrar={() => setEdit(null)}>
          <Formulario titulo={edit.id ? "Editar empleado" : "Nuevo empleado"} campos={campos} inicial={edit as Record<string, unknown>} onCancelar={() => setEdit(null)}
            onGuardar={async (v) => {
              if (v.estado === 'retirado' && !v.fecha_retiro) return 'Indique la fecha de retiro.';
              const f = { ciudad_id: ciudad, tipo_documento: v.tipo_documento, documento: String(v.documento).trim(), nombre: String(v.nombre).trim().toUpperCase(), cargo: v.cargo,
                fecha_ingreso: v.fecha_ingreso || null, fecha_retiro: v.fecha_retiro || null, estado: v.estado, actualizado_en: new Date().toISOString() };
              const { error } = edit.id ? await db().from('empleados').update(f).eq('id', edit.id) : await db().from('empleados').insert(f);
              if (error) return error.message.includes('duplicate') ? 'Ya existe un empleado con ese documento.' : error.message;
              setEdit(null); cargar(); return null;
            }} />
        </Modal>
      )}
    </>
  );
}
