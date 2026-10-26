import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { compareDeploymentSettings, PRESERVED_SETTINGS } from '../scripts/deploy-preflight.mjs';

const pilot = () => ({ APP_ENV: 'staging', APP_ORIGIN: 'https://example.test',
  SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'true',
  DELIVERY_START_AT: '1793066400000', DELIVERY_STOP_AT: '1793152800000',
  LIVE_LINE_RECIPIENTS: JSON.stringify(['U' + '1'.repeat(32)]),
  INGESTION_ENABLED: 'false', SYNTHETIC_INGESTION_ENABLED: 'false',
  RETENTION_ENABLED: 'true', PRIVATE_RETENTION_ENABLED: 'true',
  SERVICE_ADMIN_ENABLED: 'true', SERVICE_OWNER_ACTOR_ID: 'private-owner-fixture',
  LINE_CHANNEL_ACCESS_TOKEN: 'private-token-fixture' });

test('unchanged bounded pilot passes without interpreting expiration as permission to change it', () => {
  assert.deepEqual(compareDeploymentSettings({ before: pilot(), after: pilot() }), { ok: true, errors: [] });
});

test('every protected setting change, removal or addition fails without returning values', () => {
  for (const setting of PRESERVED_SETTINGS) {
    const before = { ...pilot(), [setting]: 'private-original' };
    for (const after of [{ ...before, [setting]: 'private-replacement' },
      Object.fromEntries(Object.entries(before).filter(([key]) => key !== setting))]) {
      const result = compareDeploymentSettings({ before, after });
      assert.equal(result.ok, false);
      assert.ok(result.errors.some(error => error.setting === setting));
      assert.doesNotMatch(JSON.stringify(result), /private-original|private-replacement|private-token-fixture|private-owner-fixture/);
    }
    const after = { ...before };
    delete before[setting];
    assert.equal(compareDeploymentSettings({ before, after }).ok, false);
  }
});

test('repository default reset is rejected and incomplete snapshots fail closed', () => {
  assert.equal(compareDeploymentSettings({ before: pilot(), after: { ...pilot(), DELIVERY_ENABLED: 'false', LIVE_LINE_RECIPIENTS: '[]' } }).ok, false);
  for (const input of [null, [], {}, { before: {}, after: {} }, { before: pilot(), after: [] }]) {
    assert.equal(compareDeploymentSettings(input).ok, false);
  }
});

test('invalid active pilot windows, duplicate recipients and wrong value types fail closed', () => {
  for (const patch of [{ DELIVERY_STOP_AT: '1793066400000' }, { DELIVERY_STOP_AT: '1793152800001' },
    { DELIVERY_START_AT: 'NaN' }, { DELIVERY_ENABLED: true }, { LIVE_LINE_RECIPIENTS: '[]' },
    { LIVE_LINE_RECIPIENTS: 'broken' }, { LIVE_LINE_RECIPIENTS: JSON.stringify(['U' + '1'.repeat(32), 'U' + '1'.repeat(32)]) },
    { SCHEDULER_ENABLED: 'false' }]) {
    const settings = { ...pilot(), ...patch };
    assert.equal(compareDeploymentSettings({ before: settings, after: settings }).ok, false);
  }
});

test('CLI returns nonzero with redacted output for malformed, oversized and changed input', () => {
  for (const input of ['private-malformed', 'x'.repeat(65_537),
    JSON.stringify({ before: pilot(), after: { ...pilot(), LINE_CHANNEL_ACCESS_TOKEN: 'private-new-token' } })]) {
    const result = spawnSync(process.execPath, ['scripts/deploy-preflight.mjs'], { input, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).ok, false);
    assert.doesNotMatch(result.stdout + result.stderr, /private-|U1111/);
  }
  const result = spawnSync(process.execPath, ['scripts/deploy-preflight.mjs'], {
    input: JSON.stringify({ before: pilot(), after: pilot() }), encoding: 'utf8' });
  assert.equal(result.status, 0);
});
