import { runPatient, nextWake } from './scheduler.mjs';
import { deliveryConfig } from './delivery.mjs';

/** One independently scheduled, persisted alarm per patient. Never publicly routed. */
export class PatientClock {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/wake') return new Response(null, { status: 404 });
    if (this.env.SCHEDULER_ENABLED !== 'true') return new Response(null, { status: 204 });
    let data;
    try {
      if (Number(request.headers.get('content-length') ?? 0) > 256) throw Error();
      const text = await request.text();
      if (text.length > 256) throw Error();
      data = JSON.parse(text);
    } catch { return new Response(null, { status: 400 }); }
    if (!data || Object.keys(data).some(key => !['patientId','onlyIfMissing'].includes(key))
      || (data.onlyIfMissing !== undefined && data.onlyIfMissing !== true)
      || typeof data.patientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.patientId)) return new Response(null, { status: 400 });
    const stored = await this.ctx.storage.get('patientId');
    if (stored && stored !== data.patientId) return new Response(null, { status: 409 });
    await this.ctx.storage.put('patientId', data.patientId);
    // Set recovery alarm BEFORE work; a crash between D1 writes and rearming
    // cannot strand the patient. Do not overwrite an earlier existing alarm.
    const alarm = await this.ctx.storage.getAlarm();
    const soon = Date.now() + 1000;
    if (alarm === null || (data.onlyIfMissing === true ? alarm <= Date.now() : alarm > soon)) await this.ctx.storage.setAlarm(soon);
    return new Response(null, { status: 202 });
  }

  async alarm() {
    if (this.env.SCHEDULER_ENABLED !== 'true') { await this.ctx.storage.deleteAlarm(); return; }
    const patientId = await this.ctx.storage.get('patientId');
    if (!patientId) { await this.ctx.storage.deleteAlarm(); return; }
    const now = Date.now();
    try {
      await runPatient(this.env.DB, patientId, now, { env: this.env });
      const config = deliveryConfig(this.env);
      const wake = await nextWake(this.env.DB, patientId, Date.now(), { deliveryEnabled: config !== null, recipients: config?.recipients ?? [] });
      if (wake === null) await this.ctx.storage.deleteAlarm(); else await this.ctx.storage.setAlarm(wake);
      await this.ctx.storage.put('lastSuccessAt', now);
    } catch {
      // Stable code only: never include patient IDs, SQL, tokens or medication.
      await this.ctx.storage.setAlarm(now + 60_000);
      throw Error('PATIENT_CLOCK_FAILED');
    }
  }
}
