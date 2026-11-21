// Propone los servicios contratados de cada puesto a partir de cómo se programa hoy.
// Sirve de punto de partida cuando no hay contratos cargados: el administrador confirma o corrige.
//
// Día operativo: de 06:00 a 06:00 del día siguiente, en franjas de 30 minutos (48 franjas), para
// que un turno de 18:00 a 06:00 o un puesto de 24 h queden como un solo bloque.

export interface TurnoPuesto { puesto_id: number; inicio: string; fin: string }
export interface ServicioPropuesto { puesto_id: number; dias: number[]; hora_inicio: string; hora_fin: string; guardas: number }

const FRANJAS = 48;
const MIN = 30;
const msDia = 86400000;

function aMs(ts: string) { return Date.parse(ts.slice(0, 16).replace(' ', 'T') + ':00Z'); }
function fechaISO(ms: number) { return new Date(ms).toISOString().slice(0, 10); }
function isodow(fecha: string) { const d = new Date(fecha + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; }
function horaDeFranja(i: number) { const m = (6 * 60 + i * MIN) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

/** Vector de guardas presentes por franja para cada (puesto, día operativo). */
export function vectoresPorDia(turnos: TurnoPuesto[], desde: string, hasta: string) {
  const ini = aMs(desde + 'T06:00'), fin = aMs(hasta + 'T06:00') + msDia;
  const m = new Map<number, Map<string, number[]>>();
  for (const t of turnos) {
    const a = Math.max(aMs(t.inicio), ini), b = Math.min(aMs(t.fin), fin);
    if (b <= a) continue;
    const porDia = m.get(t.puesto_id) ?? m.set(t.puesto_id, new Map()).get(t.puesto_id)!;
    // franjas completamente cubiertas por el turno
    const primera = Math.ceil((a - ini) / (MIN * 60000)), ultima = Math.floor((b - ini) / (MIN * 60000));
    for (let k = primera; k < ultima; k++) {
      const dia = fechaISO(ini + Math.floor(k / FRANJAS) * msDia);
      const v = porDia.get(dia) ?? porDia.set(dia, new Array(FRANJAS).fill(0)).get(dia)!;
      v[k % FRANJAS]++;
    }
  }
  return m;
}

/** Valor más frecuente (en empate, el mayor: mejor sobrestimar lo contratado que dejarlo corto). */
function moda(xs: number[]) {
  const c = new Map<number, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((p, q) => q[1] - p[1] || q[0] - p[0])[0]?.[0] ?? 0;
}

export function inferirServicios(turnos: TurnoPuesto[], desde: string, hasta: string, festivos: Iterable<string> = []): ServicioPropuesto[] {
  const fest = new Set(festivos);
  const fechas: string[] = [];
  for (let ms = Date.parse(desde + 'T00:00:00Z'); ms <= Date.parse(hasta + 'T00:00:00Z'); ms += msDia) fechas.push(fechaISO(ms));
  const out: ServicioPropuesto[] = [];
  for (const [puesto, porDia] of vectoresPorDia(turnos, desde, hasta)) {
    // vector típico por día de la semana (sin festivos)
    const tipico = new Map<number, number[]>();
    for (let dow = 1; dow <= 7; dow++) {
      const dias = fechas.filter((f) => isodow(f) === dow && !fest.has(f));
      if (dias.length === 0) continue;
      const v = Array.from({ length: FRANJAS }, (_, k) => moda(dias.map((f) => porDia.get(f)?.[k] ?? 0)));
      if (v.some((x) => x > 0)) tipico.set(dow, v);
    }
    // agrupar días con el mismo vector
    const grupos = new Map<string, { dias: number[]; v: number[] }>();
    for (const [dow, v] of tipico) {
      const k = v.join(',');
      (grupos.get(k) ?? grupos.set(k, { dias: [], v }).get(k)!).dias.push(dow);
    }
    for (const { dias, v } of grupos.values()) {
      if (v.every((x) => x === v[0])) {
        out.push({ puesto_id: puesto, dias, hora_inicio: '06:00', hora_fin: '06:00', guardas: v[0] });
        continue;
      }
      let k = 0;
      while (k < FRANJAS) {
        if (v[k] === 0) { k++; continue; }
        let j = k;
        while (j < FRANJAS && v[j] === v[k]) j++;
        out.push({ puesto_id: puesto, dias, hora_inicio: horaDeFranja(k), hora_fin: horaDeFranja(j), guardas: v[k] });
        k = j;
      }
    }
  }
  return out;
}

/**
 * Separa las propuestas confiables de los "puestos" que en realidad agrupan varias sedes o tienen
 * horarios muy variables (más de `maxGuardas` al mismo tiempo o más de `maxServicios` servicios):
 * a esos no se les propone contrato hasta dividirlos en sedes reales.
 */
export function clasificarPropuestas(props: ServicioPropuesto[], maxGuardas = 3, maxServicios = 4) {
  const porPuesto = new Map<number, ServicioPropuesto[]>();
  props.forEach((p) => (porPuesto.get(p.puesto_id) ?? porPuesto.set(p.puesto_id, []).get(p.puesto_id)!).push(p));
  const confiables: ServicioPropuesto[] = [];
  const agrupados: { puesto_id: number; maxGuardas: number; servicios: number }[] = [];
  for (const [id, ps] of porPuesto) {
    const max = Math.max(...ps.map((p) => p.guardas));
    if (max <= maxGuardas && ps.length <= maxServicios) confiables.push(...ps);
    else agrupados.push({ puesto_id: id, maxGuardas: max, servicios: ps.length });
  }
  return { confiables, agrupados };
}
