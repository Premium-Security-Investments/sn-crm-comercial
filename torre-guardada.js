// El último cálculo de Avancys para la Torre, guardado en la base (migración 231). La pantalla lo muestra al entrar,
// con su hora, mientras pide el cálculo en vivo (Juan, 2026-11-20). Sin tabla o sin base, todo sigue en vivo.
export const TABLA_GUARDADA = 'siio_torre_guardada';

export function claveDeRentabilidad(mes) {
  return /^\d{4}-\d{2}$/.test(String(mes || '')) ? `rentabilidad:${mes}` : null;
}

export async function leerGuardado(db, clave) {
  if (!db?.from || !clave) return null;
  try {
    const { data, error } = await db.from(TABLA_GUARDADA).select('datos,medido_en').eq('clave', clave).limit(1);
    if (error || !data?.length) return null;
    return { ...data[0].datos, medido_en: data[0].medido_en, desde_guardado: true };
  } catch {
    return null;
  }
}

/** Guarda un cálculo que salió bien. Un cálculo fallido o sin autenticar no reemplaza al último bueno. */
export async function guardar(db, clave, datos) {
  if (!db?.from || !clave || !datos || datos.legible === false || datos.autenticado === false || datos.configurado === false) return false;
  const { desde_memoria: _memoria, desde_guardado: _guardado, ...limpio } = datos;
  try {
    const { error } = await db.from(TABLA_GUARDADA).upsert({
      clave, datos: limpio, medido_en: datos.medido_en || new Date().toISOString(), guardado_en: new Date().toISOString(),
    }, { onConflict: 'clave' });
    return !error;
  } catch {
    return false;
  }
}
