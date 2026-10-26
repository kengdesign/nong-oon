import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleRequest } from '../src/webhook.mjs';

test('D1 QA button signs fixed fixtures, clears secret, guards real data and does not claim SQL proof', async () => {
  const html=readFileSync(new URL('../public/staging-qa.html',import.meta.url),'utf8');
  assert.ok(html.includes('src="/staging-qa.mjs"'));
  assert.ok(!html.includes('<style>') && !html.includes('<script type="module">'));
  const script=readFileSync(new URL('../public/staging-qa.mjs',import.meta.url),'utf8');
  const secret='test-only-ui-secret', nodes={};
  for(const id of ['result','channelSecret','basic','burst','recovery','paced','signed','inbox']) nodes['#'+id]={value:'',textContent:'',disabled:false};
  nodes['#channelSecret'].value=secret;
  const rows=new Map(), requests=[];
  const DB={prepare(sql){return {bind(...values){return {sql,values};}};},async batch(statements){
    for(const {values} of statements) if(!rows.has(values[0])) rows.set(values[0],values);
    return statements.map(()=>({success:true}));
  }};
  const context=vm.createContext({crypto,TextEncoder,Uint8Array,btoa,performance,AbortController,setTimeout,clearTimeout,
    location:{hostname:'staging.nongoon.com',protocol:'https:',host:'staging.nongoon.com'},
    document:{querySelector:s=>nodes[s],querySelectorAll:()=>Object.entries(nodes).filter(([k])=>!['#result','#channelSecret'].includes(k)).map(([,v])=>v)},
    fetch:async(path,options)=>{
      requests.push({path,body:options.body});
      return handleRequest(new Request('https://staging.nongoon.com'+path,options),{
        APP_ENV:'staging',DELIVERY_ENABLED:'false',INGESTION_ENABLED:'false',SYNTHETIC_INGESTION_ENABLED:'true',LINE_CHANNEL_SECRET:secret,DB,
      });
    },
  });
  vm.runInContext(script,context);
  await nodes['#inbox'].onclick();
  const result=JSON.parse(nodes['#result'].textContent);
  assert.equal(result.handlerPass,true);
  assert.equal(result.databaseVerified,false);
  assert.equal(nodes['#channelSecret'].value,'');
  assert.equal(rows.size,1);
  assert.equal(requests.length,4);
  assert.ok(requests.every(r=>r.path==='/webhook/line'&&!r.body.includes(secret)));
});
