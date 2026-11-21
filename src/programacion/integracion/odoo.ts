// Cliente de la conexión estándar de Odoo (JSON-RPC), base de Avancys. Funciona en Node, Deno y navegador.
// Se usa desde la función del servidor; las claves nunca llegan al navegador.
import { normalizarEstado, normalizarFecha, normalizarTexto, texto, type Fila } from './normalizar.ts';

export interface ConexionOdoo { url: string; db: string; usuario: string; clave: string }

/**
 * De dónde sale el lugar de un registro. Medido en Avancys el 2026-10-29:
 * - el empleado NO tiene ciudad propia; vive en su contrato (`hr.contract.work_city_id`, 3.140 de 3.141);
 * - el cliente sí la tiene en el registro (`res.partner.city_id`, 1.435 de 1.439).
 * `grupo` es la agrupación ancha (la agencia del contrato o el departamento del cliente), que es la
 * que corresponde a una ciudad de Programación.
 */
export interface ConfigLugar {
  desde: string;                 // 'propio' o el modelo donde vive (p. ej. 'hr.contract')
  campos: { registro?: string; ciudad?: string; grupo?: string; estado?: string };
  estadoVigente?: string;        // si se declara, solo cuentan los registros en ese estado
}
export interface ConfigEntidad { modelo: string; dominio: unknown[]; campos: Record<string, string>; lugar?: ConfigLugar }
export interface FiltroLugar { ciudades?: string[]; grupos?: string[] }
export interface Lugar { ciudad: string | null; grupo: string | null }

let contador = 0;
async function rpc(url: string, service: string, method: string, args: unknown[]) {
  const r = await fetch(url.replace(/\/+$/, '') + '/jsonrpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++contador, params: { service, method, args } }),
  });
  if (!r.ok) throw new Error(`Avancys respondió ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Avancys: ${j.error.data?.message ?? j.error.message ?? 'error'}`);
  return j.result;
}

export async function autenticar(c: ConexionOdoo): Promise<number> {
  const uid = await rpc(c.url, 'common', 'authenticate', [c.db, c.usuario, c.clave, {}]);
  if (!uid) throw new Error('Usuario o clave de Avancys no válidos');
  return uid as number;
}

export async function contar(c: ConexionOdoo, uid: number, cfg: ConfigEntidad): Promise<number> {
  return rpc(c.url, 'object', 'execute_kw', [c.db, uid, c.clave, cfg.modelo, 'search_count', [cfg.dominio], { context: { active_test: false } }]);
}

/** Trae todos los registros del modelo en páginas, incluidos los inactivos (para detectar retiros). */
export async function leerTodo(c: ConexionOdoo, uid: number, cfg: ConfigEntidad, pagina = 500): Promise<Record<string, unknown>[]> {
  const propios = cfg.lugar?.desde === 'propio'
    ? [cfg.lugar.campos.ciudad, cfg.lugar.campos.grupo].filter(Boolean) as string[]
    : [];
  const campos = [...new Set([...Object.values(cfg.campos), ...propios])];
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += pagina) {
    const lote = await rpc(c.url, 'object', 'execute_kw', [c.db, uid, c.clave, cfg.modelo, 'search_read', [cfg.dominio],
      { fields: campos, limit: pagina, offset, order: 'id', context: { active_test: false } }]) as Record<string, unknown>[];
    out.push(...lote);
    if (lote.length < pagina) return out;
  }
}

/**
 * Lee el lugar de cada registro desde otro modelo (el contrato, para los empleados) y lo deja
 * indexado por el id del registro. Si se declara `estadoVigente`, solo un registro en ese estado da
 * lugar: un empleado cuyo único contrato está cerrado queda sin lugar, el filtro lo descarta y el
 * cargue lo deja marcado para revisar en vez de retirarlo solo.
 */
export async function leerLugares(c: ConexionOdoo, uid: number, lugar: ConfigLugar, pagina = 500): Promise<Map<number, Lugar>> {
  const mapa = new Map<number, Lugar>();
  if (!lugar || lugar.desde === 'propio' || !lugar.campos.registro) return mapa;
  const campos = [lugar.campos.registro, lugar.campos.ciudad, lugar.campos.grupo, lugar.campos.estado].filter(Boolean) as string[];
  for (let offset = 0; ; offset += pagina) {
    const lote = await rpc(c.url, 'object', 'execute_kw', [c.db, uid, c.clave, lugar.desde, 'search_read', [[]],
      { fields: [...new Set(campos)], limit: pagina, offset, order: 'id', context: { active_test: false } }]) as Record<string, unknown>[];
    for (const r of lote) {
      const ref = r[lugar.campos.registro];
      if (!Array.isArray(ref)) continue;
      const id = Number(ref[0]);
      if (lugar.estadoVigente && String(r[lugar.campos.estado ?? ''] ?? '') !== lugar.estadoVigente) continue;
      mapa.set(id, {
        ciudad: texto(lugar.campos.ciudad ? r[lugar.campos.ciudad] : null),
        grupo: texto(lugar.campos.grupo ? r[lugar.campos.grupo] : null),
      });
    }
    if (lote.length < pagina) return mapa;
  }
}

/** El lugar del registro: propio o traído del modelo que lo tiene. */
function lugarDe(r: Record<string, unknown>, cfg: ConfigEntidad, lugares?: Map<number, Lugar>): Lugar | null {
  const l = cfg.lugar;
  if (!l) return null;
  if (l.desde === 'propio') {
    const ciudad = texto(l.campos.ciudad ? r[l.campos.ciudad] : null);
    const grupo = texto(l.campos.grupo ? r[l.campos.grupo] : null);
    return ciudad === null && grupo === null ? null : { ciudad, grupo };
  }
  return lugares?.get(Number(r.id)) ?? null;
}

const igual = (a: string | null, lista?: string[]) =>
  !!a && !!lista?.some((x) => normalizarTexto(x) === normalizarTexto(a));

/** ¿El filtro deja pasar este lugar? Un filtro vacío deja pasar todo. */
export function pasaFiltro(lugar: Lugar | null, filtro?: FiltroLugar): boolean {
  const pide = (filtro?.ciudades?.length ?? 0) + (filtro?.grupos?.length ?? 0) > 0;
  if (!pide) return true;
  if (!lugar) return false;
  return igual(lugar.ciudad, filtro?.ciudades) || igual(lugar.grupo, filtro?.grupos);
}

/**
 * Convierte registros de Odoo al formato del cargue usando el mapeo de la configuración y, si se
 * declara un filtro, deja solo los del lugar pedido. `sinLugar` cuenta los que el filtro descartó
 * porque no se les conoce el lugar (un empleado sin contrato vigente, por ejemplo).
 */
export function mapearRegistros(
  registros: Record<string, unknown>[],
  cfg: ConfigEntidad,
  entidad: 'empleados' | 'clientes',
  filtro?: FiltroLugar,
  lugares?: Map<number, Lugar>,
): { filas: Fila[]; descartadosPorCiudad: number; sinLugar: number } {
  const v = (r: Record<string, unknown>, campo: string) => (cfg.campos[campo] ? r[cfg.campos[campo]] : undefined);
  let descartados = 0;
  let sinLugar = 0;
  const filas: Fila[] = [];
  for (const r of registros) {
    const lugar = lugarDe(r, cfg, lugares);
    if (!pasaFiltro(lugar, filtro)) {
      descartados++;
      if (!lugar) sinLugar++;
      continue;
    }
    if (entidad === 'clientes') {
      const act = v(r, 'activo');
      filas.push({ nit: texto(v(r, 'nit')), razon_social: texto(v(r, 'razon_social')), activo: act === undefined ? null : Boolean(act) });
      continue;
    }
    filas.push({
      documento: texto(v(r, 'documento')),
      nombre: texto(v(r, 'nombre')),
      cargo: texto(v(r, 'cargo')),
      fecha_ingreso: normalizarFecha(v(r, 'fecha_ingreso')),
      fecha_retiro: normalizarFecha(v(r, 'fecha_retiro')),
      estado: normalizarEstado(v(r, 'activo')),
      telefono: texto(v(r, 'telefono')),
    });
  }
  return { filas, descartadosPorCiudad: descartados, sinLugar };
}


/**
 * Catálogo de patrones de turno de Avancys: `hr.roster.modalidad` con sus secuencias.
 * Cada modalidad es un ciclo de días; cada día apunta a un horario (`hr.roster.horario`), cuyo
 * nombre es el código del turno ("06:00-18:00") y "_" cuando es descanso.
 *
 * No son de una ciudad: 541 de 542 no declaran regional. Son de toda la empresa, y por eso entran
 * como patrones sin ciudad, que la política de seguridad ya deja ver a todos.
 */
export interface ConfigModalidades {
  modelo: string;            // hr.roster.modalidad
  secuencias: string;        // hr.roster.sequence
  horarios: string;          // hr.roster.horario
}
export interface PatronAvancys {
  avancys_id: number;
  codigo: string;
  ciclo: string[];           // un elemento por día: "0600-1800" o "_"; sirve para comparar
  dias: { tramos: { inicio: string; fin: string }[] }[];   // la forma que guarda Programación
  grupos: number;
  desfase: number;
}

/** Del ciclo compacto a la forma de `patrones_turno.dias`. Un "_" es un día de descanso. */
export function diasDesdeCiclo(ciclo: string[]) {
  return ciclo.map((d) => {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(d);
    return m ? { tramos: [{ inicio: `${m[1]}:${m[2]}`, fin: `${m[3]}:${m[4]}` }] } : { tramos: [] };
  });
}

const HHMM = /^(\d{1,2}):?(\d{2})\s*[-a]\s*(\d{1,2}):?(\d{2})$/;
/** El nombre del horario a "HHMM-HHMM", o null si no es un rango de horas (descanso o basura). */
export function tramoDeHorario(nombre: unknown): string | null {
  const s = texto(nombre)?.trim();
  if (!s) return null;
  const m = HHMM.exec(s);
  if (!m) return null;
  const dd = (h: string, mm: string) => `${String(Number(h)).padStart(2, '0')}${mm}`;
  return `${dd(m[1], m[2])}-${dd(m[3], m[4])}`;
}

export async function leerModalidades(c: ConexionOdoo, uid: number, cfg: ConfigModalidades): Promise<PatronAvancys[]> {
  const pagina = 500;
  const leer = async (modelo: string, campos: string[]) => {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await rpc(c.url, 'object', 'execute_kw', [c.db, uid, c.clave, modelo, 'search_read', [[]],
        { fields: campos, limit: pagina, offset, order: 'id', context: { active_test: false } }]) as Record<string, unknown>[];
      out.push(...lote);
      if (lote.length < pagina) return out;
    }
  };
  const horarios = new Map<number, string | null>();
  for (const h of await leer(cfg.horarios, ['name'])) horarios.set(Number(h.id), tramoDeHorario(h.name));
  const porModalidad = new Map<number, { orden: number; tramo: string | null }[]>();
  for (const s of await leer(cfg.secuencias, ['modalidad_id', 'horario_id', 'sequence'])) {
    const m = s.modalidad_id;
    if (!Array.isArray(m)) continue;
    const h = Array.isArray(s.horario_id) ? horarios.get(Number(s.horario_id[0])) ?? null : null;
    const lista = porModalidad.get(Number(m[0])) ?? [];
    lista.push({ orden: Number(s.sequence ?? 0), tramo: h });
    porModalidad.set(Number(m[0]), lista);
  }
  const out: PatronAvancys[] = [];
  for (const m of await leer(cfg.modelo, ['name', 'desfase', 'numero_personal'])) {
    const seq = porModalidad.get(Number(m.id));
    if (!seq || !seq.length) continue;                    // 19 modalidades no tienen ciclo: no entran
    const ciclo = [...seq].sort((a, b) => a.orden - b.orden).map((x) => x.tramo ?? '_');
    const codigo = texto(m.name);
    if (!codigo) continue;
    out.push({
      avancys_id: Number(m.id),
      codigo,
      ciclo,
      dias: diasDesdeCiclo(ciclo),
      grupos: Math.max(1, Number(m.numero_personal ?? 1) || 1),
      desfase: Number(m.desfase ?? 0) || 0,
    });
  }
  return out;
}


/**
 * Los puestos de Avancys. El puesto vive en `hr.roster.puesto`, pero su **ciudad** no está ahí:
 * está en la línea de la orden de servicio (`project.service.order.line.city_id`), que es lo que se
 * le vende al cliente. En Avancys el puesto es un objeto comercial, no de personal; por eso el
 * precio y la asignación viven en el mismo sitio. Medido el 2026-10-31: de 3.429 puestos con orden
 * activa, 1.035 traen ciudad, y **ninguno trae dos**.
 *
 * El cliente sale por el contrato (`cliente_contract_id` → `project.project.partner_id` → `ref_num`)
 * y el centro de costo del código de la cuenta analítica.
 */
export interface ConfigPuestos {
  modelo: string;        // hr.roster.puesto
  ordenes: string;       // project.service.order.line
  contratos: string;     // project.project
  terceros: string;      // res.partner
  cuentas: string;       // account.analytic.account
}
export interface PuestoAvancys {
  avancys_id: number;
  nombre: string;
  municipio: string | null;
  nit_cliente: string | null;
  centro_costo: string | null;
  direccion: string | null;
}

export async function leerPuestos(c: ConexionOdoo, uid: number, cfg: ConfigPuestos, pagina = 500): Promise<PuestoAvancys[]> {
  const leer = async (modelo: string, dominio: unknown[], campos: string[]) => {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += pagina) {
      const lote = await rpc(c.url, 'object', 'execute_kw', [c.db, uid, c.clave, modelo, 'search_read', [dominio],
        { fields: campos, limit: pagina, offset, order: 'id', context: { active_test: false } }]) as Record<string, unknown>[];
      out.push(...lote);
      if (lote.length < pagina) return out;
    }
  };
  // Municipio del puesto, desde las órdenes de servicio activas. Si una orden dice una ciudad y otra
  // dice otra, el puesto queda sin municipio: no se escoge una por mayoría.
  const municipio = new Map<number, string | null>();
  for (const o of await leer(cfg.ordenes, [['state', '=', 'active']], ['puesto_id', 'city_id'])) {
    if (!Array.isArray(o.puesto_id) || !Array.isArray(o.city_id)) continue;
    const id = Number(o.puesto_id[0]);
    const ciudad = String(o.city_id[1]);
    if (municipio.has(id) && municipio.get(id) !== ciudad) municipio.set(id, null);
    else if (!municipio.has(id)) municipio.set(id, ciudad);
  }
  const nitDe = new Map<number, string | null>();
  for (const t of await leer(cfg.terceros, [], ['ref_num'])) nitDe.set(Number(t.id), texto(t.ref_num));
  const clienteDelContrato = new Map<number, string | null>();
  for (const p of await leer(cfg.contratos, [], ['partner_id'])) {
    clienteDelContrato.set(Number(p.id), Array.isArray(p.partner_id) ? nitDe.get(Number(p.partner_id[0])) ?? null : null);
  }
  const codigoDeCuenta = new Map<number, string | null>();
  for (const a of await leer(cfg.cuentas, [], ['code'])) codigoDeCuenta.set(Number(a.id), texto(a.code));

  const out: PuestoAvancys[] = [];
  for (const p of await leer(cfg.modelo, [], ['code', 'name', 'direccion', 'cliente_contract_id', 'analytic_account_id'])) {
    const id = Number(p.id);
    // El `code` es la etiqueta corta y legible; el `name` es una descripción de hasta 259 caracteres.
    const nombre = texto(p.code) ?? texto(p.name)?.slice(0, 80) ?? null;
    if (!nombre) continue;
    out.push({
      avancys_id: id,
      nombre,
      municipio: municipio.get(id) ?? null,
      nit_cliente: Array.isArray(p.cliente_contract_id) ? clienteDelContrato.get(Number(p.cliente_contract_id[0])) ?? null : null,
      centro_costo: Array.isArray(p.analytic_account_id) ? codigoDeCuenta.get(Number(p.analytic_account_id[0])) ?? null : null,
      direccion: texto(p.direccion),
    });
  }
  return out;
}
