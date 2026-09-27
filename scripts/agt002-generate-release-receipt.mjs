import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FREEZE_CANONICAL_SHA256 = 'd7123520c4016a4963dfda7c36bdc5d5507f7ac0d5bb2b26c96193b1f95ef4b3';

const SURFACE_NAMES = [
  'origin_main',
  'vercel_production',
  'bridge',
  'radar_pipeline',
  'reanalysis_worker',
  'workbench_scheduler',
];

const MIGRATION_092_PATH = fileURLToPath(
  new URL('../supabase/migrations/092_agt002_f0b_chat_query_revoke.sql', import.meta.url),
);
const MIGRATION_094_PATH = fileURLToPath(
  new URL('../supabase/migrations/094_agt002_f0b2_rpc_hardening.sql', import.meta.url),
);

function sha256OfFile(path) {
  try {
    const bytes = readFileSync(path);
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function buildSurfaces(inputSurfaces = {}, gitSha = null) {
  const surfaces = {};
  for (const name of SURFACE_NAMES) {
    const provided = inputSurfaces[name];
    surfaces[name] = {
      sha: provided?.sha ?? null,
      version: provided?.version ?? null,
      source: provided?.source ?? 'unobserved',
    };
  }
  if (gitSha) {
    surfaces.origin_main = {
      sha: gitSha,
      version: surfaces.origin_main.version,
      source: 'github_sha',
    };
  }
  return surfaces;
}

export function generateAgt002ReleaseReceipt(input = {}) {
  if (input.freeze_canonical_sha256 !== undefined && input.freeze_canonical_sha256 !== FREEZE_CANONICAL_SHA256) {
    throw new Error(
      `freeze_canonical_sha256 mismatch: expected ${FREEZE_CANONICAL_SHA256}, got ${input.freeze_canonical_sha256}`,
    );
  }

  if (input.control_plane_reconciled === true) {
    throw new Error('control_plane_reconciled must never be true');
  }

  const migration092Sha256 = sha256OfFile(MIGRATION_092_PATH);
  const migration094Sha256 = sha256OfFile(MIGRATION_094_PATH);
  const gitSha = input.git_sha ?? process.env.GITHUB_SHA ?? null;
  // The single canonical release identity every one of the six surfaces is expected to be
  // running. Both fields are explicit immutable inputs (an env var GitHub Actions/the deployer
  // set for this run, or an explicit generator argument) -- never inferred from mutable git/disk
  // state. A missing version stays null here, which is exactly what keeps drift detection from
  // ever declaring PASS on an unversioned release.
  const desiredVersion = nonEmptyString(input.version ?? process.env.AGT002_DESIRED_VERSION ?? null);

  const receipt = {
    schema_version: 'agt002.release_receipt.v1',
    generated_at_utc: new Date().toISOString(),
    git_sha: gitSha,
    git_ref: input.git_ref ?? process.env.GITHUB_REF ?? null,
    freeze_canonical_sha256: FREEZE_CANONICAL_SHA256,
    control_plane_reconciled: false,
    desired: {
      sha: nonEmptyString(gitSha),
      version: desiredVersion,
    },
    surfaces: buildSurfaces(input.surfaces, gitSha),
  };

  if (migration092Sha256 && migration094Sha256) {
    receipt.migrations = {
      '092_agt002_f0b_chat_query_revoke.sql': { sha256: migration092Sha256 },
      '094_agt002_f0b2_rpc_hardening.sql': { sha256: migration094Sha256 },
    };
  }

  return receipt;
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const args = process.argv.slice(2);
  const readArg = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const outPath = readArg('--out') ?? null;
  const version = readArg('--version');
  const gitSha = readArg('--git-sha');

  const receipt = generateAgt002ReleaseReceipt({
    ...(version !== undefined ? { version } : {}),
    ...(gitSha !== undefined ? { git_sha: gitSha } : {}),
  });
  const json = JSON.stringify(receipt, null, 2);

  if (outPath) {
    writeFileSync(outPath, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
}
