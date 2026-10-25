import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RETENTION_CRON } from '../src/maintenance.mjs';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('staging has no default or preview public endpoint', () => {
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
});

test('staging CPU budget is explicit and bounded per invocation', () => {
  assert.equal(config.limits.cpu_ms, 50);
});

test('collection and outbound delivery remain disabled with only bounded retention scheduled', () => {
  assert.equal(config.vars.INGESTION_ENABLED, 'false');
  assert.equal(config.vars.DELIVERY_ENABLED, 'false');
  assert.equal(config.vars.SYNTHETIC_INGESTION_ENABLED, 'false');
  assert.equal(config.vars.RETENTION_ENABLED, 'true');
  assert.equal(config.vars.APP_ENV, 'staging');
  assert.deepEqual(config.triggers, { crons: [RETENTION_CRON] });
  assert.equal(config.queues, undefined);
  assert.equal(config.ai, undefined);
});

test('static UI does not invoke the Worker before asset serving', () => {
  assert.deepEqual(config.assets.run_worker_first, ['/webhook/*', '/health']);
});

test('staging invocation logs persist across repository deployments', () => {
  assert.equal(config.observability.enabled, true);
  assert.equal(config.observability.logs.invocation_logs, true);
  assert.equal(config.observability.logs.head_sampling_rate, 1);
  assert.equal(config.observability.traces.enabled, false);
});
