# Inventario específico por licitación AGT-002 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la cobertura implícita del catálogo fijo por un inventario documental por snapshot que falle cerrado y pause decisiones no verificables.

**Architecture:** Un módulo puro crea/valida unidades, ledger y requisitos deterministas desde el expediente. El paquete de preview lo adjunta a evidencia; la persistencia lo revalida. La idempotencia se enlaza explícitamente a la versión y hashes del inventario sin modificar los validadores v3 de orden.

**Tech Stack:** Node.js ESM, `node:crypto`, `node:test`/assert, preview/persistencia AGT-002 existentes.

## Global Constraints

- No desplegar, push, PR, migraciones, DB, roles, secretos ni llamadas de proveedor.
- Una sola identidad Vig-IA; sin gates piloto, GO/NO-GO, compliance ni side effects de modelo.
- Mantener `v3_unit_ordering` y milestones sin relajar validadores.
- Los extractores fijos son señales suplementarias, nunca frontera ni cobertura integral.

---

### Task 1: Contrato puro de inventario y ledger

**Files:**
- Create: `tender-requirement-inventory.js`
- Test: `tests/tender-requirement-inventory.test.mjs`

**Interfaces:**
- Produces `buildTenderRequirementInventory({ snapshotId, documents, documentGaps })` y `validateTenderRequirementInventory(value)`.
- Consumes documentos con `document_id`, `document_version_id`, `content_hash`, `extracted_text` y gaps documentales.

- [ ] **Step 1: Write the failing test**

```js
const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-a', documents, documentGaps: [] });
assert.notEqual(inventory.requirements.length, 4);
assert.equal(inventory.decision_ready, false);
assert.equal(inventory.recommendation, 'pause');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tender-requirement-inventory.test.mjs`
Expected: FAIL because the inventory module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildTenderRequirementInventory(input) {
  const sourceUnits = buildSourceUnits(input);
  return validateTenderRequirementInventory(buildPausedInventory(sourceUnits));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tender-requirement-inventory.test.mjs`
Expected: PASS, including citation/hash, gap, historical-four and addenda cases.

- [ ] **Step 5: Commit**

```bash
git add tender-requirement-inventory.js tests/tender-requirement-inventory.test.mjs
git commit -m "fix(agt002): add fail-closed tender requirement inventory"
```

### Task 2: Preview/persistence/idempotency integration

**Files:**
- Modify: `agt002-preview-input.js`
- Modify: `agt002-preview-persistence.js`
- Modify: `agt002-preview-engine.js`
- Test: `tests/agt002-tender-specific-inventory-integration.test.mjs`

**Interfaces:**
- `document_evidence.tender_requirement_inventory` is server-derived and persisted in `evidence_coverage`.
- `computeAgt002PreviewIdempotencyKey` accepts optional inventory identity values.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(result.evidence_coverage.tender_requirement_inventory.recommendation, 'pause');
assert.notEqual(keyBeforeAddendum, keyAfterAddendum);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/agt002-tender-specific-inventory-integration.test.mjs`
Expected: FAIL because preview does not carry the contract.

- [ ] **Step 3: Write minimal implementation**

```js
const inventory = buildTenderRequirementInventory({ snapshotId, documents, documentGaps });
return { ...retrieval, tender_requirement_inventory: inventory };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/agt002-tender-specific-inventory-integration.test.mjs`
Expected: PASS with frozen input and revalidation before persistence.

- [ ] **Step 5: Commit**

```bash
git add agt002-preview-input.js agt002-preview-persistence.js agt002-preview-engine.js tests/agt002-tender-specific-inventory-integration.test.mjs
git commit -m "fix(agt002): persist fail-closed tender inventory"
```

### Task 3: Full verification

**Files:**
- Modify only if test evidence exposes a defect.

- [ ] **Step 1: Run focal tests**

Run: `node --test tests/tender-requirement-inventory.test.mjs tests/agt002-tender-specific-inventory-integration.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run all test files**

Run: `node --test tests/*.test.mjs`
Expected: PASS or report pre-existing unrelated failure exactly.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit final verified state**

```bash
git add docs/superpowers && git commit -m "docs(agt002): document tender-specific inventory"
```
