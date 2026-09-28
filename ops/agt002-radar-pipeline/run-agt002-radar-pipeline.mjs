#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { buildRadarPipelineIdentity } from '../../agt002-control-plane-surface-builders.js';
import { resolveAgt002ReleaseArtifactEvidence } from '../../agt002-control-plane-runtime-evidence.js';

const RADAR_PIPELINE_RELATIVE_PATH = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';

// --control-plane: side-effect-free identity report, gated before any secret/client
// requirement below. Never trusts an env-var/config claim -- the sha/version are only ever
// reported when this exact script's realpath resolves into the immutable releases/<sha>/ tree
// (see agt002-control-plane-runtime-evidence.js); otherwise the surface stays honestly
// unobserved.
if (process.argv.includes('--control-plane')) {
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath: fileURLToPath(import.meta.url),
    relativePath: RADAR_PIPELINE_RELATIVE_PATH,
  });
  console.log(JSON.stringify(buildRadarPipelineIdentity({
    headSha: evidence.sha,
    version: evidence.version,
  })));
  process.exit(0);
}

// Retired: this entrypoint no longer claims a queue job, calls the provider bridge, or talks to
// Supabase. It reads no secret and no configuration. Any direct invocation outside
// --control-plane reports the retirement and exits cleanly with no side effects.
console.log(JSON.stringify({ status: 'retired', code: 'AGT002_RADAR_AI_RETIRED' }));
