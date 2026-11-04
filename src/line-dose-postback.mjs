import { snoozeLineDose } from './snooze.mjs';
import { confirmationText } from './dose-confirmation.mjs';
import { applyDoseCommand } from './dose-store.mjs';
// Called only after webhook signature verification; identity never comes from postback data.
export async function applyLineDosePostback(db,event,now=Date.now(), { snoozeEnabled = false } = {}) {
  if(event?.type!=='postback'||event.source?.type!=='user'||!/^U[0-9a-f]{32}$/.test(event.source.userId??''))return null;
  if (snoozeEnabled && /^dose_snooze:([0-9a-f-]{36})$/.test(event.postback?.data??'')) {
    const receipt=await snoozeLineDose(db,event.postback.data.slice(12),event.source.userId,now);
    return receipt ? {ok:true,patientId:receipt.patientId,text:'ตั้งเตือนอีกครั้งเวลา '+new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(receipt.wakeAt))+' น. แล้วค่ะ'} : {ok:false,text:'เลื่อนรอบนี้ไม่ได้ รอบอาจบันทึกแล้วหรือพ้นเวลารับคำตอบ กรุณาเปิดรอบยาตรวจสอบ'};
  }
  const match=/^dose_taken:([0-9a-f-]{36})$/.exec(event.postback?.data??'');
  if(!match)return null;
  const job=await db.prepare(`SELECT o.patient_id,o.dose_id,o.schedule_version,a.actor_id,d.due_at FROM notification_outbox o
    JOIN dose_records d ON d.patient_id=o.patient_id AND d.dose_id=o.dose_id
    JOIN accounts a ON a.actor_id=o.recipient_actor_id
    JOIN patients p ON p.id=o.patient_id
    JOIN care_members m ON m.patient_id=p.id AND m.actor_id=a.actor_id
    WHERE o.id=? AND o.kind='reminder' AND a.line_user_id=? AND a.blocked_at IS NULL
    AND p.owner_actor_id=a.actor_id AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND m.role='owner'`)
    .bind(match[1],event.source.userId).first();
  if(!job)return {ok:false,text:'ไม่สามารถบันทึกรอบนี้ได้ กรุณาเปิดรอบยาเพื่อตรวจสอบ'};
  try {
    const receipt=await applyDoseCommand(db,{patientId:job.patient_id,doseId:job.dose_id,scheduleVersion:job.schedule_version,commandId:match[1],type:'report_taken'},{actorId:job.actor_id,now});
    return {ok:true,text:confirmationText(job.due_at,receipt.changedAt)};
  } catch(error) {
    if(error.message==='COMMAND_REJECTED')return {ok:false,text:'รอบนี้บันทึกแล้วหรือพ้นช่วงรับคำตอบ กรุณาเปิดรอบยาเพื่อตรวจสอบ'};
    throw error;
  }
}

export async function handleLineDosePostbacks(env,events,{fetcher=fetch,now=Date.now()}={}) {
  if(env.LINE_POSTBACK_ENABLED!=='true')return;
  for(const event of events){
    const result=await applyLineDosePostback(env.DB,event,now,{snoozeEnabled:env.SNOOZE_ENABLED==='true'});
    if(result?.patientId && env.PATIENT_CLOCK) {
      const clock=env.PATIENT_CLOCK.get(env.PATIENT_CLOCK.idFromName(result.patientId));
      const wake=await clock.fetch('https://patient-clock/wake',{method:'POST',body:JSON.stringify({patientId:result.patientId})});
      if(!wake.ok)throw Error('SNOOZE_WAKE_FAILED');
    }
    if(!result || typeof event.replyToken!=='string' || !event.replyToken)continue;
    if(typeof env.LINE_CHANNEL_ACCESS_TOKEN!=='string'||!env.LINE_CHANNEL_ACCESS_TOKEN.trim())throw Error('REPLY_NOT_CONFIGURED');
    let response;
    try { response=await fetcher('https://api.line.me/v2/bot/message/reply',{
      method:'POST',headers:{authorization:`Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,'content-type':'application/json'},
      body:JSON.stringify({replyToken:event.replyToken,messages:[{type:'text',text:result.text}]}),
      signal:AbortSignal.timeout(10000),redirect:'manual'});
    }catch{throw Error('REPLY_NETWORK_FAILED');}
    const status=response.status;
    try{await response.body?.cancel();}catch{}
    // A 400 can mean an expired/used token OR an invalid request. Never
    // silently classify it as success. Dose persistence is idempotent on redelivery.
    if(status===429||status>=500)throw Error('REPLY_RETRYABLE');
    if(status<200||status>=300)throw Error('REPLY_FAILED');
  }
}
