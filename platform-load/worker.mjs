import { PatientClock } from '../src/patient-clock.mjs';
import { recoverSchedules } from '../src/scheduler.mjs';

// Dedicated synthetic DB only. This entry point never uses any LINE credentials,
// exposes no HTTP operation, and runs at most three recovery/alarm cycles.
function safeEnv(env) {
  if (env.APP_ENV !== 'isolated-load-review') throw Error('LOAD_ENV_REQUIRED');
  return { DB: env.DB, PATIENT_CLOCK: env.PATIENT_CLOCK,
    SCHEDULER_ENABLED: 'true', DELIVERY_ENABLED: 'false', LIVE_LINE_RECIPIENTS: '[]' };
}

export class LoadPatientClock extends PatientClock {
  constructor(ctx, env) { super(ctx, safeEnv(env)); }
  async alarm() {
    const control = await this.env.DB.prepare('SELECT runs,expires_at FROM platform_load_control WHERE id=1').first();
    if (!control || control.runs > 3 || control.expires_at < Date.now()) {
      await this.ctx.storage.deleteAlarm(); return;
    }
    await super.alarm();
    // Exercise the real alarm path, then remove its future wake for this drill.
    await this.ctx.storage.deleteAlarm();
    const patient = await this.ctx.storage.get('patientId');
    await this.env.DB.prepare(`INSERT INTO platform_load_results(patient_id,cycle,completed_at)
      VALUES(?,?,?) ON CONFLICT(patient_id,cycle) DO NOTHING`).bind(patient, control.runs, Date.now()).run();
    console.log(JSON.stringify({ event: 'LOAD_ALARM_COMPLETED', cycle: control.runs }));
  }
}

export default {
  fetch() { return new Response(null, { status: 404 }); },
  async scheduled(controller, env) {
    const guarded = safeEnv(env);
    const claim = await env.DB.prepare(`UPDATE platform_load_control SET runs=runs+1
      WHERE id=1 AND runs<3 AND expires_at>? RETURNING runs`).bind(Date.now()).all();
    if (claim.results.length !== 1) return;
    const result = await recoverSchedules(guarded, Date.now());
    console.log(JSON.stringify({ event: 'LOAD_RECOVERY_COMPLETED', cycle: claim.results[0].runs, ...result }));
    if (result.checked !== 10 || result.failed !== 0) throw Error('LOAD_RECOVERY_INCOMPLETE');
  },
};
