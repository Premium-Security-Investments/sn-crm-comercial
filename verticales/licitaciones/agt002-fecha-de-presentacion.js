// AGT-002 — mejora 6 (encargo desde Terminal): la fecha de presentación se pone sola.
//
// En Terminal (TT-SPO-07, 3-nov) la fecha se puso a mano en diez anexos, uno por uno, y la carta de presentación quedó
// sin ella porque el archivo estaba bloqueado. La línea «Ciudad, fecha» de un documento de la oferta es la ciudad de la
// sede principal y el día del cierre en Colombia: la pone el servidor, no el modelo.
//
// Sólo la línea de ciudad y fecha. Una fecha dentro del cuerpo («a los [DÍA] del mes de [MES]») no se toca: en Terminal
// el [MES] del período de aportes no era la fecha del documento y llenarlo con noviembre habría sido un error.

import { agt002FechaDeTrabajo } from './agt002-fecha-de-trabajo.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * El día del cierre. SECOP casi siempre da sólo la fecha (1.083 de 1.317 cierres, 2026-11-05), y el CRM la guarda como
 * medianoche UTC: Fiscalía cierra el 12-nov y `deadline_at` dice `2026-11-12 00:00Z`, que en Colombia sería el 11.
 * Por eso: una fecha sola se toma tal cual, y una medianoche UTC exacta también; sólo una hora real se lleva al día de
 * Colombia.
 */
export function agt002DiaDelCierre(cierre) {
  if (typeof cierre === 'string' && SOLO_FECHA.test(cierre.trim())) return cierre.trim();
  const instante = cierre ? new Date(cierre) : null;
  if (!instante || Number.isNaN(instante.getTime())) return null;
  if (instante.getUTCHours() === 0 && instante.getUTCMinutes() === 0 && instante.getUTCSeconds() === 0) return instante.toISOString().slice(0, 10);
  return agt002FechaDeTrabajo(instante).fecha;
}

/** «Pereira, 4 de noviembre de 2026» a partir de la ciudad y del cierre. */
export function agt002LineaCiudadFecha({ ciudad, cierre }) {
  const ciudadLimpia = typeof ciudad === 'string' ? ciudad.trim() : '';
  const dia = agt002DiaDelCierre(cierre);
  if (!ciudadLimpia || !dia) return null;
  const [anio, mes, numero] = dia.split('-').map(Number);
  return `${ciudadLimpia}, ${numero} de ${MESES[mes - 1]} de ${anio}`;
}

/** Lee la ciudad de la sede principal y el cierre del proceso. Sin alguno de los dos, devuelve null. */
export async function agt002LeerCiudadFechaDePresentacion(database, { tenderId }) {
  if (!database || typeof database.from !== 'function' || !tenderId) return null;
  const [sede, proceso] = await Promise.all([
    database.from('psi_company_sites').select('city').eq('is_main', true).limit(1).maybeSingle(),
    database.from('psi_public_tenders').select('deadline_at,raw').eq('id', tenderId).maybeSingle(),
  ]).catch(() => [null, null]);
  const raw = proceso?.data?.raw && typeof proceso.data.raw === 'object' ? proceso.data.raw : {};
  return agt002LineaCiudadFecha({ ciudad: sede?.data?.city, cierre: raw.deadline || proceso?.data?.deadline_at });
}

/**
 * Pone la línea de ciudad y fecha en el documento. Si no se pudo saber, la deja para decidir ([[ ]]) y lo dice.
 * Devuelve `{ document, aviso }`.
 */
export function agt002PonerFechaDePresentacion(document, lineaCiudadFecha) {
  if (!document || typeof document !== 'object') return { document, aviso: null };
  if (lineaCiudadFecha) return { document: { ...document, city_date: lineaCiudadFecha }, aviso: null };
  return {
    document: { ...document, city_date: '[[Ciudad y fecha de presentación]]' },
    aviso: 'La fecha de presentación quedó en amarillo: el proceso no tiene fecha de cierre registrada o falta la sede principal.',
  };
}
