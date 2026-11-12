// Estudios de Seguridad Física: comparación con el estudio anterior (migración 212; Juan, 2026-11-12: "vamos adelante").
//
// Héctor Martínez (reunión del 2026-11-11): quien revisa "hace un comparativo con el estudio anterior: qué riesgos y
// cuál fue la escala, cómo se movieron los riesgos teniendo en cuenta el del año pasado". También sirve para saber si
// el cliente aplicó lo que se le recomendó.
//
// El estudio anterior es la ÚLTIMA VERSIÓN APROBADA de otro estudio del mismo cliente y sede (la foto congelada). Los
// riesgos se emparejan por el código de la lista base y, si no tienen, por el nombre. Si las dos metodologías no son la
// misma, las magnitudes no son comparables y se compara sólo el nivel, con aviso.

const LEVEL_RANK = Object.freeze({ bajo: 1, aceptable: 1, moderado: 2, tolerable: 2, alto: 3, critico: 4, inaceptable: 4 });
const normalize = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const missingColumn = error => error && (error.code === '42703' || error.code === 'PGRST204' || /previous_study_id/.test(error.message || '') || /does not exist|could not find/i.test(error.message || ''));
const day = value => (value ? new Date(value).toISOString().slice(0, 10) : null);

// Riesgos de la foto (snapshot) o del detalle vivo, en una sola forma.
export function riskShape(risk) {
  if (risk.valoracion) {
    return { numero: risk.numero, codigo: risk.catalogo || null, titulo: risk.riesgo, magnitud: risk.valoracion.actual.magnitud, nivel: risk.valoracion.actual.nivel, residual: risk.valoracion.residual.nivel };
  }
  return { numero: risk.number, codigo: risk.catalog_risk_code || null, titulo: risk.title, magnitud: risk.valuation.actual.magnitud, nivel: risk.valuation.actual.nivel, residual: risk.valuation.residual.nivel };
}

/** Empareja y clasifica: nuevo, ya no está, sube, baja o igual. */
export function compareRisks(previous, current, { sameMethodology = true } = {}) {
  const key = risk => (risk.codigo ? `c:${risk.codigo}` : `t:${normalize(risk.titulo)}`);
  const before = new Map();
  for (const risk of previous) if (!before.has(key(risk))) before.set(key(risk), risk);
  const seen = new Set();
  const rows = [];
  for (const risk of current) {
    const k = key(risk);
    const old = before.get(k) || (risk.codigo ? before.get(`t:${normalize(risk.titulo)}`) : null);
    if (!old) { rows.push({ estado: 'nuevo', actual: risk, anterior: null }); continue; }
    seen.add(key(old));
    const delta = sameMethodology ? risk.magnitud - old.magnitud : (LEVEL_RANK[risk.nivel] || 0) - (LEVEL_RANK[old.nivel] || 0);
    rows.push({ estado: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual', actual: risk, anterior: old });
  }
  for (const risk of previous) if (!seen.has(key(risk))) rows.push({ estado: 'ya_no_esta', actual: null, anterior: risk });
  const order = { sube: 0, nuevo: 1, ya_no_esta: 2, igual: 3, baja: 4 };
  rows.sort((a, b) => order[a.estado] - order[b.estado] || (a.actual?.numero ?? 99) - (b.actual?.numero ?? 99));
  const resumen = Object.fromEntries(['sube', 'baja', 'igual', 'nuevo', 'ya_no_esta'].map(state => [state, rows.filter(row => row.estado === state).length]));
  return { rows, resumen, mismaMetodologia: sameMethodology };
}

/** El estudio anterior candidato: el último aprobado del mismo cliente y la misma sede (por referencia o por nombre). */
export async function findPreviousStudy(db, study) {
  const { data, error } = await db.from('psi_security_studies').select('id, client_ref, site_ref, site_name, status').eq('client_ref', study.client_ref);
  if (error) throw error;
  const sameSite = row => row.id !== study.id && ['aprobado', 'archivado'].includes(row.status)
    && ((study.site_ref && row.site_ref === study.site_ref) || normalize(row.site_name) === normalize(study.site_name));
  const candidates = (data || []).filter(sameSite);
  if (!candidates.length) return null;
  const { data: versions, error: versionsError } = await db.from('psi_security_study_versions').select('study_id, approved_at').in('study_id', candidates.map(row => row.id));
  if (missingColumn(versionsError)) return null;
  if (versionsError) throw versionsError;
  const latest = (versions || []).sort((a, b) => new Date(b.approved_at) - new Date(a.approved_at))[0];
  return latest ? latest.study_id : null;
}

/** El estudio anterior escogido, validado: otro estudio aprobado del mismo cliente. */
export async function validatePrevious(db, study, previousId) {
  if (previousId === null || previousId === '') return null;
  if (previousId === study.id) throw Object.assign(new Error('Un estudio no puede ser su propio estudio anterior.'), { status: 400 });
  const { data, error } = await db.from('psi_security_studies').select('id, client_ref, status').eq('id', previousId).maybeSingle();
  if (error) throw error;
  if (!data || data.client_ref !== study.client_ref) throw Object.assign(new Error('El estudio anterior tiene que ser del mismo cliente.'), { status: 400 });
  if (!['aprobado', 'archivado'].includes(data.status)) throw Object.assign(new Error('El estudio anterior tiene que estar aprobado.'), { status: 409 });
  return previousId;
}

/** La comparación para la ficha: el estudio anterior (su última versión aprobada) frente a los riesgos de hoy. */
export async function loadComparison(db, study, currentRisks, currentMethodology) {
  if (!study.previous_study_id) return null;
  const [{ data: previous, error }, { data: versions, error: versionsError }, { data: actions, error: actionsError }] = await Promise.all([
    db.from('psi_security_studies').select('id, code, title, site_name').eq('id', study.previous_study_id).maybeSingle(),
    db.from('psi_security_study_versions').select('version, approved_at, methodology_id, snapshot').eq('study_id', study.previous_study_id).order('version', { ascending: false }).limit(1),
    db.from('psi_security_study_actions').select('id, status').eq('study_id', study.previous_study_id),
  ]);
  if (missingColumn(error) || missingColumn(versionsError)) return null;
  if (error) throw error;
  if (versionsError) throw versionsError;
  if (actionsError && !missingColumn(actionsError)) throw actionsError;
  const version = versions?.[0];
  if (!previous || !version) return null;
  const snapshot = version.snapshot;
  const comparison = compareRisks((snapshot.riesgos || []).map(riskShape), currentRisks.map(riskShape), { sameMethodology: version.methodology_id === currentMethodology });
  const now = new Map((actions || []).map(action => [action.id, action.status]));
  const number = new Map((snapshot.riesgos || []).map(risk => [risk.id, risk.numero]));
  return {
    estudio: { id: previous.id, codigo: previous.code, titulo: previous.title, version: version.version, aprobado: day(version.approved_at), metodologia: version.methodology_id },
    ...comparison,
    // Lo que se le recomendó la vez anterior y cómo está hoy (el seguimiento que pide Héctor).
    recomendaciones: (snapshot.acciones || []).filter(action => action.estado !== 'descartada').map(action => ({
      riesgo: number.has(action.riesgo) ? `R${number.get(action.riesgo)}` : '—', accion: action.accion,
      // Sólo el día: una fecha que llegue con hora (medianoche UTC) no puede correrse al día anterior en Colombia.
      a_cargo: action.a_cargo === 'cliente' ? 'cliente' : 'seguridad_nacional', fecha: action.fecha_compromiso ? day(action.fecha_compromiso) : null,
      estado: now.get(action.id) || action.estado,
    })),
  };
}

/** Lo que se congela en la versión aprobada. */
export function comparisonSnapshot(comparison) {
  if (!comparison) return null;
  return {
    estudio_anterior: { codigo: comparison.estudio.codigo, version: comparison.estudio.version, aprobado: comparison.estudio.aprobado, metodologia: comparison.estudio.metodologia },
    misma_metodologia: comparison.mismaMetodologia, resumen: comparison.resumen,
    riesgos: comparison.rows.map(row => ({
      estado: row.estado,
      actual: row.actual ? { numero: row.actual.numero, riesgo: row.actual.titulo, magnitud: row.actual.magnitud, nivel: row.actual.nivel } : null,
      anterior: row.anterior ? { numero: row.anterior.numero, riesgo: row.anterior.titulo, magnitud: row.anterior.magnitud, nivel: row.anterior.nivel } : null,
    })),
    recomendaciones_anteriores: comparison.recomendaciones,
  };
}
