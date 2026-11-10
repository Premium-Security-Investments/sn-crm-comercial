// Mejora 9, primera parte (Juan, 2026-11-10; migración 198): el certificado de cada experiencia del RUP y la lista de a
// qué cliente pedírselo primero. No hay una carpeta con los certificados: hay que pedirlos, y un cliente cubre varios
// contratos (Jerónimo Martins 11, Matecaña 10, la UTP 9), así que la lista va por cliente y en orden de valor.

export const CERTIFICATE_STATUSES = Object.freeze({
  falta: 'Falta', pedido: 'Pedido', recibido: 'Recibido', incompleto: 'Incompleto', completo: 'Completo',
});
/** Lo que todavía hay que conseguir: lo que falta, y lo incompleto, que hay que pedir otra vez. */
const TO_REQUEST = new Set(['falta', 'incompleto']);

/** El cliente al que se le pide: sin el paréntesis («(Tiendas Ara)») ni la forma societaria. */
export function clientKey(name) {
  return String(name || '').replace(/\([^)]*\)/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|e\.?\s?s\.?\s?p\.?)(?=\s|$)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const statusOf = row => (Object.hasOwn(CERTIFICATE_STATUSES, row?.certificate_status || '') ? row.certificate_status : 'falta');
const smmlv = row => { const value = Number(row?.value_smmlv); return Number.isFinite(value) ? value : 0; };

/**
 * A quién pedirle certificados primero: los clientes con contratos sin certificado (o incompleto), ordenados por el valor
 * en SMMLV que se destraba, con el porcentaje acumulado del valor de toda la experiencia.
 */
export function certificateRequestPlan(experience, { limit = 10 } = {}) {
  const rows = Array.isArray(experience) ? experience : [];
  const total = rows.reduce((sum, row) => sum + smmlv(row), 0);
  const counts = Object.fromEntries(Object.keys(CERTIFICATE_STATUSES).map(key => [key, 0]));
  const clients = new Map();
  for (const row of rows) {
    const status = statusOf(row);
    counts[status] += 1;
    if (!TO_REQUEST.has(status)) continue;
    const key = clientKey(row.contracting_party);
    const client = clients.get(key) || { key, name: String(row.contracting_party || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim(), contracts: [], smmlv: 0 };
    client.contracts.push({ id: row.id, consecutive: row.rup_consecutive || (row.rup_number != null ? String(row.rup_number) : null), smmlv: smmlv(row), status, note: row.certificate_note || null });
    client.smmlv += smmlv(row);
    clients.set(key, client);
  }
  let accumulated = 0;
  const ordered = [...clients.values()]
    .map(client => ({ ...client, contracts: client.contracts.sort((a, b) => b.smmlv - a.smmlv) }))
    .sort((a, b) => b.smmlv - a.smmlv || b.contracts.length - a.contracts.length || a.name.localeCompare(b.name))
    .map(client => { accumulated += client.smmlv; return { ...client, share: total ? client.smmlv / total : 0, accumulated_share: total ? accumulated / total : 0 }; });
  return { total_contracts: rows.length, total_smmlv: total, counts, clients_to_request: ordered.length, top: ordered.slice(0, limit) };
}
