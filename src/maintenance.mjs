import { purgeExpiredInbox } from './retention.mjs';
import { purgePrivateData } from './privacy.mjs';
import { recoverSchedules } from './scheduler.mjs';
import { processLineEvents } from './line-events.mjs';

export const RETENTION_CRON = '17 * * * *';
export const RECOVERY_CRON = '*/5 * * * *';

// One bounded SQL operation per hourly event. No loop, retry or HTTP endpoint.
export async function handleScheduled(controller, env = {}) {
  if (controller?.cron === RECOVERY_CRON) {
    if (env.SCHEDULER_ENABLED !== 'true' || !['staging','production'].includes(env.APP_ENV)) return { skipped: true };
    if (!Number.isSafeInteger(controller.scheduledTime) || controller.scheduledTime < 0) throw Error('INVALID_MAINTENANCE_EVENT');
    try {
      const result = await recoverSchedules(env, controller.scheduledTime);
      console.info(JSON.stringify({ task: 'scheduler_recovery', ...result }));
      return result;
    } catch { throw Error('RECOVERY_RUN_FAILED'); }
  }
  if (!['staging','production'].includes(env.APP_ENV) || env.RETENTION_ENABLED !== 'true') return { skipped: true };
  if (controller?.cron !== RETENTION_CRON || !Number.isSafeInteger(controller.scheduledTime)
    || controller.scheduledTime < 0) throw new Error('INVALID_MAINTENANCE_EVENT');
  try {
    const result = await purgeExpiredInbox(env.DB, controller.scheduledTime);
    if (env.PRIVATE_RETENTION_ENABLED === 'true') {
      await purgePrivateData(env.DB, controller.scheduledTime);
      if (env.INGESTION_ENABLED === 'true') await processLineEvents(env.DB, controller.scheduledTime);
      const saved = await env.DB.prepare(`INSERT INTO operation_health(task,last_ok_at,rows_processed) VALUES('retention',?,?)
        ON CONFLICT(task) DO UPDATE SET last_ok_at=excluded.last_ok_at,rows_processed=excluded.rows_processed`)
        .bind(controller.scheduledTime, result.deleted).run();
      if (saved?.success !== true) throw Error('HEALTH_WRITE_FAILED');
    }
    console.info(JSON.stringify({ task: 'retention', ...result }));
    return result;
  } catch {
    // Do not expose database errors, event IDs or request content in runtime logs.
    throw new Error('RETENTION_RUN_FAILED');
  }
}
