// Aliados al día con los procesos (Juan, 2026-11-15; migración 223): «que ese listado se mantenga actualizado con todas
// las empresas que cada semana aparecen interesadas en los procesos que vamos a seguir analizando». Para cada proceso del
// CRM se leen en los datos abiertos de SECOP sus proponentes («Proponentes por proceso», hgi6-6wh3) y, por NIT, su
// contacto en «Proveedores registrados» (qmzu-gj57). Sólo empresas individuales e identificadas: una unión temporal o un
// consorcio no entra, ni un proponente sin NIT; una empresa que no está en la base entra sólo con teléfono o correo.
import { isJointVenture } from './tender-allies.js';

const PROPONENTS_URL = 'https://www.datos.gov.co/resource/hgi6-6wh3.json';
const SUPPLIERS_URL = 'https://www.datos.gov.co/resource/qmzu-gj57.json';
const NOT_GIVEN = /^(no definido|no provisto|no aplica|n\/a|sin informaci[oó]n|-|0+)$/i;

const clean = value => {
  const text = String(value ?? '').trim();
  return text && !NOT_GIVEN.test(text) ? text : null;
};
/** El NIT de SECOP sin puntos ni dígito de verificación pegado con guion; sólo dígitos, de 6 a 12. */
export function secopNit(value) {
  const text = clean(value);
  if (!text) return null;
  const digits = text.split('-')[0].replace(/\D/g, '');
  return /^[0-9]{6,12}$/.test(digits) ? digits : null;
}

/** De las filas de proponentes de un proceso, las empresas individuales con NIT, una vez cada una. Pura. */
export function individualProponents(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    const name = clean(row?.proveedor);
    const nit = secopNit(row?.nit_proveedor);
    if (!name || !nit || isJointVenture(name) || seen.has(nit)) continue;
    seen.set(nit, { nit, name });
  }
  return [...seen.values()];
}

/** El contacto de un proveedor registrado en SECOP: teléfono, correo y representante. Pura. */
export function supplierContact(row) {
  if (!row) return null;
  return { phone: clean(row.telefono) || clean(row.telefono_representante_legal), email: clean(row.correo) || clean(row.correo_representante_legal),
    representative: clean(row.nombre_representante_legal), name: clean(row.nombre) };
}

async function getJson(fetchImpl, url, params) {
  const query = new URLSearchParams(params).toString();
  const response = await fetchImpl(`${url}?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`datos.gov.co respondió ${response.status}`);
  return response.json();
}

/**
 * Una pasada: procesos del CRM con código de SECOP (`CO1.REQ.…`), sus proponentes y su contacto, y el registro en la base
 * con `psi_register_process_participant`. Devuelve el resumen; los errores de un proceso no paran los demás.
 */
export async function registerSecopProponents(database, { fetchImpl = fetch, log = () => {} } = {}) {
  const { data: tenders, error } = await database.from('psi_public_tenders')
    .select('process_id,entity,ref,converted_opportunity_id').not('converted_opportunity_id', 'is', null).like('process_id', 'CO1.REQ.%');
  if (error) throw error;
  const summary = { procesos: 0, proponentes: 0, empresas_nuevas: 0, participaciones_nuevas: 0, sin_contacto: 0, errores: [] };
  const contactCache = new Map();
  for (const tender of tenders || []) {
    summary.procesos += 1;
    try {
      const rows = await getJson(fetchImpl, PROPONENTS_URL, { id_procedimiento: tender.process_id, $limit: '500' });
      for (const proponent of individualProponents(rows)) {
        summary.proponentes += 1;
        if (!contactCache.has(proponent.nit)) {
          const suppliers = await getJson(fetchImpl, SUPPLIERS_URL, { nit: proponent.nit, $limit: '1' });
          contactCache.set(proponent.nit, supplierContact(suppliers?.[0]));
        }
        const contact = contactCache.get(proponent.nit) || {};
        const { data: result, error: rpcError } = await database.rpc('psi_register_process_participant', { p_payload: {
          nit: proponent.nit, name: proponent.name, phone: contact.phone, email: contact.email, representative: contact.representative,
          process_ref: tender.ref, entity: tender.entity, opportunity_id: tender.converted_opportunity_id, kind: 'oferto',
          detail: 'Presentó oferta (SECOP, proponentes por proceso).', source: `datos.gov.co hgi6-6wh3, ${tender.process_id}`,
        } });
        if (rpcError) throw rpcError;
        if (result?.status === 'empresa_nueva') { summary.empresas_nuevas += 1; summary.participaciones_nuevas += 1; }
        else if (result?.status === 'participacion_nueva') summary.participaciones_nuevas += 1;
        else if (result?.status === 'sin_contacto') summary.sin_contacto += 1;
      }
    } catch (failure) {
      summary.errores.push({ proceso: tender.process_id, error: String(failure?.message || failure).slice(0, 200) });
      log({ event: 'agt002_aliados_proponentes_error', process_id: tender.process_id });
    }
  }
  return summary;
}
