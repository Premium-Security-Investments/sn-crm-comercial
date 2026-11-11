// Estudios de Seguridad Física: socialización con el cliente y enlace en línea (migración 206; Juan, 2026-11-11).
//
// Héctor Martínez (reunión del 2026-11-11): "hasta que no se socialice el informe, dentro del procedimiento está
// establecido que no ha sido entregado el estudio de seguridad". Lo presentan el analista y el coordinador. Juan pidió,
// además del PDF, un enlace donde el cliente vea su estudio en línea.
//
// El enlace muestra la versión APROBADA (la foto congelada), con el estado de hoy de cada recomendación. No muestra
// fotos, causas, nombres de personas ni nada que no esté en el informe que ya se le entrega. El token sólo se muestra
// una vez; la base guarda su huella. Vence (por defecto a 90 días), se puede anular, y cada apertura queda registrada
// sólo con la hora.
import { createHash, randomBytes } from 'node:crypto';
import { APPROVE_PERMISSION, REVIEW_PERMISSION } from './flujo.js';
import { METODOLOGIAS, METODOLOGIA_V1 } from './metodologia.js';
import { ESCALAS } from './plantilla.js';

const DELIVERIES = 'psi_security_study_deliveries';
const SHARES = 'psi_security_study_shares';
const VIEWS = 'psi_security_study_share_views';
const MEDIUMS = new Set(['presencial', 'virtual', 'correo']);
export const SHARE_DEFAULT_DAYS = 90;
export const SHARE_MAX_DAYS = 365;
export const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const missingTable = error => error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message || ''));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const holds = (profile, code) => Array.isArray(profile?.permissions) && profile.permissions.includes(code);
const bogotaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(value));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clean = (value, { field, min = 0, max }) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text && min === 0) return null;
  if (text.length < min || text.length > max) throw fail(`${field}: entre ${min} y ${max} caracteres.`);
  return text;
};

// Socializa y comparte quien preparó, revisa o aprueba (el analista y el coordinador presentan el estudio).
export function canDeliver(profile, study) {
  return profile?.id === study.prepared_by || holds(profile, REVIEW_PERMISSION) || holds(profile, APPROVE_PERMISSION);
}

async function latestVersion(db, studyId) {
  const { data, error } = await db.from('psi_security_study_versions').select('version, approved_at').eq('study_id', studyId).order('version', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function approvedVersionOrFail(db, study) {
  if (!['aprobado', 'archivado'].includes(study.status)) throw fail('El estudio no está aprobado.', 409);
  const version = await latestVersion(db, study.id);
  if (!version) throw fail('El estudio no tiene una versión aprobada.', 409);
  return version;
}

export async function recordDelivery(db, study, body = {}, profile, now = new Date()) {
  if (!canDeliver(profile, study)) throw fail('Sólo quien preparó, revisa o aprueba estudios registra la socialización.', 403);
  const version = await approvedVersionOrFail(db, study);
  const day = String(body.delivered_on || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) throw fail('Fecha de la socialización inválida.');
  // Días en Colombia: una socialización de las 8 p. m. no puede quedar al día siguiente.
  if (day > bogotaDay(now)) throw fail('La socialización no puede tener fecha futura: se registra cuando ya ocurrió.');
  if (version.approved_at && day < bogotaDay(version.approved_at)) throw fail('La socialización no puede ser anterior a la aprobación.');
  if (!MEDIUMS.has(body.medium)) throw fail('Medio: presencial, virtual o por correo.');
  const row = {
    study_id: study.id, version: version.version, delivered_on: day, medium: body.medium,
    presented_by: clean(body.presented_by, { field: 'Quién presentó', min: 2, max: 300 }),
    attendees: clean(body.attendees, { field: 'Asistentes del cliente', min: 2, max: 1000 }),
    support: clean(body.support, { field: 'Soporte', max: 1000 }),
    notes: clean(body.notes, { field: 'Observaciones', max: 2000 }),
    recorded_by: profile.id, recorded_at: now.toISOString(),
  };
  const { data, error } = await db.from(DELIVERIES).insert(row).select('*').single();
  if (error) {
    if (error.code === '23505' || /unique/i.test(error.message || '')) throw fail(`La versión ${version.version} ya tiene su socialización registrada.`, 409);
    throw error;
  }
  return data;
}

export async function createShare(db, study, body = {}, profile, now = new Date(), random = randomBytes) {
  if (!canDeliver(profile, study)) throw fail('Sólo quien preparó, revisa o aprueba estudios crea enlaces para el cliente.', 403);
  const version = await approvedVersionOrFail(db, study);
  const days = body.days === undefined || body.days === null || body.days === '' ? SHARE_DEFAULT_DAYS : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > SHARE_MAX_DAYS) throw fail(`Vigencia: de 1 a ${SHARE_MAX_DAYS} días.`);
  const token = random(32).toString('base64url');
  const row = {
    study_id: study.id, version: version.version, token_sha256: sha256(token),
    label: clean(body.label, { field: 'Para quién', max: 160 }),
    created_by: profile.id, created_at: now.toISOString(), expires_at: new Date(now.getTime() + days * 86400e3).toISOString(),
  };
  const { data, error } = await db.from(SHARES).insert(row).select('id, version, label, created_at, expires_at').single();
  if (error) throw error;
  // El token sale una sola vez: la base no lo puede volver a mostrar.
  return { ...data, token, path: `/api/estudios-seguridad/publico/${token}` };
}

export async function revokeShare(db, study, shareId, profile, now = new Date()) {
  if (!canDeliver(profile, study)) throw fail('Sólo quien preparó, revisa o aprueba estudios anula enlaces.', 403);
  const { data, error } = await db.from(SHARES).update({ revoked_at: now.toISOString(), revoked_by: profile.id }).eq('id', shareId).eq('study_id', study.id).is('revoked_at', null).select('id');
  if (error) throw error;
  if (!data?.length) throw fail('Ese enlace no existe o ya estaba anulado.', 404);
  return { revoked: true };
}

// Lo que ve la ficha: socializaciones y enlaces (sin token: sólo su huella vive en la base).
export async function loadDelivery(db, study, profile, now = new Date()) {
  const [deliveries, shares] = await Promise.all([
    db.from(DELIVERIES).select('*').eq('study_id', study.id).order('version', { ascending: false }),
    db.from(SHARES).select('id, version, label, created_at, expires_at, revoked_at').eq('study_id', study.id).order('created_at', { ascending: false }),
  ]);
  if (missingTable(deliveries.error) || missingTable(shares.error)) return { available: false, deliveries: [], shares: [], can: false };
  if (deliveries.error) throw deliveries.error;
  if (shares.error) throw shares.error;
  const ids = (shares.data || []).map(item => item.id);
  const views = ids.length ? await db.from(VIEWS).select('share_id, viewed_at').in('share_id', ids) : { data: [] };
  if (views.error) throw views.error;
  const byShare = new Map();
  for (const view of views.data || []) byShare.set(view.share_id, [...(byShare.get(view.share_id) || []), view.viewed_at]);
  return {
    available: true,
    can: canDeliver(profile, study) && ['aprobado', 'archivado'].includes(study.status),
    deliveries: deliveries.data || [],
    shares: (shares.data || []).map(item => {
      const seen = (byShare.get(item.id) || []).map(value => new Date(value).toISOString()).sort();
      const state = item.revoked_at ? 'anulado' : new Date(item.expires_at).getTime() <= now.getTime() ? 'vencido' : 'activo';
      return { ...item, state, views: seen.length, last_view: seen.at(-1) || null };
    }),
  };
}

// --- La página pública ------------------------------------------------------------------------------------------

const STATUS_WORD = { pendiente: 'Pendiente', en_curso: 'En curso', cumplida: 'Cumplida', descartada: 'Descartada' };
const NIVEL = { bajo: 'Bajo', moderado: 'Moderado', alto: 'Alto', critico: 'Crítico', aceptable: 'Aceptable', tolerable: 'Tolerable', inaceptable: 'Inaceptable' };

// Sólo lo que el cliente ya recibe en el informe, y el estado de hoy de cada recomendación.
export function publicView(snapshot, { version, approvedAt, actionsNow = [], delivery = null, expiresAt }) {
  const study = snapshot.estudio;
  const metodologia = METODOLOGIAS[study.metodologia] || METODOLOGIA_V1;
  const risks = [...(snapshot.riesgos || [])].sort((a, b) => a.numero - b.numero);
  const number = new Map(risks.map(risk => [risk.id, risk.numero]));
  const now = new Map(actionsNow.map(action => [action.id, action]));
  const count = key => Object.fromEntries(metodologia.niveles.map(item => [item.codigo, risks.filter(risk => risk.valoracion[key].nivel === item.codigo).length]));
  return {
    cliente: study.cliente?.nombre || '', sede: [study.sede?.nombre, study.sede?.ciudad].filter(Boolean).join(' · '),
    codigo: study.codigo, version, aprobado: approvedAt ? new Date(approvedAt).toISOString().slice(0, 10) : null,
    socializado: delivery?.delivered_on ? String(delivery.delivered_on).slice(0, 10) : null, vence: expiresAt,
    niveles: metodologia.niveles.map(item => ({ codigo: item.codigo, nombre: item.etiqueta })),
    resumen: { actual: count('actual'), residual: count('residual') },
    riesgos: risks.map(risk => ({
      codigo: `R${risk.numero}`, riesgo: risk.riesgo,
      actual: { magnitud: risk.valoracion.actual.magnitud, nivel: risk.valoracion.actual.nivel },
      residual: { magnitud: risk.valoracion.residual.magnitud, nivel: risk.valoracion.residual.nivel },
      probabilidad: risk.valoracion.actual.probabilidad, impacto: risk.valoracion.impacto,
    })),
    recomendaciones: (snapshot.acciones || []).filter(action => action.estado !== 'descartada').map(action => {
      const live = now.get(action.id);
      const status = live?.status || action.estado;
      return {
        riesgo: number.has(action.riesgo) ? `R${number.get(action.riesgo)}` : '—', accion: action.accion,
        a_cargo: (live?.responsible_party || action.a_cargo) === 'cliente' ? 'El cliente' : 'Seguridad Nacional',
        fecha: action.fecha_compromiso || null, estado: STATUS_WORD[status] || status,
      };
    }).filter(item => item.estado !== 'Descartada'),
  };
}

export async function resolvePublicStudy(db, token, now = new Date()) {
  if (!PUBLIC_TOKEN.test(String(token || ''))) return { ok: false, reason: 'invalido' };
  const { data: share, error } = await db.from(SHARES).select('id, study_id, version, expires_at, revoked_at').eq('token_sha256', sha256(token)).maybeSingle();
  if (error) {
    if (missingTable(error)) return { ok: false, reason: 'invalido' };
    throw error;
  }
  if (!share) return { ok: false, reason: 'invalido' };
  if (share.revoked_at) return { ok: false, reason: 'anulado' };
  if (new Date(share.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'vencido' };
  const [{ data: version, error: versionError }, { data: actions, error: actionsError }, { data: delivery }] = await Promise.all([
    db.from('psi_security_study_versions').select('version, snapshot, approved_at').eq('study_id', share.study_id).eq('version', share.version).maybeSingle(),
    db.from('psi_security_study_actions').select('id, status, responsible_party').eq('study_id', share.study_id),
    db.from(DELIVERIES).select('delivered_on').eq('study_id', share.study_id).eq('version', share.version).maybeSingle(),
  ]);
  if (versionError) throw versionError;
  if (actionsError) throw actionsError;
  if (!version) return { ok: false, reason: 'invalido' };
  await db.from(VIEWS).insert({ share_id: share.id, viewed_at: now.toISOString() });
  return { ok: true, view: publicView(version.snapshot, { version: version.version, approvedAt: version.approved_at, actionsNow: actions || [], delivery, expiresAt: new Date(share.expires_at).toISOString() }) };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const longDate = value => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`)) : '—');
const COLORS = { bajo: '#dcfce7', aceptable: '#dcfce7', moderado: '#fef9c3', tolerable: '#fef9c3', alto: '#ffedd5', critico: '#fee2e2', inaceptable: '#fee2e2' };
const badge = tramo => `<span class="n" style="background:${COLORS[tramo.nivel] || '#eee'}">${esc(tramo.magnitud)} · ${esc(NIVEL[tramo.nivel] || tramo.nivel)}</span>`;

const PAGE_STYLE = `body{margin:0;background:#f4f6fa;color:#172033;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px}.muted{color:#607089}
table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}th,td{border:1px solid #e2e8f0;padding:8px;text-align:left;vertical-align:top}
th{background:#1f3864;color:#fff}.n{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:700;white-space:nowrap}
.wrap{overflow-x:auto}footer{margin-top:28px;font-size:13px}
@media (max-width:600px){table,thead,tbody,tr,td{display:block;width:100%;box-sizing:border-box}thead{display:none}
tr{background:#fff;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;padding:6px 10px}td{border:0;padding:4px 0}
td::before{content:attr(data-label);display:block;font-size:12px;font-weight:700;color:#607089}}`;

export function renderPublicPage(result) {
  const head = title => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${PAGE_STYLE}</style></head><body><main>`;
  if (!result.ok) {
    const message = { vencido: 'Este enlace ya venció.', anulado: 'Este enlace fue anulado.', invalido: 'Este enlace no existe.' }[result.reason] || 'Este enlace no está disponible.';
    return `${head('Estudio de seguridad')}<div class="card"><h1>Estudio de seguridad</h1><p>${esc(message)} Pida uno nuevo a su coordinador de Seguridad Nacional Ltda.</p></div></main></body></html>`;
  }
  const v = result.view;
  const summary = key => v.niveles.map(item => `<span class="n" style="background:${COLORS[item.codigo]}">${esc(v.resumen[key][item.codigo] || 0)} ${esc(item.nombre.toLowerCase())}</span>`).join(' ');
  const risks = v.riesgos.map(item => `<tr><td data-label="Código">${esc(item.codigo)}</td><td data-label="Riesgo">${esc(item.riesgo)}</td><td data-label="Actual">${badge(item.actual)}</td><td data-label="Residual estimado">${badge(item.residual)}</td></tr>`).join('');
  const actions = v.recomendaciones.map(item => `<tr><td data-label="Riesgo">${esc(item.riesgo)}</td><td data-label="Recomendación">${esc(item.accion)}</td><td data-label="A cargo de">${esc(item.a_cargo)}</td><td data-label="Fecha compromiso">${esc(longDate(item.fecha))}</td><td data-label="Estado hoy">${esc(item.estado)}</td></tr>`).join('');
  return `${head(`Estudio de seguridad · ${v.cliente}`)}
<div class="card"><h1>Estudio de seguridad física</h1>
<p><strong>${esc(v.cliente)}</strong><br>${esc(v.sede)}</p>
<p class="muted">${esc(v.codigo)} · versión ${esc(v.version)} · aprobada el ${esc(longDate(v.aprobado))}${v.socializado ? ` · socializada el ${esc(longDate(v.socializado))}` : ''}</p></div>
<h2>Resumen</h2><div class="card"><p>Riesgo actual: ${summary('actual')}</p><p>Riesgo residual estimado: ${summary('residual')}</p>
<p class="muted">El residual es lo que se espera al implementar las recomendaciones; no es un resultado verificado.</p></div>
<h2>Riesgos identificados</h2><div class="wrap"><table><thead><tr><th>Código</th><th>Riesgo</th><th>Actual</th><th>Residual estimado</th></tr></thead><tbody>${risks}</tbody></table></div>
<h2>Recomendaciones y su estado</h2>${actions ? `<div class="wrap"><table><thead><tr><th>Riesgo</th><th>Recomendación</th><th>A cargo de</th><th>Fecha compromiso</th><th>Estado hoy</th></tr></thead><tbody>${actions}</tbody></table></div>` : '<p class="muted">El estudio no tiene recomendaciones con plan.</p>'}
<footer class="muted">Seguridad Nacional Ltda. · Información confidencial del cliente. Este enlace vence el ${esc(longDate(v.vence))}. El informe completo es el documento entregado en la socialización. Escalas: probabilidad ${esc(ESCALAS.probabilidad.join(', '))}; impacto ${esc(ESCALAS.impacto.join(', '))}.</footer>
</main></body></html>`;
}
