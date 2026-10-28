// Phase 2 contracts only. Not mounted by webhook.mjs; no storage/network writes.
export const DRAFT_VERSION = 1;
export const MAX_DRAFT_BYTES = 65_536;
export const DRAFT_FIELDS = Object.freeze(['label','strength','dose','instructions','times','weekdays','startDate','endDate','useMode']);
export const SOURCE_KINDS = Object.freeze(['voice','printed_label','printed_prescription','handwritten_prescription','pill_photo']);
export const INTENTS = Object.freeze(['view_today','view_remaining','report_taken','report_not_taken','create_schedule','change_schedule','pause_schedule','unknown']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v &&
  !/[\u0000-\u001f\u007f]/u.test(v);
const date = v => text(v,10) && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2020-01-01' && v <= '2100-12-31' &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
const list = (v,max,check) => Array.isArray(v) && v.length >= 1 && v.length <= max &&
  new Set(v).size === v.length && v.every(check);

// Errors contain fixed codes only, never input values or provider exception text.
export function validateDraft(value) {
  if (!exact(value,['schemaVersion','sourceKind','items']) || value.schemaVersion !== DRAFT_VERSION ||
      !SOURCE_KINDS.includes(value.sourceKind) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 20)
    return {ok:false, errors:['INVALID_DRAFT']};
  const errors = new Set();
  for (const item of value.items) {
    if (!exact(item,['fields','issues']) || !exact(item.fields,DRAFT_FIELDS) ||
        !Array.isArray(item.issues) || item.issues.length > 8 || new Set(item.issues).size !== item.issues.length ||
        item.issues.some(v=>!['unreadable','ambiguous','conflicting','possible_duplicate','unsupported_regimen'].includes(v))) {
      errors.add('INVALID_ITEM'); continue;
    }
    for (const key of DRAFT_FIELDS) {
      const field=item.fields[key];
      if (!exact(field,['value','evidence'])) {errors.add('INVALID_FIELD');continue;}
      if (field.value === null) {if(field.evidence !== null)errors.add('UNKNOWN_WITH_EVIDENCE');continue;}
      if (!text(field.evidence,500)) errors.add('EVIDENCE_REQUIRED');
      const v=field.value;
      const valid=key==='times' ? list(v,8,t=>text(t,5)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) :
        key==='weekdays' ? list(v,7,d=>Number.isInteger(d)&&d>=0&&d<=6) :
        ['startDate','endDate'].includes(key) ? date(v) :
        key==='useMode' ? ['scheduled','as_needed'].includes(v) : text(v,key==='instructions'?500:120);
      if(!valid)errors.add('INVALID_FIELD_VALUE');
      // A bare pill photograph must not be used to infer any medication field.
      if(value.sourceKind==='pill_photo')errors.add('PILL_IDENTIFICATION_FORBIDDEN');
    }
    const {startDate,endDate,useMode,times}=item.fields;
    if(date(startDate?.value)&&date(endDate?.value)&&endDate.value<startDate.value)errors.add('DATE_ORDER');
    if(useMode?.value==='as_needed'&&times?.value!==null)errors.add('AS_NEEDED_FIXED_TIMES');
  }
  return {ok:errors.size===0,errors:[...errors]};
}

export function parseDraft(input) {
  if(typeof input!=='string'||new TextEncoder().encode(input).length>MAX_DRAFT_BYTES)
    return {ok:false,errors:['DRAFT_TOO_LARGE_OR_NOT_TEXT']};
  let value;
  try {value=JSON.parse(input);} catch {return {ok:false,errors:['INVALID_JSON']};}
  const result=validateDraft(value);
  return result.ok?{...result,draft:value}:result;
}

export function assessDraft(value) {
  const result=validateDraft(value);
  if(!result.ok)return {...result,activationAllowed:false};
  return {ok:true,activationAllowed:false,requiresSourceVerification:true,requiresConfirmation:true,
    items:value.items.map(item=>({
      missingFields:DRAFT_FIELDS.filter(key=>key!=='endDate'&&item.fields[key].value===null),
      needsClarification:item.issues.length>0,
      fixedScheduleUnsupported:value.sourceKind==='pill_photo'||item.fields.useMode.value==='as_needed',
    }))};
}

export function assessCommand(value, {resolvedTargets=0}={}) {
  if(!exact(value,['schemaVersion','intent','targetLabel','ambiguous']) || value.schemaVersion!==1 ||
      !INTENTS.includes(value.intent) || typeof value.ambiguous!=='boolean' ||
      !(value.targetLabel===null||text(value.targetLabel,120)) ||
      !Number.isSafeInteger(resolvedTargets)||resolvedTargets<0||resolvedTargets>20)
    return {ok:false,errors:['INVALID_COMMAND'],mutationAllowed:false};
  if(value.intent==='unknown')return {ok:true,action:'unsupported',mutationAllowed:false};
  if(value.ambiguous)return {ok:true,action:'clarify',mutationAllowed:false};
  if(['view_today','view_remaining'].includes(value.intent))return {ok:true,action:'read_after_authorization',mutationAllowed:false};
  if(value.intent==='create_schedule')return {ok:true,action:'create_draft_after_authorization',mutationAllowed:false};
  // Server-side access checks and target resolution are required; AI labels/IDs
  // are never permission, target identity, or a substitute for a user action.
  if(resolvedTargets!==1)return {ok:true,action:'clarify',mutationAllowed:false};
  return {ok:true,action:'request_confirmation',mutationAllowed:false};
}
