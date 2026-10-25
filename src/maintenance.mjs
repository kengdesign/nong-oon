import { purgeExpiredInbox } from './retention.mjs';

export const RETENTION_CRON = '17 * * * *';

// One bounded SQL operation per hourly event. No loop, retry or HTTP endpoint.
export async function handleScheduled(controller, env = {}) {
  if (env.APP_ENV !== 'staging' || env.RETENTION_ENABLED !== 'true') return { skipped: true };
  if (controller?.cron !== RETENTION_CRON || !Number.isSafeInteger(controller.scheduledTime)
    || controller.scheduledTime < 0) throw new Error('INVALID_MAINTENANCE_EVENT');
  try {
    return await purgeExpiredInbox(env.DB, controller.scheduledTime);
  } catch {
    // Do not expose database errors, event IDs or request content in runtime logs.
    throw new Error('RETENTION_RUN_FAILED');
  }
}
