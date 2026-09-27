#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { createAgt002RadarWorker } from '../../agt002-radar-worker.js';
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

const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key){console.error(JSON.stringify({status:'unavailable',code:'AGT002_RADAR_ENTRYPOINT_CONFIG_INVALID'}));process.exitCode=1;}else{
 try{
  const database=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=()=>new Date().toISOString();
  const worker=createAgt002RadarWorker({database,environment:process.env,now});
  const result=await worker.runOnce();console.log(JSON.stringify(result));
 }
 catch{console.error(JSON.stringify({status:'unavailable',code:'AGT002_RADAR_ENTRYPOINT_FAILED'}));process.exitCode=1;}
}
