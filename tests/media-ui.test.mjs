// DOM interaction harness, not a browser rendering or accessibility certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {extraction} from './helpers/media.mjs';
class Element {
  constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.children=[];this.attrs={};this.events={};this.value='';this.disabled=false;this.isConnected=true;}
  setAttribute(k,v){this.attrs[k]=v;}
  append(...els){this.children.push(...els);}
  prepend(...els){this.children.unshift(...els);}
  replaceChildren(...els){this.children.forEach(el=>{el.isConnected=false;});this.children=els;}
  addEventListener(type,fn){this.events[type]=fn;}
  querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(el=>[...(tags.includes(el.tagName)?[el]:[]),...el.querySelectorAll(selector)]);}
}
const tick=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
async function ui({authenticated=true,consented=true}={}){
  const root=new Element('div'),feedback=new Element('p'),calls=[];
  let saved;
  const context={document:{querySelector:s=>s==='#media-view'?root:feedback,createElement:tag=>new Element(tag)},AbortSignal,crypto,fetch:async(path,options)=>{
    calls.push({path,...options});let value;
    if(path==='/api/session')value={authenticated,csrf:'synthetic-csrf'};
    else if(path==='/api/patients')value={patients:[{id:'patient',role:'owner',displayName:'Synthetic'}]};
    else if(path.endsWith('/consent'))value={consented,version:'phase2-media-v1',provider:'Synthetic provider'};
    else if(path.endsWith('/jobs'))value={jobs:[{id:'job',sourceKind:'printed_label',state:'awaiting_review',createdAt:Date.now()}],currentVersion:0};
    else if(path.endsWith('/jobs/job'))value={sourceKind:'printed_label',draft:JSON.parse(extraction()),reviews:[],currentVersion:0};
    else if(options.method==='PUT'){
      saved=JSON.parse(options.body);value={snapshot:{schedule:saved.schedule},reviewVersion:1,expectedScheduleVersion:0};
    }else if(path.endsWith('/confirm'))value={confirmed:true};
    else throw Error('Unexpected fixture route');
    return {ok:true,json:async()=>value};
  }};
  vm.runInNewContext(readFileSync(new URL('../public/media-review.mjs',import.meta.url),'utf8'),context);await tick();
  return {root,feedback,calls,get saved(){return saved;}};
}
const find=(root,tag,text)=>root.querySelectorAll(tag).find(e=>e.textContent===text);
test('UI unauthenticated and missing-consent states never fetch media or write automatically',async()=>{
  for(const settings of [{authenticated:false},{consented:false}]){
    const f=await ui(settings);assert.equal(f.calls.some(c=>c.method!=='GET'),false);assert.equal(f.calls.some(c=>c.path.endsWith('/jobs')),false);
  }
});
test('UI leaves unknowns blank, saves a review separately, and confirms with CSRF only after explicit action',async()=>{
  const f=await ui();
  const open=f.root.querySelectorAll('button').find(e=>e.textContent.includes('ตรวจ'));assert.ok(open);await open.events.click();await tick();
  const form=f.root.querySelectorAll('form')[0];assert.ok(form);
  const inputs=form.querySelectorAll('input,textarea');const fields=Object.fromEntries(inputs.filter(i=>i.attrs.name).map(i=>[i.attrs.name,i]));
  assert.equal(fields.times.value,'');assert.equal(fields.dose.value,'');assert.equal(f.calls.some(c=>c.method!=='GET'),false);
  const checkbox=inputs.find(i=>i.attrs.type==='checkbox');checkbox.checked=true;
  for(const [key,value] of Object.entries({label:'SAMPLE',strength:'5 mg',dose:'1 เม็ด',instructions:'synthetic',times:'08:00',weekdays:'0,1,2,3,4,5,6',startDate:'2026-10-28',endDate:''}))fields[key].value=value;
  await form.events.submit({preventDefault(){}});await tick();
  assert.ok(f.saved);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
  const confirm=find(f.root,'button','ยืนยันบันทึกตารางและเปิดรายการนี้');assert.ok(confirm);await confirm.events.click();await tick();
  const calls=f.calls.filter(c=>c.path.endsWith('/confirm'));assert.equal(calls.length,1);assert.equal(calls[0].headers['x-csrf-token'],'synthetic-csrf');
  assert.equal(JSON.parse(calls[0].body).acknowledge,true);assert.match(f.feedback.textContent,/บันทึกตารางแล้ว/);
});
