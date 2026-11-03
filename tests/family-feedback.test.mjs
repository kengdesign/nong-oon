// Execute the actual family component with a minimal DOM; this is not a handset rendering test.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('cancelling unused invitations writes only to the family component and navigation clears global feedback',async()=>{
 const source=readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8');
 class Node{constructor(tag,attrs,...children){this.tag=tag;this.attrs=attrs;this.children=children.flat();this.textContent=attrs?.text??'';}append(...children){this.children.push(...children.flat());}querySelector(tag){return this.children.find(c=>c?.tag===tag);} }
 const el=(tag,attrs,...children)=>new Node(tag,attrs,...children),text=(tag,value)=>el(tag,{text:value}),buttons=[];let action,requests=0,cleared=0,rendered=0;
 const context={el,text,card:(title,children)=>el('section',{},...children),button:(label,fn)=>{const node=el('button',{text:label,fn});buttons.push(node);return node;},state:{members:[],session:{actorId:'owner'}},confirmDialog:(a,b,c,fn)=>{action=fn;},api:async()=>{requests++;},selectedPath:()=>'/synthetic/invites',closeDialog:()=>{},notify:()=>{throw Error('Family result must not enter global feedback');},feedbackController:{clear:()=>{cleared++;}},renderDashboard:()=>{rendered++;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function familyPanel('),source.indexOf('async function printCareSummary('))+'\n'+source.match(/function showTab\(tab\) \{[^\n]+/)[0]+'\nthis.make=familyPanel;this.navigate=showTab;',context);
 const panel=context.make(true);buttons.find(b=>b.textContent==='ยกเลิกรหัสเชิญที่ยังไม่ได้ใช้').attrs.fn();assert.equal(requests,0);await action();assert.equal(requests,1);
 const descendants=node=>[node,...node.children.filter(c=>c instanceof Node).flatMap(descendants)];const status=descendants(panel).find(n=>n.attrs?.class==='family-invite-status');assert.equal(status.textContent,'ยกเลิกรหัสเชิญที่ยังไม่ได้ใช้แล้ว');assert.equal(status.attrs.role,'status');
 context.navigate('today');assert.equal(cleared,1);assert.equal(rendered,1);assert.equal(context.state.tab,'today');
});
