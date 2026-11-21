// Normaliza filas que vienen de Avancys (archivo exportado o conexión directa) al formato del cargue.
// Reconoce los encabezados más comunes y convierte fechas y estados.

export type Entidad = 'empleados' | 'clientes';
export type Fila = Record<string, unknown>;

/** Campos destino y los nombres de columna que se reconocen para cada uno (sin tildes, en minúscula). */
export const CAMPOS: Record<Entidad, { campo: string; etiqueta: string; requerido: boolean; sinonimos: string[] }[]> = {
  empleados: [
    { campo: 'documento', etiqueta: 'Documento', requerido: true, sinonimos: ['documento', 'cedula', 'identificacion', 'numero de identificacion', 'nro documento', 'num documento', 'cc', 'identification_id', 'no. identificacion', 'numero documento'] },
    { campo: 'tipo_documento', etiqueta: 'Tipo de documento', requerido: false, sinonimos: ['tipo documento', 'tipo de documento', 'tipo identificacion', 'tipo doc'] },
    { campo: 'nombre', etiqueta: 'Nombre completo', requerido: true, sinonimos: ['nombre', 'nombre completo', 'empleado', 'nombres y apellidos', 'apellidos y nombres', 'name', 'trabajador'] },
    { campo: 'cargo', etiqueta: 'Cargo', requerido: false, sinonimos: ['cargo', 'puesto de trabajo', 'job', 'job_id', 'oficio'] },
    { campo: 'fecha_ingreso', etiqueta: 'Fecha de ingreso', requerido: false, sinonimos: ['fecha ingreso', 'fecha de ingreso', 'ingreso', 'fecha inicio contrato', 'fecha inicio', 'first_contract_date', 'date_start'] },
    { campo: 'fecha_retiro', etiqueta: 'Fecha de retiro', requerido: false, sinonimos: ['fecha retiro', 'fecha de retiro', 'retiro', 'fecha fin contrato', 'fecha fin', 'date_end'] },
    { campo: 'estado', etiqueta: 'Estado', requerido: false, sinonimos: ['estado', 'activo', 'estado contrato', 'active', 'state'] },
    { campo: 'telefono', etiqueta: 'Celular', requerido: false, sinonimos: ['celular', 'telefono', 'movil', 'telefono movil', 'mobile_phone', 'mobile'] },
  ],
  clientes: [
    { campo: 'nit', etiqueta: 'NIT', requerido: true, sinonimos: ['nit', 'documento', 'identificacion', 'vat', 'nit cliente'] },
    { campo: 'razon_social', etiqueta: 'Razón social', requerido: true, sinonimos: ['razon social', 'nombre', 'cliente', 'tercero', 'name'] },
    { campo: 'activo', etiqueta: 'Activo', requerido: false, sinonimos: ['activo', 'estado', 'active'] },
  ],
};

export function normalizarTexto(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/** Propone qué columna del archivo corresponde a cada campo. */
export function detectarColumnas(encabezados: string[], entidad: Entidad): Record<string, string | null> {
  const norm = encabezados.map((h) => ({ h, n: normalizarTexto(String(h ?? '')) }));
  const usado = new Set<string>();
  const out: Record<string, string | null> = {};
  for (const c of CAMPOS[entidad]) {
    const sin = c.sinonimos.map(normalizarTexto);
    const exacta = norm.find((x) => !usado.has(x.h) && sin.includes(x.n));
    const parcial = exacta ?? norm.find((x) => !usado.has(x.h) && sin.some((s) => s.length > 3 && x.n.includes(s)));
    out[c.campo] = parcial?.h ?? null;
    if (parcial) usado.add(parcial.h);
  }
  return out;
}

/** Fecha a AAAA-MM-DD: acepta Date, número de serie de Excel, AAAA-MM-DD y DD/MM/AAAA. */
export function normalizarFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === '' || v === false) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Estado del empleado: 'activo' | 'retirado' | null (no se sabe). */
export function normalizarEstado(v: unknown): string | null {
  if (v === true) return 'activo';
  if (v === false) return 'retirado';
  const s = normalizarTexto(String(v ?? ''));
  if (!s) return null;
  if (['activo', 'activa', 'a', 'si', 'true', '1', 'vigente', 'open', 'en contrato'].includes(s)) return 'activo';
  if (['retirado', 'retirada', 'inactivo', 'inactiva', 'i', 'r', 'no', 'false', '0', 'liquidado', 'terminado', 'close', 'cancel'].includes(s)) return 'retirado';
  return null;
}

/** Valor de un many2one de Odoo ([id, "nombre"]) o texto simple. */
export function texto(v: unknown): string | null {
  if (v === null || v === undefined || v === false) return null;
  if (Array.isArray(v)) return v.length > 1 ? String(v[1]) : null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Convierte filas del archivo con el mapeo elegido al formato del cargue. */
export function mapearFilas(filas: Fila[], mapeo: Record<string, string | null>, entidad: Entidad): Fila[] {
  return filas.map((f) => {
    const val = (campo: string) => (mapeo[campo] ? f[mapeo[campo]!] : undefined);
    if (entidad === 'clientes') {
      const act = normalizarEstado(val('activo'));
      return { nit: texto(val('nit')), razon_social: texto(val('razon_social')), activo: act === null ? null : act === 'activo' };
    }
    const doc = val('documento');
    return {
      documento: typeof doc === 'number' ? String(Math.trunc(doc)) : texto(doc),
      tipo_documento: texto(val('tipo_documento')),
      nombre: texto(val('nombre')),
      cargo: texto(val('cargo')),
      fecha_ingreso: normalizarFecha(val('fecha_ingreso')),
      fecha_retiro: normalizarFecha(val('fecha_retiro')),
      estado: normalizarEstado(val('estado')),
      telefono: texto(val('telefono')),
    };
  }).filter((f) => Object.values(f).some((v) => v !== null && v !== undefined && v !== ''));
}

/**
 * Convierte la matriz de una hoja (filas de celdas) en filas con nombre de columna. La fila de títulos
 * es la primera con al menos 2 nombres reconocibles: así se saltan los títulos o logos de los reportes.
 */
export function filasDesdeMatriz(matriz: unknown[][], entidad: Entidad): { encabezados: string[]; filas: Fila[] } {
  const conocidos = CAMPOS[entidad].flatMap((c) => c.sinonimos.map(normalizarTexto));
  const reconoce = (v: unknown) => typeof v === 'string' && conocidos.some((s) => normalizarTexto(v) === s || (s.length > 3 && normalizarTexto(v).includes(s)));
  const idx = matriz.findIndex((r) => (r ?? []).filter(reconoce).length >= 2);
  if (idx < 0) throw new Error('No encontré una fila de títulos reconocible (documento, nombre…). Revise que la primera hoja tenga los títulos de las columnas.');
  const encabezados = (matriz[idx] ?? []).map((h, i) => (h === null || h === undefined || h === '' ? `Columna ${i + 1}` : String(h)));
  const filas = matriz.slice(idx + 1).map((r) => Object.fromEntries(encabezados.map((h, i) => [h, (r ?? [])[i] ?? null])));
  return { encabezados, filas };
}
