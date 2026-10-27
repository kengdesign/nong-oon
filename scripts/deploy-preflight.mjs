import { pathToFileURL } from 'node:url';

// Compare the effective runtime variables, not repository defaults alone.
// Never return values: operator input may include account IDs or credentials.
export const PRESERVED_SETTINGS = Object.freeze([
  'APP_ENV', 'APP_ORIGIN', 'SELF_CARE_ONLY', 'CARE_API_ENABLED',
  'SERVICE_ADMIN_ENABLED', 'SERVICE_OWNER_ACTOR_ID',
  'SCHEDULER_ENABLED', 'DELIVERY_ENABLED', 'DELIVERY_START_AT',
  'DELIVERY_STOP_AT', 'LIVE_LINE_RECIPIENTS',
  'INGESTION_ENABLED', 'SYNTHETIC_INGESTION_ENABLED',
  'RETENTION_ENABLED', 'PRIVATE_RETENTION_ENABLED',
  'LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET',
  'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN',
]);

export function compareDeploymentSettings(input) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!record(input) || !record(input.before) || !record(input.after)) {
    return { ok: false, errors: [{ code: 'INVALID_INPUT' }] };
  }
  const errors = [];
  for (const key of PRESERVED_SETTINGS) {
    const beforeHas = Object.hasOwn(input.before, key);
    const afterHas = Object.hasOwn(input.after, key);
    if ((beforeHas && typeof input.before[key] !== 'string') ||
        (afterHas && typeof input.after[key] !== 'string')) {
      errors.push({ code: 'INVALID_VALUE_TYPE', setting: key });
    } else if (beforeHas !== afterHas || input.before[key] !== input.after[key]) {
      errors.push({ code: 'SETTING_CHANGED', setting: key });
    }
  }
  // A partial snapshot cannot certify preservation of the active pilot gates.
  for (const key of ['APP_ENV', 'APP_ORIGIN', 'SCHEDULER_ENABLED', 'DELIVERY_ENABLED',
    'LIVE_LINE_RECIPIENTS', 'INGESTION_ENABLED', 'SYNTHETIC_INGESTION_ENABLED',
    'RETENTION_ENABLED', 'PRIVATE_RETENTION_ENABLED']) {
    if (!Object.hasOwn(input.before, key) || !Object.hasOwn(input.after, key)) {
      errors.push({ code: 'REQUIRED_SETTING_MISSING', setting: key });
    }
  }
  // Equal snapshots do not make malformed switches safe or meaningful.
  for (const key of ['SELF_CARE_ONLY', 'CARE_API_ENABLED', 'SERVICE_ADMIN_ENABLED',
    'SCHEDULER_ENABLED', 'DELIVERY_ENABLED', 'INGESTION_ENABLED',
    'SYNTHETIC_INGESTION_ENABLED', 'RETENTION_ENABLED', 'PRIVATE_RETENTION_ENABLED']) {
    for (const snapshot of [input.before, input.after]) {
      if (Object.hasOwn(snapshot, key) && !['true', 'false'].includes(snapshot[key])) {
        errors.push({ code: 'INVALID_SWITCH', setting: key });
        break;
      }
    }
  }
  if (input.before.DELIVERY_ENABLED === 'true') {
    for (const key of ['DELIVERY_START_AT', 'DELIVERY_STOP_AT']) {
      const value = input.before[key];
      if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) {
        errors.push({ code: 'INVALID_PILOT_WINDOW', setting: key });
      }
    }
    const start = Number(input.before.DELIVERY_START_AT), stop = Number(input.before.DELIVERY_STOP_AT);
    if (!(stop > start && stop - start <= 86_400_000)) errors.push({ code: 'INVALID_PILOT_WINDOW' });
    let recipients;
    try { recipients = JSON.parse(input.before.LIVE_LINE_RECIPIENTS); } catch { /* reported below */ }
    if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10 ||
        recipients.some(value => typeof value !== 'string' || !/^U[0-9a-f]{32}$/.test(value)) ||
        new Set(recipients).size !== recipients.length) errors.push({ code: 'INVALID_RECIPIENT_LIST' });
    if (input.before.SCHEDULER_ENABLED !== 'true') errors.push({ code: 'SCHEDULER_DISABLED' });
  }
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 65_536) throw Error('INPUT_TOO_LARGE');
    }
    const result = compareDeploymentSettings(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    process.stdout.write('{"ok":false,"errors":[{"code":"INVALID_INPUT"}]}\n');
    process.exitCode = 1;
  }
}
