import { readFileSync, writeFileSync } from 'node:fs';
import { observeAgt002Surfaces } from '../agt002-control-plane-observe.js';

function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function buildAgt002ObserveSurfacesResult({ inputPath, desiredSha, gitSha, readFile = readFileSync } = {}) {
  const observations = inputPath
    ? JSON.parse(readFile(inputPath, 'utf8'))?.surfaces ?? {}
    : {};

  if (gitSha) {
    observations.origin_main = { sha: gitSha, source: 'github_sha' };
  }

  return observeAgt002Surfaces({ desiredSha: desiredSha || null, observations });
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const args = process.argv.slice(2);
  const inputPath = readArgValue(args, '--input');
  const outPath = readArgValue(args, '--out');
  const desiredSha = readArgValue(args, '--desired-sha');
  const gitSha = readArgValue(args, '--git-sha');

  const result = buildAgt002ObserveSurfacesResult({ inputPath, desiredSha, gitSha });
  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    writeFileSync(outPath, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
}
