const output=document.querySelector('#result');
const buttons=[...document.querySelectorAll('button')];
let busy=false, cooldown=0;
const log=value=>{output.textContent=JSON.stringify(value,null,2)};
async function request(path,options={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
  const text=await response.text();
  let body;try{body=JSON.parse(text)}catch{}
  return {status:response.status,json:body??null,redirect:response.type==='opaqueredirect',html:/<html|<!doctype/i.test(text),colo:response.headers.get('cf-ray')?.split('-').pop()??null,cache:response.headers.get('cf-cache-status')};
 }catch(error){return {status:0,error:error.name}}finally{clearTimeout(timer)}
}
async function run(task){if(busy)return;busy=true;buttons.forEach(b=>b.disabled=true);try{await task()}catch(error){log({error:error.message})}finally{busy=false;buttons.forEach(b=>b.disabled=false)}}
function assertHost(){if(location.hostname!=='staging.nongoon.com')throw Error('อนุญาตเฉพาะ staging.nongoon.com')}
document.querySelector('#basic').onclick=()=>run(async()=>{
 assertHost();
 const health=await request('/health');
 const webhook=await request('/webhook/line',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({events:[]})});
 log({test:'basic',health,webhook,healthPass:health.status===200&&health.json?.deliveryEnabled===false,
 unsignedWebhookRejected: (webhook.status===401&&webhook.json?.error==='INVALID_SIGNATURE')||(webhook.status===503&&webhook.json?.error==='NOT_CONFIGURED'),
 note:'503 NOT_CONFIGURED หมายถึงยังไม่มี secret จึงยังไม่ได้ทดสอบตัวตรวจลายเซ็นบน staging'});
});
document.querySelector('#burst').onclick=()=>run(async()=>{
 assertHost();if(Date.now()<cooldown)throw Error('กรุณารอให้ครบ 20 วินาทีแล้วทดสอบใหม่');
 const start=performance.now();
 const results=await Promise.all(Array.from({length:40},()=>request('/health')));
 cooldown=Date.now()+20000;
 const statuses={};for(const r of results)statuses[r.status]=(statuses[r.status]??0)+1;
 log({test:'burst',requests:40,elapsedMs:Math.round(performance.now()-start),statuses,
 appResponses:results.filter(r=>r.status===200&&r.json?.deliveryEnabled===false).length,
 blocked429:results.filter(r=>r.status===429).length,
 accessOrHtmlResponses:results.filter(r=>r.redirect||r.html).length,
 rateLimitObserved:results.some(r=>r.status===429),
 note:'ตรวจข้อ 3 หลังรออย่างน้อย 20 วินาที ไม่ retry อัตโนมัติ'});
});
document.querySelector('#recovery').onclick=()=>run(async()=>{
 assertHost();if(Date.now()<cooldown)throw Error('กรุณารอให้ครบ 20 วินาทีหลังทดสอบ burst');
 const result=await request('/health');log({test:'recovery',result,pass:result.status===200&&result.json?.deliveryEnabled===false});
});

document.querySelector('#paced').onclick=()=>run(async()=>{
 assertHost();if(Date.now()<cooldown)throw Error('กรุณารอให้ครบ 20 วินาทีแล้วทดสอบใหม่');
 cooldown=Date.now()+60000;
 const start=performance.now(),results=[],pending=[];
 const nonce=crypto.randomUUID();
 for(let i=0;i<45;i++){
  pending.push(request('/health?qa='+encodeURIComponent(nonce)+'&n='+i).then(r=>{results.push(r)}));
  if(i<44)await new Promise(resolve=>setTimeout(resolve,200));
 }
 await Promise.all(pending);cooldown=Date.now()+20000;
 const statuses={},colos={};for(const r of results){statuses[r.status]=(statuses[r.status]??0)+1;colos[r.colo??'unknown']=(colos[r.colo??'unknown']??0)+1}
 log({test:'paced',requests:45,elapsedMs:Math.round(performance.now()-start),statuses,colos,
 blocked429:results.filter(r=>r.status===429).length,rateLimitObserved:results.some(r=>r.status===429),
 accessOrHtmlResponses:results.filter(r=>r.redirect||r.html).length,note:'แต่ละคำขอต่าง URL เว้น 200 ms ไม่มี retry ตรวจข้อ 3 หลังรอ 20 วินาที'});
});
async function checkSigned(inbox=false){return run(async()=>{
 assertHost();
 const input=document.querySelector('#channelSecret');
 let secret=input.value;input.value='';
 if(!secret||secret!==secret.trim())throw Error('กรุณาใส่ Channel secret ให้ถูกต้อง ไม่มีช่องว่างหัวท้าย');
 let key;
 try{key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])}finally{secret=''}
 async function signedRequest(events,valid=true){
  const body=JSON.stringify({events});
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));
  if(!valid)digest[0]^=1;
  return request('/webhook/line',{method:'POST',headers:{'content-type':'application/json','x-line-signature':btoa(String.fromCharCode(...digest))},body});
 }
 try{
  if(inbox){
   const eventId='qa_d1_'+crypto.randomUUID();
   const fixture={webhookEventId:eventId,type:'follow',timestamp:Date.now()};
   const first=await signedRequest([fixture]);
   const duplicate=await signedRequest([fixture]);
   const rejected=await signedRequest([fixture],false);
   const guarded=await signedRequest([{...fixture,source:{userId:'qa_not_allowed'}}]);
   log({test:'synthetic-inbox',eventId,first,duplicate,rejected,guarded,
    handlerPass:first.status===200&&first.json?.status==='stored'&&duplicate.status===200&&duplicate.json?.status==='stored'&&rejected.status===401&&guarded.status===503,
    databaseVerified:false,note:'ต้องตรวจ D1 ว่ามี eventId นี้เพียง 1 แถว user_id และ postback_data เป็น null; ผล HTTP ยังไม่ยืนยันจำนวนแถว ล้างข้อมูลจำลองหลังตรวจ'});
   return;
  }
  const verified=await signedRequest([]);
  const rejected=await signedRequest([],false);
  const guarded=await signedRequest([{webhookEventId:'qa_'+crypto.randomUUID(),type:'message',timestamp:Date.now(),source:{userId:'qa_synthetic_user'}}]);
  log({test:'signed',verified,rejected,guarded,
   pass:verified.status===200&&verified.json?.status==='verified'&&rejected.status===401&&rejected.json?.error==='INVALID_SIGNATURE'&&guarded.status===503&&guarded.json?.error==='DURABLE_INGESTION_NOT_READY',
   note:'ทดสอบ metadata จำลอง ไม่มีข้อความหรือข้อมูลสุขภาพ ไม่บันทึก secret'});
 }finally{key=null}
});}
document.querySelector('#signed').onclick=()=>checkSigned();
document.querySelector('#inbox').onclick=()=>checkSigned(true);
