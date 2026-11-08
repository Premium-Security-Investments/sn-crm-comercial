// F14 (auditoría Fiscalía; Juan, 2026-11-07 y 2026-11-08): un documento propio subido a un expediente puede traer un
// dato de la empresa; Vig-IA lo propone a la ficha y una persona con custodia lo confirma o lo descarta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { decideCompanyFactProposal, listPendingCompanyFactProposals, normalizeCompanyFactProposals, proposeCompanyFactsFromDocuments } from '../verticales/licitaciones/agt002-company-fact-proposals.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const KATHERINE = '8c172493-12aa-4be1-893a-2e5e93f7fba2';
const COMERCIAL = '44444444-4444-4444-8444-444444444444';
const OPP = '021c37ec-99f0-4151-b4b0-42dfb930c5c7';
const RCE = { entry_id: 'rce_policy', document_class: 'Póliza de responsabilidad civil extracontractual', vigencia_text: 'Póliza observada: 2026-02-06 a 2027-02-06', expiry: '2027-02-06' };
const ENV = Object.freeze({
  AGT002_WORKBENCH_RUNTIME: 'agt002_workbench_bridge_v1', AGT002_WORKBENCH_DRAIN_ENABLED: 'true', AGT002_WORKBENCH_MODEL: 'modelo',
  AGT002_HETZNER_BRIDGE_URL: 'https://puente.example.com/run', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
  AGT002_WORKBENCH_AGENT_ID: '33333333-3333-4333-8333-333333333333', AGT002_WORKBENCH_WORKER_ID: 'prueba',
});
const PROPUESTA = { entry_id: 'rce_policy', summary: 'RCE de 400 SMMLV ($700.362.000)', proposed_vigencia_text: 'RCE 400 SMMLV ($700.362.000); vigencia 2026-02-06 a 2027-01-01', proposed_expiry: '2027-01-01', why: 'La póliza leída dice 01-01-2027; la ficha dice 06-02-2027.' };

async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', role text not null, full_name text);
    create table public.psi_access_permissions (code text primary key, name text not null default '', description text, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null, permission_code text not null, primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_agt002_company_evidence_registry (id uuid primary key default gen_random_uuid(), entry_id text not null, version integer not null, current boolean not null,
      document_class text not null, source_reference text not null, existence_status text not null, human_review_status text not null, vigencia_text text not null, expiry date,
      integration_active boolean not null default true, decision_humana text, decision_humana_fecha date, decision_humana_por uuid, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create function public.psi_profile_has_tender_custody(p uuid) returns boolean language sql as $$ select exists (select 1 from psi_profile_permissions where profile_id = p and permission_code = 'licitaciones_custodia') $$;
    insert into public.psi_access_permissions(code) values ('licitaciones'), ('licitaciones_custodia');
    insert into public.psi_sales_profiles(id,role,full_name) values ('${KATHERINE}','comercial','Katherine Valencia Buitrago'), ('${COMERCIAL}','comercial','Otra');
    insert into public.psi_profile_permissions values ('${KATHERINE}','licitaciones'), ('${KATHERINE}','licitaciones_custodia'), ('${COMERCIAL}','licitaciones');
    insert into public.psi_sales_opportunities values ('${OPP}');
    insert into public.psi_agt002_company_evidence_registry (entry_id, version, current, document_class, source_reference, existence_status, human_review_status, vigencia_text, expiry)
      values ('rce_policy', 1, true, '${RCE.document_class}', 'manifiesto 061', 'reported', 'pending_human_review', '${RCE.vigencia_text}', '2027-02-06');
  `);
  await pg.exec(read('supabase/migrations/192_empresa_propuestas_desde_procesos.sql'));
  return pg;
}

function client(pg) {
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      try {
        const r = await pg.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => (args[k] && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])));
        return { data: r.rows[0].r, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
    from(table) {
      const q = { where: [], vals: [] };
      const run = async () => {
        try {
          const sel = table === 'psi_company_fact_proposals' ? `p.*, json_build_object('full_name', s.full_name) as actor from psi_company_fact_proposals p left join psi_sales_profiles s on s.id = p.actor_id` : `* from ${table}`;
          const rows = (await pg.query(`select ${sel}${q.where.length ? ' where ' + q.where.join(' and ') : ''}`, q.vals)).rows;
          return { data: rows, error: null };
        } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
      };
      const chain = {
        select() { return chain; },
        eq(column, value) { q.vals.push(value); q.where.push(`${column} = $${q.vals.length}`); return chain; },
        order() { return chain; },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return chain;
    },
  };
}

const bridge = output => ({ seen: [], async run(args) { this.seen.push(args); return { content: JSON.stringify(output) }; } });

test('caso Supersalud: la póliza subida al expediente propone a la ficha, y confirmar crea la versión nueva del bloque', async () => {
  const pg = await db();
  const database = client(pg);
  const bridgeClient = bridge({ propuestas: [PROPUESTA, { ...PROPUESTA, entry_id: 'inventado' }] });
  const outcome = await proposeCompanyFactsFromDocuments(database, {
    opportunityId: OPP, actorId: KATHERINE, sourceLabel: 'SNS-LP-2-2026 · Supersalud',
    documents: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Poliza RCE.pdf', extracted_text: 'Valor asegurado 400 SMMLV ... hasta el 01/01/2027' }],
    environment: ENV, bridgeClient, log: () => {},
  });
  assert.deepEqual(outcome, { status: 'ran', proposed: 1 });
  assert.equal(bridgeClient.seen[0].input.ficha[0].vigencia_text, RCE.vigencia_text, 'el modelo ve lo que hoy dice la ficha');
  const pending = await listPendingCompanyFactProposals(database);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].uploaded_by_name, 'Katherine Valencia Buitrago');

  await assert.rejects(decideCompanyFactProposal(database, { actorId: COMERCIAL, proposalId: pending[0].id, decision: 'confirmada' }), error => error.status === 403);
  const decided = await decideCompanyFactProposal(database, { actorId: KATHERINE, proposalId: pending[0].id, decision: 'confirmada' });
  assert.equal(decided.registry_version, 2);
  const rows = (await pg.query(`select version, current, vigencia_text, expiry::text, existence_status, human_review_status, decision_humana from psi_agt002_company_evidence_registry order by version`)).rows;
  assert.deepEqual(rows.map(r => [r.version, r.current]), [[1, false], [2, true]]);
  assert.equal(rows[1].vigencia_text, PROPUESTA.proposed_vigencia_text);
  assert.equal(rows[1].expiry, '2027-01-01');
  assert.deepEqual([rows[1].existence_status, rows[1].human_review_status], ['verified', 'approved']);
  assert.match(rows[1].decision_humana, /Confirmado por Katherine.*Supersalud/);
  assert.equal((await listPendingCompanyFactProposals(database)).length, 0);
  await assert.rejects(decideCompanyFactProposal(database, { actorId: KATHERINE, proposalId: pending[0].id, decision: 'descartada' }), error => error.status === 409);
  await pg.close();
});

test('descartar no toca la ficha; si la ficha cambió después, confirmar se rechaza', async () => {
  const pg = await db();
  const database = client(pg);
  const p1 = (await database.rpc('psi_propose_company_fact', { p_actor_id: KATHERINE, p_payload: PROPUESTA })).data;
  const p2 = (await database.rpc('psi_propose_company_fact', { p_actor_id: KATHERINE, p_payload: { ...PROPUESTA, proposed_vigencia_text: 'otra' } })).data;
  await decideCompanyFactProposal(database, { actorId: KATHERINE, proposalId: p1.id, decision: 'descartada' });
  assert.equal((await pg.query(`select count(*)::int n from psi_agt002_company_evidence_registry`)).rows[0].n, 1);
  await pg.exec(`update psi_agt002_company_evidence_registry set vigencia_text = 'cambió a mano'`);
  await assert.rejects(decideCompanyFactProposal(database, { actorId: KATHERINE, proposalId: p2.id, decision: 'confirmada' }), /cambió/);
  await assert.rejects(pg.exec(`delete from psi_company_fact_proposals`), /no se editan/);
  await pg.close();
});

test('el modelo no puede proponer un bloque inexistente ni repetir lo que la ficha ya dice', () => {
  const out = normalizeCompanyFactProposals({ propuestas: [
    { entry_id: 'rce_policy', summary: 'igual', proposed_vigencia_text: RCE.vigencia_text, proposed_expiry: '2027-02-06' },
    { entry_id: 'nada', summary: 'x', proposed_vigencia_text: 'x', proposed_expiry: '' },
    { ...PROPUESTA, proposed_expiry: '01/01/2027' },
  ] }, [RCE]);
  assert.equal(out.length, 1);
  assert.equal(out[0].proposed_expiry, null, 'una fecha mal escrita no se adivina');
});

test('sin documentos propios o con la Mesa apagada no llama al modelo; una falla no rompe la carga', async () => {
  const never = { run: () => { throw new Error('no debía llamarse'); } };
  assert.equal((await proposeCompanyFactsFromDocuments({}, { documents: [], environment: ENV, bridgeClient: never })).reason, 'sin_documentos_propios');
  assert.equal((await proposeCompanyFactsFromDocuments({}, { documents: [{ id: 'x', extracted_text: 'a' }], environment: {}, bridgeClient: never })).reason, 'apagada');
  const roto = { from() { throw Object.assign(new Error('caída'), { code: 'X' }); } };
  assert.deepEqual(await proposeCompanyFactsFromDocuments(roto, { documents: [{ id: 'x', extracted_text: 'a' }], environment: ENV, bridgeClient: never, log: () => {} }), { status: 'failed', code: 'X' });
});

test('la carga de documentos propios llama a la propuesta, y Empresa la muestra con Confirmar y Descartar', () => {
  const server = read('server/index.js');
  const ingest = server.slice(server.indexOf('export async function ingestTenderDossierDocuments'), server.indexOf("app.post('/api/tender-documents-upload'"));
  assert.match(ingest, /item\.origin === 'propio'/);
  assert.match(ingest, /proposeCompanyFactsFromDocuments\(/);
  assert.match(server, /'POST \/api\/tender-company-fact-proposals\/decision': \['tenders', ACTIONS\.LICITACIONES_COMPANY_EVIDENCE_DECIDE\]/);
  assert.equal(server, read('api/[...path].js'));
  const view = read('src/tenders/TenderConfigurationView.tsx');
  assert.ok(view.indexOf('<CompanyFactProposals') < view.indexOf('<CompanyBlocksTable'));
  const panel = read('src/tenders/components/CompanyFactProposals.tsx');
  assert.ok(panel.includes('>Confirmar<') && panel.includes('>Descartar<'));
});
