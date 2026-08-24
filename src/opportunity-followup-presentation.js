export const INTERACTION_TYPE_LABELS = Object.freeze({
  llamada: 'Llamada', correo: 'Correo', reunion: 'Reunión', whatsapp: 'WhatsApp',
  nota: 'Nota', cambio_estado: 'Cambio de estado', documento: 'Documento',
});
export function capitalizeVisibleLabel(text) {
  const value = String(text ?? '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}
export function followUpInteractionTypeLabel(type) {
  const key = String(type ?? '');
  return Object.prototype.hasOwnProperty.call(INTERACTION_TYPE_LABELS, key)
    ? INTERACTION_TYPE_LABELS[key]
    : capitalizeVisibleLabel(key);
}
export function normalizeFollowUpText(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function isObservationCapturedInNotes(observaciones, interactions) {
  const needle = normalizeFollowUpText(observaciones);
  if (!needle || !Array.isArray(interactions) || !interactions.length) return false;
  return interactions.some(item => normalizeFollowUpText(item?.notes).includes(needle));
}
export function buildMigratedObservationEvent(opportunity) {
  const notes = opportunity?.observaciones;
  if (!String(notes ?? '').trim()) return null;
  const at = opportunity?.quote_date || opportunity?.created_at || null;
  return { id: 'observacion-migrada', interaction_type: 'nota', notes, occurred_at: at, created_at: at, actor_label: 'Migrado / sistema', psi_sales_profiles: null };
}
function sortKey(item) {
  const parsed = Date.parse(item?.occurred_at || item?.created_at || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}
export function buildFollowUpHistory(opportunity, interactions) {
  const visible = (Array.isArray(interactions) ? interactions : []).filter(i => i?.interaction_type !== 'documento');
  const migrated = buildMigratedObservationEvent(opportunity);
  const all = migrated && !isObservationCapturedInNotes(opportunity?.observaciones, visible) ? [...visible, migrated] : [...visible];
  return all.sort((a, b) => sortKey(b) - sortKey(a));
}
