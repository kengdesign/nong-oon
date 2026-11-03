import { sendLineNotification } from './delivery.mjs';
export function confirmationText(dueAt,changedAt) {
 const format=(at,options)=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',hourCycle:'h23',...options}).format(new Date(at));
 return '✓ บันทึกว่าทานยาแล้วเรียบร้อย\nรอบ '+format(dueAt,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' น.\nบันทึกเมื่อ '+format(changedAt,{hour:'2-digit',minute:'2-digit'})+' น.';
}
// A user-requested receipt, not a scheduled reminder. Retry only the persisted
// audit command key, with identical text, inside LINE's 24-hour deduplication period.
export async function sendDoseConfirmation(env,{patientId,doseId,actorId,now},{fetcher=fetch}={}) {
 if(env.LINE_POSTBACK_ENABLED!=='true')return {accepted:false};
 let allow;try{allow=JSON.parse(env.LIVE_LINE_RECIPIENTS);}catch{return {accepted:false};}
 const receipt=await env.DB.prepare(`SELECT d.due_at,d.changed_at,d.command_id,a.line_user_id FROM dose_records d
 JOIN patients p ON p.id=d.patient_id JOIN accounts a ON a.actor_id=p.owner_actor_id
 JOIN care_members m ON m.patient_id=p.id AND m.actor_id=a.actor_id
 JOIN dose_audit audit ON audit.command_id=d.command_id AND audit.patient_id=d.patient_id AND audit.dose_id=d.dose_id AND audit.actor_id=d.actor_id
 WHERE d.patient_id=? AND d.dose_id=? AND d.actor_id=? AND p.owner_actor_id=?
 AND d.status='reported_taken' AND audit.status='reported_taken' AND p.revoked_at IS NULL AND a.blocked_at IS NULL AND m.revoked_at IS NULL AND m.role='owner'
 AND EXISTS(SELECT 1 FROM care_grants g WHERE g.patient_id=p.id AND g.actor_id=a.actor_id AND g.action='report_taken' AND g.revoked_at IS NULL)`)
 .bind(patientId,doseId,actorId,actorId).first();
 if(!receipt||!Array.isArray(allow)||!allow.includes(receipt.line_user_id)||now<receipt.changed_at||now-receipt.changed_at>=23*3600000)return {accepted:false};
 const result=await sendLineNotification({to:receipt.line_user_id,retryKey:receipt.command_id,text:confirmationText(receipt.due_at,receipt.changed_at)},{token:env.LINE_CHANNEL_ACCESS_TOKEN,fetcher});
 return {accepted:result.accepted};
}
