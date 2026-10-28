import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRAFT_FIELDS, parseDraft, validateDraft, assessDraft, assessCommand } from '../src/draft-contract.mjs';
import { draftJsonSchema, commandJsonSchema } from '../src/draft-schema.mjs';
const unknown=()=>({value:null,evidence:null});
const known=(value,evidence='ข้อความสังเคราะห์ตามตัวอย่าง')=>({value,evidence});
const draft=()=>({schemaVersion:1,sourceKind:'printed_label',items:[{fields:Object.fromEntries(DRAFT_FIELDS.map(k=>[k,unknown()])),issues:[]}]});

test('partial drafts preserve unknowns without inventing dates, doses or meal times',()=>{
  const input=draft();input.items[0].fields.instructions=known('หลังอาหาร');
  const before=JSON.stringify(input);const r=parseDraft(before);
  assert.equal(r.ok,true);assert.equal(r.draft.items[0].fields.times.value,null);
  const assessment=assessDraft(r.draft);assert.equal(assessment.activationAllowed,false);
  assert.equal(assessment.requiresConfirmation,true);assert.equal(assessment.requiresSourceVerification,true);
  assert.ok(assessment.items[0].missingFields.includes('times'));assert.equal(JSON.stringify(input),before);
});
test('identity, activation, confidence and schema injection fail with no private values in errors',()=>{
  for(const patch of [{actorId:'private-patient'},{active:true},{confirmed:true},{confidence:1},{schemaVersion:2}]){
    const r=parseDraft(JSON.stringify({...draft(),...patch}));assert.equal(r.ok,false);
    assert.doesNotMatch(JSON.stringify(r),/private-patient|label|instructions/);
  }
  assert.equal(parseDraft('{"__proto__":{},"schemaVersion":1,"sourceKind":"voice","items":[]}').ok,false);
  assert.equal(validateDraft(Object.create({schemaVersion:1})).ok,false);
});
test('malformed, oversized UTF-8 and nested payloads fail without exceptions or raw output',()=>{
  for(const input of [null,42,'bad private-health-data','['.repeat(40000),JSON.stringify({...draft(),extra:'ก'.repeat(30000)})]){
    const r=parseDraft(input);assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/private-health-data/);
  }
});
test('known fields need evidence and null fields cannot hide inferred values',()=>{
  for(const field of [{value:'ยาสังเคราะห์',evidence:null},{value:null,evidence:'เดา'},{value:' x ',evidence:'x'},
    {value:'x\n',evidence:'x'},{value:'x',evidence:'x',confirmed:true}]){
    const d=draft();d.items[0].fields.label=field;assert.equal(validateDraft(d).ok,false);
  }
});
test('invalid calendars, backwards dates and duplicate/out-of-range slots are rejected',()=>{
  for(const [key,value] of [['startDate','2026-02-30'],['startDate','2019-01-01'],['times',['24:00']],
    ['times',['08:00','08:00']],['weekdays',[7]],['weekdays',[1,1]],['dose',1],['times',[]]]){
    const d=draft();d.items[0].fields[key]=known(value);assert.equal(validateDraft(d).ok,false);
  }
  const d=draft();d.items[0].fields.startDate=known('2028-02-29');d.items[0].fields.endDate=known('2028-02-28');
  assert.ok(validateDraft(d).errors.includes('DATE_ORDER'));
});
test('pill-only inference and fixed-time PRN are blocked; a complete draft still cannot activate',()=>{
  const pill=draft();pill.sourceKind='pill_photo';assert.equal(assessDraft(pill).items[0].fixedScheduleUnsupported,true);
  pill.items[0].fields.label=known('เดาชื่อยา');assert.ok(validateDraft(pill).errors.includes('PILL_IDENTIFICATION_FORBIDDEN'));
  const d=draft();d.items[0].fields.useMode=known('as_needed');d.items[0].fields.times=known(['08:00']);
  assert.ok(validateDraft(d).errors.includes('AS_NEEDED_FIXED_TIMES'));
  const full=draft();Object.assign(full.items[0].fields,{label:known('ยาทดสอบ'),strength:known('ตามฉลาก'),dose:known('ตามฉลาก'),
    instructions:known('ข้อมูลทดสอบ'),times:known(['08:00']),weekdays:known([0,1,2,3,4,5,6]),startDate:known('2026-10-28'),useMode:known('scheduled')});
  assert.deepEqual(assessDraft(full).items[0].missingFields,[]);assert.equal(assessDraft(full).activationAllowed,false);
});
test('command target hints never authorize writes, even with one resolved target',()=>{
  for(const intent of ['report_taken','report_not_taken','change_schedule','pause_schedule']){
    const c={schemaVersion:1,intent,targetLabel:'รายการทดสอบ',ambiguous:false};
    for(const resolvedTargets of [0,1,2]){
      const r=assessCommand(c,{resolvedTargets});assert.equal(r.mutationAllowed,false);
      assert.equal(r.action,resolvedTargets===1?'request_confirmation':'clarify');
    }
    assert.equal(assessCommand({...c,ambiguous:true},{resolvedTargets:1}).action,'clarify');
    assert.equal(assessCommand({...c,actorId:'spoof'}).ok,false);
  }
});
test('published schema exports stay aligned with runtime contract and reject extra properties',()=>{
  assert.deepEqual(draftJsonSchema.properties.items.items.properties.fields.required,[...DRAFT_FIELDS]);
  assert.equal(draftJsonSchema.additionalProperties,false);assert.equal(commandJsonSchema.additionalProperties,false);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../schemas/schedule-draft-v1.json',import.meta.url),'utf8')),draftJsonSchema);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../schemas/voice-command-v1.json',import.meta.url),'utf8')),commandJsonSchema);
});
test('synthetic Thai annotations exercise contract policy without claiming ASR/OCR accuracy',()=>{
  const corpus=JSON.parse(readFileSync(new URL('./fixtures/phase2-thai.json',import.meta.url),'utf8'));
  assert.equal(corpus.synthetic,true);assert.ok(corpus.cases.length>=20);
  for(const example of corpus.cases){
    const result=example.kind==='command'?assessCommand(example.input,example.context):assessDraft(example.input);
    for(const [key,value] of Object.entries(example.expected))assert.deepEqual(result[key],value,example.id);
  }
});
