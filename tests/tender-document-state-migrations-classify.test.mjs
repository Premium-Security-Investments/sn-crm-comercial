import { strict as assert } from 'node:assert';
import { classify, prerequisitesOk } from '../scripts/tender-document-state-migrations.mjs';

const fullyPending = {
  t_company_docs: null, t_tender_doc_versions: null,
  fn_is_public_https_url: null, fn_record_company_doc: null, fn_record_tender_doc_version: null,
  grant_company_doc: false, grant_tender_doc_version: false,
  t_document_state: null, fn_begin_refresh: null, fn_record_snapshot_8arg: null, fn_go_no_go_8arg: null,
  trg_legacy: 0, trg_typed: 0, grant_begin_refresh: false, grant_foundation_ready: false,
  rls_company_docs: null, rls_tender_doc_versions: null, rls_document_state: null,
  grants_company_docs_unsafe: 0, grants_tender_doc_versions_unsafe: 0, grants_document_state_unsafe: 0,
};

const fullyApplied = {
  t_company_docs: 'psi_company_procurement_documents', t_tender_doc_versions: 'psi_tender_document_versions',
  fn_is_public_https_url: 'psi_is_public_https_url', fn_record_company_doc: 'psi_record_company_procurement_document',
  fn_record_tender_doc_version: 'psi_record_tender_document_version',
  grant_company_doc: true, grant_tender_doc_version: true,
  t_document_state: 'psi_tender_document_state', fn_begin_refresh: 'psi_begin_tender_document_refresh',
  fn_record_snapshot_8arg: 'psi_record_tender_document_snapshot', fn_go_no_go_8arg: 'psi_record_tender_go_no_go',
  trg_legacy: 1, trg_typed: 1, grant_begin_refresh: true, grant_foundation_ready: true,
  rls_company_docs: true, rls_tender_doc_versions: true, rls_document_state: true,
  grants_company_docs_unsafe: 0, grants_tender_doc_versions_unsafe: 0, grants_document_state_unsafe: 0,
};

{
  const result = classify(fullyPending);
  assert.deepEqual(result, { migration026: false, migration027: false, status: 'pending' });
}

{
  const result = classify(fullyApplied);
  assert.deepEqual(result, { migration026: true, migration027: true, status: 'applied' });
}

{
  // 026 applied, 027 not — the only real intermediate state (each migration is one transaction).
  const result = classify({ ...fullyApplied, ...fullyPending, ...{
    t_company_docs: fullyApplied.t_company_docs, t_tender_doc_versions: fullyApplied.t_tender_doc_versions,
    fn_is_public_https_url: fullyApplied.fn_is_public_https_url, fn_record_company_doc: fullyApplied.fn_record_company_doc,
    fn_record_tender_doc_version: fullyApplied.fn_record_tender_doc_version,
    grant_company_doc: true, grant_tender_doc_version: true,
    rls_company_docs: true, rls_tender_doc_versions: true,
    grants_company_docs_unsafe: 0, grants_tender_doc_versions_unsafe: 0,
  } });
  assert.equal(result.migration026, true);
  assert.equal(result.migration027, false);
  assert.equal(result.status, 'partial');
}

{
  // Grants revoked but structures present (e.g. mid-rollback) must not be misclassified as applied.
  const result = classify({ ...fullyApplied, grant_tender_doc_version: false });
  assert.equal(result.status, 'partial');
}

{
  // Missing exactly one trigger must not be misclassified as applied.
  const result = classify({ ...fullyApplied, trg_typed: 0 });
  assert.equal(result.status, 'partial');
}

{
  // RLS disabled on a 026 table (structures/grants otherwise intact) must not be misclassified as applied.
  const result = classify({ ...fullyApplied, rls_company_docs: false });
  assert.equal(result.migration026, false);
  assert.equal(result.status, 'partial');
}

{
  const result = classify({ ...fullyApplied, rls_tender_doc_versions: false });
  assert.equal(result.migration026, false);
  assert.equal(result.status, 'partial');
}

{
  // A stray grant to anon/authenticated/public on a 026 table must not be misclassified as applied.
  const result = classify({ ...fullyApplied, grants_company_docs_unsafe: 1 });
  assert.equal(result.migration026, false);
  assert.equal(result.status, 'partial');
}

{
  const result = classify({ ...fullyApplied, grants_tender_doc_versions_unsafe: 1 });
  assert.equal(result.migration026, false);
  assert.equal(result.status, 'partial');
}

{
  // RLS disabled on 027's document-state table must not be misclassified as applied.
  const result = classify({ ...fullyApplied, rls_document_state: false });
  assert.equal(result.migration027, false);
  assert.equal(result.status, 'partial');
}

{
  const result = classify({ ...fullyApplied, grants_document_state_unsafe: 2 });
  assert.equal(result.migration027, false);
  assert.equal(result.status, 'partial');
}

{
  const okRow = {
    t_go_no_go_decisions: 'x', t_snapshots: 'x', t_runs: 'x', t_opportunities: 'x', t_tenders: 'x',
    t_profiles: 'x', t_interactions: 'x', fn_safe_jsonb: 'x', fn_go_no_go_025: 'x',
  };
  assert.equal(prerequisitesOk(okRow), true);
  for (const key of Object.keys(okRow)) {
    assert.equal(prerequisitesOk({ ...okRow, [key]: null }), false, `missing ${key} must fail prerequisites`);
  }
}

console.log('tender document state migrations classify unit test passed');
