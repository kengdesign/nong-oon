// Telephone fallback only. A saved contact is not permission to send LINE messages.
export function validateEmergencyContacts(contacts) {
  if(!Array.isArray(contacts)||contacts.length>3)throw Error('INVALID_CONTACTS');
  return contacts.map((c,index)=>{
    if(!c||Object.keys(c).sort().join(',')!=='name,phone'||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||/[\u0000-\u001f\u007f]/u.test(c.name)||typeof c.phone!=='string')throw Error('INVALID_CONTACTS');
    const phone=c.phone.replace(/[ ()-]/g,'');
    if(!/^\+?[0-9]{8,15}$/.test(phone))throw Error('INVALID_CONTACTS');
    return {priority:index+1,name:c.name.trim(),phone};
  });
}
// Escalation is an explicit plan; never claims a call connected or a message delivered.
export function emergencyCallPlan(contacts){return validateEmergencyContacts(contacts.map(({name,phone})=>({name,phone}))).map(c=>({...c,href:`tel:${c.phone}`}));}
