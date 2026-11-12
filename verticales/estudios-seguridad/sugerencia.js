// Estudios de Seguridad Física: probabilidad sugerida por los datos (IEC 31010; Juan, 2026-11-11: "vamos a regirnos por
// la norma").
//
// La norma pide que cada término de probabilidad tenga un significado definido (con periodo y lugar) y que el juicio del
// analista se contraste con datos. Aquí:
//   · la escala de probabilidad queda anclada a frecuencias en la sede y antecedentes en la zona (PROBABILIDAD_ANCLADA);
//   · la plataforma SUGIERE una probabilidad con la estadística de delitos del estudio y las novedades de SecurityOps del
//     puesto en 12 meses; el analista decide, y si se aparta escribe por qué (estudios.js lo exige);
//   · sin datos no hay sugerencia: la calificación queda como "juicio sin dato".
// Es aproximada a propósito: SecurityOps clasifica las novedades por tipo, no por riesgo. Se dice en cada sugerencia.

import { ESCALAS } from './plantilla.js';

// La escala anclada vive en plantilla.js (la misma que ven la pantalla y el informe).
export const PROBABILIDAD_ANCLADA = ESCALAS.probabilidadSignificado;

const DELICTIVAS = Object.freeze(['seguridad', 'judicializacion', 'panico']);
// Qué datos cuentan para cada categoría de la lista base. `zona`: la estadística de delitos de la zona es antecedente.
const SENALES = Object.freeze({
  'Accesos y perímetro': { novedades: DELICTIVAS, zona: true },
  'Bienes, carga e instalaciones': { novedades: DELICTIVAS, zona: true },
  Personas: { novedades: DELICTIVAS, zona: true },
  Entorno: { novedades: DELICTIVAS, zona: true },
  'Medios técnicos y servicio': { novedades: ['tecnologia'], fallas: true, zona: false },
  Emergencias: { novedades: ['infraestructura'], zona: false },
  Información: null,
});
// Riesgos de la lista base para los que ni SecurityOps ni la estadística dicen nada útil.
const SIN_SENAL = new Set(['RB-13', 'RB-14', 'RB-15']);
const PROPIO = { novedades: DELICTIVAS, zona: true };

const TIPO = { seguridad: 'de seguridad', judicializacion: 'de judicialización', panico: 'de pánico', tecnologia: 'de tecnología', infraestructura: 'de infraestructura' };

function fromCount(count) {
  if (count >= 6) return 5;
  if (count >= 2) return 4;
  if (count === 1) return 3;
  return null;
}

/**
 * La probabilidad que sugieren los datos para un riesgo, o null si no hay datos.
 * `securityops`: lo que devuelve loadSecurityOps (data.summary de los últimos 12 meses); `crimeStats`: filas de estadística.
 */
export function suggestProbability({ catalogCode = null, catalog = null, securityops = null, crimeStats = [] }) {
  if (catalogCode && SIN_SENAL.has(catalogCode)) return null;
  const entry = catalogCode ? catalog?.riesgos?.find(item => item.codigo === catalogCode) : null;
  const signals = entry ? SENALES[entry.categoria] : PROPIO;
  if (!signals) return null;
  const summary = securityops?.data?.status === 'ok' ? securityops.data.summary : null;
  const zone = signals.zona && (crimeStats || []).length > 0;
  if (!summary && !zone) return null;

  const parts = [];
  let count = 0;
  if (summary) {
    const byType = summary.novedades?.por_tipo || {};
    for (const tipo of signals.novedades || []) {
      if (byType[tipo]) { count += byType[tipo]; parts.push(`${byType[tipo]} ${byType[tipo] === 1 ? 'novedad' : 'novedades'} ${TIPO[tipo]}`); }
    }
    if (signals.fallas && summary.fallas?.total) { count += summary.fallas.total; parts.push(`${summary.fallas.total} ${summary.fallas.total === 1 ? 'falla' : 'fallas'} de medios técnicos`); }
  }
  const fromSite = summary ? fromCount(count) : null;
  const probabilidad = fromSite ?? (zone ? 2 : 1);
  const source = [];
  if (summary) source.push(parts.length ? `SecurityOps, 12 meses: ${parts.join(', ')}` : 'SecurityOps, 12 meses: sin novedades de este tipo en el puesto');
  if (zone) source.push(`estadística de delitos de la zona (${crimeStats.length} ${crimeStats.length === 1 ? 'dato' : 'datos'})`);
  return { probabilidad, significado: PROBABILIDAD_ANCLADA[probabilidad - 1], fuente: source.join('; '), aproximada: true };
}

/**
 * Indicador por riesgo (Juan, 2026-11-12: "vamos con A"): después de aprobar, si las novedades de SecurityOps de la sede
 * en 12 meses ya corresponden a una probabilidad mayor que la calificada Y mayor que la que sugerían los datos al
 * calificar, los hechos cambiaron: hay que revalorar. Sólo cuenta lo de la sede (no la estadística de la zona) y no hay
 * umbral manual: la escala anclada es el umbral. Devuelve una entrada por riesgo que se quedó corto.
 */
export function riskIndicators({ risks = [], catalog = null, securityops = null }) {
  if (securityops?.data?.status !== 'ok') return [];
  const out = [];
  for (const risk of risks) {
    const now = suggestProbability({ catalogCode: risk.catalog_risk_code ?? null, catalog, securityops });
    // Sin conteos en la sede, suggestProbability cae a 1: eso no es un hecho nuevo.
    if (!now || now.probabilidad < 3) continue;
    if (now.probabilidad <= Number(risk.probability) || now.probabilidad <= Number(risk.suggested_probability || 0)) continue;
    out.push({
      riesgo: risk.number, titulo: risk.title, calificada: Number(risk.probability), hechos: now.probabilidad,
      detalle: `R${risk.number} ${risk.title} se calificó con probabilidad ${risk.probability}, pero los hechos ya corresponden a ${now.probabilidad} (${now.significado}; ${now.fuente}).`,
    });
  }
  return out;
}

/** Las sugerencias de todo el catálogo para la ficha: { propio, porCodigo }. */
export function suggestionsForStudy({ catalog, securityops, crimeStats }) {
  const porCodigo = {};
  for (const item of catalog?.riesgos || []) porCodigo[item.codigo] = suggestProbability({ catalogCode: item.codigo, catalog, securityops, crimeStats });
  return { propio: suggestProbability({ catalog, securityops, crimeStats }), porCodigo };
}
