export const AGT002_F0A_SCHEMA_VERSION = 'f0a.v1';

export const AGT002_F0A_REQUIRED_SURFACES = Object.freeze([
  'origin_main',
  'vercel_production',
  'bridge',
  'radar_pipeline',
  'reanalysis_worker',
  'workbench_scheduler',
]);

export const AGT002_F0A_FREEZE_CANONICAL_SHA256 =
  'd7123520c4016a4963dfda7c36bdc5d5507f7ac0d5bb2b26c96193b1f95ef4b3';

function isSupabaseOrPsqlMigration(line) {
  return (
    /supabase\s+(db|migration)\b/i.test(line) ||
    /supabase\/migrations\//.test(line)
  );
}

function isKernelMigrationKthread(line) {
  return /\[migration\/\d+\]/.test(line) || /\bmigration\/\d+\b/.test(line);
}

export function classifyObservedProcess(line) {
  const supabaseOrPsql = isSupabaseOrPsqlMigration(line);
  if (isKernelMigrationKthread(line) && !supabaseOrPsql) {
    return 'kernel_kthread';
  }
  if (supabaseOrPsql) {
    return 'supabase_or_psql_migration';
  }
  return 'other';
}

export function findSupabaseOrPsqlMigrationRunners(lines) {
  return lines.filter((line) => classifyObservedProcess(line) === 'supabase_or_psql_migration');
}

function claimsPassLike(claims) {
  if (!claims || typeof claims !== 'object') {
    return false;
  }
  return (
    claims.f0a_pass === true ||
    claims.control_plane_reconciled === true ||
    claims.release_receipt === true
  );
}

export function validateAgt002F0aObservedReceipt(receipt) {
  const errors = [];

  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    return { ok: false, errors: ['receipt must be an object'] };
  }

  if (receipt.schema_version !== AGT002_F0A_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${AGT002_F0A_SCHEMA_VERSION}`);
  }

  if (!receipt.observed_at_utc) {
    errors.push('observed_at_utc is required');
  }

  if (
    !receipt.freeze_canonical_sha256 ||
    receipt.freeze_canonical_sha256 !== AGT002_F0A_FREEZE_CANONICAL_SHA256
  ) {
    errors.push('freeze_canonical_sha256 must match the canonical frozen manifest hash');
  }

  if (!receipt.origin_main_sha) {
    errors.push('origin_main_sha is required');
  }

  if (!receipt.surfaces || typeof receipt.surfaces !== 'object') {
    errors.push('surfaces is required');
  } else {
    for (const surface of AGT002_F0A_REQUIRED_SURFACES) {
      if (!(surface in receipt.surfaces)) {
        errors.push(`surfaces.${surface} is required`);
      }
    }
  }

  if (receipt.secrets === true) {
    errors.push('secrets must not be true');
  }

  if (receipt.env && typeof receipt.env === 'object') {
    for (const [key, value] of Object.entries(receipt.env)) {
      if (typeof value === 'string' && value.length > 0) {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY' || /KEY|TOKEN|SECRET|PASSWORD/i.test(key)) {
          errors.push(`env.${key} must not carry a non-empty secret value`);
        }
      }
    }
  }

  if (claimsPassLike(receipt.claims)) {
    errors.push('receipt must not claim f0a_pass, control_plane_reconciled, or release_receipt; F0-A is observation-only');
  }

  return { ok: errors.length === 0, errors };
}

export function assertAgt002F0aDoesNotClaimPass(receipt) {
  if (claimsPassLike(receipt?.claims)) {
    throw new Error(
      'AGT-002 F0-A receipt must not claim f0a_pass, control_plane_reconciled, or release_receipt',
    );
  }
}
