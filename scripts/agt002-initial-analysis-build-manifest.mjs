#!/usr/bin/env node
// AGT-002 INITIAL — builds an admission manifest with the document selection rule (no human picking).
//
// Rule (approved by the owner, 2026-10-06): every current official document with extracted text goes in, ordered by
// decision weight, EXCEPT types that do not define requirements or conditions (compressed quotes, BP/EBI investment
// files, the structuring-team designation, internal filings). Documents without extracted text cannot be read and are
// listed as excluded with their gap. Licitaciones can still add or remove documents by editing the manifest.
//
// READ-ONLY against the database; it only writes the manifest file. `expires_at` is left empty on purpose: the human
// who authorizes the run sets it (the authorization window is a human decision).
//
// Usage: ENV_FILE=/root/.agt002-prod.env node scripts/agt002-initial-analysis-build-manifest.mjs \
//   --opportunity <uuid> --actor <uuid> --out /root/manifest.json [--scope A|A_PLUS_B --profile-snapshot-id <uuid>
//   --profile-snapshot-hash <hex>] [--attempt N]
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const EXCLUDE = [
  [/cotizaci/i, 'cotizaciones de terceros: precios de referencia, no definen requisitos'],
  [/(^|[^a-z])(detallado\s+)?bp[-_ ]?\d|ficha[_ ]?ebi/i, 'ficha del proyecto de inversión (BP/EBI): no define requisitos del proceso'],
  [/designaci[oó]n\s+(del\s+)?equipo/i, 'designación del equipo estructurador: documento interno de la entidad'],
  [/^radicado|^\d{6,}\.pdf$/i, 'radicado u oficio interno sin requisitos'],
];

const INCLUDE = [
  [/adenda/i, 0, 'Adenda: modifica el pliego; prevalece sobre la versión anterior.'],
  [/pliego/i, 1, 'Pliego de condiciones: reglas, requisitos habilitantes, criterios de evaluación y causales de rechazo.'],
  [/respuesta|observaci/i, 2, 'Respuestas a observaciones: aclaran o modifican requisitos.'],
  [/aviso|convocatoria/i, 3, 'Aviso de convocatoria: datos del proceso y cronograma.'],
  [/estudios?[\s_]+previos?/i, 4, 'Estudios previos: necesidad, alcance, presupuesto, riesgos y garantías.'],
  [/anexo[\s_]+t[eé]cnico|especificaciones|esp\.?[\s_]+t[eé]cnicas|requerimiento[\s_]+t[eé]cnico/i, 5, 'Anexo técnico: especificaciones del servicio y obligaciones.'],
  [/matriz.*riesgo|riesgo/i, 6, 'Matriz de riesgos: asignación de riesgos entre las partes.'],
  [/experiencia/i, 7, 'Formato de experiencia: cómo se acredita la experiencia del proponente.'],
  [/oferta\s+econ|presupuesto|memoria\s+de\s+c[aá]lculo|estudio\s+de\s+mercado|costos?/i, 8, 'Oferta económica y presupuesto: estructura de precios y techos.'],
  [/an[aá]lisis\s+del\s+sector/i, 9, 'Análisis del sector: mercado, precios de referencia e indicadores exigidos.'],
  [/capacidad\s+financiera|financier/i, 10, 'Estudio de capacidad financiera: indicadores exigidos.'],
  [/anexo|formato/i, 11, 'Anexos y formatos de la propuesta: lo que se debe diligenciar y presentar.'],
  [/cdp|vigencia|hacienda|registro|disponibilidad/i, 12, 'Documento presupuestal (CDP, vigencias futuras, aprobación de Hacienda): respaldo y coherencia del presupuesto.'],
  [/concepto|matriz/i, 13, 'Concepto o matriz del proceso: soporte técnico o jurídico del proceso.'],
];

export function classifyAgt002InitialDocument({ name, hasText, gapReason }) {
  if (!hasText) return { include: false, reason: `sin texto extraído${gapReason ? ` (${gapReason})` : ''}: no se puede leer` };
  for (const [pattern, reason] of EXCLUDE) if (pattern.test(name)) return { include: false, reason };
  for (const [pattern, rank, reason] of INCLUDE) if (pattern.test(name)) return { include: true, rank, reason };
  return { include: true, rank: 14, reason: 'Documento oficial vigente del proceso.' };
}

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const direct = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (direct) {
  if (process.env.ENV_FILE) {
    for (const line of readFileSync(process.env.ENV_FILE, 'utf8').split('\n')) {
      const i = line.indexOf('='); if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  const opportunityId = arg('opportunity'); const actor = arg('actor'); const out = arg('out');
  const scope = arg('scope') || 'A';
  if (!opportunityId || !actor || !out?.startsWith('/')) { console.error('Faltan --opportunity, --actor y --out (ruta absoluta).'); process.exit(2); }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: opportunity } = await db.from('psi_sales_opportunities').select('id,company_name').eq('id', opportunityId).single();
  const { data: versions } = await db.from('psi_tender_document_versions').select('id,name,tender_id').eq('opportunity_id', opportunityId).eq('current', true);
  const { data: extractions } = await db.from('psi_tender_document_extractions').select('document_version_id,status,char_count,gap_reason,created_at').eq('opportunity_id', opportunityId);
  const latest = {};
  for (const e of extractions || []) if (!latest[e.document_version_id] || e.created_at > latest[e.document_version_id].created_at) latest[e.document_version_id] = e;
  const rows = (versions || []).map(version => {
    const extraction = latest[version.id];
    const hasText = extraction?.status === 'ok' && Number(extraction.char_count) > 0;
    return { version, chars: Number(extraction?.char_count || 0), ...classifyAgt002InitialDocument({ name: version.name, hasText, gapReason: extraction?.gap_reason }) };
  });
  const included = rows.filter(row => row.include).sort((a, b) => a.rank - b.rank || b.chars - a.chars);
  const excluded = rows.filter(row => !row.include);
  const tenderId = versions?.[0]?.tender_id;
  const manifest = {
    schema_version: 'agt002-initial-analysis-admission-v1',
    opportunity_id: opportunityId, tender_id: tenderId, actor_profile_id: actor,
    expires_at: '', policy_version: 'agt002-initial-analysis-policy-v1',
    scope,
    profile_snapshot_id: scope === 'A_PLUS_B' ? arg('profile-snapshot-id') : null,
    profile_snapshot_hash: scope === 'A_PLUS_B' ? arg('profile-snapshot-hash') : null,
    ...(arg('attempt') ? { attempt: Number(arg('attempt')) } : {}),
    documents: included.map(row => ({ document_version_id: row.version.id, source_classification: 'official', inclusion_reason: row.reason.slice(0, 500) })),
  };
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  chmodSync(out, 0o600);
  const totalChars = included.reduce((sum, row) => sum + row.chars, 0);
  console.log(`${opportunity?.company_name}`);
  console.log(`Incluidos ${included.length} de ${rows.length} · ${totalChars.toLocaleString('es-CO')} caracteres · ${Math.ceil(included.length / 12)} lote(s) · ~${Math.ceil(totalChars / 300000)} llamadas de lectura`);
  for (const row of included) console.log(`  + ${row.version.name} (${row.chars.toLocaleString('es-CO')})`);
  for (const row of excluded) console.log(`  - ${row.version.name}: ${row.reason}`);
  console.log(`Manifiesto: ${out} (expires_at vacío: lo fija quien autoriza)`);
}
