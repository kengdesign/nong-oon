import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedback} from '../public/feedback.mjs';
test('feedback expires, navigation clears it and replacement cancels the old timer',()=>{
 const timers=new Map();let id=0;const classes=new Set();
 const node={textContent:'',classList:{remove:c=>classes.delete(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)}};
 const feedback=createFeedback(node,{schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id)});
 feedback.show('first');feedback.show('second',true);assert.equal(timers.size,1);assert.equal(node.textContent,'second');
 [...timers.values()][0]();assert.equal(node.textContent,'');assert.equal(classes.has('error'),false);
 feedback.show('family');feedback.clear();assert.equal(node.textContent,'');assert.equal(timers.size,0);
});
