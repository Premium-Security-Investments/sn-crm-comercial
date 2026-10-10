#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { financialSourceReadiness, FinancialConnectorError, validateFinancialSource } from '../siio-financial-connectors.js';
import { stageFinancialSource } from '../siio-financial-source-stage.js';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['check-config', 'stage'].includes(command)) throw new FinancialConnectorError('USAGE_CHECK_CONFIG_OR_STAGE');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--config', '--source', '--period', '--cutoff', '--output'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(options, key)) throw new FinancialConnectorError('INVALID_CLI_ARGUMENTS');
    options[key] = args[index + 1];
  }
  if (!options['--config']) throw new FinancialConnectorError('CONFIG_PATH_REQUIRED');
  let config;
  try { config = JSON.parse(await readFile(options['--config'], 'utf8')); } catch { throw new FinancialConnectorError('CONFIG_READ_FAILED'); }
  if (config.version !== 1 || !Array.isArray(config.sources) || !config.sources.length || config.sources.length > 20 || new Set(config.sources.map(source => source.id)).size !== config.sources.length) throw new FinancialConnectorError('INVALID_SOURCE_REGISTRY');
  config.sources.forEach(validateFinancialSource);
  if (command === 'check-config') {
    console.log(JSON.stringify({ state: 'local_config_check_only', sources: config.sources.map(source => financialSourceReadiness(source)), network_calls: 0 }, null, 2));
    return;
  }
  const source = config.sources.find(item => item.id === options['--source']);
  if (!source) throw new FinancialConnectorError('SOURCE_ID_REQUIRED');
  const receipt = await stageFinancialSource(source, { periodMonth: options['--period'], cutoffDate: options['--cutoff'], outputDir: options['--output'] });
  console.log(JSON.stringify(receipt, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ outcome: 'failed', error_code: error instanceof FinancialConnectorError ? error.code : 'CONNECTOR_UNEXPECTED_FAILURE' }));
  process.exitCode = 1;
});
