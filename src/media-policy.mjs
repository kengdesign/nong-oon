// Pure P2-03 policy. Inputs must come from authenticated server records, never AI.
// No route, cloud resource, consent collection or data deletion is performed here.
export const MEDIA_CONSENT_VERSION = 'phase2-media-v1';
export const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const stamp=v=>Number.isSafeInteger(v)&&v>=0;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const deny=code=>({allowed:false,code});

export function mediaAccessDecision({now,enabled,principal,consent,job}={}) {
  if(enabled!==true)return deny('MEDIA_DISABLED');
  if(!stamp(now)||!principal||!consent||!job)return deny('INVALID_MEDIA_CONTEXT');
  if(!id(principal.actorId)||!id(principal.profileId)||principal.canManage!==true||principal.blocked!==false)
    return deny('MEDIA_FORBIDDEN');
  if(job.actorId!==principal.actorId||job.profileId!==principal.profileId||
      consent.actorId!==principal.actorId||consent.profileId!==principal.profileId)return deny('MEDIA_FORBIDDEN');
  if(consent.version!==MEDIA_CONSENT_VERSION||consent.purpose!=='media_extraction'||consent.revokedAt!==null)
    return deny('MEDIA_CONSENT_REQUIRED');
  if(!stamp(consent.grantedAt)||!stamp(consent.expiresAt)||consent.grantedAt>now||consent.expiresAt<=now||consent.expiresAt<=consent.grantedAt)
    return deny('MEDIA_CONSENT_EXPIRED');
  if(!stamp(job.createdAt)||!stamp(job.expiresAt)||job.createdAt>now||job.createdAt<consent.grantedAt||
      job.expiresAt<=job.createdAt||job.expiresAt-job.createdAt>MEDIA_TTL_MS||job.expiresAt>consent.expiresAt)
    return deny('INVALID_MEDIA_LIFETIME');
  if(job.unsentAt!==null)return deny('SOURCE_UNSENT');
  if(now>=job.expiresAt)return deny('MEDIA_EXPIRED');
  if(!['queued','processing','awaiting_review'].includes(job.state))return deny('MEDIA_NOT_ACTIVE');
  if(!['voice','printed_label','printed_prescription','handwritten_prescription','pill_photo'].includes(job.sourceKind))
    return deny('INVALID_MEDIA_SOURCE');
  return {allowed:true,code:'MEDIA_ALLOWED',deleteBy:job.expiresAt};
}
