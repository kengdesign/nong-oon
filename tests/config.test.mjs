import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deliveryConfig } from '../src/delivery.mjs';
import { RETENTION_CRON, RECOVERY_CRON } from '../src/maintenance.mjs';

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

test('staging prepares dose rounds while collection and LINE delivery remain disabled', () => {
  assert.equal(config.vars.INGESTION_ENABLED, 'false');
  assert.equal(config.vars.DELIVERY_ENABLED, 'false');
  assert.equal(config.vars.SYNTHETIC_INGESTION_ENABLED, 'false');
  assert.equal(config.vars.RETENTION_ENABLED, 'true');
  assert.equal(config.vars.APP_ENV, 'staging');
  assert.deepEqual(config.triggers, { crons: [RETENTION_CRON,RECOVERY_CRON] });
  assert.equal(config.vars.SCHEDULER_ENABLED,'true');
  assert.equal(deliveryConfig(config.vars), null);
  assert.equal(config.vars.CARE_API_ENABLED,'true');
  assert.deepEqual(JSON.parse(config.vars.LIVE_LINE_RECIPIENTS),[]);
  assert.equal(config.queues, undefined);
  assert.equal(config.ai, undefined);
});

test('only auth, API, webhook and health routes run Worker before assets', () => {
  assert.deepEqual(config.assets.run_worker_first, ['/webhook/*', '/health','/auth/*','/api/*']);
});

test('safe application logs persist; OAuth invocation URL logging stays disabled', () => {
  assert.equal(config.observability.enabled, true);
  // OAuth callback URLs contain a short-lived code. Keep custom safe logs but
  // disable automatic request invocation logging before adding Login routes.
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.observability.logs.head_sampling_rate, 1);
  assert.equal(config.observability.traces.enabled, false);
});
