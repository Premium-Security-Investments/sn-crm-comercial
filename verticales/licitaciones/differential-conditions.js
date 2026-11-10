// Mejora 10 (Juan, 2026-11-10; migración 200): las condiciones diferenciales de la empresa —empresa de mujeres, tamaño y
// personas con discapacidad en la nómina— en la ficha, y en cada licitación el aviso de dónde el pliego las premia
// (garantía más baja, puntaje o desempate). En Terminal se supo a un día del cierre que «empresa de mujeres» bajaba la
// garantía del 12 % al 10 %.
//
// El aviso sale de leer el texto de los documentos del proceso, sin modelo: busca las frases con que los pliegos
// nombran cada condición y muestra el fragmento. Los datos de la ficha los ponen Juan o Katherine.

export const DIFFERENTIAL_CONDITIONS = Object.freeze({
  empresa_mujeres: { label: 'Empresa de mujeres', help: 'Al menos 50 % de los cargos directivos ejercidos por mujeres con un año o más de vinculación (Decreto 1860 de 2021).' },
  tamano_empresarial: { label: 'Tamaño empresarial', help: 'Gran Empresa: no aplican los beneficios ni el desempate para Mipymes.' },
  discapacidad_nomina: { label: 'Personas con discapacidad en la nómina', help: 'Factor de desempate del artículo 35 de la Ley 2069 de 2020.' },
});
export const CONDITION_STATUSES = Object.freeze({ cumple: 'Cumple', no_cumple: 'No cumple', por_confirmar: 'Por confirmar' });
const CODES = Object.keys(DIFFERENTIAL_CONDITIONS);

function fail(message, status) { return Object.assign(new Error(message), { status }); }
const absent = error => ['PGRST205', '42P01'].includes(String(error?.code || ''));
const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || null;

/** Las tres condiciones, en orden; sin la migración 200, `installed: false`. */
export async function listDifferentialConditions(database) {
  const { data, error } = await database.from('psi_company_differential_conditions').select('code,status,value,detail,evidence,certified_on,updated_at');
  if (error) {
    if (absent(error)) return { installed: false, conditions: [] };
    throw error;
  }
  const byCode = new Map((data || []).map(row => [row.code, row]));
  return { installed: true, conditions: CODES.map(code => ({ code, ...DIFFERENTIAL_CONDITIONS[code], status: 'por_confirmar', value: null, detail: null, evidence: null, certified_on: null, ...(byCode.get(code) || {}) })) };
}

export async function saveDifferentialCondition(database, input, actorId) {
  const code = String(input?.code || '');
  if (!CODES.includes(code)) throw fail('La condición no es válida.', 400);
  const status = String(input?.status || 'por_confirmar');
  if (!Object.hasOwn(CONDITION_STATUSES, status)) throw fail('El estado no es válido.', 400);
  const certifiedOn = String(input?.certified_on || '');
  if (certifiedOn && !/^\d{4}-\d{2}-\d{2}$/.test(certifiedOn)) throw fail('La fecha no es válida.', 400);
  const row = {
    code, status, value: clip(input?.value, 100), detail: clip(input?.detail, 1000), evidence: clip(input?.evidence, 500),
    certified_on: certifiedOn || null, updated_by: actorId, updated_at: new Date().toISOString(),
  };
  const { data, error } = await database.from('psi_company_differential_conditions').upsert(row, { onConflict: 'code' }).select('code,status,value,detail,evidence,certified_on,updated_at').single();
  if (error) {
    if (absent(error)) throw fail('Las condiciones diferenciales aún no están habilitadas (falta aplicar la migración 200).', 409);
    throw error;
  }
  return data;
}

// Cómo nombran los pliegos cada condición. Mipyme va con el tamaño: es lo que no nos aplica por ser Gran Empresa.
const PATTERNS = {
  empresa_mujeres: /emprendimientos?\s+y\s+empresas\s+de\s+mujeres|empresas?\s+de\s+mujeres|emprendimientos?\s+de\s+mujeres/gi,
  tamano_empresarial: /mipymes?\b|micro\s*,?\s*pequeñas?\s+(?:y|o)\s+medianas?\s+empresas?/gi,
  discapacidad_nomina: /(?:personas?|trabajadores?|empleados?)\s+(?:en\s+(?:situación|condición)\s+de\s+|con\s+)discapacidad/gi,
};
// Fiscalía FGN-REC-IPSE-0058-2026 (adenda): el criterio diferencial para empresas de mujeres es de EXPERIENCIA
// («acreditar en el RUP la ejecución de hasta seis contratos…»), no de garantía ni de desempate.
const KIND_PATTERNS = [
  ['garantia', /garant[ií]a/i],
  ['desempate', /desempate|empate/i],
  ['puntaje', /puntaje|puntos?\b|ponderaci[oó]n/i],
  ['experiencia', /experiencia|contratos?\s+ejecutad/i],
];

/** El tipo de beneficio que sugiere el contexto del fragmento. */
function kindsOf(context) {
  return KIND_PATTERNS.filter(([, pattern]) => pattern.test(context)).map(([kind]) => kind);
}

/**
 * Dónde el pliego nombra cada condición: hasta `perCondition` fragmentos por condición, con el documento y el tipo de
 * beneficio (garantía, desempate, puntaje) que sugiere el contexto. Pura.
 */
export function findDifferentialMentions(documents, { perCondition = 3, radius = 220 } = {}) {
  const found = Object.fromEntries(CODES.map(code => [code, []]));
  for (const document of Array.isArray(documents) ? documents : []) {
    const text = String(document?.extracted_text || '');
    if (!text) continue;
    for (const code of CODES) {
      for (const match of text.matchAll(PATTERNS[code])) {
        const start = Math.max(0, match.index - radius);
        const end = Math.min(text.length, match.index + match[0].length + radius);
        const excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim();
        found[code].push({ document: document.name || 'Documento', excerpt: `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`, kinds: kindsOf(excerpt), key: excerpt.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '') });
      }
    }
  }
  // Primero lo que dice qué beneficio da (un pliego repite la definición legal muchas veces); sin repetir el mismo texto
  // aunque venga en varios documentos (pliego, estudio previo, evaluación).
  return Object.fromEntries(CODES.map(code => {
    const seen = new Set();
    const picked = [];
    for (const item of found[code].sort((a, b) => b.kinds.length - a.kinds.length)) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      picked.push({ document: item.document, excerpt: item.excerpt, kinds: item.kinds });
      if (picked.length >= perCondition) break;
    }
    return [code, picked];
  }));
}

/** Qué hacer con cada mención según lo que dice la ficha. Pura. */
export function assessDifferentialBenefits(conditions, mentions, { today = new Date() } = {}) {
  const byCode = new Map((conditions || []).map(condition => [condition.code, condition]));
  return CODES.filter(code => (mentions[code] || []).length).map(code => {
    const condition = byCode.get(code) || { status: 'por_confirmar' };
    const kinds = [...new Set(mentions[code].flatMap(item => item.kinds))];
    let verdict;
    let action;
    if (code === 'tamano_empresarial') {
      verdict = condition.value === 'gran_empresa' ? 'no_aplica' : condition.status === 'cumple' ? 'aplica' : 'por_confirmar';
      action = verdict === 'no_aplica' ? 'Somos Gran Empresa: lo que el pliego da a las Mipymes no nos aplica (ni garantía reducida ni desempate por tamaño).' : 'Confirmar el tamaño empresarial en la ficha.';
    } else if (condition.status === 'cumple') {
      verdict = 'aplica';
      const months = condition.certified_on ? (today - new Date(`${condition.certified_on}T00:00:00Z`)) / (30 * 864e5) : null;
      action = code === 'empresa_mujeres'
        ? `Calificamos. Preparar la certificación firmada con la fecha de cierre${condition.certified_on ? ` (la última es del ${condition.certified_on}${months !== null && months > 3 ? ', hay que actualizarla' : ''})` : ''}${kinds.includes('garantia') ? '; calcular la garantía con el porcentaje reducido' : ''}${kinds.includes('experiencia') ? '; revisar el requisito de experiencia diferencial' : ''}.`
        : 'Calificamos. Preparar el soporte que pide el pliego.';
    } else if (condition.status === 'no_cumple') {
      verdict = 'no_aplica';
      action = 'La ficha dice que no cumplimos esta condición.';
    } else {
      verdict = 'por_confirmar';
      action = 'El pliego la premia y en la ficha está por confirmar: confirmar antes del cierre.';
    }
    return { code, label: DIFFERENTIAL_CONDITIONS[code].label, verdict, kinds, action, mentions: mentions[code] };
  });
}
