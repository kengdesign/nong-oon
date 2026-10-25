import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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

test('collection and outbound delivery remain opt-in with no scheduled jobs', () => {
  assert.equal(config.vars.INGESTION_ENABLED, 'false');
  assert.equal(config.vars.DELIVERY_ENABLED, 'false');
  assert.equal(config.triggers, undefined);
  assert.equal(config.queues, undefined);
  assert.equal(config.ai, undefined);
});

test('static UI does not invoke the Worker before asset serving', () => {
  assert.deepEqual(config.assets.run_worker_first, ['/webhook/*', '/health']);
});
