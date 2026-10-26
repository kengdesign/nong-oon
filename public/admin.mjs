// No identity, invite code, or session is stored in browser persistence.
const view=document.querySelector('#admin-view'), feedback=document.querySelector('#admin-feedback');
const dialog=document.querySelector('#admin-dialog'), dialogContent=document.querySelector('#admin-dialog-content');
let session=null, busy=false;
const errors={ADMIN_DISABLED:'ระบบแอดมินร่วมยังไม่เปิดใช้งาน',ADMIN_FORBIDDEN:'บัญชีนี้ไม่มีสิทธิ์บริหารบริการ',
  ADMIN_OWNER_REQUIRED:'เฉพาะเจ้าของระบบเท่านั้นที่จัดการแอดมินได้',ADMIN_INVITE_INVALID:'รหัสเชิญไม่ตรงกับบัญชี หมดอายุ ถูกถอน หรือใช้ไปแล้ว',
  ADMIN_INVITE_UNAVAILABLE:'สร้างคำเชิญไม่ได้ กรุณาตรวจว่าหุ้นส่วนเข้าใช้ผ่าน LINE แล้ว ไม่มีคำเชิญค้าง และยังไม่ครบ 5 แอดมิน',
  INVALID_ADMIN_INPUT:'กรุณาตรวจรหัสบัญชีให้ถูกต้อง',ADMIN_NOT_FOUND:'รายการนี้เปลี่ยนแปลงแล้ว กรุณาโหลดใหม่',
  RATE_LIMITED:'ทำรายการถี่เกินไป กรุณารอสักครู่',CSRF_REJECTED:'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'};
function node(tag,text,attrs={}) {
  const el=document.createElement(tag); if(text!==null) el.textContent=text;
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
}
const time=value=>new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
function button(label,action) { const el=node('button',label,{type:'button',class:'secondary'});el.addEventListener('click',()=>task(action));return el; }
function card(title,...children) { const el=node('section',null,{class:'card'});el.append(node('h2',title),...children);return el; }
async function api(path,method='GET',body) {
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{accept:'application/json',...(method==='GET'?{}:{'content-type':'application/json','x-csrf-token':session?.csrf??''})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(errors[data.error]??(response.status===401?'กรุณาเข้าใช้ผ่าน LINE อีกครั้ง':'ทำรายการไม่สำเร็จ กรุณาลองใหม่')),{code:data.error});
  return data;
}
async function task(action) {
  if(busy) return;busy=true;view.setAttribute('aria-busy','true');feedback.textContent='';
  document.querySelectorAll('button').forEach(el=>{el.disabled=true;});
  try {await action();} catch(error) {feedback.textContent=error.message??'เชื่อมต่อไม่สำเร็จ';}
  finally {busy=false;view.setAttribute('aria-busy','false');document.querySelectorAll('button').forEach(el=>{el.disabled=false;});}
}
function confirmAction(title,description,action) {
  dialogContent.replaceChildren(node('h2',title,{id:'admin-dialog-title'}),node('p',description),
    button('ยกเลิก',async()=>dialog.close()),button('ยืนยัน',async()=>{dialog.close();await action();}));
  dialog.showModal();
}
function inputForm(label,hint,onSubmit,{pattern,minlength,maxlength,submitLabel='ดำเนินการ',placeholder=''}={}) {
  const form=node('form',null), caption=node('label',label), input=node('input',null,{type:'text',required:'',autocomplete:'off',spellcheck:'false',
    ...(pattern?{pattern}:{}),...(minlength?{minlength}:{}),...(maxlength?{maxlength}:{})});
  input.setAttribute('placeholder',placeholder);
  caption.append(input);const submit=node('button',submitLabel,{type:'submit',class:'primary'});
  form.append(caption,node('p',hint,{class:'small'}),submit);
  form.addEventListener('submit',event=>{event.preventDefault();task(()=>onSubmit(input.value.trim()));});
  return form;
}
async function render() {
  session=await api('/api/session');
  if(!session.authenticated) {view.replaceChildren(node('p','เข้าใช้ด้วยบัญชี LINE ของคุณก่อน'),node('a','เข้าใช้ผ่าน LINE',{href:'/auth/login',class:'button primary'}));return;}
  const identityHint=node('p','รหัสนี้ใช้ระบุบัญชีที่คุณเข้าสู่ระบบ ไม่ใช่รหัสผ่านหรือรหัสคำเชิญ');
  const identity=card('รหัสบัญชีของคุณ',identityHint,node('code',session.actorId));
  view.replaceChildren(identity);
  let admin;
  try {admin=await api('/api/admin/session');} catch(error) {
    if(error.code==='ADMIN_DISABLED') {view.append(card('กำลังเตรียมระบบแอดมินร่วม',node('p',errors.ADMIN_DISABLED)));return;}
    throw error;
  }
  view.append(node('p',`สิทธิ์ของคุณ: ${{owner:'เจ้าของระบบ',admin:'แอดมินร่วม',none:'ยังไม่มีสิทธิ์แอดมิน'}[admin.role]}`));
  identityHint.textContent=admin.role==='owner'
    ? 'คุณเป็นเจ้าของระบบแล้ว ไม่ต้องนำรหัสของคุณไปกรอกด้านล่าง หากยังไม่เชิญหุ้นส่วน สามารถปล่อยช่องด้านล่างว่างไว้ได้'
    : admin.role==='none'
      ? 'ขั้นตอนที่ 1: คัดลอกรหัสบัญชีของคุณด้านล่าง ส่งให้เจ้าของระบบเพื่อสร้างคำเชิญ รหัสนี้ไม่ใช่รหัสผ่านหรือรหัสคำเชิญ'
      : 'รหัสนี้ใช้ระบุบัญชีแอดมินร่วมของคุณ ไม่ใช่รหัสผ่านหรือรหัสคำเชิญ';
  if(admin.role==='none') {
    view.append(card('ขั้นตอนที่ 2: รับสิทธิ์แอดมินร่วม',inputForm('รหัสคำเชิญที่ได้รับจากเจ้าของระบบ','เมื่อเจ้าของสร้างคำเชิญแล้ว ให้นำรหัสคำเชิญที่เขาส่งกลับมาใส่ช่องนี้ ไม่ใช่รหัสบัญชีที่ขึ้นต้นด้วย U คำเชิญใช้ได้ครั้งเดียว เฉพาะบัญชีของคุณ และหมดอายุใน 24 ชั่วโมง',async code=>{
      confirmAction('รับสิทธิ์แอดมินร่วม?','คุณจะเข้าดูสถานะการทำงานของบริการได้ สิทธิ์นี้ไม่รวมข้อมูลยาของผู้ใช้',async()=>{
        await api('/api/admin/invites/accept','POST',{code});await render();feedback.textContent='รับสิทธิ์แอดมินร่วมแล้ว';
      });
    },{pattern:'[0-9a-f]{64}',minlength:64,maxlength:64,submitLabel:'รับสิทธิ์แอดมินร่วม',placeholder:'วางรหัสคำเชิญจากเจ้าของระบบ'})));
    return;
  }
  const status=await api('/api/admin/status');
  const health=node('ul',null);
  health.append(node('li',`สภาพแวดล้อม: ${status.environment}`),node('li',`ส่ง LINE: ${status.deliveryEnabled?'เปิด':'ปิด'}`),node('li',`จัดรอบยา: ${status.schedulerEnabled?'เปิด':'ปิด'}`));
  for(const item of status.operations) health.append(node('li',`${item.task}: สำเร็จล่าสุด ${time(item.lastOkAt)}`));
  view.append(card('สถานะบริการ',health),button('รีเฟรช',render));
  if(admin.role!=='owner') return;
  const steps=node('ol',null);
  steps.append(node('li','ส่งลิงก์หน้านี้ให้หุ้นส่วน: https://staging.nongoon.com/admin.html'),
    node('li','ให้หุ้นส่วนเข้าสู่ระบบด้วย LINE ของเขา แล้วคัดลอก “รหัสบัญชีของคุณ” ส่งมาให้คุณ'),
    node('li','วางรหัสที่หุ้นส่วนส่งมาในช่องด้านล่าง แล้วกด “สร้างคำเชิญให้หุ้นส่วน”'),
    node('li','คัดลอกรหัสคำเชิญที่ระบบแสดง ส่งกลับให้หุ้นส่วนใช้รับสิทธิ์ในหน้านี้ ภายใน 24 ชั่วโมง'));
  view.append(card('เชิญหุ้นส่วนเป็นแอดมินร่วม',steps,
    node('p','แอดมินร่วมดูสถานะระบบได้ แต่เชิญเพิ่มหรือถอนสิทธิ์คนอื่นไม่ได้ และไม่ได้สิทธิ์ดูข้อมูลยาของผู้ใช้ รองรับสูงสุด 5 คน'),
    inputForm('วางรหัสบัญชีที่หุ้นส่วนส่งมา','ใช้รหัสบัญชีของหุ้นส่วนที่ขึ้นต้นด้วย U ตามด้วยตัวเลขและตัวอักษร 32 ตัว ไม่ใช่ LINE ID ชื่อใน LINE หรือรหัสบัญชีของคุณด้านบน',async targetActorId=>{
      confirmAction('สร้างคำเชิญแอดมินร่วม?',`บัญชีเป้าหมาย: ${targetActorId}`,async()=>{
        const invitation=await api('/api/admin/invites','POST',{targetActorId});await render();
        dialogContent.replaceChildren(node('h2','รหัสเชิญแอดมินร่วม',{id:'admin-dialog-title'}),node('p',`ส่งให้บัญชี ${invitation.targetActorId} เท่านั้น หมดอายุ ${time(invitation.expiresAt)}`),
          node('code',invitation.code),node('p','คัดลอกรหัสคำเชิญนี้ส่งกลับให้หุ้นส่วน นำไปกรอกช่อง “รหัสคำเชิญที่ได้รับจากเจ้าของระบบ” ในหน้านี้ รหัสแสดงครั้งเดียว กรุณาคัดลอกก่อนปิด'),button('ปิด',async()=>{dialogContent.replaceChildren();dialog.close();}));dialog.showModal();
      });
    },{pattern:'U[0-9a-f]{32}',minlength:33,maxlength:33,submitLabel:'สร้างคำเชิญให้หุ้นส่วน',placeholder:'วางรหัสบัญชีของหุ้นส่วนที่ขึ้นต้นด้วย U'})));
  const data=await api('/api/admin/members'),members=node('div',null);
  if(!data.members.length) members.append(node('p','ยังไม่มีแอดมินร่วม'));
  for(const member of data.members) {
    const row=node('article',null);row.append(node('p',`${member.actorId} · ${member.revokedAt?'ถอนสิทธิ์แล้ว':'ใช้งานอยู่'}`));
    if(!member.revokedAt) row.append(button('ถอนสิทธิ์',async()=>confirmAction('ถอนสิทธิ์แอดมินร่วม?',`บัญชี ${member.actorId} จะหมดสิทธิ์บริหารบริการทันที`,async()=>{
      await api(`/api/admin/members/${encodeURIComponent(member.actorId)}`,'DELETE');await render();
    })));
    members.append(row);
  }
  view.append(card('แอดมินร่วม',members));
  const pending=node('div',null);
  if(!data.invitations.length) pending.append(node('p','ไม่มีคำเชิญรอรับ'));
  for(const invite of data.invitations) {
    const row=node('article',null);row.append(node('p',`${invite.targetActorId} · หมดอายุ ${time(invite.expiresAt)}`),button('ยกเลิกคำเชิญ',async()=>confirmAction('ยกเลิกคำเชิญ?',invite.targetActorId,async()=>{
      await api(`/api/admin/invites/${invite.id}`,'DELETE');await render();
    })));pending.append(row);
  }
  view.append(card('คำเชิญที่รอรับ',pending));
  const audit=await api('/api/admin/audit'),log=node('ul',null);
  const names={invite_created:'สร้างคำเชิญ',invite_revoked:'ยกเลิกคำเชิญ',admin_granted:'รับสิทธิ์แอดมิน',admin_revoked:'ถอนสิทธิ์แอดมิน'};
  for(const event of audit.events) log.append(node('li',`${time(event.createdAt)} · ${names[event.action]??event.action} · ${event.targetActorId}`));
  view.append(card('ประวัติการจัดการสิทธิ์',log));
}
dialog.addEventListener('close',()=>dialogContent.replaceChildren());
task(render);
