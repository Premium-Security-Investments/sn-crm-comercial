import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_RECEIPT_PATH = 'agt002-release-receipt.json';
const DEFAULT_OBSERVED_PATH = 'agt002-observed-surfaces.json';

export function checkAgt002Drift({ receipt, observed, githubSha = process.env.GITHUB_SHA }) {
  const drifts = [];
  const receiptSurfaces = receipt?.surfaces ?? {};
  const observedSurfaces = observed?.surfaces ?? {};

  for (const name of Object.keys(receiptSurfaces)) {
    const receiptSha = receiptSurfaces[name]?.sha;
    const observedSha = observedSurfaces[name]?.sha;

    if (typeof receiptSha === 'string' && typeof observedSha === 'string' && receiptSha !== observedSha) {
      drifts.push({
        surface: name,
        receipt_sha: receiptSha,
        observed_sha: observedSha,
      });
    }
  }

  const originMainReceiptSha = receiptSurfaces.origin_main?.sha;
  const originMainAlreadyChecked = typeof observedSurfaces.origin_main?.sha === 'string';
  if (
    !originMainAlreadyChecked &&
    typeof githubSha === 'string' &&
    githubSha.length > 0 &&
    typeof originMainReceiptSha === 'string' &&
    originMainReceiptSha !== githubSha
  ) {
    drifts.push({
      surface: 'origin_main',
      receipt_sha: originMainReceiptSha,
      observed_sha: githubSha,
    });
  }

  if (receipt?.control_plane_reconciled === true) {
    return { ok: false, drifts };
  }

  return { ok: drifts.length === 0, drifts };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const args = process.argv.slice(2);
  const receiptIndex = args.indexOf('--receipt');
  const observedIndex = args.indexOf('--observed');
  const receiptPath = receiptIndex >= 0 ? args[receiptIndex + 1] : DEFAULT_RECEIPT_PATH;
  const observedPath = observedIndex >= 0 ? args[observedIndex + 1] : DEFAULT_OBSERVED_PATH;

  const receipt = existsSync(receiptPath) ? readJson(receiptPath) : { surfaces: {} };
  const observed = existsSync(observedPath) ? readJson(observedPath) : { surfaces: {} };

  const result = checkAgt002Drift({ receipt, observed });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
