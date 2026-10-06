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
//   --profile-snapshot-hash <hex>] [--attempt N] [--reanalysis]
//
// --reanalysis (migration 108): the manifest admits a REANALYSIS whose source is the opportunity's current canonical
// AGT-002 analysis, read here; admission re-verifies it is still the canonical one.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { agt002InitialRequestedMembers, selectAgt002InitialDocuments } from '../agt002-initial-document-rule.js';

export { classifyAgt002InitialDocument } from '../agt002-initial-document-rule.js';

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
  const { included, excluded } = selectAgt002InitialDocuments(versions, extractions);
  const rows = [...included, ...excluded];
  let source = null;
  if (process.argv.includes('--reanalysis')) {
    const { data: canonical, error: canonicalError } = await db.from('psi_tender_analysis_runs')
      .select('id,analysis_kind,analysis_version,g1_scope,completed_at')
      .eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
      .not('analysis_kind', 'is', null).maybeSingle();
    if (canonicalError || !canonical) { console.error('No hay un análisis canónico AGT-002 vigente para reanalizar.'); process.exit(2); }
    source = canonical;
  }
  const tenderId = versions?.[0]?.tender_id;
  const manifest = {
    schema_version: 'agt002-initial-analysis-admission-v1',
    opportunity_id: opportunityId, tender_id: tenderId, actor_profile_id: actor,
    expires_at: '', policy_version: 'agt002-initial-analysis-policy-v1',
    scope,
    profile_snapshot_id: scope === 'A_PLUS_B' ? arg('profile-snapshot-id') : null,
    profile_snapshot_hash: scope === 'A_PLUS_B' ? arg('profile-snapshot-hash') : null,
    ...(arg('attempt') ? { attempt: Number(arg('attempt')) } : {}),
    ...(source ? { analysis_kind: 'REANALYSIS', source_analysis_run_id: source.id } : {}),
    documents: agt002InitialRequestedMembers(included),
  };
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  chmodSync(out, 0o600);
  const totalChars = included.reduce((sum, row) => sum + row.chars, 0);
  console.log(`${opportunity?.company_name}`);
  if (source) console.log(`Reanálisis: sucede al análisis vigente v${source.analysis_version} (${source.analysis_kind}, alcance ${source.g1_scope}, ${source.completed_at}) → quedará v${source.analysis_version + 1}`);
  console.log(`Incluidos ${included.length} de ${rows.length} · ${totalChars.toLocaleString('es-CO')} caracteres · ${Math.ceil(included.length / 12)} lote(s) · ~${Math.ceil(totalChars / 300000)} llamadas de lectura`);
  for (const row of included) console.log(`  + ${row.version.name} (${row.chars.toLocaleString('es-CO')})`);
  for (const row of excluded) console.log(`  - ${row.version.name}: ${row.reason}`);
  console.log(`Manifiesto: ${out} (expires_at vacío: lo fija quien autoriza)`);
}
