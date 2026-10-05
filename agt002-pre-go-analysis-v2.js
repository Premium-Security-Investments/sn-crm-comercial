// AGT-002 pre_go_analysis.v2: the schema of the FIRST (INITIAL) analysis. It is v1 minus the render
// manifest (the three rendered projections and their parity receipts do not exist yet when the first
// analysis is published and are produced by a later stage), with an optional evidence snapshot and an
// honest 'UNCLASSIFIED' vitality. v1 stays immutable and keeps governing REANALYSIS / G2 aggregates.
// The file schemas/agt002/pre_go_analysis.v2.schema.json is derived from v1 by deriveAgt002PreGoSchemaV2
// and a test keeps both in lock-step.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateAgainstPreGoSchema } from './agt002-pre-go-analysis-v1.js';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schemas', 'agt002');

export const AGT002_PRE_GO_ANALYSIS_V2 = 'pre_go_analysis.v2';

const NULLABLE_UUID = Object.freeze({ oneOf: [{ type: 'null' }, { $ref: '#/$defs/uuid' }] });

export function deriveAgt002PreGoSchemaV2(v1Schema) {
  const schema = structuredClone(v1Schema);
  schema.$id = 'https://premiumsecurity.ai/schemas/agt002/pre_go_analysis.v2.schema.json';
  schema.title = 'AGT-002 pre_go_analysis.v2';
  schema.required = schema.required.filter(key => key !== 'render_manifest');
  delete schema.properties.render_manifest;
  schema.$defs.meta.properties.schema_version = { const: AGT002_PRE_GO_ANALYSIS_V2 };
  schema.$defs.meta.properties.snapshot_id = structuredClone(NULLABLE_UUID);
  schema.$defs.evidencePackage.properties.snapshot_id = structuredClone(NULLABLE_UUID);
  const vitality = schema.$defs.evidencePackage.properties.member_refs.items.properties.vitality;
  vitality.enum = [...vitality.enum, 'UNCLASSIFIED'];
  return schema;
}

export const PRE_GO_SCHEMA_V2 = JSON.parse(
  readFileSync(path.join(SCHEMA_DIR, 'pre_go_analysis.v2.schema.json'), 'utf8'),
);

export function validatePreGoAnalysisV2(value, _context) {
  return validateAgainstPreGoSchema(PRE_GO_SCHEMA_V2, value);
}
