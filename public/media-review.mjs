// Same-origin authenticated review only; no localStorage, third-party URLs or AI calls.
const root=document.querySelector('#media-view'),feedback=document.querySelector('#media-feedback');
let session,patientId,busy=false,refreshTimer=null,refreshCount=0;
function stopRefresh(){if(refreshTimer!==null){clearTimeout(refreshTimer);refreshTimer=null;}}
const words={label:'ชื่อรายการตามฉลาก',strength:'ความแรงตามฉลาก',dose:'จำนวนต่อครั้งตามฉลาก',instructions:'วิธีใช้และคำแนะนำ',
  times:'เวลาแจ้งเตือน (เช่น 08:00,18:00)',weekdays:'วันในสัปดาห์',startDate:'วันที่เริ่ม',endDate:'วันที่สิ้นสุด (เว้นว่างได้)',useMode:'ลักษณะการใช้'};
const errors={MEDIA_RETRY_UNAVAILABLE:'อ่านใหม่ไม่ได้ ร่างอาจมีการแก้ไขแล้วหรือครบจำนวนครั้ง กรุณาตรวจรายการล่าสุด',MEDIA_DISABLED:'ฟีเจอร์ภาพและเสียงยังไม่เปิดใช้งาน',MEDIA_PROVIDER_NOT_CONFIGURED:'กำลังเตรียมบริการอ่านภาพและเสียง',
  MEDIA_SCHEDULE_CHANGED:'ตารางมีการเปลี่ยนแปลง กรุณาโหลดและตรวจร่างใหม่',MEDIA_REVIEW_CHANGED:'ร่างเปลี่ยนหรือหมดอายุ กรุณาตรวจใหม่',
  MEDIA_CONFIRMATION_CONFLICT:'บันทึกไม่ได้ อาจมีรายการซ้ำหรือตารางเปลี่ยนแล้ว กรุณาตรวจรายการล่าสุด',
  MEDIA_DRAFT_UNAVAILABLE:'ร่างนี้หมดอายุ ถูกยกเลิก หรือบันทึกแล้ว',MEDIA_REGIMEN_UNSUPPORTED:'รายการนี้ต้องตรวจเพิ่มเติม กรุณาใช้การกรอกตารางเอง',
  MEDIA_REVIEW_INCOMPLETE:'กรุณากรอกข้อมูลและตรวจยืนยันให้ครบ',MEDIA_REVIEW_INVALID_SCHEDULE:'กรุณาตรวจวันและเวลาให้ถูกต้อง'};
function node(tag,text,attrs={}){const el=document.createElement(tag);if(text!==null)el.textContent=text;for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
const card=(title,...children)=>{const el=node('section',null,{class:'media-card'});el.append(node('h2',title),...children);return el;};
function button(text,action){const el=node('button',text,{type:'button'});el.addEventListener('click',()=>task(action));return el;}
async function api(path,method='GET',body){const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),
  headers:{accept:'application/json',...(method==='GET'?{}:{'content-type':'application/json','x-csrf-token':session?.csrf??''})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(errors[data.error]??(r.status===401?'กรุณาเข้าใช้ผ่าน LINE อีกครั้ง':'ทำรายการไม่สำเร็จ กรุณาโหลดใหม่'));return data;}
const base=()=>`/api/media/patients/${encodeURIComponent(patientId)}`;
async function task(action){if(busy)return;busy=true;root.setAttribute('aria-busy','true');feedback.textContent='';
  const controls=[...root.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>{el.disabled=true;});
  try{await action();}catch(error){feedback.textContent=error.message;}finally{busy=false;root.setAttribute('aria-busy','false');controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});}}
function field(form,key,value){const label=node('label',words[key]),input=node(key==='instructions'?'textarea':'input',null,{name:key,...(key==='instructions'?{}:{type:['startDate','endDate'].includes(key)?'date':'text'}),...(key==='endDate'?{}:{required:''})});
  input.value=Array.isArray(value)?value.join(','):value??'';if(value===null&&!['startDate','endDate'].includes(key))input.setAttribute('placeholder','ไม่พบในภาพ — กรอกจากข้อมูลที่คุณตรวจสอบแล้ว');if(!['times','weekdays','startDate','endDate'].includes(key))input.maxLength=key==='instructions'?240:120;
  label.append(input);form.append(label);return input;}
async function render({automatic=false}={}){stopRefresh();if(!automatic)refreshCount=0;session=await api('/api/session');if(!session.authenticated){root.replaceChildren(card('เข้าใช้ก่อนตรวจร่าง',node('a','เข้าใช้ผ่าน LINE',{href:'/auth/login'})));return;}
  const data=await api('/api/patients');const own=data.patients.filter(p=>p.role==='owner');
  if(!own.length){root.replaceChildren(card('ยังไม่มีพื้นที่ดูแล',node('a','กลับไปสร้างพื้นที่ดูแล',{href:'/'})));return;}
  if(!own.some(p=>p.id===patientId))patientId=own[0].id;
  const label=node('label','พื้นที่ดูแลของฉัน'),select=node('select',null);for(const p of own){const option=node('option',p.displayName,{value:p.id});option.selected=p.id===patientId;select.append(option);}label.append(select);
  select.addEventListener('change',()=>{patientId=select.value;task(render);});root.replaceChildren(label);
  const consent=await api(base()+'/consent');
  root.append(card('ภาพและเสียงของคุณ',node('p',`ผู้ประมวลผลที่เลือก: ${consent.provider}`),
    node('p','ใช้ภาพ/เสียงเพื่อเตรียมร่างตาราง จำกัดการเข้าถึงต้นฉบับ 24 ชั่วโมง แล้วเข้าคิวลบ การลบจริงอาจล่าช้าหากบริการขัดข้อง คุณถอนความยินยอมได้โดยไม่ลบตารางที่เคยยืนยัน'),
    consent.consented?button('ถอนความยินยอมภาพและเสียง',async()=>{await api(base()+'/consent','DELETE');await render();}):
      button('ยินยอมให้ประมวลผลภาพและเสียง',async()=>{await api(base()+'/consent','POST',{consent:true,version:consent.version});await render();})));
  if(!consent.consented)return;
  const {jobs}=await api(base()+'/jobs');root.append(button('โหลดรายการล่าสุด',render));
  if(!jobs.length)root.append(node('p','ยังไม่มีร่าง ส่งภาพฉลากหรือเสียงผ่านห้องแชทน้องอุ่นเมื่อบริการเปิดรับแล้ว'));
  for(const job of jobs){const state={queued:'รับงานแล้ว รออ่านข้อมูล',processing:'กำลังอ่าน',awaiting_review:'รอคุณตรวจ',confirmed:'บันทึกแล้ว',failed:'อ่านไม่สำเร็จ',cancelled:'ยกเลิกแล้ว',expired:'หมดอายุ'}[job.state]??'กำลังตรวจ';
    root.append(card(job.sourceKind==='voice'?'ร่างจากเสียง':'ร่างจากภาพ',node('p',state),...(job.state==='awaiting_review'?[button('เปิดตรวจร่าง',()=>openJob(job.id))]:[]),
      ...(['queued','processing','awaiting_review'].includes(job.state)?[button('ยกเลิกร่างนี้',()=>cancelJob(job.id))]:[])));}
  if(jobs.some(job=>['queued','processing'].includes(job.state))){
    root.append(node('p',refreshCount<24?'กำลังรออ่านข้อมูล หน้านี้ตรวจสถานะให้ทุก 15 วินาที คุณไม่ต้องส่งภาพซ้ำ':'ยังรอประมวลผล กดโหลดรายการล่าสุดเพื่อตรวจอีกครั้ง ไม่ต้องส่งภาพซ้ำ'));
    if(refreshCount<24){refreshCount++;refreshTimer=setTimeout(()=>task(()=>render({automatic:true})),15000);}
  }
}
function cancelJob(id){stopRefresh();
  const section=card('ยกเลิกร่างนี้หรือไม่',node('p','ระบบจะหยุดใช้ร่างและเข้าคิวลบต้นฉบับ การลบจริงอาจล่าช้า ตารางที่เคยยืนยันแล้วจะยังอยู่'),
    button('กลับรายการ',render),button('ยืนยันยกเลิกร่าง',async()=>{await api(base()+`/jobs/${encodeURIComponent(id)}`,'DELETE');await render();feedback.textContent='ยกเลิกร่างแล้ว และเข้าคิวลบต้นฉบับ';}));
  root.replaceChildren(section);
}
async function openJob(id){stopRefresh();const path=base()+`/jobs/${encodeURIComponent(id)}`,view=await api(path);const container=card('ตรวจเทียบกับต้นฉบับ',button('กลับรายการ',render));root.replaceChildren(container);
  container.append(node(view.sourceKind==='voice'?'audio':'img',null,view.sourceKind==='voice'?{src:path+'/source',controls:'',preload:'none'}:{src:path+'/source',alt:'ภาพต้นฉบับสำหรับตรวจข้อมูล'}));
  if(view.draft.sourceText){const details=node('details',null);details.append(node('summary','ข้อความที่ OCR อ่านได้ — อาจอ่านผิด กรุณาเทียบภาพ'),node('pre',view.draft.sourceText));container.append(details);}
  if(!view.reviews.length&&view.sourceKind==='printed_label')container.append(button(view.draft.sourceText?'แยกข้อความเดิมใหม่ (ไม่เรียก OCR)':'อ่านภาพเดิมใหม่',()=>{
    container.replaceChildren(node('p',view.draft.sourceText?'แยกข้อมูลจากข้อความ OCR เดิมอีกครั้งโดยไม่เรียกผู้ให้บริการ ผลร่างเดิมจะถูกแทนที่ และไม่เติมข้อมูลวันเวลาให้เอง':'อ่านภาพเดิมด้วยบริการ OCR อีกครั้ง อาจมีค่าบริการ และผลร่างเดิมจะถูกแทนที่ ข้อมูลวันเวลาจะไม่ถูกเติมให้เอง'),
      button('กลับไปตรวจร่าง',()=>openJob(id)),button(view.draft.sourceText?'ยืนยันแยกข้อความเดิมใหม่':'ยืนยันอ่านภาพเดิมใหม่',async()=>{await api(path+'/retry','POST',{acknowledge:true});await render();}));
  }));
  view.draft.items.forEach((item,i)=>{const existing=view.reviews.find(r=>r.itemIndex===i);if(existing?.confirmed){container.append(card(`รายการ ${i+1}`,node('p','บันทึกแล้ว')));return;}
    const section=card(`รายการ ${i+1}`);container.append(section);
    section.append(node('pre',Object.entries(item.fields).map(([key,f])=>`${words[key]}: ${f.value===null?'อ่านไม่ได้ / ไม่ระบุ':Array.isArray(f.value)?f.value.join(','):f.value}${f.evidence?'\nข้อความต้นทาง: '+f.evidence:''}`).join('\n\n')));
    if(item.notes?.length)section.append(card('บันทึกช่วยตรวจ — ไม่ใช่ข้อมูลที่ยืนยันแล้ว',...item.notes.map(n=>node('p',`${n.text}\nข้อความต้นทาง: ${n.evidence}`))));
    if(item.fields.useMode.value==='as_needed'||view.draft.sourceKind==='pill_photo'){section.append(node('p',errors.MEDIA_REGIMEN_UNSUPPORTED));return;}
    if(item.issues.length)section.append(node('p','มีข้อมูลที่อ่านไม่ชัดหรืออาจซ้ำ กรุณาตรวจจากฉลากและแก้ให้ถูกต้อง',{class:'media-note'}));
    section.append(node('p','ข้อมูลที่ไม่พบจะเว้นว่าง คุณกรอกหรือแก้ไขได้จากฉลากหรือคำแนะนำที่ตรวจสอบแล้ว ระบบไม่เติมจำนวนและเวลาให้เอง'));
    const reference=view.references?.[i];
    if(reference){const info=card('ข้อมูลอ้างอิงยา — กรุณาตรวจยืนยัน',node('p',`ชื่อการค้า: ${reference.tradeName} | สารสำคัญ: ${reference.ingredient} | ความแรง: ${reference.strength}`),
      node('p',`ผู้ผลิต: ${reference.manufacturer??'ไม่ระบุในแหล่งอ้างอิง'} | กลุ่มยา: ${reference.category}`),node('p',`เลขทะเบียนอ้างอิง: ${reference.registration} | รูปแบบ: ${reference.form??'ไม่ระบุ'} | ผู้รับอนุญาต: ${reference.licenseHolder??'ไม่ระบุ'}`),node('p',`ข้อมูลทะเบียน ณ ${reference.recordAsOf??'ไม่ระบุ'} ไม่ยืนยันสถานะทะเบียนปัจจุบัน กรุณาเทียบเลขทะเบียนบนฉลาก`),node('a','ทะเบียน อย. (ข้อมูลอ้างอิง ไม่ใช่คำสั่งใช้ยา)',{href:reference.source,target:'_blank',rel:'noopener noreferrer'}));section.append(info);}
    const form=node('form',null),inputs={};section.append(form);const saved=existing?.snapshot;
    for(const key of ['label','strength','dose','instructions','times','weekdays','startDate','endDate'])inputs[key]=field(form,key,
      saved?(key==='strength'||key==='dose'||key==='instructions'?saved[key]:saved.schedule[key]):item.fields[key].value);
    form.append(node('p','วันในสัปดาห์: 0=อาทิตย์, 1=จันทร์, 2=อังคาร, 3=พุธ, 4=พฤหัส, 5=ศุกร์, 6=เสาร์ คั่นด้วยเครื่องหมายจุลภาค'));
    const check=node('input',null,{type:'checkbox',required:''}),checkLabel=node('label','ฉันตรวจต้นฉบับ ชื่อยา ความแรง จำนวน วิธีใช้ วันและเวลาแล้ว และแก้ข้อมูลที่คลุมเครือแล้ว');checkLabel.prepend(check);form.append(checkLabel,node('button','ตรวจสรุปก่อนบันทึก',{type:'submit'}));
    form.addEventListener('submit',event=>{event.preventDefault();if(!check.checked)return;
      const schedule=Object.fromEntries(['label','instructions','startDate'].map(k=>[k,inputs[k].value.trim()]));schedule.endDate=inputs.endDate.value||null;
      schedule.times=inputs.times.value.split(',').map(v=>v.trim());schedule.weekdays=inputs.weekdays.value.split(',').map(v=>v.trim()).map(v=>/^\d$/.test(v)?Number(v):NaN);
      task(async()=>{const r=await api(path+`/reviews/${i}`,'PUT',{expectedReviewVersion:existing?.version??0,expectedScheduleVersion:view.currentVersion,
        sourceChecked:true,issuesResolved:true,useMode:'scheduled',strength:inputs.strength.value.trim(),dose:inputs.dose.value.trim(),schedule});
        const preview=card('ยืนยันตารางที่ตรวจแล้ว',node('pre',`${r.snapshot.schedule.label}\nความแรง: ${inputs.strength.value.trim()}\nจำนวนต่อครั้ง: ${inputs.dose.value.trim()}\n${r.snapshot.schedule.instructions}\nเวลา: ${r.snapshot.schedule.times.join(', ')}\nวัน: ${r.snapshot.schedule.weekdays.join(', ')}\nเริ่ม: ${r.snapshot.schedule.startDate}\nสิ้นสุด: ${r.snapshot.schedule.endDate??'ไม่ระบุ'}`));
        section.replaceChildren(preview);const confirmationId=crypto.randomUUID();
        preview.append(button('กลับไปแก้',()=>openJob(id)),button('ยืนยันบันทึกตารางและเปิดรายการนี้',async()=>{
          await api(path+`/reviews/${i}/confirm`,'POST',{confirmationId,expectedReviewVersion:r.reviewVersion,expectedScheduleVersion:r.expectedScheduleVersion,acknowledge:true});
          await render();feedback.textContent='บันทึกตารางแล้ว การส่ง LINE ยังขึ้นกับสถานะบริการ';}));});});
  });
}
task(render);
