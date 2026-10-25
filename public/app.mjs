// Synthetic, in-memory UX prototype. No network, storage, or medical instructions.
const initial = () => [
  { id: 'demo-morning', time: '08:00', title: 'รอบเช้า · ยาตัวอย่าง A', state: 'taken' },
  { id: 'demo-evening', time: '18:00', title: 'รอบเย็น · ยาตัวอย่าง B', state: 'pending' },
];
let doses = initial();
const labels = { pending: 'รอการยืนยัน (ตัวอย่าง)', taken: 'รายงานว่าทานแล้ว (ตัวอย่าง)', 'not-taken': 'รายงานว่ายังไม่ทาน (ตัวอย่าง)' };
const list = document.querySelector('#doses');
const feedback = document.querySelector('#feedback');
function render() {
  list.replaceChildren();
  for (const dose of doses) {
    const article = document.createElement('article'); article.className = 'dose';
    const head = document.createElement('div'); head.className = 'dose-head';
    const title = document.createElement('div');
    const time = document.createElement('div'); time.className = 'time'; time.textContent = dose.time;
    const name = document.createElement('h3'); name.textContent = dose.title;
    title.append(time, name);
    const status = document.createElement('span'); status.className = `status ${dose.state}`; status.textContent = labels[dose.state];
    head.append(title, status); article.append(head);
    if (dose.state === 'pending') {
      const actions = document.createElement('div'); actions.className = 'actions';
      for (const [state, text] of [['taken', 'ทดลอง: ทานแล้ว'], ['not-taken', 'ทดลอง: ยังไม่ทาน']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
        button.className = state === 'taken' ? 'primary' : 'secondary';
        button.setAttribute('aria-label', `${text} สำหรับ${dose.title}`);
        button.addEventListener('click', () => {
          if (dose.state !== 'pending') return;
          dose.state = state; render();
          feedback.textContent = `เปลี่ยนสถานะตัวอย่างรอบ ${dose.time} แล้ว ไม่มีการบันทึกหรือส่งข้อมูลจริง`;
          document.querySelector('#reset').focus();
        }); actions.append(button);
      }
      article.append(actions);
    }
    list.append(article);
  }
  document.querySelector('#summary').textContent = `รายงานว่าทานแล้ว ${doses.filter(d => d.state === 'taken').length}/${doses.length} รอบ`;
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(tab => tab.removeAttribute('aria-current'));
  button.setAttribute('aria-current', 'page');
  document.querySelectorAll('.panel').forEach(panel => { panel.hidden = panel.id !== button.dataset.tab; });
  feedback.textContent = '';
}));
document.querySelector('#reset').addEventListener('click', () => {
  doses = initial(); render(); feedback.textContent = 'เริ่มข้อมูลตัวอย่างใหม่แล้ว';
});
render();
