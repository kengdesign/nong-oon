// Credentials and care records stay in memory. The server decides identity and permissions.
const $ = selector => document.querySelector(selector);
const view = $('#view');
const dialog = $('#app-dialog');
const dialogContent = $('#dialog-content');
const feedback = $('#feedback');
const timezone = 'Asia/Bangkok';
const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const state = { session: null, patients: [], patient: null, schedules: [], doses: [], members: [], currentVersion: 1, tab: 'today', busy: false, showHistory: false };
const labels = { pending: 'รอการตอบรับ', reported_taken: 'รายงานว่าทานแล้ว', reported_not_taken: 'รายงานว่ายังไม่ทาน', cancelled: 'ยกเลิกรอบนี้แล้ว' };
const errors = {
  UNAUTHENTICATED: 'หมดเวลาเข้าใช้แล้ว กรุณาเข้าใช้ผ่าน LINE อีกครั้ง',
  SESSION_EXPIRED: 'หมดเวลาเข้าใช้แล้ว กรุณาเข้าใช้ผ่าน LINE อีกครั้ง',
  FORBIDDEN: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการ หรือสิทธิ์ถูกถอนแล้ว',
  CSRF_FAILED: 'กรุณาโหลดหน้าใหม่ แล้วลองทำรายการอีกครั้ง',
  INVALID_CSRF: 'กรุณาโหลดหน้าใหม่ แล้วลองทำรายการอีกครั้ง',
  STALE_VERSION: 'ตารางยามีการเปลี่ยนแปลงแล้ว กรุณาตรวจข้อมูลล่าสุดอีกครั้ง',
  STALE_SCHEDULE: 'ตารางยามีการเปลี่ยนแปลงแล้ว กรุณาตรวจข้อมูลล่าสุดอีกครั้ง',
  VERSION_CONFLICT: 'ตารางยามีการเปลี่ยนแปลงแล้ว กรุณาตรวจข้อมูลล่าสุดอีกครั้ง',
  COMMAND_REJECTED: 'รอบยานี้เปลี่ยนสถานะแล้ว หรืออยู่นอกช่วงเวลารับคำตอบ กรุณาตรวจข้อมูลล่าสุด',
  INVITE_INVALID: 'รหัสเชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว',
  INVALID_INVITE: 'รหัสเชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว',
  CONSENT_REQUIRED: 'ต้องให้ความยินยอมก่อนใช้พื้นที่ดูแล',
  PATIENT_NOT_FOUND: 'ไม่พบพื้นที่ดูแล หรือเจ้าของข้อมูลถอนสิทธิ์แล้ว',
  PATIENT_ALREADY_EXISTS_OR_RETENTION_LIMIT: 'บัญชีนี้มีพื้นที่ของตัวเองอยู่แล้ว หรือกำลังอยู่ในช่วงจัดเก็บหลังถอนความยินยอม',
  PATIENT_OR_PILOT_LIMIT: 'บัญชีนี้มีพื้นที่อยู่แล้ว หรือรอบทดลองครบจำนวนพื้นที่ที่รองรับ กรุณาตรวจพื้นที่ของคุณหรือติดต่อผู้ดูแลบริการ',
  CARE_DISABLED: 'พื้นที่ดูแลยังไม่เปิดใช้งาน โปรดลองใหม่ภายหลัง',
  SERVICE_DISABLED: 'พื้นที่ดูแลยังไม่เปิดใช้งาน โปรดลองใหม่ภายหลัง',
  QUOTA_EXCEEDED: 'จำนวนรายการถึงขีดจำกัดแล้ว กรุณาพักรายการที่ไม่ใช้ก่อน',
  RATE_LIMITED: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
};
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'required') node[key] = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(text, onClick, className = 'secondary', attrs = {}) { return el('button', { type: 'button', class: className, onclick: onClick, ...attrs }, text); }
function text(tag, value, className) { return el(tag, { class: className || '', text: value }); }
function notify(message, error = false) { feedback.textContent = message; feedback.classList.toggle('error', error); }
function todayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key).value).join('-');
}
function dateTime(value, options = {}) { return new Intl.DateTimeFormat('th-TH', { timeZone: timezone, ...options }).format(new Date(value)); }
function dateLabel(value) { return dateTime(value, { day: 'numeric', month: 'short', year: 'numeric' }); }
function timeLabel(value) { return dateTime(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
function isToday(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k).value).join('-') === todayDate();
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' };
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = state.session?.csrf || ''; }
  let response;
  try { response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw Object.assign(new Error('เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'), { status: 0 }); }
  let data;
  try { data = response.status === 204 ? {} : await response.json(); }
  catch { throw new Error('เปิดข้อมูลไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'); }
  if (!response.ok) {
    const code = data.error || data.code;
    const message = errors[code] || (response.status === 401 ? errors.UNAUTHENTICATED : response.status === 403 ? errors.FORBIDDEN : response.status === 409 ? errors.VERSION_CONFLICT : response.status === 400 ? 'ข้อมูลยังไม่ครบหรือรูปแบบไม่ถูกต้อง กรุณาตรวจรายการอีกครั้ง' : 'ทำรายการไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
    throw Object.assign(new Error(message), { status: response.status, code });
  }
  return data;
}
async function task(fn, control) {
  if (state.busy) return;
  state.busy = true;
  if (control) control.disabled = true;
  view.setAttribute('aria-busy', 'true');
  try { await fn(); }
  catch (error) {
    notify(error.message || 'ทำรายการไม่สำเร็จ กรุณาลองใหม่', true);
    if (error.status === 401) { state.session = null; state.patient = null; state.patients = []; closeDialog(); await start(); }
    else if ((error.status === 403 || error.status === 409) && state.session?.authenticated) {
      closeDialog(); await loadPatients().catch(() => {});
    }
  } finally { state.busy = false; if (control?.isConnected) control.disabled = false; view.setAttribute('aria-busy', 'false'); }
}
function empty(title, description, action) { return el('div', { class: 'empty' }, el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '○'), text('h3', title), text('p', description), action); }
function closeDialog() { dialog.close(); dialogContent.replaceChildren(); }
function openDialog(title, content, actions) {
  dialogContent.replaceChildren(el('div', { class: 'dialog-heading' }, text('h2', title), button('×', closeDialog, 'secondary', { 'aria-label': 'ปิดหน้าต่าง' })), content, ...(actions ? [actions] : []));
  dialogContent.querySelector('h2').id = 'dialog-title';
  dialog.showModal();
}
function confirmDialog(title, description, label, action) {
  const ok = button(label, event => task(async () => { await action(); closeDialog(); }, event.currentTarget), 'danger');
  openDialog(title, text('p', description), el('div', { class: 'dialog-actions' }, button('กลับไปก่อน', closeDialog), ok));
}
function card(title, children, className = '') { return el('section', { class: `card ${className}` }, title ? text('h2', title) : null, ...children); }
function updateBadge() {
  const features = state.session?.features;
  const badge = $('#service-badge');
  if (!features) { badge.textContent = 'กำลังเชื่อมต่อ'; badge.className = 'service-badge'; return; }
  badge.textContent = features.deliveryEnabled ? 'เปิดการส่งเตือน' : 'ยังไม่ส่งแจ้งเตือน';
  badge.className = `service-badge ${features.deliveryEnabled ? 'live' : 'test'}`;
}
function serviceNotice() {
  const f = state.session?.features;
  if (f?.deliveryEnabled && f?.schedulerEnabled) return null;
  return el('aside', { class: 'notice' }, text('strong', 'ยังไม่ส่งแจ้งเตือนผ่าน LINE'), text('p', f?.careEnabled ? 'คุณดูและจัดการข้อมูลได้ตามสิทธิ์ แต่ยังไม่ควรพึ่งการแจ้งเตือนจากบริการนี้' : 'ระบบอยู่ระหว่างเตรียมเปิดใช้งาน พื้นที่ดูแลและการส่งเตือนยังไม่เปิดให้ใช้ข้อมูลจริง'));
}
function renderLogin() {
  const configured = state.session?.features?.loginConfigured && state.session?.features?.careEnabled;
  const login = configured ? el('a', { href: '/auth/login', class: 'button primary' }, 'เข้าใช้ผ่าน LINE') : button('เข้าใช้ผ่าน LINE', () => {}, 'primary', { disabled: true });
  view.replaceChildren(
    el('section', { class: 'hero' }, el('div', {}, text('p', 'พื้นที่เล็ก ๆ สำหรับความใส่ใจ', 'eyebrow'), text('h1', 'เรื่องยาในทุกวัน\nดูแลกันให้อุ่นใจ'), text('p', 'จัดตารางเตือน บันทึกการตอบรับ และชวนคนในครอบครัวมาช่วยดูแล โดยคุณเป็นคนเลือกสิทธิ์การเข้าถึง'), login, configured ? text('p', 'เข้าใช้ด้วยบัญชี LINE ของคุณ ไม่ต้องตั้งรหัสผ่านเพิ่ม', 'hint') : text('p', 'กำลังเตรียมระบบเข้าใช้ เมื่อพร้อมแล้วปุ่มนี้จะเปิดให้ใช้งาน', 'hint')),
      el('div', { class: 'hero-art', 'aria-hidden': 'true' }, el('img', { class: 'hero-logo', src: '/logo-nongoon.png', alt: '', width: '290', height: '290' }))),
    serviceNotice(),
    el('section', { class: 'steps', 'aria-label': 'เริ่มใช้น้องอุ่น' }, ...[['01', 'เริ่มจากตัวคุณ', 'เข้าใช้ผ่าน LINE แล้วให้ความยินยอมสำหรับข้อมูลของคุณเอง'], ['02', 'ตั้งตามฉลากยา', 'ใส่ชื่อยา วิธีใช้ และเวลาที่คุณตรวจสอบแล้ว'], ['03', 'ดูแลไปด้วยกัน', 'บันทึกการตอบรับ หรือเชิญผู้ดูแลที่คุณไว้ใจ']].map(([number, title, description]) => el('article', { class: 'step' }, text('span', number, 'number'), text('h3', title), text('p', description)))),
    text('p', 'การตอบรับเป็นสิ่งที่ผู้ใช้รายงาน ไม่ใช่หลักฐานว่าทานยาจริง และการไม่ตอบรับไม่ใช่การวินิจฉัยเหตุฉุกเฉิน', 'muted'));
}
function profileForm() {
  const name = el('input', { name: 'displayName', autocomplete: 'nickname', maxlength: '80', required: true, placeholder: 'ชื่อที่อยากให้เรียก' });
  const consent = el('input', { type: 'checkbox', required: true, name: 'consent' });
  const submit = el('button', { type: 'submit', class: 'primary' }, 'สร้างพื้นที่ดูแลของฉัน');
  return el('form', { class: 'form', onsubmit: event => {
    event.preventDefault();
    if (!consent.checked || !name.value.trim()) return;
    task(async () => {
      const result = await api('/api/patients', { method: 'POST', body: { displayName: name.value.trim(), consent: true, consentVersion: state.session.consentVersion || '2026-10-26' } });
      closeDialog(); await loadPatients(result.patient?.id); notify('สร้างพื้นที่ดูแลแล้ว เริ่มเพิ่มตารางยาได้เลย');
    }, submit);
  } }, el('label', {}, 'ชื่อที่ใช้ในพื้นที่ดูแล', name), text('p', 'สร้างสำหรับข้อมูลของคุณเอง การเข้าถึงข้อมูลของผู้อื่นต้องใช้รหัสเชิญจากเจ้าของข้อมูล', 'hint'),
    el('label', { class: 'check' }, consent, el('span', {}, 'ฉันยินยอมให้น้องอุ่นใช้ข้อมูลบัญชี ตารางยา และการตอบรับของฉัน เพื่อให้บริการดูแลตามที่ฉันเลือก ฉันสามารถถอนความยินยอมได้ ', el('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'อ่านรายละเอียด'))), submit);
}
function acceptInviteForm() {
  const code = el('input', { name: 'invite', autocomplete: 'off', spellcheck: 'false', maxlength: '64', minlength: '64', pattern: '[a-fA-F0-9]{64}', required: true, placeholder: 'วางรหัสเชิญที่ได้รับ' });
  const submit = el('button', { type: 'submit', class: 'secondary' }, 'รับคำเชิญ');
  return el('form', { class: 'form', onsubmit: event => {
    event.preventDefault();
    task(async () => { const result = await api('/api/invites/accept', { method: 'POST', body: { code: code.value.trim().toLowerCase() } }); await loadPatients(result.patientId); closeDialog(); notify('เข้าร่วมพื้นที่ดูแลแล้ว'); }, submit);
  } }, text('p', 'ใช้รหัสจากเจ้าของข้อมูลโดยตรง คุณจะดูตารางยาและบันทึกการตอบรับได้ตามสิทธิ์ที่ได้รับ', 'small'), el('label', {}, 'รหัสเชิญ', code), submit);
}
function renderOnboarding() {
  view.replaceChildren(el('section', { class: 'welcome' }, el('div', {}, text('p', 'ยินดีต้อนรับสู่น้องอุ่น', 'eyebrow'), text('h1', 'เริ่มดูแลกันได้จากตรงนี้')), button('ออกจากระบบ', logout, 'secondary compact')), serviceNotice(),
    card('สร้างพื้นที่ดูแลของฉัน', [profileForm()]), card('ได้รับคำเชิญจากคนในครอบครัว?', [acceptInviteForm()]));
}
function selectedPath(suffix = '') { return `/api/patients/${encodeURIComponent(state.patient.id)}${suffix}`; }
function showTab(tab) { state.tab = tab; renderDashboard(); }
function renderDashboard() {
  const owner = state.patient.role === 'owner';
  const selector = el('select', { 'aria-label': 'เลือกพื้นที่ดูแล', onchange: event => task(() => loadPatient(event.target.value), event.target) }, ...state.patients.map(p => el('option', { value: p.id, selected: p.id === state.patient.id ? 'selected' : null }, `${p.displayName}${p.role === 'owner' ? ' · ฉัน' : ' · ผู้ดูแล'}`)));
  const nav = el('nav', { class: 'tabs', 'aria-label': 'พื้นที่ดูแล' }, ...[['today', 'รอบยา'], ['meds', 'ตารางยา'], ['family', 'ผู้ดูแล'], ['settings', 'ตั้งค่า']].map(([id, label]) => button(label, () => showTab(id), '', { 'aria-current': state.tab === id ? 'page' : null })));
  const panel = state.tab === 'today' ? todayPanel() : state.tab === 'meds' ? schedulesPanel(owner) : state.tab === 'family' ? familyPanel(owner) : settingsPanel(owner);
  view.replaceChildren(el('section', { class: 'welcome' }, el('div', {}, text('p', dateLabel(Date.now()), 'eyebrow'), text('h1', 'วันนี้ ดูแลกันให้อุ่นใจ')), el('div', { class: 'account-actions' }, button('รีเฟรช', event => task(() => loadPatients(state.patient.id), event.currentTarget), 'secondary compact'), button('ออกจากระบบ', logout, 'secondary compact'))), serviceNotice(),
    el('div', { class: 'patient-bar' }, el('label', {}, 'พื้นที่ดูแลของ', selector), !state.patients.some(p => p.role === 'owner') ? button('สร้างพื้นที่ของฉัน', () => openDialog('สร้างพื้นที่ดูแลของฉัน', profileForm()), 'secondary compact') : null, button('รับรหัสเชิญ', () => openDialog('รับคำเชิญผู้ดูแล', acceptInviteForm()), 'secondary compact')), nav, panel);
}
function todayPanel() {
  const panel = el('section', { 'aria-labelledby': 'today-title' });
  const doses = state.doses.filter(d => state.showHistory || isToday(d.dueAt)).sort((a, b) => a.dueAt - b.dueAt);
  const taken = doses.filter(d => d.status === 'reported_taken').length;
  panel.append(el('div', { class: 'section-heading' }, el('div', {}, text('h2', state.showHistory ? 'การตอบรับล่าสุด' : 'รอบยาวันนี้'), text('p', `รายงานว่าทานแล้ว ${taken} / ${doses.length} รอบ`, 'summary')), button(state.showHistory ? 'ดูวันนี้' : 'ดูรายการล่าสุด', () => { state.showHistory = !state.showHistory; renderDashboard(); }, 'secondary compact')));
  panel.querySelector('h2').id = 'today-title';
  panel.append(text('p', 'สถานะแสดงสิ่งที่ผู้ใช้รายงาน กรุณาตรวจชื่อยาและฉลากก่อนบันทึก เวลาแสดงตามประเทศไทย', 'muted'));
  if (!doses.length) {
    const haveSchedules = state.schedules.some(s => s.active);
    panel.append(empty('ยังไม่มีรอบยาให้แสดง', haveSchedules ? 'รอบยาจะแสดงเมื่อระบบจัดเตรียมตารางเตือนแล้ว คุณยังตรวจตารางยาที่บันทึกไว้ได้' : 'เพิ่มตารางยาที่คุณตรวจสอบจากฉลากแล้ว เพื่อเตรียมรอบเตือนของคุณ', button('ดูตารางยา', () => showTab('meds'), 'primary')));
  }
  for (const dose of doses) {
    const now = Date.now();
    const pending = dose.status === 'pending';
    const stale = dose.scheduleVersion !== state.currentVersion;
    const expired = pending && now >= dose.expiresAt;
    const future = pending && now < dose.dueAt;
    const label = stale && pending ? 'ตารางเดิม · รับคำตอบไม่ได้' : expired ? 'พ้นช่วงรับคำตอบ' : future ? 'ยังไม่ถึงเวลา' : labels[dose.status] || 'กำลังตรวจสถานะ';
    const className = dose.status === 'reported_taken' ? 'taken' : dose.status === 'reported_not_taken' ? 'not-taken' : dose.status === 'cancelled' ? 'cancelled' : '';
    const article = el('article', { class: 'dose' }, el('div', { class: 'dose-head' }, el('div', {}, text('div', timeLabel(dose.dueAt), 'time'), text('h3', dose.label || 'รอบยาตามตาราง'), state.showHistory ? text('p', dateLabel(dose.dueAt), 'small') : null), text('span', label, `dose-status ${className}`)));
    if (stale) article.append(text('p', 'ตารางเดิม · เก็บไว้เป็นประวัติ ไม่ใช้เป็นรอบเตือนปัจจุบัน', 'hint'));
    if (dose.instructions) article.append(text('p', dose.instructions, 'instructions'));
    if (dose.changedAt) article.append(text('p', `บันทึก ${timeLabel(dose.changedAt)} น. · ${dateLabel(dose.changedAt)}`, 'hint'));
    if (pending && !stale && !expired && !future) article.append(el('div', { class: 'actions' }, ...[['report_taken', 'ทานแล้ว', 'primary'], ['report_not_taken', 'ยังไม่ทาน', 'secondary']].map(([type, title, cls]) => button(title, event => task(async () => {
      await api(selectedPath(`/doses/${encodeURIComponent(dose.doseId)}/report`), { method: 'POST', body: { type, commandId: crypto.randomUUID(), scheduleVersion: dose.scheduleVersion } });
      await loadPatient(state.patient.id); notify(type === 'report_taken' ? 'บันทึกว่าทานแล้วเรียบร้อย' : 'บันทึกว่ายังไม่ทานเรียบร้อย');
    }, event.currentTarget), cls, { 'aria-label': `${title} สำหรับ ${dose.label || 'รอบยา'} เวลา ${timeLabel(dose.dueAt)}` }))));
    panel.append(article);
  }
  return panel;
}
function schedulesPanel(owner) {
  const panel = el('section', { 'aria-labelledby': 'meds-title' }, el('div', { class: 'section-heading' }, text('h2', 'ตารางยา'), owner ? button('+ เพิ่มตาราง', () => scheduleDialog(), 'primary compact') : null), text('p', 'ใส่เวลาและวิธีใช้ตามฉลากหรือคำสั่งผู้ประกอบวิชาชีพ ระบบไม่คำนวณหรือแนะนำขนาดยา', 'muted'));
  panel.querySelector('h2').id = 'meds-title';
  if (!owner) panel.append(text('p', 'คุณมีสิทธิ์ดูและบันทึกการตอบรับ เจ้าของข้อมูลเป็นผู้แก้ไขตารางยา', 'owner-only-note'));
  if (!state.schedules.length) panel.append(empty('ยังไม่มีตารางยา', 'เตรียมฉลากยา แล้วเพิ่มชื่อยา วิธีใช้ และเวลาที่ตรวจสอบแล้ว', owner ? button('เพิ่มตารางแรก', () => scheduleDialog(), 'primary') : null));
  for (const schedule of state.schedules) {
    const days = schedule.weekdays.length === 7 ? 'ทุกวัน' : schedule.weekdays.map(d => dayNames[d]).join(' ');
    const content = [el('div', { class: 'card-heading' }, text('h3', schedule.label), text('span', schedule.active ? 'ใช้งาน' : 'พักตาราง', `tag ${schedule.active ? '' : 'paused'}`)), text('p', schedule.instructions || 'ไม่ได้ระบุวิธีใช้', 'instructions'),
      el('div', { class: 'schedule-meta' }, ...schedule.times.map(t => text('span', `${t} น.`, 'tag'))), text('p', days, 'small'), text('p', `เริ่ม ${schedule.startDate}${schedule.endDate ? ` · ถึง ${schedule.endDate}` : ' · ไม่กำหนดวันสิ้นสุด'}`, 'hint')];
    if (owner) content.push(el('div', { class: 'actions' }, button('แก้ไข', () => scheduleDialog(schedule), 'secondary compact'), button(schedule.active ? 'พักตารางนี้' : 'เปิดตารางนี้', () => confirmDialog(schedule.active ? 'พักตารางยานี้?' : 'เปิดตารางยานี้?', 'การเปลี่ยนแปลงจะใช้กับรอบต่อจากนี้ รอบที่ยังรอคำตอบในตารางเดิมจะรับคำตอบไม่ได้ ส่วนประวัติที่บันทึกแล้วคงเดิม', schedule.active ? 'ยืนยันพักตาราง' : 'ยืนยันเปิดตาราง', async () => {
      const { id, patientId, version, updatedAt, ...body } = schedule;
      await api(selectedPath(`/schedules/${encodeURIComponent(id)}`), { method: 'PUT', body: { ...body, active: !schedule.active, expectedVersion: state.currentVersion } });
      await loadPatient(state.patient.id); notify(schedule.active ? 'พักตารางแล้ว รอบเก่าจะไม่ส่งเตือนเพิ่ม' : 'เปิดตารางแล้ว');
    }), 'secondary compact')));
    panel.append(card(null, content));
  }
  return panel;
}
function scheduleDialog(schedule) {
  const label = el('input', { name: 'label', value: schedule?.label || '', maxlength: '120', required: true, placeholder: 'ชื่อยาตามฉลาก' });
  const instructions = el('textarea', { name: 'instructions', maxlength: '500', required: true, rows: '3', placeholder: 'พิมพ์วิธีใช้ที่ตรวจสอบจากฉลากแล้ว' }, schedule?.instructions || '');
  const startDate = el('input', { type: 'date', name: 'startDate', required: true, value: schedule?.startDate || todayDate() });
  const endDate = el('input', { type: 'date', name: 'endDate', value: schedule?.endDate || '' });
  const times = (schedule?.times || ['08:00']).map(value => el('input', { type: 'time', value, required: true, 'aria-label': 'เวลาเตือน' }));
  const timesList = el('div', { class: 'time-inputs' });
  const drawTimes = () => {
    timesList.replaceChildren(...times.map((input, i) => el('div', { class: 'time-entry' }, input, times.length > 1 ? button('×', () => { times.splice(i, 1); drawTimes(); }, 'secondary compact', { 'aria-label': `ลบเวลาเตือนที่ ${i + 1}` }) : null)));
    addTime.disabled = times.length >= 8;
  };
  const addTime = button('+ เพิ่มเวลา', () => { if (times.length < 8) { times.push(el('input', { type: 'time', value: '18:00', required: true, 'aria-label': 'เวลาเตือน' })); drawTimes(); } }, 'secondary compact');
  drawTimes();
  const weekdays = dayNames.map((day, i) => el('input', { type: 'checkbox', value: i, checked: schedule ? schedule.weekdays.includes(i) : true, 'aria-label': `วัน${['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'][i]}` }));
  const submit = el('button', { type: 'submit', class: 'primary' }, 'ตรวจแล้ว บันทึกตาราง');
  const form = el('form', { class: 'form', onsubmit: event => {
    event.preventDefault();
    const selectedDays = weekdays.filter(input => input.checked).map(input => Number(input.value));
    const selectedTimes = times.map(input => input.value).sort();
    if (!selectedDays.length) { notify('กรุณาเลือกอย่างน้อย 1 วัน', true); return; }
    if (new Set(selectedTimes).size !== selectedTimes.length) { notify('เวลาเตือนซ้ำกัน กรุณาตรวจอีกครั้ง', true); return; }
    if (endDate.value && endDate.value < startDate.value) { endDate.setCustomValidity('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'); endDate.reportValidity(); return; }
    task(async () => {
      const body = { label: label.value.trim(), instructions: instructions.value.trim(), times: selectedTimes, weekdays: selectedDays, startDate: startDate.value, endDate: endDate.value || null, active: schedule?.active ?? true, expectedVersion: state.currentVersion };
      await api(selectedPath(`/schedules${schedule ? `/${encodeURIComponent(schedule.id)}` : ''}`), { method: schedule ? 'PUT' : 'POST', body });
      closeDialog(); await loadPatient(state.patient.id); notify('บันทึกตารางแล้ว กรุณาตรวจวันและเวลาอีกครั้ง');
    }, submit);
  } }, el('label', {}, 'ชื่อยา / ชื่อรายการ', label), el('label', {}, 'วิธีใช้ตามฉลาก', instructions, text('span', 'ระบบจะใช้ข้อความที่คุณกรอก โปรดตรวจชื่อและวิธีใช้ให้ถูกต้อง', 'hint')),
    el('fieldset', {}, el('legend', {}, 'เวลาเตือน (เวลาประเทศไทย)'), timesList, el('div', { class: 'actions' }, addTime)), el('fieldset', {}, el('legend', {}, 'วันที่ต้องการเตือน'), el('div', { class: 'weekday-list' }, ...weekdays.map((input, i) => el('label', { class: 'weekday' }, input, dayNames[i])))),
    el('div', { class: 'form-row' }, el('label', {}, 'วันเริ่ม', startDate), el('label', {}, 'วันสิ้นสุด (ถ้ามี)', endDate)),
    el('aside', { class: 'notice' }, text('strong', 'ก่อนบันทึกตาราง'), text('p', 'ตารางใหม่ใช้กับรอบต่อจากนี้ รอบที่ยังรอคำตอบในตารางเดิมจะรับคำตอบไม่ได้ ส่วนประวัติที่บันทึกแล้วจะคงเดิม')),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', required: true }), text('span', 'ฉันตรวจชื่อยา วิธีใช้ วัน และเวลา ตามฉลากหรือคำสั่งของผู้ประกอบวิชาชีพแล้ว')),
    el('div', { class: 'dialog-actions' }, button('กลับไปก่อน', closeDialog), submit));
  endDate.addEventListener('input', () => endDate.setCustomValidity(''));
  startDate.addEventListener('input', () => endDate.setCustomValidity(''));
  openDialog(schedule ? 'แก้ไขตารางยา' : 'เพิ่มตารางยา', form);
}
function familyPanel(owner) {
  const panel = el('section', { 'aria-labelledby': 'family-title' }, text('h2', 'ดูแลไปด้วยกัน'), text('p', 'ผู้ดูแลที่ได้รับคำเชิญจะเห็นตารางยาและสถานะการตอบรับ เจ้าของข้อมูลเลือกและถอนสิทธิ์ได้', 'muted'));
  panel.querySelector('h2').id = 'family-title';
  if (!owner) { panel.append(card('คุณเป็นผู้ดูแลในพื้นที่นี้', [text('p', 'คุณดูข้อมูลและบันทึกการตอบรับตามสิทธิ์ที่ได้รับ หากต้องการแก้ตารางหรือเปลี่ยนผู้ดูแล กรุณาติดต่อเจ้าของข้อมูล')])); return panel; }
  const members = state.members.filter(m => m.revokedAt === null || m.revokedAt === undefined);
  panel.append(card('คนในพื้นที่ดูแล', members.length ? members.map((member, index) => el('div', { class: 'member' }, el('div', {}, text('strong', member.role === 'owner' ? 'ฉัน · เจ้าของข้อมูล' : `ผู้ดูแล ${members.slice(0, index + 1).filter(m => m.role !== 'owner').length}`), text('p', member.actorId === state.session.actorId ? 'บัญชีของคุณ' : `รหัสบัญชี …${member.actorId.slice(-6)}`)), member.role !== 'owner' ? button('ถอนสิทธิ์', () => confirmDialog('ถอนสิทธิ์ผู้ดูแล?', 'ผู้ดูแลบัญชีนี้จะเข้าถึงพื้นที่นี้หรือบันทึกการตอบรับไม่ได้อีก กรุณาตรวจรหัสบัญชีก่อนยืนยัน', 'ถอนสิทธิ์', async () => { await api(selectedPath(`/members/${encodeURIComponent(member.actorId)}`), { method: 'DELETE' }); await loadPatient(state.patient.id); notify('ถอนสิทธิ์ผู้ดูแลแล้ว'); }), 'danger compact') : text('span', 'เจ้าของ', 'tag'))) : [text('p', 'ยังไม่มีผู้ดูแลที่ได้รับสิทธิ์') ]));
  panel.append(card('ชวนคนที่คุณไว้ใจ', [text('p', 'สร้างรหัสเชิญแล้วส่งให้ผู้ดูแลด้วยตัวคุณเอง รหัสใช้ได้ครั้งเดียวและมีวันหมดอายุ', 'small'), button('สร้างรหัสเชิญ', () => {
    const consent = el('input', { type: 'checkbox', required: true });
    const submit = el('button', { type: 'submit', class: 'primary' }, 'ยินยอมและสร้างรหัส');
    const form = el('form', { class: 'form', onsubmit: event => {
      event.preventDefault(); if (!consent.checked) return;
      task(async () => {
        const result = await api(selectedPath('/invites'), { method: 'POST', body: { consent: true } });
        openDialog('รหัสเชิญผู้ดูแล', el('div', {}, text('p', 'ส่งรหัสนี้ให้เฉพาะคนที่คุณต้องการให้เข้าถึงข้อมูล อย่าเผยแพร่ในที่สาธารณะ'), text('code', result.code, 'code-box'), text('p', `หมดอายุ ${dateLabel(result.expiresAt)} เวลา ${timeLabel(result.expiresAt)} น. · ใช้ได้ครั้งเดียว`, 'hint'), el('div', { class: 'actions' }, button('คัดลอกรหัส', event => task(async () => { if (!navigator.clipboard?.writeText) { notify('กรุณาเลือกรหัสด้านบนแล้วคัดลอก'); return; } await navigator.clipboard.writeText(result.code); notify('คัดลอกรหัสแล้ว'); }, event.currentTarget), 'primary'), button('เสร็จแล้ว', closeDialog))));
      }, submit);
    } }, text('p', 'ผู้ที่ได้รับรหัสและเข้าใช้ผ่าน LINE จะมีสิทธิ์ดูตารางยาและบันทึกการตอบรับของคุณ'), el('label', { class: 'check' }, consent, text('span', 'ฉันยินยอมเปิดเผยข้อมูลในพื้นที่นี้ให้ผู้ดูแลที่ฉันจะส่งรหัสให้')), submit);
    openDialog('เลือกเปิดเผยข้อมูลให้ผู้ดูแล', form);
  }, 'primary')]));
  return panel;
}
function settingsPanel(owner) {
  const panel = el('section', { 'aria-labelledby': 'settings-title' }, text('h2', 'ตั้งค่าพื้นที่ดูแล'));
  panel.querySelector('h2').id = 'settings-title';
  panel.append(card('สถานะการแจ้งเตือน', [text('p', state.session.features?.deliveryEnabled ? 'ระบบเปิดส่งเตือนแล้ว การส่งขึ้นกับสิทธิ์ LINE ของผู้รับและสถานะตารางยา' : 'ยังไม่เปิดส่งแจ้งเตือนผ่าน LINE'), text('p', 'เพิ่มบัญชีทางการน้องอุ่นเป็นเพื่อนและไม่บล็อกบัญชี เพื่อให้ LINE รับการแจ้งเตือนได้เมื่อเปิดบริการ', 'small'), text('p', 'เมื่อยังไม่มีการตอบรับ ผู้ดูแลอาจได้รับข้อความให้ตรวจสอบตามที่ตั้งไว้ การไม่ตอบไม่ใช่การวินิจฉัยเหตุฉุกเฉิน', 'small')]));
  if (owner) panel.append(card('ข้อมูลและความยินยอม', [text('p', `พื้นที่ดูแล: ${state.patient.displayName}`), state.patient.consentedAt ? text('p', `ให้ความยินยอมเมื่อ ${dateLabel(state.patient.consentedAt)}`, 'small') : null, el('div', { class: 'actions' }, button('ดาวน์โหลดข้อมูลของฉัน', event => task(async () => {
    const data = await api(selectedPath('/export'));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = el('a', { href: url, download: 'nong-oon-my-data.json' }); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('เตรียมไฟล์ข้อมูลแล้ว โปรดเก็บไฟล์นี้ในที่ปลอดภัย');
  }, event.currentTarget), 'secondary'), button('ถอนความยินยอม', () => confirmDialog('ถอนความยินยอม?', 'พื้นที่นี้จะหยุดใช้งาน ผู้ดูแลจะไม่เห็นข้อมูล และการแจ้งเตือนที่ยังไม่ส่งจะหยุด ข้อมูลที่ต้องจัดเก็บชั่วคราวจะถูกลบตามนโยบาย กรุณาดาวน์โหลดข้อมูลที่ต้องการเก็บไว้ก่อน', 'ถอนความยินยอม', async () => { await api(selectedPath('/consent'), { method: 'DELETE' }); state.patient = null; await loadPatients(); notify('ถอนความยินยอมแล้ว พื้นที่นี้หยุดใช้งาน'); }), 'danger'))]));
  panel.append(card('ใช้งานอย่างเข้าใจ', [text('p', 'ไม่เปลี่ยนวิธีใช้หรือเพิ่มขนาดยาเพราะพลาดการแจ้งเตือน โปรดปรึกษาผู้ประกอบวิชาชีพเมื่อไม่แน่ใจ', 'small'), el('a', { href: '/help.html' }, 'อ่านวิธีใช้น้องอุ่น'), el('br'), el('a', { href: '/privacy.html' }, 'อ่านข้อมูลและความเป็นส่วนตัว')]));
  return panel;
}
async function logout(event) {
  await task(async () => { await api('/auth/logout', { method: 'POST', body: {} }); state.session = null; state.patient = null; state.patients = []; state.schedules = []; state.doses = []; state.members = []; closeDialog(); await start(); notify('ออกจากระบบแล้ว'); }, event?.currentTarget);
}
async function loadPatients(preferredId) {
  const data = await api('/api/patients'); state.patients = data.patients;
  if (!state.patients.length) { state.patient = null; renderOnboarding(); return; }
  const selected = state.patients.find(p => p.id === preferredId) || state.patients.find(p => p.id === state.patient?.id) || state.patients[0];
  await loadPatient(selected.id);
}
async function loadPatient(id) {
  const path = `/api/patients/${encodeURIComponent(id)}`;
  const overview = await api(path);
  const [schedules, doses, members] = await Promise.all([api(`${path}/schedules`), api(`${path}/doses`), overview.canManage ? api(`${path}/members`) : Promise.resolve({ members: [] })]);
  state.patient = { ...overview.patient, role: overview.canManage ? 'owner' : 'caregiver' };
  state.schedules = schedules.schedules; state.doses = doses.doses; state.members = members.members;
  state.currentVersion = schedules.currentVersion;
  renderDashboard();
}
async function start() {
  view.setAttribute('aria-busy', 'true');
  try {
    state.session = await api('/api/session'); updateBadge();
    if (!state.session.authenticated) renderLogin();
    else if (!state.session.features?.careEnabled) {
      view.replaceChildren(text('h1', 'ยินดีต้อนรับสู่น้องอุ่น'), serviceNotice(), button('ออกจากระบบ', logout, 'secondary'));
    } else {
      const requested = new URL(location.href).searchParams.get('patient');
      await loadPatients(requested && /^[a-zA-Z0-9_-]{1,128}$/.test(requested) ? requested : undefined);
    }
  } catch (error) {
    view.replaceChildren(empty('เปิดพื้นที่ดูแลไม่สำเร็จ', error.message || 'กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', button('ลองอีกครั้ง', () => task(start), 'primary')));
    $('#service-badge').textContent = 'ยังเชื่อมต่อไม่ได้';
  } finally { view.setAttribute('aria-busy', 'false'); }
}
dialog.addEventListener('cancel', () => { dialogContent.replaceChildren(); });
// Refresh due windows and revoked permissions without persistent browser storage.
function refreshVisible() {
  if (document.visibilityState !== 'visible' || !state.session?.authenticated
    || !state.session.features?.careEnabled || state.busy || dialog.open) return;
  // Do not replace a select while a keyboard or assistive-technology user operates it.
  if (view.contains(document.activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const active = document.activeElement;
  const key = active && view.contains(active) && active.tagName === 'BUTTON'
    ? { label: active.getAttribute('aria-label'), text: active.textContent } : null;
  task(async () => {
    await loadPatients(state.patient?.id);
    if (key) {
      const replacement = [...view.querySelectorAll('button')].find(node => key.label
        ? node.getAttribute('aria-label') === key.label : node.textContent === key.text);
      replacement?.focus({ preventScroll: true });
    }
  });
}
document.addEventListener('visibilitychange', refreshVisible);
setInterval(refreshVisible, 30000);
await start();
