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

test('staging releases preserve dashboard runtime without overriding delivery guards', () => {
  assert.equal(config.name, 'nong-oon-staging');
  assert.equal(config.account_id, 'c5f673e7bdf271485603029e19f42f49');
  assert.equal(config.keep_vars, true);
  assert.equal(Object.hasOwn(config, 'vars'), false);
  assert.deepEqual(config.triggers, { crons: [RETENTION_CRON, RECOVERY_CRON] });
  assert.deepEqual(config.d1_databases.map(({binding,database_name,database_id}) =>
    ({binding,database_name,database_id})), [{
      binding: 'DB', database_name: 'nong-oon-staging',
      database_id: '9a584c89-3b1f-4ae6-9b59-f97d1b75946d',
    }]);
  // A new Worker lacking existing runtime settings must never acquire delivery.
  assert.equal(deliveryConfig({}), null);
  assert.equal(deliveryConfig({APP_ENV:'staging', DELIVERY_ENABLED:'true',
    SCHEDULER_ENABLED:'true'}), null);
  // Bind the existing private staging resources without enabling intake/inference.
  assert.deepEqual(config.r2_buckets, [{binding:'MEDIA_R2',bucket_name:'nong-oon-staging-media'}]);
  assert.deepEqual(config.queues.producers, [{binding:'MEDIA_QUEUE',queue:'nong-oon-staging-media'}]);
  assert.deepEqual(config.queues.consumers, [{queue:'nong-oon-staging-media',
    max_batch_size:1,max_batch_timeout:5,max_retries:3,max_concurrency:1,
    retry_delay:60,dead_letter_queue:'nong-oon-staging-media-dlq'}]);
  assert.deepEqual(config.ai, {binding:'AI'});
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

